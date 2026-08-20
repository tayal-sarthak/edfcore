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
import { clampToDigitalRange, physicalRangeOf, toPhysical } from '../../src/decode/physical.js';
import { getSignal } from '../../src/header/lookup.js';
import { signalFieldOffset } from '../../src/header/signals.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
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

describe('the negative gain the page works through', () => {
  /** `// physicalMinimum 500, physicalMaximum -500, over -32768..32767` */
  const INVERTED_BYTES = buildEdf({
    recordCount: 1,
    recordDurationSeconds: 1,
    signals: [
      {
        label: 'Inv',
        samplesPerRecord: 1,
        physicalMinimum: 500,
        physicalMaximum: -500,
        digitalMinimum: -32768,
        digitalMaximum: 32767,
      },
    ],
  });

  const inverted = async () => getSignal((await openEdf(byteSource(INVERTED_BYTES))).header, 'Inv');

  it('publishes the negative scale the page prints', async () => {
    // `inverted.scale;  // { bitValue: -0.015259021896696421, offset: 0.5 }`
    const printed = /inverted\.scale;\s*\/\/ \{ bitValue: (-[\d.]+), offset: ([\d.]+) \}/.exec(
      PAGE,
    );
    expect(printed).not.toBeNull();
    const scale = (await inverted()).scale;
    expect(Object.is(scale?.bitValue, Number(printed?.[1]))).toBe(true);
    expect(Object.is(scale?.offset, Number(printed?.[2]))).toBe(true);
  });

  it('converts the three samples to the three values the page prints', async () => {
    // `toPhysical(inverted, new Int32Array([-32768, 0, 32767]));`
    // `// Float64Array [ 500, -0.007629510948348211, -500 ]`
    const printed =
      /toPhysical\(inverted, new Int32Array\(\[([-\d, ]+)\]\)\);\s*\/\/ Float64Array \[ ([-\d.e, ]+) \]/.exec(
        PAGE,
      );
    expect(printed).not.toBeNull();
    const digital = (printed?.[1] ?? '').split(',').map((text) => Number(text.trim()));
    const expected = (printed?.[2] ?? '').split(',').map((text) => Number(text.trim()));
    const produced = toPhysical(await inverted(), Int32Array.from(digital));
    expected.forEach((value, index) => {
      expect(Object.is(produced[index], value)).toBe(true);
    });
    // "physical values must fall as digital values rise" — the whole point of the sign.
    expect(produced[0]).toBeGreaterThan(produced[expected.length - 1] ?? 0);
  });

  it('reports the declared envelope in size order, not field order', async () => {
    // `physicalRangeOf(inverted);   // { low: -500, high: 500 }`
    const printed = /physicalRangeOf\(inverted\);\s*\/\/ \{ low: (-?\d+), high: (-?\d+) \}/.exec(
      PAGE,
    );
    expect(printed).not.toBeNull();
    const signal = await inverted();
    expect(physicalRangeOf(signal)).toEqual({
      low: Number(printed?.[1]),
      high: Number(printed?.[2]),
    });
    // The fields themselves stay as the file wrote them; only the envelope is ordered.
    expect(signal.physicalMinimum).toBe(500);
    expect(signal.physicalMaximum).toBe(-500);
  });

  it('emits the diagnostic the page quotes, word for word', async () => {
    // The page prints the whole message for a one-signal file. Only the page's HARD WRAPS are
    // undone — a run of spaces inside a line is not wrapping, it is the eight-byte physical
    // minimum field quoted as written, and collapsing that would compare a message the package
    // does not emit.
    const quoted = /On a one-signal file it reads:\s*```\n([\s\S]*?)```/.exec(PAGE)?.[1] ?? '';
    expect(quoted).not.toBe('');
    const { header } = await openEdf(byteSource(INVERTED_BYTES));
    const diagnostic = header.diagnostics.find((entry) => entry.code === 'INVERTED_PHYSICAL_RANGE');
    expect(diagnostic?.message).toBe(quoted.replace(/\n\s*/g, ' ').trim());
    // The padding is load-bearing: the message quotes the field as the file holds it.
    expect(diagnostic?.message).toContain('"500     "');
    expect(diagnostic?.raw).toBe('500     ');
    // "at `info` severity naming the signal, the raw bytes, the byte offset, and the spec clause"
    expect(diagnostic?.severity).toBe('info');
    expect(diagnostic?.signalIndex).toBe(0);
  });

  it('quotes a byte offset the layout actually puts the field at', async () => {
    // `at byte offset 360` — signal 0's physicalMinimum in a one-signal file, which is the same
    // `256 + ns*104 + i*8` the address table on `edf-format.md` gives.
    const offset = Number(/at byte offset (\d+)/.exec(FLAT)?.[1]);
    expect(offset).toBe(signalFieldOffset('physicalMinimum', 1, 0));
    const { header } = await openEdf(byteSource(INVERTED_BYTES));
    expect(
      header.diagnostics.find((entry) => entry.code === 'INVERTED_PHYSICAL_RANGE')?.byteOffset,
    ).toBe(offset);
  });
});

describe('the out-of-range window the page shows', () => {
  /** `// A signal declaring -100..100 digital, holding samples at -500 and +500.` */
  const SAMPLES = [-500, -50, 50, 500] as const;

  const NARROW_BYTES = buildEdf({
    recordCount: 1,
    recordDurationSeconds: 1,
    signals: [
      {
        label: 'Narrow',
        samplesPerRecord: SAMPLES.length,
        digitalMinimum: -100,
        digitalMaximum: 100,
        physicalMinimum: -100,
        physicalMaximum: 100,
        sample: (_record, index) => SAMPLES[index] ?? 0,
      },
    ],
  });

  /** The printed array from a `// Int32Array [ … ]` comment. */
  function printedArray(after: string): readonly number[] {
    const at = PAGE.indexOf(after);
    if (at === -1) throw new Error(`no ${JSON.stringify(after)} on physical-values.md`);
    const match = /\/\/ Int32Array \[ ([-\d, ]+) \]/.exec(PAGE.slice(at));
    if (match === null) throw new Error(`no printed array after ${JSON.stringify(after)}`);
    return (match[1] ?? '').split(',').map((text) => Number(text.trim()));
  }

  async function window() {
    const recording = await openEdf(byteSource(NARROW_BYTES));
    const narrow = getSignal(recording.header, 'Narrow');
    const [chunk] = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: 1,
      signalIndices: [narrow.index],
    });
    return { narrow, signal: chunk?.signals[0] };
  }

  it('returns the samples the page prints, unclamped', async () => {
    // `chunk.signals[0].digital;                 // Int32Array [ -500, -50, 50, 500 ]`
    const { signal } = await window();
    expect([...(signal?.digital ?? [])]).toEqual(printedArray('chunk.signals[0].digital;'));
    // "It never clamps on read" — the samples are what the amplifier wrote.
    expect([...(signal?.digital ?? [])]).toEqual([...SAMPLES]);
  });

  it('counts the two the page counts', async () => {
    // `chunk.signals[0].outOfDigitalRangeCount;  // 2`
    const printed = Number(/outOfDigitalRangeCount;\s*\/\/ (\d+)/.exec(PAGE)?.[1]);
    const { signal } = await window();
    expect(signal?.outOfDigitalRangeCount).toBe(printed);
  });

  it('clamps to the bounds the page prints', async () => {
    // `clamped;                       // Int32Array [ -100, -50, 50, 100 ]`
    const { narrow, signal } = await window();
    const clamped = clampToDigitalRange(narrow, signal?.digital ?? new Int32Array());
    expect([...clamped]).toEqual(printedArray('const clamped = clampToDigitalRange('));
  });

  it('orders the bounds before comparing, so an inverted range is not all out of range', async () => {
    // "The comparison uses `min` and `max` of the two declared bounds rather than the pair as
    //  written. A file with an inverted digital range therefore does not report every sample as
    //  out of range." The same rule is why `clampToDigitalRange` does not collapse the channel:
    //  "the naive bounds are an empty interval that collapses every sample onto a single value."
    const bytes = buildEdf({
      recordCount: 1,
      recordDurationSeconds: 1,
      signals: [
        {
          label: 'Backwards',
          samplesPerRecord: SAMPLES.length,
          // Declared the wrong way round, which is not sanctioned but does occur.
          raw: { digitalMinimum: '100     ', digitalMaximum: '-100    ' },
          sample: (_record, index) => SAMPLES[index] ?? 0,
        },
      ],
    });
    const recording = await openEdf(byteSource(bytes));
    const backwards = getSignal(recording.header, 'Backwards');
    const [chunk] = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: 1,
      signalIndices: [backwards.index],
    });

    // Two out of range, not four: the same two that are outside -100..100 either way round.
    expect(chunk?.signals[0]?.outOfDigitalRangeCount).toBe(2);
    // And the clamp keeps four distinct values rather than folding them onto one.
    const clamped = clampToDigitalRange(backwards, chunk?.signals[0]?.digital ?? new Int32Array());
    expect([...clamped]).toEqual([-100, -50, 50, 100]);
  });
});
