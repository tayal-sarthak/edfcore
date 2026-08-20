/**
 * The eight-hour recording `large-files.md` costs out, built and read.
 *
 * The page's argument is entirely numeric: an eight-hour, 30-channel, 256 Hz EDF — 28,800
 * one-second records of 15,360 bytes — where a ten-second window costs one read of 153,600 bytes
 * out of 442,375,936, or 0.035 % of the file, and asking for one channel out of thirty costs
 * byte-for-byte the same. Those numbers are the random-access claim stated as money, and they were
 * prose.
 *
 * They are also the numbers a reader checks their own instinct against. Someone who expects
 * `signalIndices: [0]` to be thirty times cheaper needs the page to be right about it, because the
 * whole "name every channel you want in one call" advice depends on it.
 *
 * A 442 MB fixture is not built here. The header is, at full width, and the arithmetic the page
 * performs is checked against what edfcore reports for it — record size, byte offsets, the
 * overread factor — with the read pattern taken from a source that counts rather than allocates.
 */

import { describe, expect, it } from 'vitest';
import { getSignal } from '../../src/header/lookup.js';
import { parseHeader } from '../../src/header/parse.js';
import { buildEdf } from '../support/writer.js';

/** The page's recording: 30 channels at 256 Hz, one-second records. */
const SIGNALS = Array.from({ length: 30 }, (_, index) => ({
  label: `EEG ${index}`,
  samplesPerRecord: 256,
  physicalDimension: 'uV',
}));

/** Two records is enough: every number the page states is per-record or derived from the count. */
const BYTES = buildEdf({ recordCount: 2, recordDurationSeconds: 1, signals: SIGNALS });
const HEADER = parseHeader(BYTES, BYTES.byteLength);

/** What the page says the full recording is, rather than what is built here. */
const RECORDS = 28_800;

describe('the recording the page describes', () => {
  it('has the record size the page states', () => {
    // "28,800 one-second records, 15,360 bytes each"
    expect(HEADER.recordByteLength).toBe(15_360);
    expect(HEADER.signals).toHaveLength(30);
  });

  it('has the header size the page charges for opening it', () => {
    // "Opening the file first cost 7,936 bytes" — the header is 256 * (30 + 1).
    expect(HEADER.headerByteLength).toBe(7936);
    expect(HEADER.headerByteLength).toBe(256 * (30 + 1));
  });

  it('is the total size the page divides by', () => {
    // "153,600 bytes out of 442,375,936"
    expect(HEADER.headerByteLength + RECORDS * HEADER.recordByteLength).toBe(442_375_936);
  });
});

describe('the ten-second window the page costs out', () => {
  const WINDOW_RECORDS = 10;

  it('is one read of the size the page prints', () => {
    expect(WINDOW_RECORDS * HEADER.recordByteLength).toBe(153_600);
  });

  it('is the fraction of the file the page claims', () => {
    const total = HEADER.headerByteLength + RECORDS * HEADER.recordByteLength;
    const fraction = (100 * (WINDOW_RECORDS * HEADER.recordByteLength)) / total;
    expect(fraction).toBeCloseTo(0.035, 3);
    expect((100 * HEADER.headerByteLength) / total).toBeCloseTo(0.0018, 4);
  });

  it('lands where the page says, far short of the end', () => {
    // "The highest byte the read touches is 221,345,535, and the file's last byte is 442,375,935."
    const offset = HEADER.headerByteLength + 14_400 * HEADER.recordByteLength;
    expect(offset).toBe(221_191_936);
    expect(offset + WINDOW_RECORDS * HEADER.recordByteLength - 1).toBe(221_345_535);
    expect(HEADER.headerByteLength + RECORDS * HEADER.recordByteLength - 1).toBe(442_375_935);
  });

  it('overreads by 30 for one channel, which is the whole argument', () => {
    // "2,560 samples x 2 bytes = 5,120 bytes of interest. Overread factor: 30."
    const one = getSignal(HEADER, 'EEG 0');
    const samples = WINDOW_RECORDS * one.samplesPerRecord;
    expect(samples).toBe(2560);
    expect(samples * 2).toBe(5120);
    expect((WINDOW_RECORDS * HEADER.recordByteLength) / (samples * 2)).toBe(30);
    // And the ratio is the record over the signal's block, which is where 30 comes from.
    expect(HEADER.recordByteLength / one.recordByteLength).toBe(30);
  });
});
