/**
 * One buffer handed in for both bounds, and an envelope that came back flat.
 *
 * `toPhysicalEnvelope` checked both halves of `out` for kind and for length, and neither check says
 * they have to be two arrays. `{ min: buf, max: buf }` — one buffer reused for both, which is what a
 * viewer pooling allocations across a pan reaches for, and `out` exists for exactly that caller —
 * wrote the lower bound of every bucket and then overwrote it with the upper one.
 *
 * What came back was an envelope whose min equals its max: a band of zero height, which is what a
 * flat signal looks like, from the function whose entire output is the distance between the two.
 *
 * Nothing downstream could see it. Both sides are narrowed with `subarray` on the way out, and those
 * are distinct view objects — so `result.min === result.max` is FALSE even though the numbers are
 * identical, and the one identity test a caller might run does not fire. What agrees is the buffer
 * and the byte range, which is why the guard is an overlap test rather than an equality one.
 *
 * Overlap and not identity, so the legitimate pooled use keeps working: two views into one buffer at
 * different offsets are what a pool actually hands out.
 *
 * `api-helpers.md` already records that this function guards the ORDER of the two bounds — on a
 * decreasing scale the lower one "sits above its upper bound, and a viewer would draw it inside out",
 * so they are swapped. It defended which bound is which and not that there are two of them
 * (0.6.298).
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope, toPhysicalEnvelope } from '../../src/envelope.js';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfEnvelopeSignal, EdfSignal } from '../../src/types.js';
import { minimalEdfPlus } from '../support/writer.js';

async function fixture(): Promise<{ signal: EdfSignal; envelope: EdfEnvelopeSignal }> {
  const recording = await openEdf(
    byteSource(minimalEdfPlus({ recordCount: 8, recordDurationSeconds: 1 })),
  );
  const chunks = await readEnvelope(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 8,
    buckets: 4,
  });
  const envelope = chunks[0]?.signals[0];
  if (envelope === undefined) throw new Error('fixture');
  return { signal: getSignal(recording.header, 0), envelope };
}

describe('an envelope band with no height', () => {
  it('has a real band to lose, so a flat one is never the honest answer', async () => {
    const { signal, envelope } = await fixture();
    const honest = toPhysicalEnvelope(signal, envelope);
    for (let i = 0; i < honest.min.length; i += 1) {
      expect((honest.max[i] as number) - (honest.min[i] as number)).toBeGreaterThan(0);
    }
  });

  it('refuses one array handed in for both bounds', async () => {
    const { signal, envelope } = await fixture();
    const shared = new Float64Array(4);
    expect(() => toPhysicalEnvelope(signal, envelope, { min: shared, max: shared })).toThrow(
      /out\.min and out\.max overlap in memory/,
    );
  });

  it('refuses two overlapping views over one buffer', async () => {
    const { signal, envelope } = await fixture();
    const pool = new Float64Array(8);
    expect(() =>
      toPhysicalEnvelope(signal, envelope, {
        min: pool.subarray(0, 4),
        max: pool.subarray(2, 6),
      }),
    ).toThrow(/overlap in memory/);
  });

  it('says what it would have cost, and ends naming the pooled spelling', async () => {
    const { signal, envelope } = await fixture();
    const shared = new Float64Array(4);
    let message = '';
    try {
      toPhysicalEnvelope(signal, envelope, { min: shared, max: shared });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('a band of zero height');
    expect(message).toMatch(/Next: pass two separate Float64Arrays/);
    expect(message).toContain('pool.subarray(0, n)');
  });

  it('accepts two disjoint views over one buffer, which is what a pool hands out', async () => {
    const { signal, envelope } = await fixture();
    const pool = new Float64Array(8);
    const result = toPhysicalEnvelope(signal, envelope, {
      min: pool.subarray(0, 4),
      max: pool.subarray(4, 8),
    });
    const honest = toPhysicalEnvelope(signal, envelope);
    expect([...result.min]).toEqual([...honest.min]);
    expect([...result.max]).toEqual([...honest.max]);
  });

  it('accepts two separate arrays, and longer ones, as before', async () => {
    const { signal, envelope } = await fixture();
    const exact = toPhysicalEnvelope(signal, envelope, {
      min: new Float64Array(4),
      max: new Float64Array(4),
    });
    expect(exact.min.length).toBe(4);
    const longer = toPhysicalEnvelope(signal, envelope, {
      min: new Float64Array(9),
      max: new Float64Array(9),
    });
    expect(longer.min.length).toBe(4);
  });

  it('is why identity downstream could not catch it', async () => {
    const { signal, envelope } = await fixture();
    // Two separate arrays: the result's halves are distinct views either way, so a caller comparing
    // them learns nothing about whether their buffers were shared.
    const result = toPhysicalEnvelope(signal, envelope, {
      min: new Float64Array(4),
      max: new Float64Array(4),
    });
    expect(result.min === result.max).toBe(false);
    expect(result.min.buffer === result.max.buffer).toBe(false);
  });

  it('still refuses the kinds and lengths it did before', async () => {
    const { signal, envelope } = await fixture();
    expect(() =>
      toPhysicalEnvelope(signal, envelope, {
        min: new Float64Array(4),
        max: new Int32Array(4) as never,
      }),
    ).toThrow(/out\.max is Int32Array, not a Float64Array/);
    expect(() =>
      toPhysicalEnvelope(signal, envelope, { min: new Float64Array(2), max: new Float64Array(2) }),
    ).toThrow(/out holds 2 buckets but this envelope has 4/);
  });
});
