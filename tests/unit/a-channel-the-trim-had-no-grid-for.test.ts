/**
 * `trimToWindow` on a channel that declares no samples per record.
 *
 * `samplesPerRecord` of zero makes every bound inside the trim collapse, so it returned an empty
 * signal — and an empty signal is also what a window that selects nothing returns. The two are
 * different facts. One is a channel the parser has already diagnosed `ZERO_SAMPLES_PER_RECORD`; the
 * other is a window the caller chose.
 *
 * `biosemi.ts` makes exactly this argument for its own case — "an empty result here reads as a
 * recording with no stimulus in it" — and claims to be "the third place a signal with no grid is read
 * from, and the only one that answered". It was not the only one: `sample-locate.ts` and
 * `sample-grid.ts` refuse, and this call answered.
 *
 * The DECLARATION is what is tested, not the samples in hand. `chunkSignal.digital.length` is
 * legitimately zero for a zero-duration window, and refusing on that would break a trim a caller
 * meant. `signal.samplesPerRecord` is a property of the header, and it says the channel has no grid
 * at all.
 *
 * Why here and not in `readWindow`: this is a single-signal call, like the three that already refuse.
 * A caller asking about one channel gets one answer about it. `readWindow` takes a selection, so
 * refusing there would make a file with one dead channel unreadable in full — and the precedent for
 * per-signal failure at the per-signal call is `signal.scale`, where `decodeDigital` still works and
 * `toPhysical` throws.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { trimToWindow } from '../../src/time/window.js';
import type { EdfChunkSignal, EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

/** Signal 1 declares no samples. Signal 0 is ordinary, so the file stays readable. */
const FILE = buildEdf({
  format: 'EDF',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fp1', samplesPerRecord: 4 },
    { label: 'Dead', samplesPerRecord: 0 },
  ],
});

const open = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

async function chunkSignalFor(index: number): Promise<{
  recording: EdfRecording;
  chunkSignal: EdfChunkSignal;
}> {
  const recording = await open();
  const [chunk] = await readWindow(recording, {
    signalIndices: [index],
    startSeconds: 0,
    durationSeconds: 2,
  });
  const chunkSignal = chunk?.signals[0];
  if (chunkSignal === undefined) throw new Error('fixture');
  return { recording, chunkSignal };
}

const refusal = (call: () => unknown): string => {
  let thrown: Error | undefined;
  try {
    call();
  } catch (error) {
    thrown = error as Error;
  }
  expect(thrown, 'nothing was refused').toBeDefined();
  return (thrown as Error).message;
};

describe('the file itself', () => {
  it('is diagnosed and still readable, which is why this is not refused earlier', async () => {
    const recording = await open();
    expect(recording.header.diagnostics.map((d) => d.code)).toContain('ZERO_SAMPLES_PER_RECORD');
    expect(recording.header.signals[1]?.samplesPerRecord).toBe(0);
    await expect(
      readWindow(recording, { signalIndices: [0, 1], startSeconds: 0, durationSeconds: 2 }),
    ).resolves.toHaveLength(1);
  });
});

describe('a trim over the channel with no grid', () => {
  it('is refused rather than answered with an empty signal', async () => {
    const { recording, chunkSignal } = await chunkSignalFor(1);
    expect(() => trimToWindow(recording.header, chunkSignal, 0, 1)).toThrow(RangeError);
  });

  it('names the channel, the declaration and the diagnostic to look for', async () => {
    const { recording, chunkSignal } = await chunkSignalFor(1);
    const message = refusal(() => trimToWindow(recording.header, chunkSignal, 0, 1));
    expect(message).toContain('signal 1 ("Dead") declares 0 samples per record');
    expect(message).toContain('no sample grid to narrow');
    expect(message).toContain('ZERO_SAMPLES_PER_RECORD');
  });

  it('says why an empty answer was the wrong one', async () => {
    const { recording, chunkSignal } = await chunkSignalFor(1);
    expect(refusal(() => trimToWindow(recording.header, chunkSignal, 0, 1))).toContain(
      'reads as a window that selected nothing',
    );
  });

  it('agrees with the three calls that already refused this channel', async () => {
    const { recording } = await chunkSignalFor(1);
    const { sampleAt, sampleStartSecondsOf } = await import('../../src/sample-locate.js');
    const { gridSampleIndexAt } = await import('../../src/sample-grid.js');
    const signal = recording.header.signals[1];
    if (signal === undefined) throw new Error('fixture');
    expect(refusal(() => sampleAt(recording, 1, 0.5))).toContain('no sample grid');
    expect(refusal(() => sampleStartSecondsOf(recording, 1, 0))).toContain('no sample grid');
    expect(
      refusal(() => gridSampleIndexAt(signal, 0, recording.header.recordDurationTicks)),
    ).toContain('no sample grid');
  });
});

describe('an empty result a caller did choose', () => {
  it('is still an empty result: a window of no duration over a real channel', async () => {
    const { recording, chunkSignal } = await chunkSignalFor(0);
    const trimmed = trimToWindow(recording.header, chunkSignal, 0, 0);
    expect(trimmed.digital).toHaveLength(0);
  });

  it('and a window that does select samples still trims to them', async () => {
    const { recording, chunkSignal } = await chunkSignalFor(0);
    const trimmed = trimToWindow(recording.header, chunkSignal, 0, 1);
    expect(trimmed.digital.length).toBe(4);
  });
});
