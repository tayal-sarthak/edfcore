/**
 * The two conversion forms tabulated on `physical-values.md`, executed.
 *
 * That page and `edf-format.md` were the only documentation pages no test named at all, and this
 * is the half of it that is pure arithmetic: a four-row table of exact float64 literals showing
 * where EDFlib's expression and the textbook one part company, and the census underneath it —
 * 37,144 of the 65,536 possible samples, a largest gap of 8.5e-14 µV, 5.6e-12 of a quantisation
 * step.
 *
 * Every one of those numbers is right. None of them was checked. They are the argument for the
 * one deliberate numerical choice in the package — `decode/physical.ts` pins EDFlib's form so the
 * output is bit-identical to pyEDFlib's rather than approximately equal to it — and an argument
 * made out of stale numbers is worse than none, because it reads exactly like a live one.
 *
 * The literals are parsed from the page and compared with `Object.is`, which is the comparison the
 * golden-value harness uses. `toBeCloseTo` would pass on every digit the table exists to
 * distinguish.
 */

import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../src/decode/physical.js';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('physical-values.md') ?? '';

/** The same page with its line wrapping collapsed, for claims made across a wrapped sentence. */
const FLAT = PAGE.replace(/\s+/g, ' ');

/** The range the page tabulates: -500..500 µV over the full 16-bit digital span. */
const RANGE = {
  physicalMinimum: -500,
  physicalMaximum: 500,
  digitalMinimum: -32768,
  digitalMaximum: 32767,
} as const;

const BYTES = buildEdf({
  recordCount: 1,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 1, physicalDimension: 'uV', ...RANGE }],
});

/** `physicalMinimum + (digital - digitalMinimum) * bitValue`, the form the page rejects. */
function textbook(digital: number, bitValue: number): number {
  return RANGE.physicalMinimum + (digital - RANGE.digitalMinimum) * bitValue;
}

describe('the disagreement table', () => {
  /** The three cells of every `| \`-1\` | … | … |` row under the table's heading. */
  const rows = [...PAGE.matchAll(/^\| `(-?\d+)` \| `(-?[\d.e-]+)` \| `(-?[\d.e-]+)` \|$/gm)].map(
    ([, digital = '', edfcore = '', other = '']) => ({
      digital: Number(digital),
      edfcore: Number(edfcore),
      textbook: Number(other),
    }),
  );

  it('has the four rows the page draws', () => {
    expect(rows.map((row) => row.digital)).toEqual([-32768, -1, 0, 32767]);
  });

  it('gives edfcore the values in its own column, bit for bit', async () => {
    const { header } = await openEdf(byteSource(BYTES));
    const signal = getSignal(header, 'Fp1');
    const produced = toPhysical(signal, Int32Array.from(rows.map((row) => row.digital)));
    rows.forEach((row, index) => {
      expect(Object.is(produced[index], row.edfcore)).toBe(true);
    });
  });

  it('gives the other form the values in its column, bit for bit', async () => {
    const { header } = await openEdf(byteSource(BYTES));
    const bitValue = getSignal(header, 'Fp1').scale?.bitValue ?? Number.NaN;
    for (const row of rows) {
      expect(Object.is(textbook(row.digital, bitValue), row.textbook)).toBe(true);
    }
  });

  it('agrees at the endpoints and parts company in between, as the page says', () => {
    // "The two forms agree at the endpoints and disagree in the last place elsewhere."
    for (const row of rows) {
      const agrees = Object.is(row.edfcore, row.textbook);
      expect(agrees).toBe(row.digital === -32768 || row.digital === 32767);
    }
  });

  it('publishes the scale the page prints', async () => {
    // `fp1.scale;  // { bitValue: 0.015259021896696421, offset: 0.5 }`
    const printed =
      /\{ bitValue: (-?[\d.]+), offset: (-?[\d.]+) \}\s*\n\s*\/\/ from -500\.\.500/.exec(PAGE);
    expect(printed).not.toBeNull();
    const { header } = await openEdf(byteSource(BYTES));
    const scale = getSignal(header, 'Fp1').scale;
    expect(Object.is(scale?.bitValue, Number(printed?.[1]))).toBe(true);
    expect(Object.is(scale?.offset, Number(printed?.[2]))).toBe(true);
  });

  it('does not map digital zero to physical zero, and says why', () => {
    // "the digital range −32768..32767 is not symmetric about zero, so neither is the map."
    const zero = rows.find((row) => row.digital === 0);
    expect(zero?.edfcore).not.toBe(0);
    expect(RANGE.digitalMinimum + RANGE.digitalMaximum).not.toBe(0);
  });
});

describe('the census the page takes of the whole range', () => {
  // "the two forms produce a different float64 for 37,144 of the 65,536 possible sample values
  //  (57 % of them). The largest disagreement is 8.5e-14 µV, which is 5.6e-12 of one
  //  quantisation step."
  // Matched against the page with its line wrapping collapsed, so rewrapping the paragraph
  // cannot silently turn this check off.
  const prose =
    /a different float64 for ([\d,]+) of the ([\d,]+) possible sample values \((\d+) % of them\)\. The largest disagreement is ([\d.e-]+) [^ ]+, which is ([\d.e-]+) of one quantisation step/.exec(
      FLAT,
    );

  /** Both forms over every encoding, once, for the four numbers the prose states. */
  async function census(): Promise<{
    differing: number;
    total: number;
    largest: number;
    inSteps: number;
  }> {
    const { header } = await openEdf(byteSource(BYTES));
    const signal = getSignal(header, 'Fp1');
    const bitValue = signal.scale?.bitValue ?? Number.NaN;
    const digital = new Int32Array(RANGE.digitalMaximum - RANGE.digitalMinimum + 1);
    for (let index = 0; index < digital.length; index += 1) {
      digital[index] = RANGE.digitalMinimum + index;
    }
    const produced = toPhysical(signal, digital);

    let differing = 0;
    let largest = 0;
    for (let index = 0; index < digital.length; index += 1) {
      const mine = produced[index] ?? Number.NaN;
      const other = textbook(digital[index] ?? 0, bitValue);
      if (Object.is(mine, other)) continue;
      differing += 1;
      largest = Math.max(largest, Math.abs(mine - other));
    }
    return { differing, total: digital.length, largest, inSteps: largest / bitValue };
  }

  it('states the census in prose the page still carries', () => {
    expect(prose).not.toBeNull();
  });

  it('counts the sample values the page counts', async () => {
    const { differing, total } = await census();
    expect(total).toBe(Number((prose?.[2] ?? '').replaceAll(',', '')));
    expect(differing).toBe(Number((prose?.[1] ?? '').replaceAll(',', '')));
    expect(Math.round((differing / total) * 100)).toBe(Number(prose?.[3]));
  });

  it('measures the largest gap the page measures, to the digits it prints', async () => {
    const { largest, inSteps } = await census();
    // Both are quoted to two significant figures, so that is the agreement being asked for.
    const twoFigures = (value: number): string => value.toExponential(1);
    expect(twoFigures(largest)).toBe(twoFigures(Number(prose?.[4])));
    expect(twoFigures(inSteps)).toBe(twoFigures(Number(prose?.[5])));
  });

  it('leaves the difference far below anything an amplifier can express', async () => {
    // "about eleven orders of magnitude below the smallest difference the amplifier can express"
    const { inSteps } = await census();
    expect(Math.round(-Math.log10(inSteps))).toBe(11);
  });
});

describe('the float32 cost the page refuses to pay', () => {
  /** The 24-bit range the page names, at the same ±500 µV envelope. */
  const BDF_RANGE = {
    physicalMinimum: -500,
    physicalMaximum: 500,
    digitalMinimum: -8388608,
    digitalMaximum: 8388607,
  } as const;

  const BDF_BYTES = buildEdf({
    format: 'BDF',
    recordCount: 1,
    recordDurationSeconds: 1,
    signals: [{ label: 'A1', samplesPerRecord: 1, physicalDimension: 'uV', ...BDF_RANGE }],
  });

  it('is stated on the page in the units the page states it in', () => {
    expect(FLAT).toContain('the float32 rounding error reaches **0.26 of a quantisation step**');
  });

  it('reaches that error somewhere in the range', async () => {
    const { header } = await openEdf(byteSource(BDF_BYTES));
    const scale = getSignal(header, 'A1').scale;
    const bitValue = scale?.bitValue ?? Number.NaN;
    const offset = scale?.offset ?? Number.NaN;

    // Every 24-bit sample, converted the way `toPhysical` converts it and then rounded to
    // float32. Held as a scalar loop rather than a Float64Array: 2^24 samples is 134 MB.
    let worst = 0;
    for (
      let digital = BDF_RANGE.digitalMinimum;
      digital <= BDF_RANGE.digitalMaximum;
      digital += 1
    ) {
      const exact = bitValue * (offset + digital);
      worst = Math.max(worst, Math.abs(Math.fround(exact) - exact) / bitValue);
    }
    expect(worst.toFixed(2)).toBe('0.26');
    // "a quarter of the smallest difference the amplifier can express" — and not half of one,
    // which is what an error of a whole step would mean.
    expect(worst).toBeGreaterThan(0.25);
    expect(worst).toBeLessThan(0.5);
  });

  it('holds because a 24-bit sample fills the float32 significand exactly', () => {
    // "Float32 carries 24 significand bits and a BDF sample is a 24-bit integer, so a scaled BDF
    //  sample doesn't fit."
    expect(FLAT).toContain('Float32 carries 24 significand bits and a BDF sample is a 24-bit');
    // The integers themselves survive to the last one the significand can hold, and no further.
    expect(Math.fround(2 ** 24)).toBe(2 ** 24);
    expect(Math.fround(2 ** 24 + 1)).not.toBe(2 ** 24 + 1);
    // So the digital values do fit, and there is nothing left over for the scaling.
    expect(Math.fround(BDF_RANGE.digitalMinimum)).toBe(BDF_RANGE.digitalMinimum);
    expect(Math.fround(BDF_RANGE.digitalMaximum)).toBe(BDF_RANGE.digitalMaximum);
  });

  it('never returns anything but a Float64Array', async () => {
    // "The output is a `Float64Array`, and there's no `Float32` option."
    const { header } = await openEdf(byteSource(BDF_BYTES));
    expect(toPhysical(getSignal(header, 'A1'), [0, 1])).toBeInstanceOf(Float64Array);
  });
});
