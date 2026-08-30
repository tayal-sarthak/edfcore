/**
 * A `NaN` bound, at every entry point that takes a time in seconds.
 *
 * `secondsToTicks` is the one place a caller's seconds become the integers everything else works
 * in, and it refuses a non-finite one: "expected a finite number of seconds, received NaN. Next:
 * check the window bound you passed in." `ticks.test.ts` covers that, once, on the resolver.
 *
 * The resolver is not the guarantee. The guarantee is that a `NaN` cannot get PAST it — and
 * `NaN` reaches a time bound the same way it reaches a byte budget:
 * `Number(searchParams.get('t'))`, a slider whose value has not been set, an absent key in a saved
 * view. What makes it worth a sweep rather than a spot check is what happens if one entry point
 * misses: `NaN` compares false against everything, so a window bound that skipped the resolver
 * would not throw. It would return `[]` — an empty window, which is a legitimate answer for a
 * window past the end of a recording, and indistinguishable from one.
 *
 * `nan-budget-reaches.test.ts` does this for `options.maxMaterializeBytes`, which has six resolving
 * modules named in a docblock. This is the same sweep on the other axis, and the entry points are
 * enumerated the same way: read out of `src/`, split from the two helpers that take a `startSeconds`
 * edfcore itself produced rather than one a caller passed, and each driven with all three
 * non-finite values.
 *
 * What this does NOT check: what any of them does with a finite bound, or the bounds-clamping rules.
 * Those are `trim-window.test.ts`, `window.test.ts` and the per-function tests.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { annotationsAt, filterAnnotationsByTime } from '../../src/annotations-query.js';
import { readTriggers } from '../../src/biosemi.js';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex, gapAt, segmentAt } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { gridSampleIndexAt } from '../../src/sample-grid.js';
import { sampleAt } from '../../src/sample-locate.js';
import { streamRecords } from '../../src/stream.js';
import { secondsToTicks } from '../../src/tal/ticks.js';
import { resolveTimeWindow, trimToWindow } from '../../src/time/window.js';
import { buildEdf } from '../support/writer.js';

const NOT_FINITE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY] as const;

const EDF_PLUS = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    {
      samplesPerRecord: 24,
      tals: (record) => (record === 0 ? [{ onset: '+0.5', texts: ['e'] }] : []),
    },
  ],
});

const BDF_WITH_STATUS = buildEdf({
  format: 'BDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 8 },
    { label: 'Status', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 24 }],
});

// ---------------------------------------------------------------------------
// The entry points, read out of src/
// ---------------------------------------------------------------------------

describe('the functions that take a time in seconds', () => {
  function sourceFiles(dir: URL, prefix: string, into: string[]): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        sourceFiles(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`, into);
        continue;
      }
      if (entry.name.endsWith('.ts')) into.push(`${prefix}${entry.name}`);
    }
    return into;
  }

  const src = new URL('../../src/', import.meta.url);
  const names = sourceFiles(src, '', []).sort();
  const text = new Map(names.map((name) => [name, readFileSync(new URL(name, src), 'utf8')]));
  const all = [...text.values()].join('\n');

  const FIELDS = /^(seconds|startSeconds|durationSeconds|secondsPerBucket)$/;

  /** True when `type` declares one of the four fields, following `extends` and `&`. */
  function declaresSeconds(type: string, seen = new Set<string>()): boolean {
    for (const part of type.split(/[&|,]/).map((piece) => piece.trim())) {
      // Only bare type names are followed. Anything else — a literal, a generic, a union member
      // with punctuation in it — is not an interface this file can resolve, and building a regex
      // out of it would not be a lookup.
      if (!/^[A-Za-z_$][\w$]*$/.test(part) || seen.has(part)) continue;
      seen.add(part);
      const declaration = new RegExp(
        `export (?:interface|type) ${part}\\b(?: extends ([^{]+))?\\s*(?:=\\s*([^;]+);|\\{([\\s\\S]*?)\\n\\})`,
      ).exec(all);
      if (declaration === null) continue;
      const body = declaration[3] ?? '';
      for (const member of body.matchAll(/^\s*readonly (\w+)\??:/gm)) {
        if (FIELDS.test(member[1] ?? '')) return true;
      }
      for (const parent of [declaration[1], declaration[2]]) {
        if (parent !== undefined && declaresSeconds(parent, seen)) return true;
      }
    }
    return false;
  }

  const taking: string[] = [];
  for (const name of names) {
    for (const match of (text.get(name) ?? '').matchAll(
      /export (?:async )?function\*? (\w+)\(([\s\S]*?)\)(?::|\s*\{)/g,
    )) {
      const parameters = match[2] ?? '';
      const direct = [...parameters.matchAll(/(\w+)\s*:\s*number/g)].some((p) =>
        FIELDS.test(p[1] ?? ''),
      );
      const viaType = [...parameters.matchAll(/:\s*([A-Z]\w+(?:\s*&\s*[A-Z]\w+)*)/g)].some((p) =>
        declaresSeconds(p[1] ?? ''),
      );
      if (direct || viaType) taking.push(`${name}: ${match[1] ?? ''}`);
    }
  }

  it('found the tree, so a passing run is not a vacuous one', () => {
    expect(names.length).toBeGreaterThan(40);
    expect(taking.length).toBeGreaterThan(10);
  });

  it('are the sixteen in src/, and every one is accounted for below', () => {
    expect(taking.sort()).toEqual([
      'annotations-query.ts: annotationsAt',
      'annotations-query.ts: filterAnnotationsByTime',
      'biosemi.ts: readTriggers',
      'envelope.ts: envelopeOfSamples',
      'envelope.ts: readEnvelope',
      'envelope.ts: readEnvelopeAtResolution',
      'envelope.ts: toPhysicalEnvelope',
      'record-index.ts: gapAt',
      'record-index.ts: segmentAt',
      'recording.ts: readWindow',
      'sample-grid.ts: gridSampleIndexAt',
      'sample-locate.ts: sampleAt',
      'stream.ts: streamRecords',
      'tal/ticks.ts: secondsToTicks',
      'time/window.ts: resolveTimeWindow',
      'time/window.ts: trimToWindow',
    ]);
  });

  it('minus the resolver and the two that read a start edfcore produced', () => {
    // `secondsToTicks` is the resolver every one of the others reaches.
    // `envelopeOfSamples` and `toPhysicalEnvelope` take an `EdfChunkSignal` and an
    // `EdfEnvelopeSignal` — values edfcore returned, whose `startSeconds` no caller supplies. They
    // are matched by the enumeration because their parameter TYPES carry the field, which is worth
    // stating rather than filtering out silently.
    expect(taking.filter((entry) => !entry.includes('secondsToTicks'))).toHaveLength(15);
  });
});

// ---------------------------------------------------------------------------
// And every one of them refuses
// ---------------------------------------------------------------------------

describe('a non-finite bound is refused', () => {
  async function drivers(): Promise<
    ReadonlyArray<readonly [string, (seconds: number) => unknown]>
  > {
    const recording = await openEdf(byteSource(EDF_PLUS));
    const bdf = await openEdf(byteSource(BDF_WITH_STATUS));
    const index = await buildRecordIndex(recording);
    const chunk = await readRecords(recording, {
      records: { start: 0, count: 4 },
      signalIndices: [0],
    });
    const series = chunk.signals[0];
    const signal = recording.header.signals[0];
    if (series === undefined || signal === undefined) throw new Error('fixture is not as expected');
    const { annotations } = await readAnnotations(recording, { start: 0, count: 4 });

    return [
      [
        'readWindow (startSeconds)',
        (s) => readWindow(recording, { startSeconds: s, durationSeconds: 1, signalIndices: [0] }),
      ],
      [
        'readWindow (durationSeconds)',
        (s) => readWindow(recording, { startSeconds: 0, durationSeconds: s, signalIndices: [0] }),
      ],
      [
        'streamRecords',
        async (s) => {
          for await (const piece of streamRecords(recording, {
            startSeconds: s,
            durationSeconds: 1,
            signalIndices: [0],
          }))
            void piece;
        },
      ],
      [
        'readEnvelope',
        (s) =>
          readEnvelope(recording, {
            startSeconds: s,
            durationSeconds: 1,
            buckets: 4,
            signalIndices: [0],
          }),
      ],
      [
        'readEnvelopeAtResolution (startSeconds)',
        (s) =>
          readEnvelopeAtResolution(recording, {
            startSeconds: s,
            durationSeconds: 1,
            secondsPerBucket: 1,
            signalIndices: [0],
          }),
      ],
      [
        'readEnvelopeAtResolution (secondsPerBucket)',
        (s) =>
          readEnvelopeAtResolution(recording, {
            startSeconds: 0,
            durationSeconds: 1,
            secondsPerBucket: s,
            signalIndices: [0],
          }),
      ],
      ['readTriggers', (s) => readTriggers(bdf, { startSeconds: s, durationSeconds: 1 })],
      ['resolveTimeWindow', (s) => resolveTimeWindow(recording.timeline, recording.index, s, 1)],
      ['trimToWindow (startSeconds)', (s) => trimToWindow(recording.header, series, s, 1)],
      ['trimToWindow (durationSeconds)', (s) => trimToWindow(recording.header, series, 0, s)],
      ['sampleAt', (s) => sampleAt(recording, 0, s)],
      [
        'gridSampleIndexAt',
        (s) => gridSampleIndexAt(signal, s, recording.header.recordDurationTicks),
      ],
      ['segmentAt', (s) => segmentAt(index, s)],
      ['gapAt', (s) => gapAt(index, s)],
      ['index.locate', (s) => index.locate(s)],
      [
        'filterAnnotationsByTime',
        (s) => filterAnnotationsByTime(annotations, { startSeconds: s, durationSeconds: 1 }),
      ],
      ['annotationsAt', (s) => annotationsAt(annotations, s)],
      ['secondsToTicks', (s) => secondsToTicks(s)],
    ];
  }

  it('covers every entry point the enumeration found, plus the index method', async () => {
    const names = new Set((await drivers()).map(([label]) => label.replace(/ \(.*/, '')));
    // Fifteen enumerated, minus the two output-carrying helpers, plus `index.locate`, which is a
    // method on the index rather than an exported function and so is not in the enumeration.
    expect(names.size).toBe(15);
    expect(names).toContain('index.locate');
  });

  it.each(NOT_FINITE)('at every one of them, for %s', async (value) => {
    for (const [label, drive] of await drivers()) {
      const thrown = await Promise.resolve()
        .then(() => drive(value))
        .then(
          () => undefined,
          (error: unknown) => error,
        );

      expect(thrown, label).toBeInstanceOf(RangeError);
      const error = thrown as RangeError;
      // A caller mistake, not a file defect — the split `isEdfError` documents.
      expect(isEdfError(error), label).toBe(false);
      expect(error.message, label).toMatch(/Next:/);
      expect(error.message, label).toContain(String(value));
    }
  });

  it('would otherwise come back as an empty window, which is a real answer', async () => {
    // Why this is a sweep and not a spot check: `NaN` compares false against every bound, so an
    // entry point that skipped the resolver would return the same `[]` a window past the end of the
    // recording returns — and nothing downstream could tell the two apart.
    const recording = await openEdf(byteSource(EDF_PLUS));
    const pastTheEnd = await readWindow(recording, {
      startSeconds: 1000,
      durationSeconds: 1,
      signalIndices: [0],
    });
    expect(pastTheEnd).toEqual([]);
  });
});
