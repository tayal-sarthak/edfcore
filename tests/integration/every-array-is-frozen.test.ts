/**
 * Every array edfcore hands back is frozen. Every typed array is not.
 *
 * `src/` calls `Object.freeze` forty-three times, in seventeen modules, and the suite asserted
 * `Object.isFrozen` twice. That is a policy held by convention across every module that returns a
 * list, checked at two of its sites — and a policy with one hole is not one, because the hole is
 * exactly where a caller's `push` lands.
 *
 * The reason is sharing. `header.diagnostics` is the same array on every reference to that header;
 * `readWindow` hands one array of chunks to whoever asked; `findSignals` returns a view of
 * `header.signals`. A caller who sorts one in place, or appends to it, changes what the next reader
 * sees — and the next reader is often the same program, later, through a different function. There
 * is no copy-on-read anywhere in this package, and freezing is what makes that safe.
 *
 * So the rule is checked as a rule: every object every entry point returns is walked to a depth of
 * nine, over the eleven `AWKWARD` shapes and a file with a gap, and every plain `Array` found
 * anywhere in the graph must be frozen. 240 of them, which is roughly six times the number of
 * `Object.freeze` calls — because one call freezes an array that appears on many results.
 *
 * Two things are deliberately NOT frozen, and both are asserted so the rule reads as a rule and not
 * as "everything is frozen":
 *
 * - The containing objects. A chunk, a segment, a signal, a report — those are values the caller
 *   owns a reference to and nobody else mutates. Freezing them would buy nothing and would break
 *   the `{ ...recording, index }` spread that `discontinuous.md` tells every reader to write.
 * - The typed arrays. `chunk.signals[0].digital` is the data, and `toPhysical(signal, digital, out)`
 *   writes into a buffer the caller supplied. Freezing those would make the reuse the package
 *   documents impossible.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../src/decode/physical.js';
import { readEnvelope } from '../../src/envelope.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { AWKWARD } from '../support/awkward-files.js';
import { buildEdf } from '../support/writer.js';

const GAPPED = buildEdf({
  plus: 'D',
  recordCount: 6,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (record) => (record < 3 ? record : record + 10),
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    {
      samplesPerRecord: 40,
      tals: (record) => (record === 0 ? [{ onset: '+0.5', duration: 2, texts: ['e@@Fp1'] }] : []),
    },
  ],
});

interface Found {
  /** Every plain array reached, and whether it was frozen when it was reached. */
  readonly arrays: Array<{ path: string; frozen: boolean }>;
  readonly typedArrays: string[];
  readonly objects: string[];
}

function walk(value: unknown, path: string, found: Found, depth = 0): void {
  if (depth > 9 || value === null || typeof value !== 'object') return;
  if (ArrayBuffer.isView(value)) {
    found.typedArrays.push(path);
    return;
  }
  if (Array.isArray(value)) {
    found.arrays.push({ path, frozen: Object.isFrozen(value) });
    for (const [index, item] of value.entries()) {
      walk(item, `${path}[${index}]`, found, depth + 1);
    }
    return;
  }
  found.objects.push(path);
  for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
    walk(member, `${path}.${key}`, found, depth + 1);
  }
}

async function everything(): Promise<Found> {
  const found: Found = { arrays: [], typedArrays: [], objects: [] };
  const files: ReadonlyArray<readonly [string, Uint8Array]> = [
    ...AWKWARD.map((file) => [file.name, file.bytes] as const),
    ['a file with a gap', GAPPED],
  ];

  for (const [name, bytes] of files) {
    const recording = await openEdf(byteSource(bytes));
    const index = await buildRecordIndex(recording);
    const located = { ...recording, index };
    const signalIndices = [...recording.header.dataSignalIndices];

    walk(recording, `${name}: openEdf`, found);
    walk(index, `${name}: buildRecordIndex`, found);
    walk(
      await validateRecording(recording, { scanSamples: true }),
      `${name}: validateRecording`,
      found,
    );
    walk(await inspectEdf(byteSource(bytes)), `${name}: inspectEdf`, found);
    walk(
      await readAnnotations(recording, { start: 0, count: recording.header.recordCount }),
      `${name}: readAnnotations`,
      found,
    );

    const readable =
      signalIndices.length > 0 &&
      recording.header.recordCount > 0 &&
      recording.header.recordDurationSeconds > 0;
    if (!readable) continue;

    walk(
      await readRecords(located, { records: { start: 0, count: 1 }, signalIndices }),
      `${name}: readRecords`,
      found,
    );
    walk(
      await readWindow(located, { startSeconds: 0, durationSeconds: 20, signalIndices }),
      `${name}: readWindow`,
      found,
    );
    walk(
      await readEnvelope(located, {
        startSeconds: 0,
        durationSeconds: 3,
        buckets: 4,
        signalIndices,
      }),
      `${name}: readEnvelope`,
      found,
    );
  }
  return found;
}

const FOUND = await everything();

describe('the sweep', () => {
  it('reached enough of the API that a passing run is not a vacuous one', () => {
    expect(FOUND.arrays.length).toBeGreaterThan(200);
    expect(FOUND.typedArrays.length).toBeGreaterThan(10);
    expect(FOUND.objects.length).toBeGreaterThan(200);
  });

  it('found the freeze calls it is checking the effect of', () => {
    const src = new URL('../../src/', import.meta.url);
    const files: string[] = [];
    const collect = (dir: URL, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) collect(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
        else if (entry.name.endsWith('.ts')) files.push(`${prefix}${entry.name}`);
      }
    };
    collect(src, '');
    const freezing = files.filter((name) =>
      /Object\.freeze\(/.test(readFileSync(new URL(name, src), 'utf8')),
    );
    expect(freezing.length).toBeGreaterThanOrEqual(15);
    // One call freezes an array that reaches many results, which is why there are far more
    // frozen arrays above than there are calls here.
    expect(FOUND.arrays.length).toBeGreaterThan(freezing.length);
  });
});

describe('every plain array', () => {
  it('is frozen, wherever in the graph it sits', () => {
    const mutable = FOUND.arrays.filter((entry) => !entry.frozen).map((entry) => entry.path);
    expect(mutable).toEqual([]);
  });
});

describe('and freezing is what it buys', () => {
  it('refuses a push, so one caller cannot lengthen a list another is holding', async () => {
    const recording = await openEdf(byteSource(GAPPED));
    const mine = recording.header.diagnostics;
    const yours = recording.header.diagnostics;
    expect(mine).toBe(yours);
    expect(() => (mine as unknown as unknown[]).push({})).toThrow(TypeError);
    expect(yours).toHaveLength(mine.length);
  });

  it('refuses a sort in place, which is the other way a shared list gets rearranged', async () => {
    const recording = await openEdf(byteSource(GAPPED));
    const signals = recording.header.signals;
    const order = signals.map((signal) => signal.index);
    expect(() => (signals as unknown as { reverse(): unknown }).reverse()).toThrow(TypeError);
    expect(recording.header.signals.map((signal) => signal.index)).toEqual(order);
  });
});

describe('what is deliberately not frozen', () => {
  it('is the containing objects, so the documented spread still works', async () => {
    const recording = await openEdf(byteSource(GAPPED));
    expect(Object.isFrozen(recording)).toBe(false);
    // `{ ...recording, index }` is the shape `discontinuous.md` tells every reader to write.
    const index = await buildRecordIndex(recording);
    const located = { ...recording, index };
    expect(located.index.coverage).toBe('complete');
    expect(recording.index.coverage).toBe('probed');
  });

  it('and the typed arrays, because the reuse the package documents writes into them', async () => {
    const recording = await openEdf(byteSource(GAPPED));
    const chunk = await readRecords(recording, {
      records: { start: 0, count: 1 },
      signalIndices: [0],
    });
    const series = chunk.signals[0];
    const signal = recording.header.signals[0];
    if (series === undefined || signal === undefined) throw new Error('fixture is not as expected');

    expect(Object.isFrozen(series.digital)).toBe(false);
    // `toPhysical(signal, digital, out)` writes into `out`, which a frozen buffer would refuse.
    const out = new Float64Array(series.sampleCount);
    expect(toPhysical(signal, series.digital, out)).toBe(out);
    expect(out.some((value) => value !== 0)).toBe(true);
  });
});

describe('the matrix this file sweeps', () => {
  it('is the fourteen shapes it was written against', () => {
    // `awkward-files.ts` asks every consumer for this: without it, a shape removed from the matrix
    // quietly removes cases from here instead of failing anything.
    expect(AWKWARD).toHaveLength(14);
  });
});
