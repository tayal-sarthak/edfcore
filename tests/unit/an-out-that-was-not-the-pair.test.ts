/**
 * `toPhysicalEnvelope`'s `out`, read for two fields without being asked whether it has any.
 *
 * The note above that check names the shape this call does not share with its siblings: "the other
 * three take a single typed array, this takes an object carrying two". So
 * `toPhysicalEnvelope(signal, envelope, scratch)` with `scratch` a `Float64Array` — the buffer
 * `toPhysical`, `clampToDigitalRange` and `decodeDigital` all want — is the mistake this signature
 * invites, and it was answered `out.min is undefined, not a Float64Array`: a complaint about a
 * field, on a value that has none, with the array the caller actually passed never mentioned.
 *
 * `null` did not even get that. It reached `(out).min` and threw V8's `Cannot read properties of
 * null (reading 'min')` — the one way out of this function with no `Next:` clause, and the same
 * hole 0.6.228 closed in `mergeChunks`, where `null` arrives the same way: JSON writes an absent
 * value as one.
 *
 * An `out` that IS the pair keeps every message it had, including the per-side ones that name
 * `out.min` and `out.max` separately, and the length check under them.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope, toPhysicalEnvelope } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfEnvelopeSignal, EdfSignal } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const BUCKETS = 4;

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 16 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function shapes(): Promise<{ signal: EdfSignal; envelope: EdfEnvelopeSignal }> {
  const recording = await openEdf(byteSource(FILE));
  const chunks = await readEnvelope(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 2,
    buckets: BUCKETS,
  });
  return {
    signal: recording.header.signals[0] as EdfSignal,
    envelope: chunks[0]?.signals[0] as EdfEnvelopeSignal,
  };
}

const refusal = (call: () => unknown): Error => {
  let thrown: Error | undefined;
  try {
    call();
  } catch (error) {
    thrown = error as Error;
  }
  expect(thrown, 'nothing was refused').toBeDefined();
  return thrown as Error;
};

describe('an out that is not the pair', () => {
  it('no longer throws the engine TypeError for null', async () => {
    const { signal, envelope } = await shapes();
    const thrown = refusal(() => toPhysicalEnvelope(signal, envelope, null as never));
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown.message).not.toContain('Cannot read properties');
    expect(thrown.message).toContain('out is null');
  });

  it('names the single array a caller passed, rather than a field it has not got', async () => {
    const { signal, envelope } = await shapes();
    const thrown = refusal(() =>
      toPhysicalEnvelope(signal, envelope, new Float64Array(BUCKETS) as never),
    );
    // No article before a typed array's name, which is `describeValue`'s rule throughout: an
    // article "needs to know that `Uint8Array` is said 'yoo-int', which no rule about vowels
    // gets right".
    expect(thrown.message).toContain('out is Float64Array');
    expect(thrown.message).not.toContain('out.min is undefined');
  });

  it('says why this one differs from its siblings', async () => {
    const { signal, envelope } = await shapes();
    const thrown = refusal(() =>
      toPhysicalEnvelope(signal, envelope, new Float64Array(BUCKETS) as never),
    );
    expect(thrown.message).toContain('reuse a single typed array');
    expect(thrown.message).toContain('a lower and an upper bound');
    expect(thrown.message).toContain('Next: pass an object with a min and a max Float64Array');
  });

  it.each([
    ['a number', 5],
    ['a string', 'scratch'],
    ['an Int32Array', new Int32Array(BUCKETS)],
    ['a boolean', true],
  ])('refuses %s in the same words', async (_shape, given) => {
    const { signal, envelope } = await shapes();
    const thrown = refusal(() => toPhysicalEnvelope(signal, envelope, given as never));
    expect(thrown.message).toContain('not the pair this one takes');
    expect(thrown.message).toContain('Next:');
  });
});

describe('an out that is the pair', () => {
  it('keeps the per-side message when one side is the wrong kind', async () => {
    const { signal, envelope } = await shapes();
    const thrown = refusal(() =>
      toPhysicalEnvelope(signal, envelope, {
        min: new Int32Array(BUCKETS),
        max: new Float64Array(BUCKETS),
      } as never),
    );
    expect(thrown.message).toContain('out.min');
    expect(thrown.message).toContain('Float64Array');
  });

  it('keeps the per-side message when one side is missing', async () => {
    const { signal, envelope } = await shapes();
    const thrown = refusal(() =>
      toPhysicalEnvelope(signal, envelope, { min: new Float64Array(BUCKETS) } as never),
    );
    expect(thrown.message).toContain('out.max');
  });

  it('keeps the length check under them', async () => {
    const { signal, envelope } = await shapes();
    const thrown = refusal(() =>
      toPhysicalEnvelope(signal, envelope, {
        min: new Float64Array(1),
        max: new Float64Array(1),
      }),
    );
    expect(thrown.message).toContain('buckets but this envelope has');
    expect(thrown.message).toContain('size both arrays to envelope.min.length');
  });

  it('still converts into arrays of the right kind and length', async () => {
    const { signal, envelope } = await shapes();
    const out = { min: new Float64Array(BUCKETS), max: new Float64Array(BUCKETS) };
    const physical = toPhysicalEnvelope(signal, envelope, out);
    expect(physical.min).toHaveLength(envelope.min.length);
    expect(physical.min.buffer).toBe(out.min.buffer);
  });

  it('still allocates when out is omitted', async () => {
    const { signal, envelope } = await shapes();
    expect(toPhysicalEnvelope(signal, envelope).min).toHaveLength(envelope.min.length);
  });
});
