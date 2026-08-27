/**
 * `toPhysical` / `clampToDigitalRange` — the pinned scaling expression.
 *
 * DESIGN section 5 ("Scaling — pinned expression, do not simplify") fixes three numbers and
 * one order of operations:
 *
 *     bitValue = (physicalMaximum - physicalMinimum) / (digitalMaximum - digitalMinimum)
 *     offset   = physicalMaximum / bitValue - digitalMaximum
 *     physical = bitValue * (offset + digital)          // float64 throughout
 *
 * Every expected value below is computed from those three lines IN THE TEST, from the numbers
 * the fixture declares, and compared with `Object.is` per element — not with a tolerance, and
 * not against a recorded snapshot. That is the whole point: the expression is kept because it
 * is EDFlib's, so edfcore reproduces pyEDFlib/EDFlib float64 output bit for bit, and the
 * numerically better `physicalMinimum + (digital - digitalMinimum) * gain` form would forfeit
 * that parity. The expression looking numerically worse than the obvious one is not a mistake
 * in the source; rewriting it is the mistake, and these tests exist to catch that rewrite.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../../src/decode/digital.js';
import { clampToDigitalRange, physicalRangeOf, toPhysical } from '../../../src/decode/physical.js';
import { EdfBudgetError, EdfScalingError, isEdfError } from '../../../src/errors.js';
import { parseHeader } from '../../../src/header/parse.js';
import type { EdfDiagnosticCode, EdfHeader, EdfSignal, RecordRange } from '../../../src/types.js';
import { buildEdf, type EdfSpec, type SignalSpec, sineSampler } from '../../support/writer.js';

interface Fixture {
  readonly bytes: Uint8Array;
  readonly header: EdfHeader;
  readonly signal: EdfSignal;
}

function build(spec: EdfSpec): Fixture {
  const bytes = buildEdf(spec);
  const header = parseHeader(bytes, bytes.byteLength);
  const signal = header.signals[0];
  if (signal === undefined) throw new Error('fixture has no signal 0');
  return { bytes, header, signal };
}

function buildSignal(signal: SignalSpec, format: 'EDF' | 'BDF' = 'EDF'): EdfSignal {
  return build({ format, recordCount: 1, signals: [signal] }).signal;
}

/** The pinned expression, re-derived here so the test never asks the source what it thinks. */
function pinnedScale(
  physicalMinimum: number,
  physicalMaximum: number,
  digitalMinimum: number,
  digitalMaximum: number,
): { bitValue: number; offset: number } {
  const bitValue = (physicalMaximum - physicalMinimum) / (digitalMaximum - digitalMinimum);
  const offset = physicalMaximum / bitValue - digitalMaximum;
  return { bitValue, offset };
}

function pinnedPhysical(
  physicalMinimum: number,
  physicalMaximum: number,
  digitalMinimum: number,
  digitalMaximum: number,
  digital: ArrayLike<number>,
): number[] {
  const { bitValue, offset } = pinnedScale(
    physicalMinimum,
    physicalMaximum,
    digitalMinimum,
    digitalMaximum,
  );
  const values: number[] = [];
  for (let i = 0; i < digital.length; i++) values.push(bitValue * (offset + (digital[i] ?? 0)));
  return values;
}

/** The textbook form the pinned one is deliberately NOT. */
function textbookPhysical(
  physicalMinimum: number,
  physicalMaximum: number,
  digitalMinimum: number,
  digitalMaximum: number,
  digital: ArrayLike<number>,
): number[] {
  const gain = (physicalMaximum - physicalMinimum) / (digitalMaximum - digitalMinimum);
  const values: number[] = [];
  for (let i = 0; i < digital.length; i++) {
    values.push(physicalMinimum + ((digital[i] ?? 0) - digitalMinimum) * gain);
  }
  return values;
}

function expectBitIdentical(actual: Float64Array, expected: readonly number[]): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    // Object.is, not toBeCloseTo: bit-parity with pyEDFlib is the contract, so a one-ULP
    // difference is a failure, not a rounding detail.
    expect(Object.is(actual[i], expected[i])).toBe(true);
  }
}

// The asymmetric range used for the pinning tests. Asymmetry matters: it is where the pinned
// and the textbook expressions disagree on nearly half the samples.
const PHYS_MIN = -123.456;
const PHYS_MAX = 987.654;
const DIG_MIN = -2048;
const DIG_MAX = 2047;

const PINNED_SIGNAL: SignalSpec = {
  label: 'Fp1',
  samplesPerRecord: 1,
  physicalMinimum: PHYS_MIN,
  physicalMaximum: PHYS_MAX,
  digitalMinimum: DIG_MIN,
  digitalMaximum: DIG_MAX,
};

const PINNED_DIGITAL = Int32Array.from([
  DIG_MIN,
  -2047,
  -1000,
  -513,
  -1,
  0,
  1,
  512,
  1000,
  2046,
  DIG_MAX,
]);

// ===========================================================================
// The pinned expression
// ===========================================================================

describe('the pinned scaling expression', () => {
  it('derives bitValue and offset exactly as EDFlib does', () => {
    const signal = buildSignal(PINNED_SIGNAL);
    const expected = pinnedScale(PHYS_MIN, PHYS_MAX, DIG_MIN, DIG_MAX);

    expect(signal.scale).toBeDefined();
    expect(Object.is(signal.scale?.bitValue, expected.bitValue)).toBe(true);
    expect(Object.is(signal.scale?.offset, expected.offset)).toBe(true);
  });

  it('reproduces bitValue * (offset + digital) bit for bit', () => {
    const signal = buildSignal(PINNED_SIGNAL);
    const physical = toPhysical(signal, PINNED_DIGITAL);
    expectBitIdentical(
      physical,
      pinnedPhysical(PHYS_MIN, PHYS_MAX, DIG_MIN, DIG_MAX, PINNED_DIGITAL),
    );
  });

  it('differs from the textbook form on most samples, which is why it is pinned', () => {
    // If this ever reports 0 differing samples the pinning test above has lost its teeth: the
    // two expressions would agree and the test could no longer tell them apart. On this
    // asymmetric range 9 of 11 samples differ by one ULP — ~9.3e-10 LSB, ten orders of
    // magnitude below the quantisation floor, and exactly the divergence edfcore refuses to
    // introduce because pyEDFlib does not have it.
    const pinned = pinnedPhysical(PHYS_MIN, PHYS_MAX, DIG_MIN, DIG_MAX, PINNED_DIGITAL);
    const textbook = textbookPhysical(PHYS_MIN, PHYS_MAX, DIG_MIN, DIG_MAX, PINNED_DIGITAL);
    const differing = pinned.filter((value, i) => !Object.is(value, textbook[i])).length;

    expect(differing).toBe(9);

    const signal = buildSignal(PINNED_SIGNAL);
    const physical = toPhysical(signal, PINNED_DIGITAL);
    // And edfcore is on the pinned side of every one of those disagreements.
    expectBitIdentical(physical, pinned);
    expect(physical.some((value, i) => !Object.is(value, textbook[i]))).toBe(true);
  });

  it('scales a decoded record exactly, digital samples included', () => {
    // The same assertion end to end: writer bytes -> decodeDigital -> toPhysical.
    const samplesPerRecord = 32;
    const fixture = build({
      format: 'EDF',
      recordCount: 2,
      signals: [
        {
          ...PINNED_SIGNAL,
          samplesPerRecord,
          sample: sineSampler(2047, 2, samplesPerRecord),
        },
      ],
    });
    const records: RecordRange = { start: 0, count: 2 };
    const start = fixture.header.headerByteLength;
    const recordBytes = fixture.bytes.subarray(
      start,
      start + records.count * fixture.header.recordByteLength,
    );

    const digital = decodeDigital(fixture.header, recordBytes, records, 0);
    const physical = toPhysical(fixture.signal, digital);

    expect(digital.length).toBe(2 * samplesPerRecord);
    expectBitIdentical(physical, pinnedPhysical(PHYS_MIN, PHYS_MAX, DIG_MIN, DIG_MAX, digital));
  });

  it('accepts any ArrayLike of digital values, not only an Int32Array', () => {
    const signal = buildSignal(PINNED_SIGNAL);
    const asArray = [DIG_MIN, 0, DIG_MAX];
    expectBitIdentical(
      toPhysical(signal, asArray),
      pinnedPhysical(PHYS_MIN, PHYS_MAX, DIG_MIN, DIG_MAX, asArray),
    );
  });
});

// ===========================================================================
// Float64, never Float32
// ===========================================================================

describe('output precision', () => {
  it('returns a Float64Array', () => {
    const signal = buildSignal(PINNED_SIGNAL);
    const physical = toPhysical(signal, PINNED_DIGITAL);

    expect(physical).toBeInstanceOf(Float64Array);
    expect(physical.constructor).toBe(Float64Array);
    expect(physical.BYTES_PER_ELEMENT).toBe(8);
  });

  it('keeps values Float32 could not hold', () => {
    // Float32 carries 24 significand bits, so a 24-bit BDF sample scaled into it loses about
    // a quarter of a quantisation step — a quarter of the smallest difference the hardware
    // can express. The check is that round-tripping the output through Float32 changes it.
    const signal = buildSignal(
      {
        label: 'Fp1',
        samplesPerRecord: 1,
        physicalMinimum: -1000,
        physicalMaximum: 1000,
        digitalMinimum: -8388608,
        digitalMaximum: 8388607,
      },
      'BDF',
    );
    const digital = Int32Array.from([-8388608, -4194304, 1, 4194303, 8388607]);
    const physical = toPhysical(signal, digital);
    const narrowed = Float32Array.from(physical);

    expect(physical).toBeInstanceOf(Float64Array);
    expect(physical.some((value, i) => !Object.is(value, narrowed[i]))).toBe(true);
  });
});

// ===========================================================================
// The two anchor points
// ===========================================================================

/**
 * A billionth of one quantisation step.
 *
 * Measured, not assumed: over the fixtures below the worst anchor error is ~1e-12 LSB (the
 * digital-minimum anchor of the asymmetric range), and over 300k random declared ranges the
 * worst observed is ~1e-5 LSB. DESIGN section 5 quotes the pinned-vs-textbook divergence as
 * <= 9.3e-10 LSB, so a 1e-9 LSB bound is of that same order: loose enough that IEEE-754
 * rounding never trips it, tight enough that anything which actually rounds, clamps or
 * substitutes the declared endpoints fails immediately.
 */
const ANCHOR_TOLERANCE_LSB = 1e-9;

interface AnchorCase {
  readonly name: string;
  readonly format: 'EDF' | 'BDF';
  readonly physicalMinimum: number;
  readonly physicalMaximum: number;
  readonly digitalMinimum: number;
  readonly digitalMaximum: number;
}

const ANCHOR_CASES: readonly AnchorCase[] = [
  {
    name: 'a symmetric microvolt range',
    format: 'EDF',
    physicalMinimum: -500,
    physicalMaximum: 500,
    digitalMinimum: -32768,
    digitalMaximum: 32767,
  },
  {
    name: 'an asymmetric range',
    format: 'EDF',
    physicalMinimum: PHYS_MIN,
    physicalMaximum: PHYS_MAX,
    digitalMinimum: DIG_MIN,
    digitalMaximum: DIG_MAX,
  },
  {
    name: 'a range that does not straddle zero',
    format: 'EDF',
    physicalMinimum: 0.001,
    physicalMaximum: 1000,
    digitalMinimum: -32768,
    digitalMaximum: 32767,
  },
  {
    name: 'the full 24-bit BDF range',
    format: 'BDF',
    physicalMinimum: -1000,
    physicalMaximum: 1000,
    digitalMinimum: -8388608,
    digitalMaximum: 8388607,
  },
  {
    name: 'an inverted physical range (negative amplifier gain)',
    format: 'EDF',
    physicalMinimum: 500,
    physicalMaximum: -500,
    digitalMinimum: -32768,
    digitalMaximum: 32767,
  },
];

describe('the two anchor points', () => {
  for (const testCase of ANCHOR_CASES) {
    it(`maps digital min to physical min and digital max to physical max for ${testCase.name}`, () => {
      const signal = buildSignal(
        {
          label: 'Fp1',
          samplesPerRecord: 1,
          physicalMinimum: testCase.physicalMinimum,
          physicalMaximum: testCase.physicalMaximum,
          digitalMinimum: testCase.digitalMinimum,
          digitalMaximum: testCase.digitalMaximum,
        },
        testCase.format,
      );
      const { bitValue } = pinnedScale(
        testCase.physicalMinimum,
        testCase.physicalMaximum,
        testCase.digitalMinimum,
        testCase.digitalMaximum,
      );
      const physical = toPhysical(
        signal,
        Int32Array.from([testCase.digitalMinimum, testCase.digitalMaximum]),
      );

      const tolerance = ANCHOR_TOLERANCE_LSB * Math.abs(bitValue);
      expect(Math.abs((physical[0] ?? Number.NaN) - testCase.physicalMinimum)).toBeLessThanOrEqual(
        tolerance,
      );
      expect(Math.abs((physical[1] ?? Number.NaN) - testCase.physicalMaximum)).toBeLessThanOrEqual(
        tolerance,
      );
    });
  }

  it('does not claim the anchors are exact', () => {
    // The digital-minimum anchor of the asymmetric range lands one ULP off physicalMinimum.
    // That is a property of the pinned expression, not a defect: the textbook form returns
    // physicalMinimum exactly there, which is precisely the reason it is not used. Pinning
    // the inexactness means a silent switch to the "better" form fails here too.
    const signal = buildSignal(PINNED_SIGNAL);
    const physical = toPhysical(signal, Int32Array.from([DIG_MIN, DIG_MAX]));

    expect(Object.is(physical[0], PHYS_MIN)).toBe(false);
    expect(physical[0]).not.toBe(PHYS_MIN);
    expect(physical[0]).toBeCloseTo(PHYS_MIN, 12);
    // The digital-maximum anchor, by contrast, comes out exact on this range, because the
    // offset is defined from physicalMaximum.
    expect(Object.is(physical[1], PHYS_MAX)).toBe(true);
  });
});

// ===========================================================================
// Polarity
// ===========================================================================

describe('a negative amplifier gain', () => {
  const NEGATIVE_GAIN: SignalSpec = {
    label: 'Fp1',
    samplesPerRecord: 1,
    // physicalMinimum > physicalMaximum is legal and encodes a negative gain (EDF FAQ Q6).
    physicalMinimum: 500,
    physicalMaximum: -500,
    digitalMinimum: -32768,
    digitalMaximum: 32767,
  };

  it('produces a negative bitValue rather than swapping the endpoints', () => {
    const signal = buildSignal(NEGATIVE_GAIN);
    const expected = pinnedScale(500, -500, -32768, 32767);

    expect(signal.physicalMinimum).toBe(500);
    expect(signal.physicalMaximum).toBe(-500);
    expect(signal.scale).toBeDefined();
    expect(signal.scale?.bitValue).toBeLessThan(0);
    expect(Object.is(signal.scale?.bitValue, expected.bitValue)).toBe(true);
    expect(Object.is(signal.scale?.offset, expected.offset)).toBe(true);
  });

  it('returns decreasing physical values for increasing digital values', () => {
    const signal = buildSignal(NEGATIVE_GAIN);
    const digital = Int32Array.from([-32768, -16384, 0, 16384, 32767]);
    const physical = toPhysical(signal, digital);

    expectBitIdentical(physical, pinnedPhysical(500, -500, -32768, 32767, digital));
    for (let i = 1; i < physical.length; i++) {
      expect(physical[i] ?? Number.NaN).toBeLessThan(physical[i - 1] ?? Number.NaN);
    }
    // The polarity is preserved, not flipped: the most negative sample is the most POSITIVE
    // physical value. A reader that "fixed" the range by swapping the endpoints would invert
    // the waveform — a clinically wrong result that looks perfectly normal.
    expect(physical[0] ?? Number.NaN).toBeGreaterThan(0);
    expect(physical[4] ?? Number.NaN).toBeLessThan(0);
  });

  it('agrees with the upright range up to sign', () => {
    const negative = buildSignal(NEGATIVE_GAIN);
    const upright = buildSignal({
      label: 'Fp1',
      samplesPerRecord: 1,
      physicalMinimum: -500,
      physicalMaximum: 500,
      digitalMinimum: -32768,
      digitalMaximum: 32767,
    });
    const digital = Int32Array.from([-32768, -1, 0, 1, 32767]);
    const flipped = toPhysical(negative, digital);
    const straight = toPhysical(upright, digital);

    for (let i = 0; i < digital.length; i++) {
      expect(Object.is(flipped[i], -(straight[i] ?? Number.NaN))).toBe(true);
    }
  });
});

// ===========================================================================
// Refusing to invent a gain — the deferred-fatal contract
// ===========================================================================

const SCALING_CODES: ReadonlySet<EdfDiagnosticCode> = new Set<EdfDiagnosticCode>([
  'DEGENERATE_DIGITAL_RANGE',
  'DEGENERATE_PHYSICAL_RANGE',
  'INVERTED_DIGITAL_RANGE',
  'LOG_TRANSFORMED_CHANNEL',
]);

interface RefusalCase {
  readonly name: string;
  readonly code: EdfDiagnosticCode;
  readonly signal: SignalSpec;
}

const REFUSAL_CASES: readonly RefusalCase[] = [
  {
    // EDF+ additional specification 5: "Digital maximum must be larger than Digital minimum".
    name: 'a digital range of zero width makes the gain a division by zero',
    code: 'DEGENERATE_DIGITAL_RANGE',
    signal: {
      label: 'EMG Chin',
      samplesPerRecord: 4,
      digitalMinimum: 0,
      digitalMaximum: 0,
    },
  },
  {
    name: 'an inverted digital range has no sanctioned meaning to guess at',
    code: 'INVERTED_DIGITAL_RANGE',
    signal: {
      label: 'EMG Chin',
      samplesPerRecord: 4,
      digitalMinimum: 100,
      digitalMaximum: -100,
    },
  },
  {
    name: 'a physical range of zero width maps every sample to one value',
    code: 'DEGENERATE_PHYSICAL_RANGE',
    signal: {
      label: 'EMG Chin',
      samplesPerRecord: 4,
      physicalMinimum: 0,
      physicalMaximum: 0,
    },
  },
  {
    // EDFlib edffloat.html: the dimension "Filtered" marks a log-compressed channel, where a
    // linear map would be wrong by orders of magnitude.
    name: 'a log-transformed channel is not linear at all',
    code: 'LOG_TRANSFORMED_CHANNEL',
    signal: {
      label: 'EMG Chin',
      samplesPerRecord: 4,
      physicalDimension: 'Filtered',
    },
  },
  {
    // The fifth refusal, and the only one that needs arithmetic rather than a field comparison:
    // -9.9E307..9.9E307 over -32768..32767 is four finite fields whose bitValue is Infinity. The
    // range is written raw because the builder's number formatter cannot fit -9.9e+307 into the
    // 8-byte field — which is the point, since only an 8-byte exponent notation gets here.
    name: 'four finite fields can still imply a gain that is not',
    code: 'DEGENERATE_PHYSICAL_RANGE',
    signal: {
      label: 'EMG Chin',
      samplesPerRecord: 4,
      raw: { physicalMinimum: '-9.9E307', physicalMaximum: '9.9E307' },
    },
  },
];

describe('the refusals are the five both modules know about', () => {
  // `buildScale` decides which signals have no scale; `describeScalingFailure` re-derives WHY
  // from the signal alone, because `toPhysical` never sees the header. A refusal added to one
  // and not the other is not a compile error and not a test failure anywhere else: the header
  // reports the new code and the throw quietly reports SCALE_UNAVAILABLE, whose own text tells
  // the reader to go and find a diagnostic bearing a different code. That divergence shipped
  // twice before it was worth counting — between the two entry points in 0.3.111, and in the
  // derived-gain arm until 0.4.509 — so this counts the sites rather than trusting the mirror.
  it('buildScale refuses in exactly five places', () => {
    const source = readFileSync(new URL('../../../src/header/scale.ts', import.meta.url), 'utf8');
    // Every refusal ends the same way: report the diagnostic, then abandon the scale.
    const refusals = source.match(/\n {4}\);\n {4}return undefined;\n/g) ?? [];
    expect(refusals).toHaveLength(5);
  });

  it('describeScalingFailure re-derives all five, and each case below fixes one', () => {
    // Five refusals, four distinct codes: the degenerate physical range and the unusable derived
    // gain share DEGENERATE_PHYSICAL_RANGE, which is why the count above is of sites and this is
    // of cases.
    expect(REFUSAL_CASES).toHaveLength(5);
    expect(new Set(REFUSAL_CASES.map((testCase) => testCase.code)).size).toBe(SCALING_CODES.size);
  });
});

describe('refusing to invent a gain', () => {
  for (const testCase of REFUSAL_CASES) {
    it(`throws EdfScalingError because ${testCase.name}`, () => {
      const fixture = build({ format: 'EDF', recordCount: 1, signals: [testCase.signal] });
      expect(fixture.signal.scale).toBeUndefined();

      let thrown: unknown;
      try {
        toPhysical(fixture.signal, Int32Array.from([0, 1, 2, 3]));
        expect.unreachable('a signal with no scale has no physical units');
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(EdfScalingError);
      const scalingError = thrown as EdfScalingError;
      expect(scalingError.edfErrorKind).toBe('scaling');
      expect(scalingError.code).toBe(testCase.code);
      // The message contract (DESIGN section 6): the signal is named by index AND label, so a
      // 256-channel file does not leave the reader counting columns.
      expect(scalingError.signalIndex).toBe(0);
      expect(scalingError.label).toBe('EMG Chin');
      expect(scalingError.message).toContain('signal 0');
      expect(scalingError.message).toContain('EMG Chin');
      expect(scalingError.message).toContain(testCase.code);
    });

    it(`still decodes digital samples when ${testCase.name}`, () => {
      // The deferred-fatal contract: the header parses, decodeDigital works, and only the
      // conversion that would need an invented gain fails.
      const fixture = build({
        format: 'EDF',
        recordCount: 2,
        signals: [{ ...testCase.signal, sample: (r, k) => r * 10 + k }],
      });
      const records: RecordRange = { start: 0, count: 2 };
      const start = fixture.header.headerByteLength;
      const recordBytes = fixture.bytes.subarray(
        start,
        start + records.count * fixture.header.recordByteLength,
      );

      const digital = decodeDigital(fixture.header, recordBytes, records, 0);
      expect(Array.from(digital)).toEqual([0, 1, 2, 3, 10, 11, 12, 13]);
    });

    it(`reports ${testCase.code} on the header as well as on the throw`, () => {
      // physical.ts re-derives the reason from the signal, because a bare EdfSignal does not
      // carry the diagnostic. The two must name the same cause, or a caller reading
      // header.diagnostics and a caller catching the error learn different things about the
      // same file.
      const fixture = build({ format: 'EDF', recordCount: 1, signals: [testCase.signal] });
      const reported = fixture.header.diagnostics.filter(
        (diagnostic) => diagnostic.signalIndex === 0 && SCALING_CODES.has(diagnostic.code),
      );
      expect(reported.map((diagnostic) => diagnostic.code)).toEqual([testCase.code]);
    });
  }

  it('names the cause the header named when a signal fails two checks at once', () => {
    // Both an inverted digital range and a degenerate physical range. Whichever check the
    // header applies first is the cause the caller was told about, so it is the cause
    // toPhysical must repeat.
    const fixture = build({
      format: 'EDF',
      recordCount: 1,
      signals: [
        {
          label: 'EMG Chin',
          samplesPerRecord: 4,
          digitalMinimum: 100,
          digitalMaximum: -100,
          physicalMinimum: 0,
          physicalMaximum: 0,
        },
      ],
    });
    const reported = fixture.header.diagnostics.filter(
      (diagnostic) => diagnostic.signalIndex === 0 && SCALING_CODES.has(diagnostic.code),
    );

    expect(fixture.signal.scale).toBeUndefined();
    expect(reported).toHaveLength(1);

    let thrown: unknown;
    try {
      toPhysical(fixture.signal, Int32Array.from([0]));
      expect.unreachable('a signal with no scale has no physical units');
    } catch (error) {
      thrown = error;
    }
    expect((thrown as EdfScalingError).code).toBe(reported[0]?.code);
  });

  it.each([
    ['the conventional -1/1 declaration', undefined],
    ['a degenerate 0/0 declaration', { physicalMinimum: '0', physicalMaximum: '0' }],
  ])('names the annotations channel for what it is, given %s', (_name, raw) => {
    /*
     * `parseSignalHeaders` deliberately does not run `buildScale` over an annotations channel:
     * its physical and digital fields describe nothing a caller may use, and checking them
     * "would report a defect about a number nobody may use". So such a signal has no scale AND
     * no diagnostic — and re-running the four data-signal tests over those unused fields named a
     * cause the header never evaluated.
     *
     * A 0/0 annotations channel was refused with DEGENERATE_PHYSICAL_RANGE asserting a header
     * defect, and the conventional -1/1 one with "the header recorded the reason" — both sending
     * the reader to a `header.diagnostics` entry that does not exist (fixed in 0.3.22).
     */
    const bytes = buildEdf({
      plus: 'C',
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 2 }],
      annotationSignals: [{ samplesPerRecord: 20, ...(raw === undefined ? {} : { raw }) }],
    });
    const header = parseHeader(bytes, bytes.byteLength);
    const annotations = header.signals[header.annotationSignalIndices[0] as number] as EdfSignal;

    // The premise: no scale, and nothing in header.diagnostics about this signal.
    expect(annotations.scale).toBeUndefined();
    expect(header.diagnostics.filter((d) => d.signalIndex === annotations.index)).toEqual([]);

    try {
      toPhysical(annotations, Int32Array.from([0]));
      expect.unreachable('an annotations channel has no physical units');
    } catch (error) {
      expect((error as EdfScalingError).code).toBe('SCALE_UNAVAILABLE');
      const message = (error as Error).message;
      expect(message).toContain('annotations channel');
      expect(message).toContain('EDF+ TAL text rather than measurements');
      // It must not claim the header recorded something, or blame the unused fields.
      expect(message).not.toContain('the header recorded the reason');
      expect(message).not.toContain('DEGENERATE');
      // And the next step is the one that works. `decodeDigital` on this channel produces
      // numbers that look exactly like a signal, which is the failure this package prevents.
      expect(message).toContain('readAnnotations');
      expect(message).not.toContain('decodeDigital() still works');
    }
  });

  it('admits it does not know rather than naming the nearest-looking cause', () => {
    // A signal whose scale is missing for none of the four documented reasons — here an
    // unreadable physical minimum. Naming a wrong cause is worse than admitting the cause is
    // not on hand, so the code is SCALE_UNAVAILABLE.
    const parsed = buildSignal(PINNED_SIGNAL);
    const signal: EdfSignal = { ...parsed, physicalMinimum: Number.NaN, scale: undefined };

    try {
      toPhysical(signal, Int32Array.from([0]));
      expect.unreachable('a signal with no scale has no physical units');
    } catch (error) {
      expect(error).toBeInstanceOf(EdfScalingError);
      expect((error as EdfScalingError).code).toBe('SCALE_UNAVAILABLE');
    }
  });

  it('quotes the raw header fields in the message', () => {
    // DESIGN section 6: every message names the field, the raw bytes as written, the rule and
    // a next step. The raw text is what makes a bug report actionable.
    const fixture = build({
      format: 'EDF',
      recordCount: 1,
      signals: [{ label: 'EMG Chin', samplesPerRecord: 4, digitalMinimum: 0, digitalMaximum: 0 }],
    });
    try {
      toPhysical(fixture.signal, Int32Array.from([0]));
      expect.unreachable('a signal with no scale has no physical units');
    } catch (error) {
      const message = (error as EdfScalingError).message;
      expect(message).toContain(JSON.stringify(fixture.signal.raw.digitalMinimum));
      expect(message).toContain('decodeDigital');
    }
  });
});

// ===========================================================================
// clampToDigitalRange
// ===========================================================================

describe('clampToDigitalRange', () => {
  const SAMPLES = Int32Array.from([-500, -101, -100, 0, 100, 101, 500]);
  const CLAMPED = [-100, -100, -100, 0, 100, 100, 100];

  it('clamps to the declared range', () => {
    const signal = buildSignal({
      label: 'Fp1',
      samplesPerRecord: 1,
      digitalMinimum: -100,
      digitalMaximum: 100,
    });
    const clamped = clampToDigitalRange(signal, SAMPLES);

    expect(clamped).toBeInstanceOf(Int32Array);
    expect(Array.from(clamped)).toEqual(CLAMPED);
    // Post-hoc only: nothing on the read path calls this, and the input is left alone so a
    // caller can compare the two.
    expect(Array.from(SAMPLES)).toEqual([-500, -101, -100, 0, 100, 101, 500]);
  });

  it('uses min/max of an inverted range instead of collapsing every sample onto one value', () => {
    const inverted = buildSignal({
      label: 'Fp1',
      samplesPerRecord: 1,
      digitalMinimum: 100,
      digitalMaximum: -100,
    });
    const clamped = clampToDigitalRange(inverted, SAMPLES);

    // Identical to the upright declaration: [min(digMin,digMax), max(digMin,digMax)].
    expect(Array.from(clamped)).toEqual(CLAMPED);
    // Clamping to the pair as written would give the empty interval [100, -100], where every
    // sample below 100 becomes 100 and everything else becomes -100 — two values, and 0 would
    // come back as 100.
    expect(new Set(clamped).size).toBeGreaterThan(2);
    expect(clamped[3]).toBe(0);
  });

  it('leaves an in-range signal untouched', () => {
    const signal = buildSignal({
      label: 'Fp1',
      samplesPerRecord: 1,
      digitalMinimum: -32768,
      digitalMaximum: 32767,
    });
    const clamped = clampToDigitalRange(signal, SAMPLES);
    expect(Array.from(clamped)).toEqual(Array.from(SAMPLES));
  });

  it('refuses a range that does not parse as numbers', () => {
    // Every comparison against NaN is false, so clamping would return the input unchanged
    // while claiming to have clamped it.
    const parsed = buildSignal(PINNED_SIGNAL);
    const signal: EdfSignal = { ...parsed, digitalMinimum: Number.NaN };

    let thrown: unknown;
    try {
      clampToDigitalRange(signal, SAMPLES);
      expect.unreachable('there is no range to clamp to');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RangeError);
    expect(isEdfError(thrown)).toBe(false);
  });
});

// ===========================================================================
// `out` reuse
// ===========================================================================

describe('out reuse', () => {
  const digital = Int32Array.from([DIG_MIN, 0, DIG_MAX]);

  it('toPhysical writes into an exactly sized out and returns it', () => {
    const signal = buildSignal(PINNED_SIGNAL);
    const out = new Float64Array(3);
    const physical = toPhysical(signal, digital, out);

    expect(physical).toBe(out);
    expectBitIdentical(out, pinnedPhysical(PHYS_MIN, PHYS_MAX, DIG_MIN, DIG_MAX, digital));
  });

  it('toPhysical narrows a longer out to a view over its own memory', () => {
    const signal = buildSignal(PINNED_SIGNAL);
    const out = new Float64Array(16).fill(-1);
    const physical = toPhysical(signal, digital, out);

    expect(physical.length).toBe(3);
    expect(physical.buffer).toBe(out.buffer);
    expect(out[3]).toBe(-1);
    expectBitIdentical(physical, pinnedPhysical(PHYS_MIN, PHYS_MAX, DIG_MIN, DIG_MAX, digital));
  });

  it('toPhysical refuses a too-small out', () => {
    const signal = buildSignal(PINNED_SIGNAL);
    const call = (): Float64Array => toPhysical(signal, digital, new Float64Array(2));

    expect(call).toThrow(RangeError);
    let thrown: unknown;
    try {
      call();
    } catch (error) {
      thrown = error;
    }
    expect(isEdfError(thrown)).toBe(false);
  });

  it('toPhysical checks the allocation budget only when it has to allocate', () => {
    const signal = buildSignal(PINNED_SIGNAL);
    const options = { maxMaterializeBytes: 8 };

    expect(() => toPhysical(signal, digital, undefined, options)).toThrow(EdfBudgetError);
    const out = new Float64Array(3);
    expect(toPhysical(signal, digital, out, options)).toBe(out);
  });

  it('clampToDigitalRange writes into an exactly sized out and returns it', () => {
    const signal = buildSignal({
      label: 'Fp1',
      samplesPerRecord: 1,
      digitalMinimum: -100,
      digitalMaximum: 100,
    });
    const samples = Int32Array.from([-500, 0, 500]);
    const out = new Int32Array(3);

    expect(clampToDigitalRange(signal, samples, out)).toBe(out);
    expect(Array.from(out)).toEqual([-100, 0, 100]);
  });

  it('clampToDigitalRange narrows a longer out and refuses a too-small one', () => {
    const signal = buildSignal({
      label: 'Fp1',
      samplesPerRecord: 1,
      digitalMinimum: -100,
      digitalMaximum: 100,
    });
    const samples = Int32Array.from([-500, 0, 500]);
    const out = new Int32Array(8).fill(-7);
    const clamped = clampToDigitalRange(signal, samples, out);

    expect(clamped.length).toBe(3);
    expect(clamped.buffer).toBe(out.buffer);
    expect(out[3]).toBe(-7);
    expect(() => clampToDigitalRange(signal, samples, new Int32Array(2))).toThrow(RangeError);
  });
});

describe('physicalRangeOf', () => {
  it('returns the declared bounds in ascending order for an ordinary signal', () => {
    const signal = buildSignal({
      label: 'Fp1',
      samplesPerRecord: 1,
      physicalMinimum: -500,
      physicalMaximum: 500,
    });
    expect(physicalRangeOf(signal)).toEqual({ low: -500, high: 500 });
  });

  it('orders the bounds of a negative-gain signal instead of returning them as declared', () => {
    // physicalMinimum 500 > physicalMaximum -500 is a legal negative gain. Reading the two
    // fields in field order gives a viewer an inverted axis on exactly the channels whose trace
    // is also inverted, and the two errors cancel visually while both are wrong.
    const signal = buildSignal({
      label: 'Fp1',
      samplesPerRecord: 1,
      physicalMinimum: 500,
      physicalMaximum: -500,
      digitalMinimum: -32768,
      digitalMaximum: 32767,
    });
    expect(signal.physicalMinimum).toBeGreaterThan(signal.physicalMaximum);
    expect(physicalRangeOf(signal)).toEqual({ low: -500, high: 500 });
  });

  it('agrees with the endpoints toPhysical actually produces', () => {
    // The range must be the image of the digital range under the pinned expression, for both
    // gain signs. This is the property, not the field order.
    for (const [low, high] of [
      [-500, 500],
      [500, -500],
    ] as const) {
      const signal = buildSignal({
        label: 'Fp1',
        samplesPerRecord: 1,
        physicalMinimum: low,
        physicalMaximum: high,
        digitalMinimum: -32768,
        digitalMaximum: 32767,
      });
      const ends = toPhysical(signal, Int32Array.from([-32768, 32767]));
      const range = physicalRangeOf(signal);
      expect(range.low).toBeCloseTo(Math.min(ends[0] as number, ends[1] as number), 9);
      expect(range.high).toBeCloseTo(Math.max(ends[0] as number, ends[1] as number), 9);
    }
  });

  it('keeps a degenerate range as the single point it is', () => {
    // physicalMinimum == physicalMaximum leaves `scale` undefined, but the declared range is
    // still a fact about the file. Reporting it is honest; widening it would not be.
    const signal = buildSignal({
      label: 'Fp1',
      samplesPerRecord: 1,
      physicalMinimum: 7,
      physicalMaximum: 7,
    });
    expect(signal.scale).toBeUndefined();
    expect(physicalRangeOf(signal)).toEqual({ low: 7, high: 7 });
  });

  it('refuses a non-finite bound rather than returning a NaN axis', () => {
    // `parseHeader` refuses an unreadable physical field outright, so a NaN bound reaches here
    // only on a hand-assembled signal — the same way the clampToDigitalRange guard is reached.
    // It still has to be guarded: every comparison against NaN is false, so an unguarded version
    // returns {low: NaN, high: NaN}, an axis that draws nothing and reports no error.
    const parsed = buildSignal(PINNED_SIGNAL);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => physicalRangeOf({ ...parsed, physicalMinimum: bad })).toThrow(RangeError);
      expect(() => physicalRangeOf({ ...parsed, physicalMaximum: bad })).toThrow(RangeError);
    }
  });
});
