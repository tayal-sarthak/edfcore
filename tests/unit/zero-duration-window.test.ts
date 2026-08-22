/**
 * A window over a recording whose records do not advance in time.
 *
 * `concepts.md` calls a zero record duration legal and says what edfcore does about it: a
 * `ZERO_RECORD_DURATION` warning, `sampleRateHz` left `undefined` for every signal, "and keeps
 * reading". `api-errors.md` names the shape it comes from — an annotations-only EDF+ recording,
 * where the records carry events and no samples, so there is no duration for them to advance by.
 *
 * "Keeps reading" is the part with a window in it. Every record sits at one instant, so a window
 * either contains that instant or it does not, and there is no interval arithmetic to do — which
 * is exactly why the code has a separate branch for it, and why that branch is the one a division
 * by zero would otherwise live in. Both index shapes have their own copy of it: a complete index
 * answers from its segments, a probed index from the nominal grid, and they have to agree.
 *
 * `locate-edges.test.ts` covers the same file shape for a single instant. This is the window.
 *
 * What this does NOT check: that anything downstream is sensible about the result. A caller who
 * divides by `sampleRateHz` gets `undefined` and a type error, which is the point of leaving it
 * undefined — see `concepts.md`. Here the question is only which records a window selects.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { resolveTimeWindow } from '../../src/time/window.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

/** Three records, four samples each, and no duration to separate them. */
const open = (): Promise<EdfRecording> =>
  openEdf(
    byteSource(
      buildEdf({
        recordCount: 3,
        recordDurationSeconds: 0,
        signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
      }),
    ),
  );

describe('the file itself', () => {
  it('is diagnosed and readable, which is what the page promises', async () => {
    const recording = await open();
    expect(recording.header.diagnostics.map((one) => one.code)).toContain('ZERO_RECORD_DURATION');
    expect(recording.header.recordDurationSeconds).toBe(0);
    // The documented consequence: no rate, because the quotient is a division by zero.
    expect(recording.header.signals[0]?.sampleRateHz).toBeUndefined();
  });
});

describe.each([
  ['a probed index, on the nominal grid', async (recording: EdfRecording) => recording.index],
  ['a complete index, from its segments', (recording: EdfRecording) => buildRecordIndex(recording)],
])('%s', (_name, indexFor) => {
  it('selects every record for a window containing the instant', async () => {
    const recording = await open();
    const index = await indexFor(recording);
    // One range covering all three: they share an instant, so no window can split them.
    expect(resolveTimeWindow(recording.timeline, index, 0, 1)).toEqual([{ start: 0, count: 3 }]);
  });

  it('selects none for a window that starts after it', async () => {
    const recording = await open();
    const index = await indexFor(recording);
    expect(resolveTimeWindow(recording.timeline, index, 1, 1)).toEqual([]);
  });

  it('selects none for a window that ends before it', async () => {
    const recording = await open();
    const index = await indexFor(recording);
    expect(resolveTimeWindow(recording.timeline, index, -1, 0.5)).toEqual([]);
  });

  it('is inclusive at the start and exclusive at the end, like every other window', async () => {
    const recording = await open();
    const index = await indexFor(recording);
    // A window opening exactly on the instant contains it...
    expect(resolveTimeWindow(recording.timeline, index, 0, 0.5)).toEqual([{ start: 0, count: 3 }]);
    // ...and one closing exactly on it does not.
    expect(resolveTimeWindow(recording.timeline, index, -0.5, 0.5)).toEqual([]);
    // A window straddling it from before still finds it.
    expect(resolveTimeWindow(recording.timeline, index, -1, 2)).toEqual([{ start: 0, count: 3 }]);
  });
});

describe('the two index shapes', () => {
  it('agree on every window, which is what makes building one optional', async () => {
    const recording = await open();
    const complete = await buildRecordIndex(recording);
    // One segment, no gaps: every record is at the same instant, so there is nothing between them.
    expect(complete.segments).toHaveLength(1);
    expect(complete.gaps).toEqual([]);

    for (const [start, duration] of [
      [-2, 1],
      [-1, 2],
      [0, 0.001],
      [0, 10],
      [0.5, 1],
      [1, 1],
    ] as ReadonlyArray<readonly [number, number]>) {
      expect(
        resolveTimeWindow(recording.timeline, complete, start, duration),
        `window ${start}..${start + duration}`,
      ).toEqual(resolveTimeWindow(recording.timeline, recording.index, start, duration));
    }
  });
});

describe('and the samples behind it', () => {
  it('come back as one chunk of every record', async () => {
    const recording = await open();
    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 1,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.records).toEqual({ start: 0, count: 3 });
    expect(chunks[0]?.signals[0]?.digital).toHaveLength(12);
  });

  it('and as nothing at all for a window that misses the instant', async () => {
    const recording = await open();
    expect(
      await readWindow(recording, { signalIndices: [0], startSeconds: 5, durationSeconds: 1 }),
    ).toEqual([]);
  });
});
