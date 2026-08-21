/**
 * `toPhysicalEnvelope`, and the two things it does that `toPhysical` must not be used for.
 *
 * The first is the empty bucket. `min` and `max` are `Int32Array`s, so a bucket no sample landed
 * in carries a digital `0` — and through the affine map that becomes `bitValue * offset`, which is
 * mid-scale for any channel whose declared range is not centred on zero. The page names the case:
 * "On a 0..1000 channel it is 500 — a completely believable reading, drawn as a flat trace across
 * a hole." `NaN` cannot be mistaken for a measurement, and plotting libraries break the line at it.
 *
 * That is the failure worth a test, because everything about it looks right. The number is inside
 * the channel's range, the array lengths agree, the trace is continuous, and the only sign is that
 * a stretch of recording nobody sampled is drawn as a steady midpoint.
 *
 * The second is polarity. A negative amplifier gain makes the map decreasing, so the smallest
 * digital value is the largest physical one; mapping `min` to `min` would produce an envelope
 * whose lower bound sits above its upper bound, drawn inside out.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope, toPhysicalEnvelope } from '../../src/envelope.js';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const FLAT = (DOCS_PAGES.get('api-helpers.md') ?? '').replace(/\s+/g, ' ');

/** A dense channel that sets the grid, beside a sparse one that cannot fill it. */
const SPARSE_BESIDE_DENSE = buildEdf({
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    // 0..1000, the range the page names, so an empty bucket would land on 500.
    {
      label: 'Sparse',
      samplesPerRecord: 1,
      physicalMinimum: 0,
      physicalMaximum: 1000,
      digitalMinimum: -32768,
      digitalMaximum: 32767,
    },
    { label: 'Dense', samplesPerRecord: 32 },
  ],
});

describe('an empty bucket', () => {
  it('is the case the page names, on the channel it names', () => {
    expect(FLAT).toContain('On a 0..1000 channel it is 500');
    expect(FLAT).toContain('`NaN` cannot be mistaken for a measurement');
  });

  it('comes back as NaN in both arrays', async () => {
    const recording = await openEdf(byteSource(SPARSE_BESIDE_DENSE));
    const [chunk] = await readEnvelope(recording, {
      signalIndices: [0, 1],
      startSeconds: 0,
      durationSeconds: 4,
      buckets: 32,
    });
    const sparse = chunk?.signals[0];
    const { min, max } = toPhysicalEnvelope(
      getSignal(recording.header, 'Sparse'),
      sparse ?? ({} as never),
    );

    let empty = 0;
    for (let at = 0; at < (chunk?.bucketCount ?? 0); at += 1) {
      if ((sparse?.counts[at] ?? 0) !== 0) continue;
      empty += 1;
      expect(Number.isNaN(min[at]), `bucket ${at} min`).toBe(true);
      expect(Number.isNaN(max[at]), `bucket ${at} max`).toBe(true);
    }
    // The fixture has to actually produce empty buckets, or this proves nothing.
    expect(empty).toBeGreaterThan(0);
  });

  it('would otherwise be drawn mid-scale, which is the number the page quotes', async () => {
    // Stated as a counterfactual, because a sentinel is invisible when it works. This is what the
    // digital `0` in an empty bucket means once the map is applied.
    const recording = await openEdf(byteSource(SPARSE_BESIDE_DENSE));
    const signal = getSignal(recording.header, 'Sparse');
    const scale = signal.scale;
    const midScale = (scale?.bitValue ?? 0) * (scale?.offset ?? 0);
    expect(Math.round(midScale)).toBe(500);
    // And 500 is a reading this channel could genuinely produce, which is the whole problem.
    expect(midScale).toBeGreaterThan(signal.physicalMinimum);
    expect(midScale).toBeLessThan(signal.physicalMaximum);
  });

  it('leaves counts alone, which stays the authoritative answer', async () => {
    expect(FLAT).toContain('`counts` is unchanged and remains the authoritative answer');
    const recording = await openEdf(byteSource(SPARSE_BESIDE_DENSE));
    const [chunk] = await readEnvelope(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 4,
      buckets: 4,
    });
    const sparse = chunk?.signals[0];
    expect([...(sparse?.counts ?? [])].reduce((a, b) => a + b, 0)).toBe(sparse?.sampleCount);
  });
});

describe('a filled bucket on a negative gain', () => {
  const INVERTED = buildEdf({
    recordCount: 4,
    recordDurationSeconds: 1,
    signals: [
      {
        label: 'Inv',
        samplesPerRecord: 8,
        physicalMinimum: 500,
        physicalMaximum: -500,
        digitalMinimum: -32768,
        digitalMaximum: 32767,
      },
    ],
  });

  it('comes back with min below max, not inside out', async () => {
    // "mapping `min` to `min` would produce an envelope whose lower bound sits above its upper
    //  bound, and a viewer would draw it inside out. `toPhysicalEnvelope` swaps the bounds."
    expect(FLAT).toContain('`toPhysicalEnvelope` swaps the bounds when it has to');
    const recording = await openEdf(byteSource(INVERTED));
    const signal = getSignal(recording.header, 'Inv');
    expect(signal.scale?.bitValue).toBeLessThan(0);

    const [chunk] = await readEnvelope(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 4,
      buckets: 8,
    });
    const bucketed = chunk?.signals[0];
    const { min, max } = toPhysicalEnvelope(signal, bucketed ?? ({} as never));

    let checked = 0;
    for (let at = 0; at < (chunk?.bucketCount ?? 0); at += 1) {
      if ((bucketed?.counts[at] ?? 0) === 0) continue;
      checked += 1;
      expect(min[at], `bucket ${at}`).toBeLessThanOrEqual(max[at] ?? 0);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('returns two Float64Arrays and nothing else', async () => {
    // "It returns an `EdfPhysicalEnvelope` — two `Float64Array`s, `min` and `max`, and nothing
    //  else."
    const recording = await openEdf(byteSource(INVERTED));
    const [chunk] = await readEnvelope(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 4,
      buckets: 8,
    });
    const envelope = toPhysicalEnvelope(
      getSignal(recording.header, 'Inv'),
      chunk?.signals[0] ?? ({} as never),
    );
    expect(Object.keys(envelope).sort()).toEqual(['max', 'min']);
    expect(envelope.min).toBeInstanceOf(Float64Array);
    expect(envelope.max).toBeInstanceOf(Float64Array);
  });
});
