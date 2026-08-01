/**
 * `src/header/scale.ts` — the digital-to-physical scale, and the decision to refuse one.
 *
 * DESIGN.md section 5 pins the expression verbatim:
 *
 *     bitValue = (physicalMaximum - physicalMinimum) / (digitalMaximum - digitalMinimum)
 *     offset   = physicalMaximum / bitValue - digitalMaximum
 *     physical = bitValue * (offset + digital)
 *
 * It is EDFlib's form, reproduced for float64 bit-parity with pyEDFlib, and it is deliberately
 * NOT the numerically better `physicalMinimum + (digital - digitalMinimum) * gain`. Section 6
 * lists the four deferred-fatal codes that leave `signal.scale` undefined, and `physicalMinimum
 * > physicalMaximum` is explicitly legal.
 */

import { describe, expect, it } from 'vitest';

import { DiagnosticSink } from '../../../src/diagnostics/collector.js';
import { parseHeader } from '../../../src/header/parse.js';
import { buildScale, normaliseUnit, type ScaleInput } from '../../../src/header/scale.js';
import type { EdfDiagnostic, EdfScale } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

/**
 * A deliberately ASYMMETRIC range: 4095 digital steps across 1000 physical units. The two
 * candidate scaling forms agree on a symmetric range far more often, so an asymmetric one is
 * what makes the pinning assertions below able to fail.
 */
const BASE: ScaleInput = {
  signalIndex: 0,
  label: 'Fp1',
  physicalDimension: 'uV',
  physicalMinimum: -500,
  physicalMaximum: 500,
  digitalMinimum: -2048,
  digitalMaximum: 2047,
  raw: undefined,
  byteOffsets: undefined,
};

interface Built {
  readonly scale: EdfScale | undefined;
  readonly diagnostics: readonly EdfDiagnostic[];
  readonly codes: readonly string[];
}

function build(overrides: Partial<ScaleInput> = {}): Built {
  const sink = new DiagnosticSink();
  const scale = buildScale({ ...BASE, ...overrides }, sink);
  const diagnostics = sink.diagnostics;
  return { scale, diagnostics, codes: diagnostics.map((diagnostic) => diagnostic.code) };
}

function requireScale(scale: EdfScale | undefined): EdfScale {
  expect(scale).toBeDefined();
  if (scale === undefined) throw new Error('unreachable: the assertion above has failed');
  return scale;
}

describe("the scaling expression is EDFlib's, verbatim", () => {
  it('computes bitValue and offset with the pinned expression, bit for bit', () => {
    const scale = requireScale(build().scale);

    // Written out exactly as DESIGN.md section 5 states it. Object.is, not toBeCloseTo: the
    // whole point of reproducing this form is float64 bit-parity with pyEDFlib.
    const bitValue = (500 - -500) / (2047 - -2048);
    const offset = 500 / bitValue - 2047;

    expect(Object.is(scale.bitValue, bitValue)).toBe(true);
    expect(Object.is(scale.offset, offset)).toBe(true);
    // The same numbers, spelled out, so a refactor that changes the arithmetic is visible here.
    expect(scale.bitValue).toBe(1000 / 4095);
    expect(scale.offset).toBe(0.5);
  });

  it('is not the textbook physMin-anchored form, which differs in the last bit', () => {
    // DESIGN.md section 5: the textbook form is numerically BETTER and is still not used,
    // because it shifts up to ~45% of samples by >= 1 ULP on asymmetric ranges and would
    // forfeit bit-parity. Divergence is ~1e-13 physical units here — ten orders of magnitude
    // below the quantisation floor, and therefore invisible to anything but Object.is.
    const scale = requireScale(build().scale);
    const digital = -2030;

    const pinned = scale.bitValue * (scale.offset + digital);
    const textbook = -500 + (digital - -2048) * scale.bitValue;

    expect(Object.is(pinned, textbook)).toBe(false);
    expect(Math.abs(pinned - textbook)).toBeLessThan(1e-9);
  });

  it('maps the digital extremes onto the declared physical extremes', () => {
    const scale = requireScale(build().scale);
    expect(scale.bitValue * (scale.offset + 2047)).toBeCloseTo(500, 10);
    expect(scale.bitValue * (scale.offset + -2048)).toBeCloseTo(-500, 10);
  });
});

describe('the four refusals leave scale undefined rather than inventing a gain', () => {
  interface RefusalCase {
    readonly behaviour: string;
    readonly overrides: Partial<ScaleInput>;
    readonly code: string;
  }

  // DESIGN.md section 6, "deferred-fatal": each sets scale = undefined; decodeDigital keeps
  // working and toPhysical throws EdfScalingError. Verified in edflib.c, EDFlib instead sets
  // bitvalue = 1 and offset = 0 unconditionally and returns raw ADC counts LABELLED as physical
  // units — the outcome `strictNullChecks` makes unrepresentable here.
  const CASES: readonly RefusalCase[] = [
    {
      behaviour: 'digitalMinimum equals digitalMaximum, so the scale would divide by zero',
      overrides: { digitalMinimum: 0, digitalMaximum: 0 },
      code: 'DEGENERATE_DIGITAL_RANGE',
    },
    {
      behaviour: 'physicalMinimum equals physicalMaximum, so every sample maps to one value',
      overrides: { physicalMinimum: 0, physicalMaximum: 0 },
      code: 'DEGENERATE_PHYSICAL_RANGE',
    },
    {
      behaviour: 'digitalMinimum exceeds digitalMaximum, which has no sanctioned meaning',
      overrides: { digitalMinimum: 2047, digitalMaximum: -2048 },
      code: 'INVERTED_DIGITAL_RANGE',
    },
    {
      behaviour: "the physical dimension is exactly 'Filtered', a log-compressed channel",
      overrides: { physicalDimension: 'Filtered' },
      code: 'LOG_TRANSFORMED_CHANNEL',
    },
  ];

  for (const { behaviour, overrides, code } of CASES) {
    it(`refuses a scale when ${behaviour}`, () => {
      const { scale, codes, diagnostics } = build(overrides);
      expect(scale).toBeUndefined();
      expect(codes).toEqual([code]);
      // Deferred-fatal codes carry severity 'error': the signal has no physical units at all.
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.signalIndex).toBe(0);
    });
  }

  it('checks the four refusals in the order the module fixes', () => {
    // The order decides which error a doubly-broken signal reports, and under `strict` the
    // first would-be diagnostic is the one that throws — so it is behaviour, not detail.
    expect(build({ digitalMinimum: 0, digitalMaximum: 0, physicalDimension: 'Filtered' }).codes) //
      .toEqual(['DEGENERATE_DIGITAL_RANGE']);
    expect(
      build({ digitalMinimum: 0, digitalMaximum: 0, physicalMinimum: 0, physicalMaximum: 0 }).codes,
    ) //
      .toEqual(['DEGENERATE_DIGITAL_RANGE']);
    expect(build({ physicalMinimum: 0, physicalMaximum: 0, physicalDimension: 'Filtered' }).codes) //
      .toEqual(['DEGENERATE_PHYSICAL_RANGE']);
    expect(
      build({ digitalMinimum: 2047, digitalMaximum: -2048, physicalDimension: 'Filtered' }).codes,
    ) //
      .toEqual(['INVERTED_DIGITAL_RANGE']);
  });

  it("refuses 'Filtered' only when the dimension is exactly that, after trimming", () => {
    expect(build({ physicalDimension: 'Filtered ' }).scale).toBeUndefined();
    expect(build({ physicalDimension: ' Filtered' }).scale).toBeUndefined();
    // Case and content matter: nothing else is a log-transformed channel.
    expect(build({ physicalDimension: 'filtered' }).codes).toEqual([]);
    expect(build({ physicalDimension: 'FILTERED' }).codes).toEqual([]);
    expect(build({ physicalDimension: 'Filter' }).codes).toEqual([]);
    expect(requireScale(build({ physicalDimension: 'filtered' }).scale).bitValue).toBe(1000 / 4095);
  });

  it('returns undefined without a diagnostic when a field never parsed', () => {
    // The caller has already reported the unreadable field against the field itself; a second
    // diagnostic about the scale would blame the wrong bytes.
    expect(build({ physicalMaximum: Number.NaN }).scale).toBeUndefined();
    expect(build({ physicalMaximum: Number.NaN }).codes).toEqual([]);
    expect(build({ digitalMaximum: Number.POSITIVE_INFINITY }).codes).toEqual([]);
  });
});

describe('an inverted PHYSICAL range is legal and is never "fixed"', () => {
  it('yields a negative bitValue and reports at info severity', () => {
    // EDF FAQ Q6: physicalMinimum > physicalMaximum is how a negative amplifier gain is
    // written. A silent polarity flip is a clinically wrong result that looks perfectly
    // normal, which is why the two are never swapped and why this is info, not a warning.
    const { scale, codes, diagnostics } = build({ physicalMinimum: 500, physicalMaximum: -500 });
    const resolved = requireScale(scale);

    expect(codes).toEqual(['INVERTED_PHYSICAL_RANGE']);
    expect(diagnostics[0]?.severity).toBe('info');
    expect(resolved.bitValue).toBeLessThan(0);
    expect(Object.is(resolved.bitValue, (-500 - 500) / (2047 - -2048))).toBe(true);
    expect(Object.is(resolved.offset, -500 / resolved.bitValue - 2047)).toBe(true);
  });

  it('inverts the polarity of every sample and nothing else', () => {
    // The declared bounds are used as written, so the physical values come out as the exact
    // negation of the same file with the two fields the other way round.
    const upright = requireScale(build().scale);
    const inverted = requireScale(build({ physicalMinimum: 500, physicalMaximum: -500 }).scale);

    for (const digital of [-2048, -1, 0, 1, 1234, 2047]) {
      const a = upright.bitValue * (upright.offset + digital);
      const b = inverted.bitValue * (inverted.offset + digital);
      expect(Object.is(b, -a)).toBe(true);
    }
  });

  it('keeps the two bounds in the order the file wrote them', () => {
    const bytes = buildEdf({
      signals: [
        {
          label: 'Fp1',
          samplesPerRecord: 4,
          physicalMinimum: 500,
          physicalMaximum: -500,
          digitalMinimum: -2048,
          digitalMaximum: 2047,
        },
      ],
      recordCount: 2,
      startDate: '2.8.1990',
    });
    const signal = parseHeader(bytes, bytes.byteLength).signals[0];

    expect(signal?.physicalMinimum).toBe(500);
    expect(signal?.physicalMaximum).toBe(-500);
    expect(signal?.scale?.bitValue).toBeLessThan(0);
    expect(signal?.raw.physicalMinimum.trimEnd()).toBe('500');
    expect(signal?.raw.physicalMaximum.trimEnd()).toBe('-500');
  });
});

describe('unit normalisation is for comparison only', () => {
  interface UnitCase {
    readonly behaviour: string;
    readonly dimension: string;
    readonly unit: string;
  }

  // DESIGN.md section 3: `unit` is "normalised for comparison: µ/μ/0xB5 -> u". U+00B5 is the
  // MICRO SIGN a raw 0xB5 header byte decodes to through Latin-1; U+03BC is GREEK SMALL LETTER
  // MU, which cannot come from a single header byte but does arrive from callers and other
  // toolchains, so it is covered here at the function level.
  const CASES: readonly UnitCase[] = [
    { behaviour: 'plain ASCII uV is already normal', dimension: 'uV', unit: 'uV' },
    { behaviour: 'U+00B5 MICRO SIGN becomes u', dimension: 'µV', unit: 'uV' },
    { behaviour: 'U+03BC GREEK SMALL LETTER MU becomes u', dimension: 'μV', unit: 'uV' },
    { behaviour: 'a bare micro sign becomes a bare u', dimension: 'µ', unit: 'u' },
    { behaviour: 'field padding is stripped', dimension: '  uV    ', unit: 'uV' },
    { behaviour: 'a millivolt is untouched', dimension: 'mV', unit: 'mV' },
    { behaviour: 'a degree Celsius is untouched', dimension: 'degC', unit: 'degC' },
  ];

  for (const { behaviour, dimension, unit } of CASES) {
    it(behaviour, () => {
      expect(normaliseUnit(dimension)).toBe(unit);
    });
  }

  it('does not fold case, because mV is not MV', () => {
    // edfcore has no unit vocabulary and does not normalise to SI volts; only the several
    // spellings of micro are collapsed, because they are the same character written three ways.
    expect(normaliseUnit('MV')).toBe('MV');
    expect(normaliseUnit('Uv')).toBe('Uv');
  });

  it('leaves signal.physicalDimension exactly as the file wrote it', () => {
    // The raw 0xB5 byte real equipment writes for micro, decoded as Latin-1 to U+00B5.
    const bytes = buildEdf({
      signals: [{ label: 'Fp1', samplesPerRecord: 4, physicalDimension: 'µV' }],
      recordCount: 2,
      startDate: '2.8.1990',
    });
    const signal = parseHeader(bytes, bytes.byteLength).signals[0];

    expect(signal?.physicalDimension).toBe('µV');
    expect(signal?.raw.physicalDimension.charCodeAt(0)).toBe(0xb5);
    expect(signal?.unit).toBe('uV');
  });
});

describe('a refused scale is per signal, and travels through parseHeader', () => {
  it('refuses four broken signals while the fifth still scales', () => {
    const bytes = buildEdf({
      signals: [
        // digMin == digMax
        { label: 'degenerate-d', samplesPerRecord: 2, digitalMinimum: 0, digitalMaximum: 0 },
        // physMin == physMax
        { label: 'degenerate-p', samplesPerRecord: 2, physicalMinimum: 0, physicalMaximum: 0 },
        // digMin > digMax
        { label: 'inverted-d', samplesPerRecord: 2, digitalMinimum: 2047, digitalMaximum: -2048 },
        // the edffloat log transform
        { label: 'log', samplesPerRecord: 2, physicalDimension: 'Filtered' },
        { label: 'Fp1', samplesPerRecord: 2 },
      ],
      recordCount: 2,
      startDate: '2.8.1990',
    });
    const header = parseHeader(bytes, bytes.byteLength);
    const codes = header.diagnostics.map((diagnostic) => diagnostic.code);

    expect(header.signals[0]?.scale).toBeUndefined();
    expect(header.signals[1]?.scale).toBeUndefined();
    expect(header.signals[2]?.scale).toBeUndefined();
    expect(header.signals[3]?.scale).toBeUndefined();
    expect(header.signals[4]?.scale).toBeDefined();

    expect(codes).toContain('DEGENERATE_DIGITAL_RANGE');
    expect(codes).toContain('DEGENERATE_PHYSICAL_RANGE');
    expect(codes).toContain('INVERTED_DIGITAL_RANGE');
    expect(codes).toContain('LOG_TRANSFORMED_CHANNEL');

    // Every one of them names its own signal, so a caller can say which channel is unusable.
    for (const code of [
      'DEGENERATE_DIGITAL_RANGE',
      'DEGENERATE_PHYSICAL_RANGE',
      'INVERTED_DIGITAL_RANGE',
      'LOG_TRANSFORMED_CHANNEL',
    ]) {
      const reported = header.diagnostics.find((diagnostic) => diagnostic.code === code);
      expect(reported?.signalIndex).toBeTypeOf('number');
      expect(reported?.byteOffset).toBeTypeOf('number');
      expect(reported?.raw).toBeTypeOf('string');
    }
  });

  it('builds no scale at all for an annotations channel', () => {
    // The channel carries TAL text, not measurements, so there is no gain to refuse — running
    // the degenerate-range checks over it would report a defect about a number nobody may use.
    const bytes = buildEdf({
      plus: 'C',
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
      annotationSignals: [{ samplesPerRecord: 30 }],
      recordCount: 2,
      startDate: '2.8.1990',
    });
    const header = parseHeader(bytes, bytes.byteLength);
    expect(header.signals[1]?.kind).toBe('annotations');
    expect(header.signals[1]?.scale).toBeUndefined();
    expect(header.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'DEGENERATE_PHYSICAL_RANGE',
    );
  });

  it('reproduces the pinned expression end to end from real header bytes', () => {
    const bytes = buildEdf({
      signals: [
        {
          label: 'Fp1',
          samplesPerRecord: 4,
          physicalMinimum: -500,
          physicalMaximum: 500,
          digitalMinimum: -2048,
          digitalMaximum: 2047,
        },
      ],
      recordCount: 2,
      startDate: '2.8.1990',
    });
    const scale = requireScale(parseHeader(bytes, bytes.byteLength).signals[0]?.scale);
    expect(Object.is(scale.bitValue, (500 - -500) / (2047 - -2048))).toBe(true);
    expect(Object.is(scale.offset, 500 / scale.bitValue - 2047)).toBe(true);
  });
});
