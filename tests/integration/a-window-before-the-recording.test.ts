/**
 * A window that begins before the recording does.
 *
 * "A window that starts before record 0 is how a pre-stimulus epoch is spelled" is the sentence
 * `tal/ticks.ts` uses to justify `floorDiv` and `ceilDiv` existing at all, and `annotations.md`
 * builds a whole section on negative onsets around the same idea. 0.5.15 tested the two divisions.
 * What a caller actually writes — `readWindow(recording, { startSeconds: -2, durationSeconds: 4 })`
 * — was tested for its bounds and not for the negative side of them.
 *
 * The behaviour is worth stating because there are three outcomes and only one of them is an error,
 * and it is not the one a reader expects. A window that straddles t = 0 is read, clamped to the
 * samples that exist. A window entirely before the recording comes back as `[]` — the same empty
 * array a window past the end gives, which `api-reading.md` says in as many words. Nothing throws
 * for either: a negative bound is a legitimate question with a possibly empty answer, and only a
 * non-finite one is a mistake.
 *
 * The trimmed result is where it matters. `trimToWindow(header, series, -2, 4)` must start at 0 and
 * not at -2, and must hold exactly the samples in `[0, 2)` — which is the arithmetic that needs a
 * floor rather than a truncation, on operands that are negative for the whole first half of the
 * window.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { sampleAt } from '../../src/sample-locate.js';
import { resolveTimeWindow, trimToWindow } from '../../src/time/window.js';
import { buildEdf } from '../support/writer.js';

const RATE = 16;

const BYTES = buildEdf({
  plus: 'C',
  recordCount: 8,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: RATE, sample: (record, index) => record * RATE + index },
  ],
  annotationSignals: [{ samplesPerRecord: 20 }],
});

const opened = () => openEdf(byteSource(BYTES));

describe('a window that straddles t = 0', () => {
  it('is read, clamped to the samples that exist', async () => {
    const recording = await opened();
    const chunks = await readWindow(recording, {
      startSeconds: -2,
      durationSeconds: 4,
      signalIndices: [0],
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.records).toEqual({ start: 0, count: 2 });
    expect(chunks[0]?.startSeconds).toBe(0);
  });

  it('and trims to the samples inside it, starting at 0 rather than at the bound', async () => {
    const recording = await opened();
    const [chunk] = await readWindow(recording, {
      startSeconds: -2,
      durationSeconds: 4,
      signalIndices: [0],
    });
    const series = chunk?.signals[0];
    if (series === undefined) throw new Error('the window returned no signal');

    const exact = trimToWindow(recording.header, series, -2, 4);
    expect(exact.startSeconds).toBe(0);
    expect(exact.firstSampleIndex).toBe(0);
    // Two seconds of the four are inside the recording.
    expect(exact.sampleCount).toBe(2 * RATE);
    expect([...exact.digital.subarray(0, exact.sampleCount)]).toEqual(
      Array.from({ length: 2 * RATE }, (_, at) => at),
    );
  });

  it('at a bound that is not a whole second either', async () => {
    const recording = await opened();
    const [chunk] = await readWindow(recording, {
      startSeconds: -1,
      durationSeconds: 1.5,
      signalIndices: [0],
    });
    const series = chunk?.signals[0];
    if (series === undefined) throw new Error('the window returned no signal');
    const exact = trimToWindow(recording.header, series, -1, 1.5);
    expect(exact.startSeconds).toBe(0);
    // Half a second of it is inside the recording.
    expect(exact.sampleCount).toBe(RATE / 2);
  });
});

describe('a window entirely before the recording', () => {
  it('is the empty array, not an error', async () => {
    const recording = await opened();
    await expect(
      readWindow(recording, { startSeconds: -5, durationSeconds: 2, signalIndices: [0] }),
    ).resolves.toEqual([]);
  });

  it('which is the same answer a window past the end gives', async () => {
    const recording = await opened();
    const before = await readWindow(recording, {
      startSeconds: -5,
      durationSeconds: 2,
      signalIndices: [0],
    });
    const after = await readWindow(recording, {
      startSeconds: 100,
      durationSeconds: 2,
      signalIndices: [0],
    });
    expect(before).toEqual(after);
    expect(before).toEqual([]);
  });

  it('and resolves to no record ranges at all', async () => {
    const recording = await opened();
    expect(resolveTimeWindow(recording.timeline, recording.index, -5, 2)).toEqual([]);
    // Where a straddling one resolves to the records it overlaps.
    expect(resolveTimeWindow(recording.timeline, recording.index, -2, 4)).toEqual([
      { start: 0, count: 2 },
    ]);
  });
});

describe('an instant before the recording', () => {
  it('has no sample, which is a real answer rather than a failure', async () => {
    const recording = await opened();
    expect(sampleAt(recording, 0, -0.5)).toBeUndefined();
    expect(sampleAt(recording, 0, -0.0001)).toBeUndefined();
    // And t = 0 does, so the boundary is where it should be.
    expect(sampleAt(recording, 0, 0)?.sampleIndex).toBe(0);
  });
});
