/**
 * The worked example on `concepts.md`, executed.
 *
 * That page is the one the site tells you to read first, and the README calls it "the mental model
 * the rest of the API follows from". It is built almost entirely out of arithmetic on one
 * described file — a 768-byte header, 30 records of 544 bytes, a 17,088-byte total, and a
 * ten-record read of the narrow channel costing 5,440 bytes for 160 samples — and every one of
 * those numbers was prose. A reader who works through the page and gets a different number from
 * their own file has no way to tell which of the two is wrong.
 *
 * They are all correct. What was missing is that nothing kept them so: the page's numbers follow
 * from `headerByteLength = 256 * (signals + 1)` and from the record layout, and a change to either
 * would leave the page teaching the old ones.
 *
 * The file here is built to the page's description — EEG Fpz-Cz at 256 Hz beside Resp at 16 Hz,
 * thirty one-second records — with the suite's own writer, which imports nothing from `src/`. So
 * the numbers are checked against a file assembled from the specification rather than against
 * edfcore's idea of one.
 */

import { describe, expect, it } from 'vitest';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

/** Exactly the file the page draws: two signals, thirty records, one second each. */
const BYTES = buildEdf({
  recordCount: 30,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fpz-Cz', samplesPerRecord: 256, physicalDimension: 'uV' },
    { label: 'Resp', samplesPerRecord: 16, physicalDimension: 'uV' },
  ],
});

describe('the file the page describes', () => {
  it('is the size the page computes', async () => {
    const { header } = await openEdf(byteSource(BYTES));
    // "Total file: 768 + 30 * 544 = 17088 bytes."
    expect(header.headerByteLength).toBe(768);
    expect(header.recordByteLength).toBe(544);
    expect(header.recordCount).toBe(30);
    expect(BYTES.byteLength).toBe(17_088);
  });

  it('gives each signal the block width the page draws', async () => {
    const { header } = await openEdf(byteSource(BYTES));
    expect(getSignal(header, 'EEG Fpz-Cz').recordByteLength).toBe(512);
    expect(getSignal(header, 'Resp').recordByteLength).toBe(32);
    // The horizontal position of each block inside a record, which the diagram shows.
    expect(getSignal(header, 'EEG Fpz-Cz').recordByteOffset).toBe(0);
    expect(getSignal(header, 'Resp').recordByteOffset).toBe(512);
  });
});

describe('the read the page costs out', () => {
  it('returns the byteOffset, byteLength and sampleCount the page prints', async () => {
    const recording = await openEdf(byteSource(BYTES));
    const resp = getSignal(recording.header, 'Resp');
    const chunk = await readRecords(recording, {
      records: { start: 0, count: 10 },
      signalIndices: [resp.index],
    });

    expect(chunk.byteOffset).toBe(768);
    expect(chunk.byteLength).toBe(5440);
    expect(chunk.signals[0]?.sampleCount).toBe(160);
  });

  it('overreads by the ratio the page states, and the ratio is the definition', async () => {
    // "The ratio for a channel is always header.recordByteLength / signal.recordByteLength", 17
    // for Resp and about 1.06 for the EEG channel — the number the page uses to argue that naming
    // every channel in one call is free.
    const { header } = await openEdf(byteSource(BYTES));
    const resp = getSignal(header, 'Resp');
    const eeg = getSignal(header, 'EEG Fpz-Cz');

    expect(header.recordByteLength / resp.recordByteLength).toBe(17);
    expect(header.recordByteLength / eeg.recordByteLength).toBeCloseTo(1.06, 2);

    // And the overread is real: ten records of Resp want 320 bytes and cost 5,440.
    const wanted = 10 * resp.recordByteLength;
    expect(wanted).toBe(320);
    expect((10 * header.recordByteLength) / wanted).toBe(17);
  });
});
