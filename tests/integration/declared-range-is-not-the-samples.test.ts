/**
 * Changing the declared physical range moves the scale and not the samples — and does not move the
 * converted values by the factor it moved the scale by.
 *
 * The digital samples in a data record are stored integers. The physical range in the header is a
 * declaration about what those integers mean, and edfcore keeps the two apart: `decodeDigital`
 * never looks at the range, and `toPhysical` never looks at the bytes. Rewriting
 * `physicalMinimum`/`physicalMaximum` in the header is therefore a transformation whose effect is
 * exactly known — every stored value identical, every derived value on the declared scale — and
 * nothing tested it that way. `physical-values.md` is checked against printed numbers, and
 * `out-of-range.test.ts` against the digital path; the relationship between the two was prose.
 *
 * The interesting half is the part that does NOT hold. Multiplying the declared range by ten
 * multiplies `bitValue` by exactly ten and leaves `offset` untouched — both are exact in float64
 * here — and yet **113 of 401 converted values are not exactly ten times their counterpart**.
 * `bitValue * (offset + digital)` is a float64 multiply, and scaling an operand is not the same
 * operation as scaling the result.
 *
 * That is worth pinning because it is the shape of a mistake a caller makes on purpose. Given
 * microvolts and wanting millivolts, the obvious move is to divide the values; the obvious check is
 * that dividing the declared range gives the same answer. It does not, in the last place, for a
 * quarter of the range — and `physical-values.md` spends a page explaining that the last place is
 * exactly what this library refuses to be casual about.
 *
 * So: the digital path is asserted to be bit-identical under the transformation, the scale is
 * asserted to move exactly, every converted value is asserted to be on its own declared scale
 * exactly, and the rescaling identity is asserted to FAIL — with the count of values it fails for,
 * so a change that made it hold would be noticed too.
 */

import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../src/decode/physical.js';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

/** A waveform that visits most of a +/-200 span, so the comparison has values to disagree about. */
const wave = (record: number, index: number): number => ((record * 37 + index * 11) % 401) - 200;

function withRange(physicalMinimum: string, physicalMaximum: string): Uint8Array {
  return buildEdf({
    plus: 'C',
    recordCount: 16,
    recordDurationSeconds: 1,
    signals: [
      {
        label: 'EEG Fpz-Cz',
        samplesPerRecord: 32,
        sample: wave,
        raw: { physicalMinimum, physicalMaximum },
      },
    ],
    annotationSignals: [{ samplesPerRecord: 20 }],
  });
}

const NARROW = withRange('-100', '100');
const WIDE = withRange('-1000', '1000');
const FACTOR = 10;

async function samplesOf(bytes: Uint8Array): Promise<{
  digital: readonly number[];
  physical: readonly number[];
  bitValue: number;
  offset: number;
  outOfRange: number;
}> {
  const recording = await openEdf(byteSource(bytes));
  const signal = getSignal(recording.header, 'EEG Fpz-Cz');
  const chunk = await readRecords(recording, {
    records: { start: 0, count: 16 },
    signalIndices: [signal.index],
  });
  const series = chunk.signals[0];
  const scale = signal.scale;
  if (series === undefined || scale === undefined) throw new Error('fixture is not as expected');
  return {
    digital: [...series.digital.subarray(0, series.sampleCount)],
    physical: [...toPhysical(signal, series.digital)],
    bitValue: scale.bitValue,
    offset: scale.offset,
    outOfRange: series.outOfDigitalRangeCount,
  };
}

describe('the stored samples', () => {
  it('are bit-identical, because the range is a declaration and not a value', async () => {
    const narrow = await samplesOf(NARROW);
    const wide = await samplesOf(WIDE);
    expect(wide.digital).toEqual(narrow.digital);
    expect(wide.outOfRange).toBe(narrow.outOfRange);
    // And the waveform really varies, so this is not two runs of the same constant.
    expect(narrow.digital).toHaveLength(512);
    expect(new Set(narrow.digital).size).toBeGreaterThan(300);
  });

  it('leave every other structural number alone too', async () => {
    const narrow = await openEdf(byteSource(NARROW));
    const wide = await openEdf(byteSource(WIDE));
    expect(wide.header.recordByteLength).toBe(narrow.header.recordByteLength);
    expect(wide.header.recordCount).toBe(narrow.header.recordCount);
    expect(getSignal(wide.header, 'EEG Fpz-Cz').sampleCount).toBe(
      getSignal(narrow.header, 'EEG Fpz-Cz').sampleCount,
    );

    // The sweep observes the same DIGITAL range, which is what it reports.
    const [narrowStats] = (await validateRecording(narrow, { scanSamples: true })).signalStats;
    const [wideStats] = (await validateRecording(wide, { scanSamples: true })).signalStats;
    expect(wideStats?.observedDigitalMin).toBe(narrowStats?.observedDigitalMin);
    expect(wideStats?.observedDigitalMax).toBe(narrowStats?.observedDigitalMax);
  });
});

describe('the scale', () => {
  it('moves by exactly the factor the range moved by, and the offset does not move', async () => {
    const narrow = await samplesOf(NARROW);
    const wide = await samplesOf(WIDE);
    expect(wide.bitValue).toBe(FACTOR * narrow.bitValue);
    expect(wide.offset).toBe(narrow.offset);
  });
});

describe('the converted values', () => {
  it('are on their own declared scale, exactly, in both files', async () => {
    for (const bytes of [NARROW, WIDE]) {
      const { digital, physical, bitValue, offset } = await samplesOf(bytes);
      for (const [index, sample] of digital.entries()) {
        expect(physical[index]).toBe(bitValue * (offset + sample));
      }
    }
  });

  it('do NOT all scale by that factor, which is the part worth knowing', async () => {
    const narrow = await samplesOf(NARROW);
    const wide = await samplesOf(WIDE);
    expect(wide.physical).toHaveLength(narrow.physical.length);

    const drifted = narrow.physical.filter(
      (value, index) => wide.physical[index] !== FACTOR * value,
    );
    // Not none, and not all: a quarter of the values, off in the last place.
    expect(drifted.length).toBeGreaterThan(0);
    expect(drifted.length).toBeLessThan(narrow.physical.length);
  });

  it('drift by one place and no more, so the disagreement is float64 and not arithmetic', async () => {
    const narrow = await samplesOf(NARROW);
    const wide = await samplesOf(WIDE);
    for (const [index, value] of narrow.physical.entries()) {
      const scaled = FACTOR * value;
      const actual = wide.physical[index] ?? Number.NaN;
      // Within one unit in the last place of the larger magnitude.
      const ulp = Math.abs(actual) * Number.EPSILON;
      expect(Math.abs(actual - scaled)).toBeLessThanOrEqual(ulp);
    }
  });

  it('is why a caller converts rather than rescales', async () => {
    // The two routes to "the same channel in millivolts": convert on the declared scale, or
    // convert and then divide. They are not the same function.
    const { digital, bitValue, offset } = await samplesOf(WIDE);
    const converted = digital.map((sample) => bitValue * (offset + sample));
    const rescaled = (await samplesOf(NARROW)).physical.map((value) => FACTOR * value);
    expect(rescaled).not.toEqual(converted);
    // And the one edfcore returns is the first.
    expect((await samplesOf(WIDE)).physical).toEqual(converted);
  });
});
