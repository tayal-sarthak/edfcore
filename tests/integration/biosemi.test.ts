/**
 * The BioSemi Status channel.
 *
 * The bit layout is the whole feature, so the fixture writes the 24-bit words by hand and the
 * expectations are the codes it wrote — not anything edfcore produced.
 */

import { describe, expect, it } from 'vitest';
import { decodeStatusWord, getStatusSignal, readTriggers } from '../../src/biosemi.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
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
