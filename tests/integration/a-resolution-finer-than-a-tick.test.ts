/**
 * The whole of the sub-tick range, not the half of it that rounds to zero.
 *
 * `readEnvelopeAtResolution` has a documented answer for a `secondsPerBucket` finer than one tick:
 * it has no whole-tick answer, so the request becomes one bucket per tick and `reduceRange` clamps
 * that to one bucket per sample — "the finest picture there is", as
 * `envelope-degenerate.test.ts` puts it.
 *
 * The branch choosing that path read the ROUNDED tick count. `secondsToTicks` rounds to nearest,
 * so everything from half a tick up to a whole one — 5e-8 s through 1e-7 s — came out as exactly
 * one tick, took the FIXED-WIDTH path instead, and asked for one bucket per tick with no clamp at
 * all. Over four seconds that is forty million buckets, and it was refused as an eight-hundred-
 * megabyte allocation.
 *
 * So two requests either side of half a tick behaved oppositely, and the COARSER of the two was
 * the one refused: 5e-8 s per bucket threw `EdfBudgetError` while 1e-9 — twenty times finer —
 * came back with one bucket per sample and a chunk that reported the width it really used. A
 * viewer deriving `secondsPerBucket` from a zoom level crosses that boundary continuously, and
 * nothing about it is visible from the outside.
 *
 * One tick exactly is NOT sub-tick and keeps the fixed-width treatment, which is the boundary the
 * rule has always named.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelopeAtResolution } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

/** Four records of eight samples: thirty-two samples, so "one bucket per sample" is countable. */
const FILE = buildEdf({
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

const SAMPLES = 32;
const TICK_SECONDS = 1e-7;

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

const at = async (secondsPerBucket: number): Promise<number | undefined> => {
  const recording = await opened();
  const [chunk] = await readEnvelopeAtResolution(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 4,
    secondsPerBucket,
  });
  return chunk?.signals[0]?.counts.length;
};

describe.each([
  ['a nanosecond, which rounds to zero ticks', 1e-9],
  ['half a tick, which rounds to one', TICK_SECONDS / 2],
  ['just under a tick', TICK_SECONDS * 0.99],
  ['a hundredth of a tick', TICK_SECONDS / 100],
])('a bucket width of %s', (_name, secondsPerBucket) => {
  it('is clamped to one bucket per sample rather than refused', async () => {
    expect(await at(secondsPerBucket)).toBe(SAMPLES);
  });

  it('reports the width it actually used, not the one it could not honour', async () => {
    const recording = await opened();
    const [chunk] = await readEnvelopeAtResolution(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 4,
      secondsPerBucket,
    });
    expect(chunk?.secondsPerBucket).toBe(4 / SAMPLES);
  });
});

describe('the boundary the rule names', () => {
  it('treats one whole tick as a fixed width, so a long run is refused with advice', async () => {
    const recording = await opened();
    await expect(
      readEnvelopeAtResolution(recording, {
        signalIndices: [0],
        startSeconds: 0,
        durationSeconds: 4,
        secondsPerBucket: TICK_SECONDS,
      }),
    ).rejects.toThrow(/coarser secondsPerBucket/);
  });

  it('is monotonic across it: a finer request never succeeds where a coarser one fails', async () => {
    // The defect stated as the property it broke.
    const widths = [TICK_SECONDS / 100, TICK_SECONDS / 2, TICK_SECONDS * 0.99];
    for (const width of widths) {
      expect(await at(width), `${width} s per bucket`).toBe(SAMPLES);
    }
  });
});

describe('the widths that do have a whole-tick answer', () => {
  it('still divides a run at the width it was given', async () => {
    expect(await at(0.5)).toBe(8);
    expect(await at(0.25)).toBe(16);
  });

  it('still refuses a secondsPerBucket that is not a positive number', async () => {
    const recording = await opened();
    await expect(
      readEnvelopeAtResolution(recording, {
        signalIndices: [0],
        startSeconds: 0,
        durationSeconds: 4,
        secondsPerBucket: 0,
      }),
    ).rejects.toThrow(/must be a positive finite number/);
  });
});
