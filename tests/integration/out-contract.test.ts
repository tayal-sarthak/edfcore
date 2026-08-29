/**
 * One `out` contract, and every primitive that takes one keeps it.
 *
 * `api-primitives.md` writes it once and then refers back to it: "`out` behaves exactly as in
 * `decodeDigital`: reused when long enough, narrowed with `subarray` when longer, a plain
 * `RangeError` when shorter." `envelope.ts` says the same in its own words — "this is the same
 * contract, including refusing an array that is too short rather than silently writing fewer
 * values than the caller will read."
 *
 * `out` exists for the render loop. A viewer redraws on every pan, zoom and resize, so the arrays
 * are the one allocation worth letting a caller avoid — which means the caller holds the buffer
 * across frames and reads it after the call. The three rules are what make that safe, and each
 * fails silently on its own:
 *
 *  - **Reused**, so the values a caller reads back are in the array it passed. A function that
 *    allocated its own and returned that would work perfectly, allocate every frame, and leave a
 *    caller who kept a reference reading last frame's numbers.
 *  - **Narrowed**, so a caller who sized once for the largest window gets a result whose `length`
 *    is the real count. Returning the whole buffer instead appends stale values from the previous,
 *    longer frame — plausible numbers, in a plausible place.
 *  - **Refused when short**, rather than filled part-way. The caller reads `out`, not the return
 *    value, so a partial write is a frame drawn half from this window and half from the last.
 *
 * The refusal is a plain `RangeError` and not an `EdfError`, deliberately: a wrong-sized array the
 * caller allocated is a bug in the calling code, not a problem with the file, and `isEdfError`
 * answers false for it. That is checked here too, on all four, because it is the kind of thing a
 * later refactor "tidies" into the error hierarchy one function at a time.
 *
 * The four are enumerated from `src/` rather than listed, so a fifth primitive that takes an `out`
 * fails this file until it joins it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../src/decode/digital.js';
import { clampToDigitalRange, toPhysical } from '../../src/decode/physical.js';
import { toPhysicalEnvelope } from '../../src/envelope.js';
import { isEdfError } from '../../src/errors.js';
import { parseHeader } from '../../src/header/parse.js';
import type { EdfEnvelopeSignal, EdfHeader, EdfSignal } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const BYTES = buildEdf({
  format: 'EDF',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 4, sample: (r, k) => r * 10 + k }],
});
const HEADER: EdfHeader = parseHeader(BYTES, BYTES.byteLength);
const SIGNAL: EdfSignal = HEADER.signals[0] as EdfSignal;
const RECORDS = { start: 0, count: 2 } as const;
const RECORD_BYTES = BYTES.subarray(HEADER.headerByteLength);
const DIGITAL = Int32Array.from([0, 1, 2, 3, 10, 11, 12, 13]);

/** Eight buckets, so the envelope's length matches the sample count and one `LENGTH` serves all. */
const ENVELOPE: EdfEnvelopeSignal = {
  signalIndex: 0,
  min: Int32Array.from(DIGITAL),
  max: Int32Array.from(DIGITAL),
  counts: Int32Array.from(DIGITAL, () => 1),
  sampleCount: DIGITAL.length,
  firstSampleIndex: 0,
  startSeconds: 0,
  startTicks: 0n,
  outOfDigitalRangeCount: 0,
};

const LENGTH = DIGITAL.length;

/**
 * One primitive under the contract, expressed as the three calls the rules are about.
 *
 * `buffer` is what a caller allocates and keeps; `read` is what they get back. Both are typed
 * as `ArrayBufferView` so the envelope's pair of arrays and the others' single array can be
 * checked by one set of assertions.
 */
interface Primitive {
  readonly name: string;
  readonly module: string;
  /** Allocate a caller-owned buffer of `length` elements. */
  readonly buffer: (length: number) => ArrayBufferView;
  /** Call the primitive with that buffer, and return the array the caller would read. */
  readonly call: (out: ArrayBufferView) => ArrayBufferView;
  /** The same call with no `out` at all, for the length the contract is measured against. */
  readonly allocate: () => ArrayBufferView;
}

const asInt32 = (view: ArrayBufferView): Int32Array => view as Int32Array;
const asFloat64 = (view: ArrayBufferView): Float64Array => view as Float64Array;

const PRIMITIVES: readonly Primitive[] = [
  {
    name: 'decodeDigital',
    module: 'decode/digital.ts',
    buffer: (length) => new Int32Array(length),
    call: (out) => decodeDigital(HEADER, RECORD_BYTES, RECORDS, 0, asInt32(out)),
    allocate: () => decodeDigital(HEADER, RECORD_BYTES, RECORDS, 0),
  },
  {
    name: 'toPhysical',
    module: 'decode/physical.ts',
    buffer: (length) => new Float64Array(length),
    call: (out) => toPhysical(SIGNAL, DIGITAL, asFloat64(out)),
    allocate: () => toPhysical(SIGNAL, DIGITAL),
  },
  {
    name: 'clampToDigitalRange',
    module: 'decode/physical.ts',
    buffer: (length) => new Int32Array(length),
    call: (out) => clampToDigitalRange(SIGNAL, DIGITAL, asInt32(out)),
    allocate: () => clampToDigitalRange(SIGNAL, DIGITAL),
  },
  {
    name: 'toPhysicalEnvelope',
    module: 'envelope.ts',
    buffer: (length) => new Float64Array(length),
    // The envelope's `out` is a PAIR of arrays. The same buffer is handed in as both, so the
    // assertions below can compare one buffer against the `min` half of the result.
    call: (out) =>
      toPhysicalEnvelope(SIGNAL, ENVELOPE, {
        min: asFloat64(out),
        max: new Float64Array(out.byteLength / 8),
      }).min,
    allocate: () => toPhysicalEnvelope(SIGNAL, ENVELOPE).min,
  },
];

describe('the primitives that take an out', () => {
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

  it('are the four this file covers, and no others', () => {
    const src = new URL('../../src/', import.meta.url);
    const found = sourceFiles(src, '', [])
      .filter((name) => /^\s{2}out\?:/m.test(readFileSync(new URL(name, src), 'utf8')))
      .sort();
    expect(found).toEqual([...new Set(PRIMITIVES.map((p) => p.module))].sort());
  });

  it('read the tree, so a passing run is not a vacuous one', () => {
    const src = new URL('../../src/', import.meta.url);
    expect(sourceFiles(src, '', []).length).toBeGreaterThan(30);
  });
});

describe.each(PRIMITIVES)('$name', (primitive) => {
  it('writes into the array it was given, rather than one of its own', () => {
    const out = primitive.buffer(LENGTH);
    const result = primitive.call(out);
    // The same memory, not merely equal contents: a caller holding `out` across frames reads it
    // directly and never looks at the return value.
    expect(result.buffer).toBe(out.buffer);
    expect(result.byteOffset).toBe(out.byteOffset);
    // And it agrees with what the allocating call produces, so reuse is not a different code path.
    expect(Array.from(result as unknown as ArrayLike<number>)).toEqual(
      Array.from(primitive.allocate() as unknown as ArrayLike<number>),
    );
  });

  it('narrows a longer array to a view over the caller’s own memory', () => {
    const out = primitive.buffer(LENGTH * 3);
    const result = primitive.call(out);
    expect(result.buffer).toBe(out.buffer);
    // The length is the real count, not the buffer's: a caller who sized once for the largest
    // window must not read the tail of the previous, longer frame.
    expect((result as unknown as { length: number }).length).toBe(LENGTH);
  });

  it('refuses a shorter array with a plain RangeError, rather than filling part of it', () => {
    const out = primitive.buffer(LENGTH - 1);
    let thrown: unknown;
    try {
      primitive.call(out);
      expect.unreachable('a short out was accepted');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RangeError);
    // A caller's wrong-sized array is a bug in the calling code, not a problem with the file.
    expect(isEdfError(thrown)).toBe(false);
    expect((thrown as Error).message).toContain('Next:');
    // Nothing was written before the refusal: the caller reads `out`, so a partial write is a
    // frame drawn half from this window and half from the last.
    expect(Array.from(out as unknown as ArrayLike<number>).every((value) => value === 0)).toBe(
      true,
    );
  });
});
