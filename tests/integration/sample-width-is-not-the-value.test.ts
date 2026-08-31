/**
 * The sample width decides which values a file can hold, not what they mean.
 *
 * EDF stores each sample in two bytes and BDF in three. That is the whole difference between the
 * two families as far as the data records go, and edfcore keeps it where it belongs: `decodeDigital`
 * reads the width from the variant and sign-extends, and everything above it works in `Int32Array`
 * either way. The suite tests each width against expected values; nothing tested one against the
 * other.
 *
 * Written side by side, the two halves of the claim are sharper than either alone.
 *
 * For a value both widths can hold, the files disagree about everything except the number: the
 * record is half again as long, the declared digital range is 256 times wider, `bitValue` differs by
 * the same factor — and the decoded samples are bit-identical. That is the statement "the width is
 * an encoding", made where it can fail.
 *
 * For a value only BDF can hold, the EDF file simply does not hold it. Two bytes cannot carry
 * -300,000, so what is written is the low sixteen bits and what comes back is those bits
 * sign-extended: 27,680. edfcore reports it with no diagnostic and no `outOfDigitalRangeCount`,
 * which is correct and worth writing down — the file is well formed, 27,680 is inside its declared
 * range, and the loss happened before edfcore saw a byte. Nothing in an EDF header can record that
 * a writer had a number it could not store.
 *
 * `out-of-range.test.ts` covers the other case, a sample outside the DECLARED range in a width that
 * can hold it. This is the case where the width itself is the limit.
 */

import { describe, expect, it } from 'vitest';
import {
  BDF_DIGITAL_MAX,
  BDF_DIGITAL_MIN,
  EDF_DIGITAL_MAX,
  EDF_DIGITAL_MIN,
} from '../../src/constants.js';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

/** Comfortably inside sixteen bits, and varied enough that an equality means something. */
const withinTwoBytes = (record: number, index: number): number =>
  ((record * 37 + index * 11) % 401) - 200;

/** Beyond sixteen bits by design: no EDF file can carry these. */
const beyondTwoBytes = (record: number, index: number): number =>
  record * 100_000 + index * 7_000 - 300_000;

function file(
  format: 'EDF' | 'BDF',
  sample: (record: number, index: number) => number,
): Uint8Array {
  return buildEdf({
    format,
    plus: 'C',
    recordCount: 3,
    recordDurationSeconds: 1,
    signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 8, sample }],
    annotationSignals: [{ samplesPerRecord: 20 }],
  });
}

async function read(bytes: Uint8Array): Promise<{
  recording: EdfRecording;
  digital: readonly number[];
  outOfRange: number;
}> {
  const recording = await openEdf(byteSource(bytes));
  const signal = getSignal(recording.header, 'EEG Fpz-Cz');
  const chunk = await readRecords(recording, {
    records: { start: 0, count: 3 },
    signalIndices: [signal.index],
  });
  const series = chunk.signals[0];
  if (series === undefined) throw new Error('one signal was asked for and none came back');
  return {
    recording,
    digital: [...series.digital.subarray(0, series.sampleCount)],
    outOfRange: series.outOfDigitalRangeCount,
  };
}

describe('a value both widths can hold', () => {
  it('decodes bit-identically, though nothing else about the two files matches', async () => {
    const edf = await read(file('EDF', withinTwoBytes));
    const bdf = await read(file('BDF', withinTwoBytes));

    expect(bdf.digital).toEqual(edf.digital);
    expect(edf.digital).toHaveLength(24);
    expect(new Set(edf.digital).size).toBeGreaterThan(20);

    // Everything the width does change.
    expect(bdf.recording.header.recordByteLength).toBe(
      (edf.recording.header.recordByteLength * 3) / 2,
    );
    expect(edf.recording.header.variant).toBe('EDF+C');
    expect(bdf.recording.header.variant).toBe('BDF+C');
  });

  it('and the two declared ranges are the two-s-complement limits of each width', async () => {
    const edf = await read(file('EDF', withinTwoBytes));
    const bdf = await read(file('BDF', withinTwoBytes));
    const edfSignal = getSignal(edf.recording.header, 'EEG Fpz-Cz');
    const bdfSignal = getSignal(bdf.recording.header, 'EEG Fpz-Cz');

    expect([edfSignal.digitalMinimum, edfSignal.digitalMaximum]).toEqual([
      EDF_DIGITAL_MIN,
      EDF_DIGITAL_MAX,
    ]);
    expect([bdfSignal.digitalMinimum, bdfSignal.digitalMaximum]).toEqual([
      BDF_DIGITAL_MIN,
      BDF_DIGITAL_MAX,
    ]);
    // Which makes the gain differ by the same factor, on identical samples.
    expect(bdfSignal.scale?.bitValue).toBeLessThan(edfSignal.scale?.bitValue ?? 0);
  });
});

describe('a value only three bytes can hold', () => {
  it('is carried by the BDF file exactly', async () => {
    const bdf = await read(file('BDF', beyondTwoBytes));
    expect(bdf.digital[0]).toBe(-300_000);
    expect(bdf.digital.slice(0, 5)).toEqual([-300_000, -293_000, -286_000, -279_000, -272_000]);
    expect(bdf.outOfRange).toBe(0);
  });

  it('and is not carried by the EDF file at all: what comes back is the low sixteen bits', async () => {
    const edf = await read(file('EDF', beyondTwoBytes));
    const lowBits = (value: number): number => {
      const masked = value & 0xffff;
      return masked >= 0x8000 ? masked - 0x1_0000 : masked;
    };
    expect(edf.digital).toEqual(
      Array.from({ length: 24 }, (_, at) => lowBits(beyondTwoBytes(Math.floor(at / 8), at % 8))),
    );
    expect(edf.digital[0]).toBe(27_680);
    expect(edf.digital[0]).not.toBe(-300_000);
  });

  it('with nothing to say about it, because the file is well formed', async () => {
    const edf = await read(file('EDF', beyondTwoBytes));
    // 27,680 is inside the declared range, so nothing is out of range and nothing is diagnosed.
    expect(edf.outOfRange).toBe(0);
    expect(edf.recording.header.diagnostics.filter((d) => d.signalIndex === 0)).toEqual([]);
    const signal = getSignal(edf.recording.header, 'EEG Fpz-Cz');
    for (const value of edf.digital) {
      expect(value).toBeGreaterThanOrEqual(signal.digitalMinimum);
      expect(value).toBeLessThanOrEqual(signal.digitalMaximum);
    }
  });

  it('which is the limit of what a header can record, not a defect edfcore hid', async () => {
    // The same waveform in BDF and in EDF are different recordings, and only one of them is the
    // one the writer had. Nothing in an EDF header can say so.
    const edf = await read(file('EDF', beyondTwoBytes));
    const bdf = await read(file('BDF', beyondTwoBytes));
    expect(edf.digital).not.toEqual(bdf.digital);
    expect(edf.recording.header.diagnostics.map((d) => d.code)).toEqual(
      bdf.recording.header.diagnostics.map((d) => d.code),
    );
  });
});
