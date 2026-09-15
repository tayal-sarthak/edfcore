/**
 * The shape `toPhysicalEnvelope` returns, handed back to it as the thing to convert.
 *
 * 0.6.144 taught this function to refuse a second argument that is not an envelope, and it tests
 * the field it is about to read: `ArrayBuffer.isView(envelope.min)`. That is exactly the field a
 * PHYSICAL envelope also has, and also as a view — a `Float64Array` rather than an `Int32Array` —
 * so the one shape the guard cannot tell from a digital envelope is the one this function produces.
 *
 * It is not an exotic argument. `EdfPhysicalEnvelope` is both the return type and the type of the
 * third parameter, and the docblock explains why that parameter exists: "an envelope is the render
 * loop path — a viewer redraws on every pan, zoom and resize — so allocating two Float64Arrays per
 * frame is the one allocation here worth letting a caller avoid". The pair a viewer keeps in order
 * to reuse it is therefore the same shape as the pair it converts, and putting it one argument to
 * the left is the slip that contract invites.
 *
 * What came back was V8's `Cannot read properties of undefined (reading '0')`, from `counts[i]`
 * four lines into the loop. `counts` is the field that separates the two shapes, and it is the one
 * that carries the promise this function makes about empty buckets: a bucket no sample landed in is
 * written as NaN because `counts[i] === 0` says so, "the one value that cannot be mistaken for a
 * measurement". A physical envelope has thrown that away, which is precisely why it cannot be
 * converted a second time.
 */

import { describe, expect, it } from 'vitest';
import { envelopeOfSamples, toPhysicalEnvelope } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { EdfEnvelopeSignal, EdfPhysicalEnvelope, EdfSignal } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const BYTES = buildEdf({
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8, physicalMinimum: -100, physicalMaximum: 100 }],
});

async function envelope(): Promise<{ signal: EdfSignal; digital: EdfEnvelopeSignal }> {
  const recording = await openEdf(byteSource(BYTES));
  const chunks = await readWindow(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 2,
  });
  const chunkSignal = chunks[0]?.signals[0];
  if (chunkSignal === undefined) throw new Error('the fixture produced no samples');
  return {
    signal: recording.header.signals[0] as EdfSignal,
    digital: envelopeOfSamples(chunkSignal, 4),
  };
}

const convert = (signal: EdfSignal, value: unknown): EdfPhysicalEnvelope =>
  (toPhysicalEnvelope as unknown as (s: EdfSignal, e: unknown) => EdfPhysicalEnvelope)(
    signal,
    value,
  );

describe('a physical envelope converted a second time', () => {
  it('is refused rather than dereferenced', async () => {
    const { signal, digital } = await envelope();
    const physical = toPhysicalEnvelope(signal, digital);
    // The guard 0.6.144 added reads `min`, and this shape has one — of the right kind, too.
    expect(ArrayBuffer.isView(physical.min)).toBe(true);
    expect(() => convert(signal, physical)).toThrow(RangeError);
  });

  it('says which shape it is and never leaks the internal field', async () => {
    const { signal, digital } = await envelope();
    const physical = toPhysicalEnvelope(signal, digital);
    try {
      convert(signal, physical);
      expect.unreachable('a physical envelope must not be converted again');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('physical envelope rather than a digital one');
      expect(message).toContain('scale every bound a second time');
      expect(message).toContain('Next:');
      expect(message).not.toContain('Cannot read properties');
    }
  });

  it('refuses the bare pair a caller keeps in order to reuse it', async () => {
    const { signal } = await envelope();
    // The same object the third parameter takes, one argument to the left.
    const reused = { min: new Float64Array(4), max: new Float64Array(4) };
    expect(() => convert(signal, reused)).toThrow(/no counts/);
  });
});

describe('the conversion itself', () => {
  it('still converts a digital envelope, and still reuses an out pair', async () => {
    const { signal, digital } = await envelope();
    const out = { min: new Float64Array(4), max: new Float64Array(4) };
    const physical = toPhysicalEnvelope(signal, digital, out);
    expect(physical.min).toHaveLength(digital.min.length);
    expect(physical.min[0]).toBe(out.min[0]);
    expect(Number.isFinite(physical.min[0] as number)).toBe(true);
  });
});
