/**
 * Reading, scaling and decimating agree with each other, on every awkward shape.
 *
 * The third group in `tests/corpus/whole-api.test.ts`, which skips without the corpus. These are
 * four calls a viewer makes in sequence — read a window, join the chunks, convert to units, draw a
 * decimated envelope — and each can be individually right while contradicting the one before it.
 * The envelope is where that bites: `readEnvelope` reads and reduces on its own path rather than
 * decimating what `readWindow` returned, so its extremes and the samples' extremes are two
 * independent answers to the same question, and only comparing them says they agree.
 *
 * Running it on built files rather than real ones changes what it covers, for the better. The
 * shapes here include a file with no data signal at all and one with a zero record duration, where
 * the honest answer to "read a window of it" is nothing — and a helper that returns nothing where
 * another throws is exactly the kind of disagreement this group exists to find. The corpus reaches
 * those shapes by luck; `awkward-files.ts` reaches them by construction.
 *
 * What this does NOT check: the values themselves. `physical.test.ts` owns the scaling expression
 * and `envelope.test.ts` the bucketing. This checks that the four calls describe one file.
 */

import { describe, expect, it } from 'vitest';
import {
  buildRecordIndex,
  byteSource,
  mergeChunks,
  openEdf,
  readEnvelope,
  readWindow,
  sampleAt,
  sampleStartSecondsOf,
  toPhysical,
} from '../../src/index.js';
import type { EdfRecording } from '../../src/types.js';
import { AWKWARD } from '../support/awkward-files.js';

async function scanned(bytes: Uint8Array): Promise<EdfRecording> {
  const opened = await openEdf(byteSource(bytes));
  return { ...opened, index: await buildRecordIndex(opened) };
}

/** The first data signal that carries samples, or `undefined` for a file with none. */
function readable(recording: EdfRecording): number | undefined {
  for (const index of recording.header.dataSignalIndices) {
    const signal = recording.header.signals[index];
    if (signal !== undefined && signal.samplesPerRecord > 0) return index;
  }
  return undefined;
}

let windowsRead = 0;
let envelopesCompared = 0;
let locationsChecked = 0;

describe.each(AWKWARD)('$name', ({ awkward, bytes }) => {
  it(`reads, scales and decimates one file, where ${awkward}`, async () => {
    const recording = await scanned(bytes);
    const signalIndex = readable(recording);
    if (signalIndex === undefined || recording.header.recordCount === 0) return;
    const signal = recording.header.signals[signalIndex];
    if (signal === undefined) return;
    // A zero record duration is no time axis, so a time window is refused rather than empty.
    if (recording.header.recordDurationSeconds === 0) return;

    const startSeconds = recording.timeline.spanSeconds > 4 ? 2 : 0;
    const durationSeconds = Math.max(recording.header.recordDurationSeconds, 1);
    const chunks = await readWindow(recording, {
      signalIndices: [signalIndex],
      startSeconds,
      durationSeconds,
    });
    if (chunks.length === 0) return;
    windowsRead += 1;

    // One window's chunks either join or are refused with a reason; there is no third answer.
    const merged = chunks.length === 1 ? chunks[0] : mergeChunks(chunks);
    const digital = merged?.signals[0]?.digital;
    expect(digital).toBeDefined();
    if (digital === undefined) return;
    expect(digital.length).toBe(merged?.signals[0]?.sampleCount);

    // Scaling produces one value per sample, and a finite one, or refuses the signal outright.
    if (signal.scale === undefined) {
      expect(() => toPhysical(signal, digital)).toThrow();
    } else {
      const physical = toPhysical(signal, digital);
      expect(physical.length).toBe(digital.length);
      expect(physical.every((value) => Number.isFinite(value))).toBe(true);
    }

    // The envelope reads and reduces on its own path. Its extremes are the samples' extremes, or
    // the two calls disagree about the same window.
    const [envelope] = await readEnvelope(recording, {
      signalIndices: [signalIndex],
      startSeconds,
      durationSeconds,
      buckets: 8,
    });
    const min = envelope?.signals[0]?.min;
    const max = envelope?.signals[0]?.max;
    expect(min, 'no envelope for a window that produced samples').toBeDefined();
    if (min === undefined || max === undefined) return;
    expect(Math.min(...min)).toBe(Math.min(...digital));
    expect(Math.max(...max)).toBe(Math.max(...digital));
    envelopesCompared += 1;
  });

  it(`locates a sample where a read of it lands, where ${awkward}`, async () => {
    const recording = await scanned(bytes);
    const signalIndex = readable(recording);
    if (signalIndex === undefined || recording.header.recordCount === 0) return;
    const signal = recording.header.signals[signalIndex];
    if (signal === undefined || recording.header.recordDurationSeconds === 0) return;

    // The first sample of the LAST record: the far end of the axis, where drift shows.
    const lastRecord = recording.header.recordCount - 1;
    const sampleIndex = lastRecord * signal.samplesPerRecord;
    const seconds = sampleStartSecondsOf(recording, signalIndex, sampleIndex);

    const chunks = await readWindow(recording, {
      signalIndices: [signalIndex],
      startSeconds: seconds,
      durationSeconds: recording.header.recordDurationSeconds,
    });
    expect(chunks[0]?.records.start, 'a window at that sample reads its record').toBe(lastRecord);
    expect(sampleAt(recording, signalIndex, seconds)?.sampleIndex).toBe(sampleIndex);
    locationsChecked += 1;
  });
});

describe('the shapes exercised the calls', () => {
  it('read windows, compared envelopes and located samples on more than one of them', () => {
    // Every case above returns early on a file it cannot apply to — a file with no data signal, a
    // record count of zero, a duration of zero. Without this the whole run could return early.
    expect(windowsRead).toBeGreaterThanOrEqual(4);
    expect(envelopesCompared).toBeGreaterThanOrEqual(4);
    expect(locationsChecked).toBeGreaterThanOrEqual(4);
  });
});
