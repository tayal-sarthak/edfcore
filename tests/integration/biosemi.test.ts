/**
 * The BioSemi Status channel.
 *
 * The bit layout is the whole feature, so the fixture writes the 24-bit words by hand and the
 * expectations are the codes it wrote — not anything edfcore produced.
 */

import { describe, expect, it } from 'vitest';
import { decodeStatusWord, getStatusSignal, readTriggers } from '../../src/biosemi.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

const RECORDS = 8;
const SAMPLES_PER_RECORD = 4;

/**
 * A BDF whose Status channel carries a known trigger sequence.
 *
 * Sample n of record r gets `plan[r * SAMPLES_PER_RECORD + n]`, written as a raw 24-bit word.
 */
function bdfWithStatus(plan: readonly number[], label = 'Status'): Uint8Array {
  const file = buildEdf({
    format: 'BDF',
    // Plain BDF: a real ActiveTwo file is not BDF+, and BDF+ would demand an annotations channel.
    plus: false,
    recordCount: RECORDS,
    recordDurationSeconds: 1,
    signals: [
      {
        label: 'A1',
        samplesPerRecord: SAMPLES_PER_RECORD,
        physicalMinimum: -262144,
        physicalMaximum: 262144,
        digitalMinimum: -8388608,
        digitalMaximum: 8388607,
        sample: () => 0,
      },
      {
        label,
        samplesPerRecord: SAMPLES_PER_RECORD,
        physicalMinimum: -262144,
        physicalMaximum: 262144,
        digitalMinimum: -8388608,
        digitalMaximum: 8388607,
        // buildEdf writes the digital value it is given; a Status word is that value's bits.
        sample: (recordIndex: number, sampleIndex: number) => {
          const word = plan[recordIndex * SAMPLES_PER_RECORD + sampleIndex] ?? 0;
          // Words with bit 23 set must be written as the signed value that bit pattern denotes.
          return word >= 0x800000 ? word - 0x1000000 : word;
        },
      },
    ],
  });
  return file;
}

describe('decodeStatusWord', () => {
  it('splits the trigger input from the flags', () => {
    // Low 16 bits are the parallel input; 16/17/18 are epoch, CMS-in-range and battery-low.
    const word = decodeStatusWord(0x002a | (1 << 16) | (1 << 18));
    expect(word.trigger).toBe(0x002a);
    expect(word.newEpoch).toBe(true);
    expect(word.cmsInRange).toBe(false);
    expect(word.batteryLow).toBe(true);
  });

  it('masks a sign-extended sample back to 24 unsigned bits', () => {
    // decodeDigital sign-extends BDF samples, as it must for a measurement, so bit 23 arrives
    // negative. The bit field is unsigned and has to be read as one.
    const signExtended = -1; // all 24 bits set, sign-extended to 32
    const word = decodeStatusWord(signExtended);
    expect(word.raw).toBe(0xffffff);
    expect(word.trigger).toBe(0xffff);
  });
});

describe('getStatusSignal', () => {
  it('finds the channel by label, case- and padding-insensitively', async () => {
    const recording = await openEdf(byteSource(bdfWithStatus([], 'status')));
    expect(getStatusSignal(recording.header)?.label.trim().toLowerCase()).toBe('status');
  });

  it('returns undefined when the file has no Status channel', async () => {
    // An ordinary fact about the file, not an error.
    const recording = await openEdf(byteSource(bdfWithStatus([], 'A2')));
    expect(getStatusSignal(recording.header)).toBeUndefined();
  });
});

describe('readTriggers', () => {
  it('reports one event per change, not one per sample', async () => {
    // A parallel trigger is HELD while the stimulus computer asserts it, so the same code
    // repeats across samples. The transition is the event.
    const plan = [0, 0, 0, 0, 12, 12, 12, 0, 0, 0, 0, 0, 255, 255, 0, 0];
    const recording = await openEdf(byteSource(bdfWithStatus(plan)));

    const events = await readTriggers(recording, { startSeconds: 0, durationSeconds: RECORDS });
    expect(events.map((e) => e.trigger)).toEqual([0, 12, 0, 255, 0]);
    expect(events.map((e) => e.sampleIndex)).toEqual([0, 4, 7, 12, 14]);
  });

  it('times events on the Status channel own sample grid', async () => {
    const plan = [0, 0, 0, 0, 7, 7, 7, 7];
    const recording = await openEdf(byteSource(bdfWithStatus(plan)));
    const events = await readTriggers(recording, { startSeconds: 0, durationSeconds: RECORDS });

    // Record duration 1 s, 4 samples per record, so sample 4 begins exactly 1 s in.
    const rising = events.find((e) => e.trigger === 7);
    expect(rising?.sampleIndex).toBe(4);
    expect(rising?.seconds).toBe(1);
    expect(rising?.ticks).toBe(10_000_000n);
  });

  it('gives the same events whatever the read chunk size', async () => {
    const plan = [0, 0, 5, 5, 5, 0, 0, 9, 9, 0, 0, 0, 3, 3, 3, 3];
    const recording = await openEdf(byteSource(bdfWithStatus(plan)));
    const selection = { startSeconds: 0, durationSeconds: RECORDS };

    const wide = await readTriggers(recording, selection);
    const narrow = await readTriggers(recording, selection, { maxMaterializeBytes: 64 });
    expect(narrow.map((e) => [e.sampleIndex, e.trigger])).toEqual(
      wide.map((e) => [e.sampleIndex, e.trigger]),
    );
  });

  it('refuses a file with no Status channel instead of guessing one', async () => {
    const recording = await openEdf(byteSource(bdfWithStatus([], 'A2')));
    await expect(readTriggers(recording, { startSeconds: 0, durationSeconds: 1 })).rejects.toThrow(
      RangeError,
    );
  });
});

// ---------------------------------------------------------------------------
// The window, and the axis (0.2.18)
// ---------------------------------------------------------------------------

describe('readTriggers honours the window it was given', () => {
  // Record 0 holds no trigger; record 1 goes 11, 11, 22, 33 at 0, 0.25, 0.5, 0.75 s into it.
  const PLAN = [0, 0, 0, 0, 11, 11, 22, 33];

  async function open() {
    return openEdf(byteSource(bdfWithStatus(PLAN)));
  }

  it('reports nothing outside [startSeconds, startSeconds + durationSeconds)', async () => {
    // The scan is record-aligned — record 1 is the only record touched — but the events are not.
    // Before 0.2.18 this returned three events, at 1.0, 1.5 and 1.75 s, two of them outside the
    // window the caller asked for.
    const events = await readTriggers(await open(), { startSeconds: 1.5, durationSeconds: 0.1 });
    expect(events.map((e) => [e.seconds, e.trigger])).toEqual([[1.5, 22]]);
  });

  it('does not manufacture an onset for a code that was already held', async () => {
    // Code 11 is asserted once, at 1.0 s, and held to the end of the file. A window that starts
    // at 1.5 s contains no transition at all. Before 0.2.18 the scan reset its running state at
    // the record boundary and reported a *transition to 11 at 1.0 s* — an event at a time the
    // caller did not ask about, describing a stimulus onset that is not in the file.
    const held = await openEdf(byteSource(bdfWithStatus([0, 0, 0, 0, ...Array(28).fill(11)])));

    const whole = await readTriggers(held, { startSeconds: 0, durationSeconds: RECORDS });
    expect(whole.map((e) => [e.seconds, e.trigger])).toEqual([
      [0, 0],
      [1, 11],
    ]);

    const windowed = await readTriggers(held, { startSeconds: 1.5, durationSeconds: 0.1 });
    // One event, at the window's own left edge, carrying the code in force there — not at 1.0.
    expect(windowed.map((e) => [e.seconds, e.trigger])).toEqual([[1.5, 11]]);
  });

  it('reports the code in force at the left edge, aligned or not', async () => {
    // An aligned and an unaligned window must behave the same way; a whole-file read already
    // reports its first sample whether or not it is a transition, and this is that same rule.
    const recording = await open();
    const aligned = await readTriggers(recording, { startSeconds: 1, durationSeconds: 0.3 });
    expect(aligned.map((e) => [e.seconds, e.trigger])).toEqual([[1, 11]]);

    const unaligned = await readTriggers(recording, { startSeconds: 1.25, durationSeconds: 0.05 });
    expect(unaligned.map((e) => [e.seconds, e.trigger])).toEqual([[1.25, 11]]);
  });

  it('keeps sampleIndex absolute on the Status channel own grid', async () => {
    const events = await readTriggers(await open(), { startSeconds: 1.5, durationSeconds: 0.5 });
    // 0.5 s and 0.75 s into record 1, i.e. samples 6 and 7 of the whole channel.
    expect(events.map((e) => e.sampleIndex)).toEqual([6, 7]);
  });
});

describe('readTriggers times events on the recording axis, not the nominal grid', () => {
  const GAP_RECORDS = 4;
  const GAP_SAMPLES = 2;

  /** Records 0,1 at t = 0,1; then an 8 s hole; records 2,3 at t = 10,11. */
  function discontinuous(): Uint8Array {
    return buildEdf({
      format: 'BDF',
      plus: 'D',
      recordCount: GAP_RECORDS,
      recordDurationSeconds: 1,
      recordOnsetSeconds: (r: number) => (r < 2 ? r : r + 8),
      signals: [
        {
          label: 'Status',
          samplesPerRecord: GAP_SAMPLES,
          physicalMinimum: -262144,
          physicalMaximum: 262144,
          digitalMinimum: -8388608,
          digitalMaximum: 8388607,
          // One distinct code per record, so every event names the record it came from.
          sample: (recordIndex: number) => (recordIndex + 1) * 3,
        },
      ],
      annotationSignals: [{ samplesPerRecord: 40 }],
    });
  }

  async function scanned() {
    const recording = await openEdf(byteSource(discontinuous()));
    return { ...recording, index: await buildRecordIndex(recording) };
  }

  it('gives a post-gap record the onset the file states, not recordIndex * duration', async () => {
    const recording = await scanned();
    // Ground truth from the index, independent of readTriggers.
    expect(recording.index.segments?.map((s) => s.startSeconds)).toEqual([0, 10]);

    const events = await readTriggers(recording, { startSeconds: 0, durationSeconds: 12 });
    // Before 0.2.18 the last two were reported at 2 s and 3 s — the nominal grid — for samples
    // the hardware latched at 10 s and 11 s. The whole gap was missing from every event after it.
    expect(events.map((e) => [e.seconds, e.trigger])).toEqual([
      [0, 3],
      [1, 6],
      [10, 9],
      [11, 12],
    ]);
    expect(events.map((e) => e.ticks)).toEqual([0n, 10_000_000n, 100_000_000n, 110_000_000n]);
  });

  it('agrees with readWindow about when the same records start', async () => {
    // The two must not disagree about one file: same records, same axis, same seconds.
    const recording = await scanned();
    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 12,
    });
    const chunkStarts = chunks.map((c) => c.startSeconds);
    const events = await readTriggers(recording, { startSeconds: 0, durationSeconds: 12 });
    const runStarts = [events[0]?.seconds, events[2]?.seconds];

    expect(chunkStarts).toEqual([0, 10]);
    expect(runStarts).toEqual(chunkStarts);
  });

  it('answers a post-gap window in the seconds that window was asked in', async () => {
    // Asking for [10, 12) and getting back events labelled 2 s and 3 s is self-inconsistent
    // output: the same call would have used one axis for the request and another for the answer.
    const events = await readTriggers(await scanned(), { startSeconds: 10, durationSeconds: 2 });
    expect(events.map((e) => [e.seconds, e.trigger])).toEqual([
      [10, 9],
      [11, 12],
    ]);
  });

  it('returns nothing for a window that lies inside the gap', async () => {
    const events = await readTriggers(await scanned(), { startSeconds: 4, durationSeconds: 3 });
    expect(events).toEqual([]);
  });
});
