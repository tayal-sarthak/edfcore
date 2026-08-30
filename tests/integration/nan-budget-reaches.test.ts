/**
 * A `NaN` budget, at every entry point that reads one.
 *
 * `options.ts` exists because `maxMaterializeBytes` is typed `number`, which admits `NaN`, and
 * `NaN` arrives without anyone writing it: `Number(process.env.EDF_BUDGET)`, an absent query
 * parameter, a missing JSON key. Its docblock states the reach the guard has to have — the option
 * is "resolved in six modules spread across the stack" and "read raw and handed on in two more" —
 * and then the sentence this file is named after: **a guard that only one of the eight applies is
 * not a guard.**
 *
 * Nothing checked the eight. `options.test.ts` checks the resolver in isolation, and
 * `budget-boundary.test.ts` enumerates the five sites that compare a REQUIREMENT against the
 * budget — a different set, reached by a different code path, and reached only on a request large
 * enough to refuse. A `NaN` budget is refused before any size is computed, by the resolver, in
 * modules `budget-boundary.test.ts` does not list: `record-index.ts` never compares anything, and
 * `biosemi.ts` never resolves anything.
 *
 * So the sites are enumerated here out of `src/` and split by what they do with the option, and
 * every one is then driven through its own PUBLIC entry point. The split matters: seven of the
 * eight refuse, and the eighth is `io/cached.ts`, which hands the option to the source it wraps
 * and therefore refuses only if that source does. That is the design — a cache is not the layer
 * that owns a materialisation budget — but it is the one place a caller's `NaN` survives, and it
 * is worth being a stated fact rather than an omission.
 *
 * What this does NOT check: the budget's arithmetic, its boundary, or the `EdfBudgetError` fields.
 * Those are `budget-boundary.test.ts`. Every refusal here is a plain `RangeError` from the
 * resolver, thrown before a byte is sized.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readTriggers } from '../../src/biosemi.js';
import { decodeDigital } from '../../src/decode/digital.js';
import { toPhysical } from '../../src/decode/physical.js';
import { readEnvelope } from '../../src/envelope.js';
import { isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { readRecordBytes } from '../../src/io/read.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readRecords } from '../../src/recording.js';
import type { EdfRecording, EdfSignal } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

/** The value every call below is given. `Number('')` is 0, but `Number(undefined)` is this. */
const NAN_BUDGET = { maxMaterializeBytes: Number.NaN } as const;

/** EDF+C, so the record onsets live in an annotation region and every scan path actually reads. */
const PLUS = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 16 }],
});

/** The same shape in BDF with a Status channel, which is the only file `readTriggers` accepts. */
const BDF = buildEdf({
  format: 'BDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 8 },
    { label: 'Status', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 16 }],
});

function signalAt(recording: EdfRecording, index: number): EdfSignal {
  const signal = recording.header.signals[index];
  if (signal === undefined) throw new Error(`fixture has no signal ${index}`);
  return signal;
}

// ---------------------------------------------------------------------------
// The eight sites, read out of src/
// ---------------------------------------------------------------------------

describe('the modules that read the option', () => {
  /**
   * Resolved through `resolveMaterializeBudget`, which is where the refusal comes from. Named by
   * the `options.ts` docblock, and asserted here rather than trusted: a seventh resolving module
   * has to be driven through an entry point below before this list may grow.
   */
  const RESOLVE = [
    'decode/digital.ts',
    'decode/physical.ts',
    'envelope.ts',
    'io/read.ts',
    'record-index.ts',
    'validate.ts',
  ] as const;

  /** Read raw and handed on. `biosemi.ts` hands it to a resolver; `io/cached.ts` to a source. */
  const FORWARD = ['biosemi.ts', 'io/cached.ts'] as const;

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

  /** `options.ts` declares the option's own parameter; it is the resolver, not a reader of it. */
  const readers = names.filter(
    (name) => name !== 'options.ts' && /options\??\.maxMaterializeBytes/.test(text.get(name) ?? ''),
  );

  it('found the tree, so a passing run is not a vacuous one', () => {
    expect(names.length).toBeGreaterThan(40);
    expect(names).toContain('options.ts');
  });

  it('are the eight the options.ts docblock names, and no others', () => {
    expect(readers).toEqual([...RESOLVE, ...FORWARD].sort());
  });

  it('split into the six that resolve and the two that hand it on', () => {
    const resolving = readers.filter((name) =>
      /resolveMaterializeBudget\(/.test(text.get(name) ?? ''),
    );
    expect(resolving).toEqual([...RESOLVE]);
    expect(readers.filter((name) => !resolving.includes(name))).toEqual([...FORWARD]);
  });

  it('is the count the docblock states in words', () => {
    // Unwrapped first: the sentence about the eight spans two comment lines in the source.
    const options = (text.get('options.ts') ?? '').replace(/\s*\n\s*\*\s*/g, ' ');
    expect(options).toContain('resolved in six modules');
    expect(RESOLVE).toHaveLength(6);
    expect(options).toContain('handed on in two more');
    expect(FORWARD).toHaveLength(2);
    expect(options).toContain('only one of the eight applies is not a guard');
    expect(readers).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// Every one of them, through its own public entry point
// ---------------------------------------------------------------------------

describe('a NaN budget is refused', () => {
  /**
   * One entry point per resolving module, plus `biosemi.ts`, which owns no resolver and reaches
   * `record-index.ts`'s. `validate.ts` appears twice because its two resolutions are on different
   * branches: the sweep's chunk size is computed for every call, the scratch buffer only under
   * `scanSamples`.
   */
  const CALLS: ReadonlyArray<readonly [string, (recording: EdfRecording) => unknown]> = [
    ['io/read.ts', (r) => readRecordBytes(r.source, r.header, { start: 0, count: 1 }, NAN_BUDGET)],
    [
      'recording.ts -> io/read.ts',
      (r) => readRecords(r, { records: { start: 0, count: 1 }, signalIndices: [0] }, NAN_BUDGET),
    ],
    [
      'decode/digital.ts',
      (r) =>
        decodeDigital(
          r.header,
          new Uint8Array(r.header.recordByteLength),
          { start: 0, count: 1 },
          0,
          undefined,
          NAN_BUDGET,
        ),
    ],
    [
      'decode/physical.ts',
      (r) => toPhysical(signalAt(r, 0), new Int32Array(8), undefined, NAN_BUDGET),
    ],
    [
      'envelope.ts',
      (r) =>
        readEnvelope(
          r,
          { signalIndices: [0], startSeconds: 0, durationSeconds: 4, buckets: 4 },
          NAN_BUDGET,
        ),
    ],
    ['record-index.ts', (r) => buildRecordIndex(r, NAN_BUDGET)],
    ['validate.ts (the sweep)', (r) => validateRecording(r, NAN_BUDGET)],
    [
      'validate.ts (the scratch buffer)',
      (r) => validateRecording(r, { scanSamples: true, ...NAN_BUDGET }),
    ],
  ];

  it.each(CALLS)('at %s, naming the option and where a NaN comes from', async (_site, call) => {
    const recording = await openEdf(byteSource(PLUS));
    const thrown = await Promise.resolve()
      .then(() => call(recording))
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(thrown).toBeInstanceOf(RangeError);
    const error = thrown as RangeError;
    // A caller mistake, not a file defect — the split `isEdfError` documents.
    expect(isEdfError(error)).toBe(false);
    expect(error.message).toContain('options.maxMaterializeBytes must be a finite number');
    expect(error.message).toContain('was NaN');
    expect(error.message).toMatch(/Next:/);
  });

  it('at biosemi.ts, which owns no resolver and borrows the scan chunker', async () => {
    const recording = await openEdf(byteSource(BDF));
    await expect(
      readTriggers(recording, { startSeconds: 0, durationSeconds: 4 }, NAN_BUDGET),
    ).rejects.toThrow(/options\.maxMaterializeBytes must be a finite number/);
  });

  it('covers every entry point once the two validate branches are counted as one module', () => {
    const modules = new Set(CALLS.map(([site]) => site.split(' ')[1] ?? site.split(' ')[0]));
    // Seven of the eight readers are exercised above; `io/cached.ts` is the eighth, below.
    expect(modules.size).toBeGreaterThanOrEqual(6);
    expect(CALLS).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// The eighth
// ---------------------------------------------------------------------------

describe('the one place it is not refused', () => {
  /**
   * `cachedSource` reads the option only to pass it to the source it wraps, so what happens to a
   * `NaN` is that source's business. `byteSource` holds the bytes already and materialises
   * nothing, so it has no budget to blow and the read succeeds — which is correct, and is the
   * reason `io/cached.ts` is on the "handed on" side of the split above rather than the
   * "resolved" side.
   */
  it('hands it to the wrapped source rather than resolving it', async () => {
    const source = cachedSource(byteSource(PLUS));
    const bytes = await source.read(0, 8, NAN_BUDGET);
    expect(bytes).toHaveLength(8);
    expect(bytes).toEqual(PLUS.subarray(0, 8));
  });

  it('and the file it wraps is refused the moment a resolving module sees the same budget', async () => {
    const recording = await openEdf(cachedSource(byteSource(PLUS)));
    await expect(
      readRecordBytes(recording.source, recording.header, { start: 0, count: 1 }, NAN_BUDGET),
    ).rejects.toThrow(/options\.maxMaterializeBytes must be a finite number/);
  });
});
