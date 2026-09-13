/**
 * The `out` pair of `toPhysicalEnvelope`, the fourth resolver in the family 0.6.134 swept.
 *
 * The other three take a single typed array. This one takes an object carrying two, which is why
 * it was not reached — and the cost is identical. Both bounds are written with
 * `bitValue * (offset + digital)`, which is fractional, so an `Int32Array` truncates every one of
 * them; at a bit value below 1 the whole envelope comes back as zeros, which a viewer draws as a
 * flat trace along the bottom of the axis rather than as a signal.
 *
 * `out.max` had no check of its own either. The length comparison reads `out.min.length` first, so
 * an object carrying only `min` — which is what a half-finished refactor leaves behind — reached
 * `out.max.length` and threw V8's `Cannot read properties of undefined (reading 'length')`.
 *
 * The length check underneath is unchanged: a pair that is too short is still refused with the
 * bucket counts, which is what makes reuse safe.
 */

import { describe, expect, it } from 'vitest';
import { envelopeOfSamples, toPhysicalEnvelope } from '../../src/envelope.js';
import { isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import type { EdfEnvelopeSignal, EdfSignal } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'A1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function read(): Promise<{ signal: EdfSignal; envelope: EdfEnvelopeSignal }> {
  const recording = await openEdf(byteSource(FILE));
  const chunk = await readRecords(recording, {
    signalIndices: [0],
    records: { start: 0, count: 4 },
  });
  return {
    signal: recording.header.signals[0] as EdfSignal,
    envelope: envelopeOfSamples(chunk.signals[0] as never, 4),
  };
}

const convert =
  (signal: EdfSignal, envelope: EdfEnvelopeSignal, out: unknown): (() => unknown) =>
  () =>
    (toPhysicalEnvelope as unknown as (s: unknown, e: unknown, o: unknown) => unknown)(
      signal,
      envelope,
      out,
    );

describe('toPhysicalEnvelope given an integer out pair', () => {
  it('no longer returns an envelope of truncated bounds', async () => {
    const { signal, envelope } = await read();
    const call = convert(signal, envelope, { min: new Int32Array(8), max: new Int32Array(8) });
    expect(call).toThrow(RangeError);
    // `out.min`, not `out`. This function takes a PAIR and checks each side, so the subject of the
    // sentence is the side that was rejected — the clause after the dash has always said which one
    // (0.6.159).
    expect(call).toThrow(/^toPhysicalEnvelope\(\): out\.min is Int32Array, not a Float64Array —/);
  });

  it('says which side it was looking at and what truncation would have done', async () => {
    const { signal, envelope } = await read();
    expect(convert(signal, envelope, { min: new Int32Array(8), max: new Float64Array(8) })).toThrow(
      /out\.min is what this writes the lower bound of every bucket into/,
    );
    expect(convert(signal, envelope, { min: new Float64Array(8), max: new Int32Array(8) })).toThrow(
      /out\.max is what this writes the upper bound of every bucket into/,
    );
  });

  it('is a caller mistake, so isEdfError says false', async () => {
    const { signal, envelope } = await read();
    let thrown: unknown;
    try {
      convert(signal, envelope, { min: new Int32Array(8), max: new Int32Array(8) })();
    } catch (error) {
      thrown = error;
    }
    expect(isEdfError(thrown)).toBe(false);
  });

  it('names a missing max rather than dereferencing it', async () => {
    const { signal, envelope } = await read();
    const call = convert(signal, envelope, { min: new Float64Array(8) });
    // What this test is titled. 0.6.144 stopped the dereference and the message still said "out is
    // undefined" to a caller who had plainly passed an object; naming the side is the other half
    // of it (0.6.159).
    expect(call).toThrow(/out\.max is undefined, not a Float64Array/);
    expect(call).not.toThrow(/Cannot read properties/);
  });

  it('still reuses a Float64Array pair, and still refuses one that is too short', async () => {
    const { signal, envelope } = await read();
    const own = toPhysicalEnvelope(signal, envelope);
    const reused = toPhysicalEnvelope(signal, envelope, {
      min: new Float64Array(16),
      max: new Float64Array(16),
    });
    expect(Array.from(reused.min)).toEqual(Array.from(own.min));
    expect(
      convert(signal, envelope, { min: new Float64Array(1), max: new Float64Array(1) }),
    ).toThrow(/out holds 1 buckets but this envelope has 4/);
  });
});
