/**
 * Writer -> reader round-trip properties.
 *
 * `tests/support/writer.ts` is written from the format specification and imports nothing from
 * `src/`. That independence is the whole point of this file: a reader and a writer that share a
 * misunderstanding agree with each other and are wrong together, so a round-trip between two
 * implementations that have never seen each other is a genuine cross-check rather than two copies
 * of one misunderstanding. Everything asserted below is also re-derived here from the plan the
 * generator produced — never read back off `header` and compared with itself.
 *
 * Every `fc.assert` passes a CONSTANT seed so a failure is reproducible from the terminal output
 * alone, and `numRuns` is kept in the low hundreds because these tests build and parse a whole
 * file per run and are meant to stay cheap enough to run in the browser project too.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../src/decode/digital.js';
import { toPhysical } from '../../src/decode/physical.js';
import { parseHeader } from '../../src/header/parse.js';
import { decodeAnnotations } from '../../src/tal/annotations.js';
import type { EdfHeader, EdfScale, EdfSignal, EdfVariant } from '../../src/types.js';
import {
  buildEdf,
  type EdfSpec,
  encodeTal,
  type SignalSpec,
  type TalSpec,
} from '../support/writer.js';

// ---------------------------------------------------------------------------
// Seeds and budgets
// ---------------------------------------------------------------------------

/**
 * Fixed seeds, one per property, so a counterexample is reproducible without a flaky rerun.
 * `numRuns` is deliberately modest: every run formats a header, builds a file and parses it.
 */
const SEEDS = {
  header: 0x0edf0001,
  digital: 0x0edf0002,
  physical: 0x0edf0003,
  quantisation: 0x0edf0004,
  annotations: 0x0edf0005,
} as const;

const RUNS = 300;

/**
 * A four-digit year in the `dd.mm.yy` field is accepted where it fits and is not clipped
 * (DESIGN section 5, startdate rules), so a fixture built on this carries no
 * `DATE_CLIPPED_TO_1985_2084` warning of its own and the "no unexpected diagnostics" assertion
 * stays meaningful.
 */
const CLEAN_START_DATE = '1.1.2020';

/** Room for the writer's synthesised timekeeping TAL (`+onset 0x14 0x14 0x00`) and then some. */
const ANNOTATION_SAMPLES = 20;

// ---------------------------------------------------------------------------
// Format facts, restated here rather than imported from src/
// ---------------------------------------------------------------------------

type Family = 'EDF' | 'BDF';

/**
 * DESIGN section 5, data records: EDF samples are 16-bit two's complement and BDF samples are
 * 24-bit sign-extended from bit 23. Spelled out rather than imported from `src/constants.ts` so
 * this file does not agree with the reader by construction.
 */
const FORMAT: Readonly<
  Record<Family, { readonly min: number; readonly max: number; readonly bytesPerSample: 2 | 3 }>
> = {
  EDF: { min: -32768, max: 32767, bytesPerSample: 2 },
  BDF: { min: -8388608, max: 8388607, bytesPerSample: 3 },
};

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Physical bounds that survive an 8-byte field EXACTLY.
 *
 * Every value here is a dyadic rational whose shortest decimal spelling fits in eight
 * characters, so `formatNumber` writes it back verbatim and the comparison below is against the
 * number the generator chose rather than against a silently reformatted one.
 */
const physicalBound = fc.oneof(
  fc.integer({ min: -99999, max: 99999 }),
  fc.integer({ min: -9999, max: 9999 }).map((n) => n / 2),
  fc.integer({ min: -999, max: 999 }).map((n) => n / 8),
);

/**
 * A physical pair in EITHER order. `physicalMinimum > physicalMaximum` is legal — it is how a
 * negative amplifier gain is written (EDF FAQ Q6) — and DESIGN section 5 requires it to survive
 * with its sign intact, so the order is generated rather than normalised.
 */
const physicalRange = fc.tuple(physicalBound, physicalBound).filter(([low, high]) => low !== high);

/** A digital pair inside what the sample width can represent, minimum strictly below maximum. */
function digitalRange(format: Family): fc.Arbitrary<readonly [number, number]> {
  const { min, max } = FORMAT[format];
  return fc
    .tuple(fc.integer({ min, max }), fc.integer({ min, max }))
    .filter(([a, b]) => a !== b)
    .map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as const);
}

function digitalSample(format: Family): fc.Arbitrary<number> {
  const { min, max } = FORMAT[format];
  return fc.integer({ min, max });
}

/** Label bodies that need no trimming and can never collide with `"EDF Annotations"`. */
const labelBody = fc.string({
  unit: fc.constantFrom('A', 'a', 'F', 'p', 'z', '1', '2', '7', '-', '_', '.', '+', 'C', 'O', 'T'),
  minLength: 1,
  maxLength: 10,
});

/**
 * `'µ'` is U+00B5 MICRO SIGN, one Latin-1 byte, which is exactly the raw `0xB5` real equipment
 * writes. U+03BC GREEK SMALL LETTER MU is deliberately absent: it is not a single byte, so the
 * fixture writer cannot express it in an 8-byte field at all.
 */
const physicalDimension = fc.constantFrom('uV', 'µV', 'mV', 'V', 'mmHg', '%', 'degC', 'Ohm');

/**
 * Durations whose shortest decimal spelling fits eight bytes. `0.1` is included on purpose: it
 * is not representable in binary, and `recordDurationTicks` must come from the DIGITS on disk
 * (1000000 ticks) rather than from `0.1 * 1e7`.
 */
const recordDurationSeconds = fc.constantFrom(1, 2, 0.5, 0.25, 0.125, 0.1, 30);

const family = fc.constantFrom('EDF' as const, 'BDF' as const);

interface SignalPlan {
  readonly label: string;
  readonly physicalDimension: string;
  readonly physicalRange: readonly [number, number];
  readonly digitalRange: readonly [number, number];
  readonly samplesPerRecord: number;
}

interface FilePlan {
  readonly format: Family;
  readonly plus: false | 'C';
  readonly signals: readonly SignalPlan[];
  readonly recordCount: number;
  readonly recordDurationSeconds: number;
}

function signalPlan(format: Family): fc.Arbitrary<SignalPlan> {
  return fc.record({
    label: labelBody,
    physicalDimension,
    physicalRange,
    digitalRange: digitalRange(format),
    samplesPerRecord: fc.integer({ min: 1, max: 32 }),
  });
}

const filePlan: fc.Arbitrary<FilePlan> = family.chain((format) =>
  fc.record({
    format: fc.constant(format),
    plus: fc.constantFrom(false as const, 'C' as const),
    signals: fc.array(signalPlan(format), { minLength: 1, maxLength: 4 }),
    recordCount: fc.integer({ min: 0, max: 3 }),
    recordDurationSeconds,
  }),
);

/**
 * `lengths.length` arrays of the stated lengths. Built by chaining rather than by
 * `fc.tuple(...)` over a spread so the per-signal length stays tied to the plan that produced it.
 */
function arraysOfLength(
  lengths: readonly number[],
  element: fc.Arbitrary<number>,
): fc.Arbitrary<number[][]> {
  return lengths.reduce<fc.Arbitrary<number[][]>>(
    (rows, length) =>
      rows.chain((built) =>
        fc
          .array(element, { minLength: length, maxLength: length })
          .map((row) => [...built, row] as number[][]),
      ),
    fc.constant<number[][]>([]),
  );
}

// ---------------------------------------------------------------------------
// Building and re-deriving
// ---------------------------------------------------------------------------

function annotationSignals(plus: false | 'C'): Partial<EdfSpec> {
  return plus === false ? {} : { annotationSignals: [{ samplesPerRecord: ANNOTATION_SAMPLES }] };
}

function buildFromPlan(plan: FilePlan): Uint8Array {
  const signals: SignalSpec[] = plan.signals.map((signal, index) => ({
    // The index suffix guarantees distinct labels, so `DUPLICATE_SIGNAL_LABEL` never fires and
    // the diagnostics assertion below stays about the fields under test.
    label: `${signal.label}${index}`,
    physicalDimension: signal.physicalDimension,
    physicalMinimum: signal.physicalRange[0],
    physicalMaximum: signal.physicalRange[1],
    digitalMinimum: signal.digitalRange[0],
    digitalMaximum: signal.digitalRange[1],
    samplesPerRecord: signal.samplesPerRecord,
  }));

  return buildEdf({
    format: plan.format,
    plus: plan.plus,
    recordCount: plan.recordCount,
    recordDurationSeconds: plan.recordDurationSeconds,
    raw: { startDate: CLEAN_START_DATE },
    signals,
    ...annotationSignals(plan.plus),
  });
}

/** `'0.1'` -> 1000000n, from the digits, with no float arithmetic anywhere on the path. */
function ticksOfDecimal(text: string): bigint {
  const negative = text.startsWith('-');
  const unsigned = negative || text.startsWith('+') ? text.slice(1) : text;
  const point = unsigned.indexOf('.');
  const whole = point < 0 ? unsigned : unsigned.slice(0, point);
  const fraction = point < 0 ? '' : unsigned.slice(point + 1);
  // TICKS_PER_SECOND is 10^7, so exactly seven fractional digits are representable.
  const scaled = `${fraction}0000000`.slice(0, 7);
  const ticks = BigInt(whole) * 10000000n + BigInt(scaled);
  return negative ? -ticks : ticks;
}

function variantOf(plan: FilePlan): EdfVariant {
  return plan.plus === false ? plan.format : `${plan.format}+C`;
}

function requireScale(signal: EdfSignal): EdfScale {
  const scale = signal.scale;
  if (scale === undefined) {
    throw new Error(
      `signal ${signal.index} "${signal.label}" has no scale, but its declared ranges ` +
        `(${signal.physicalMinimum}..${signal.physicalMaximum} over ` +
        `${signal.digitalMinimum}..${signal.digitalMaximum}) define one`,
    );
  }
  return scale;
}

/**
 * How far the two algebraically equal forms of the affine map may drift apart in float64.
 *
 * `toPhysical` evaluates EDFlib's pinned `bitValue * (offset + digital)` (DESIGN section 5);
 * every reference value below is computed with the textbook
 * `physicalMinimum + (digital - digitalMinimum) * gain`. Both forms subtract nearly equal numbers
 * somewhere, so neither one's error scales with its own (possibly cancelled) result — it scales
 * with the OPERANDS, and the slack has to be built out of those:
 *
 * - `offset` is `physicalMaximum / bitValue - digitalMaximum`, and scaling its ulp back through
 *   the multiply by `bitValue` turns it into `|physicalMaximum|`.
 * - the reference adds `physicalMinimum` to a product that cancels against it, contributing
 *   `|physicalMinimum|`.
 * - `offset + digital` rounds once more, worth `|bitValue| * (|offset| + |digital| + 1)` after
 *   the multiply.
 *
 * The constant multiplies the sum by the number of roundings on the two paths — `bitValue`,
 * `physicalMaximum / bitValue`, the subtraction, the addition, the product, and the same again on
 * the reference side — with headroom. Every term comes from the declared ranges: no epsilon is
 * guessed and none is hardcoded.
 */
const AFFINE_ROUNDINGS = 64;

function affineFormSlack(signal: EdfSignal, scale: EdfScale, digital: number): number {
  const magnitude =
    Math.abs(signal.physicalMinimum) +
    Math.abs(signal.physicalMaximum) +
    Math.abs(scale.bitValue) * (Math.abs(scale.offset) + Math.abs(digital) + 1);
  return magnitude * AFFINE_ROUNDINGS * Number.EPSILON;
}

/** Diagnostic codes a fully valid file is still entitled to emit. */
const EXPECTED_CODES: ReadonlySet<string> = new Set([
  // physicalMinimum > physicalMaximum is a negative amplifier gain: legal, and info-severity.
  'INVERTED_PHYSICAL_RANGE',
]);

function unexpectedCodes(header: EdfHeader): readonly string[] {
  return header.diagnostics
    .map((diagnostic) => diagnostic.code)
    .filter((code) => !EXPECTED_CODES.has(code));
}

function dataSection(header: EdfHeader, bytes: Uint8Array): Uint8Array {
  return bytes.subarray(
    header.headerByteLength,
    header.headerByteLength + header.recordCount * header.recordByteLength,
  );
}

// ---------------------------------------------------------------------------
// 1. Header round-trip
// ---------------------------------------------------------------------------

describe('header round-trip through an independently written file', () => {
  it('recovers every header field the writer put in, for EDF, BDF, EDF+C and BDF+C', () => {
    fc.assert(
      fc.property(filePlan, (plan) => {
        const bytes = buildFromPlan(plan);
        const header = parseHeader(bytes, bytes.length);

        const bytesPerSample = FORMAT[plan.format].bytesPerSample;
        const annotationCount = plan.plus === false ? 0 : 1;
        const signalCount = plan.signals.length + annotationCount;
        const dataSamplesPerRecord = plan.signals.reduce(
          (total, signal) => total + signal.samplesPerRecord,
          0,
        );
        const recordByteLength =
          bytesPerSample * (dataSamplesPerRecord + annotationCount * ANNOTATION_SAMPLES);

        expect(header.variant).toBe(variantOf(plan));
        expect(header.continuity).toBe('continuous');
        expect(header.bytesPerSample).toBe(bytesPerSample);

        // DESIGN section 5: "Compute 256*(ns+1) and use that."
        expect(header.headerByteLength).toBe(256 * (signalCount + 1));
        expect(header.declaredHeaderByteLength).toBe(header.headerByteLength);

        expect(header.recordByteLength).toBe(recordByteLength);
        expect(header.dataByteLength).toBe(recordByteLength * plan.recordCount);
        expect(header.recordCount).toBe(plan.recordCount);
        expect(header.declaredRecordCount).toBe(plan.recordCount);
        expect(header.recordCountSource).toBe('headerField');

        expect(header.recordDurationSeconds).toBe(plan.recordDurationSeconds);
        // Exact ticks come from the digits on disk, never from `seconds * 1e7`.
        expect(header.recordDurationTicks).toBe(ticksOfDecimal(String(plan.recordDurationSeconds)));

        expect(header.dataSignalIndices).toEqual(plan.signals.map((_, index) => index));
        expect(header.annotationSignalIndices).toEqual(
          plan.plus === false ? [] : [plan.signals.length],
        );
        expect(header.signals).toHaveLength(signalCount);

        let expectedRecordByteOffset = 0;
        plan.signals.forEach((planned, index) => {
          const signal = header.signals[index];
          if (signal === undefined) throw new Error(`signal ${index} is missing from the header`);

          expect(signal.kind).toBe('data');
          expect(signal.label).toBe(`${planned.label}${index}`);
          expect(signal.physicalDimension).toBe(planned.physicalDimension);
          // `unit` is normalised for comparison only: every spelling of micro becomes 'u'.
          expect(signal.unit).toBe(planned.physicalDimension.replace('µ', 'u'));
          expect(signal.physicalMinimum).toBe(planned.physicalRange[0]);
          expect(signal.physicalMaximum).toBe(planned.physicalRange[1]);
          expect(signal.digitalMinimum).toBe(planned.digitalRange[0]);
          expect(signal.digitalMaximum).toBe(planned.digitalRange[1]);
          expect(signal.samplesPerRecord).toBe(planned.samplesPerRecord);
          expect(signal.sampleCount).toBe(planned.samplesPerRecord * plan.recordCount);
          expect(signal.recordByteLength).toBe(planned.samplesPerRecord * bytesPerSample);

          // DESIGN section 5: recordByteOffset[i] = bytesPerSample * SUM(spr[j] for j < i).
          expect(signal.recordByteOffset).toBe(expectedRecordByteOffset);
          expectedRecordByteOffset += planned.samplesPerRecord * bytesPerSample;

          expect(signal.sampleRateHz).toBe(planned.samplesPerRecord / plan.recordDurationSeconds);
        });

        if (plan.plus !== false) {
          const annotations = header.signals[plan.signals.length];
          if (annotations === undefined) throw new Error('the annotation signal is missing');
          expect(annotations.kind).toBe('annotations');
          expect(annotations.label).toBe(`${plan.format} Annotations`);
          expect(annotations.scale).toBeUndefined();
          expect(annotations.recordByteOffset).toBe(expectedRecordByteOffset);
        }

        expect(unexpectedCodes(header)).toEqual([]);
      }),
      { seed: SEEDS.header, numRuns: RUNS },
    );
  });

  it('keeps a negative amplifier gain negative instead of swapping the physical bounds', () => {
    fc.assert(
      fc.property(filePlan, (plan) => {
        const bytes = buildFromPlan(plan);
        const header = parseHeader(bytes, bytes.length);

        plan.signals.forEach((planned, index) => {
          const signal = header.signals[index];
          if (signal === undefined) throw new Error(`signal ${index} is missing from the header`);
          const scale = requireScale(signal);
          const [physicalMinimum, physicalMaximum] = planned.physicalRange;
          const inverted = physicalMinimum > physicalMaximum;
          // DESIGN section 5: "Never swap them — a silent polarity flip is a clinically wrong
          // result that looks normal."
          expect(scale.bitValue < 0).toBe(inverted);
        });
      }),
      { seed: SEEDS.header, numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Digital sample round-trip
// ---------------------------------------------------------------------------

interface DecodePlan {
  readonly format: Family;
  readonly recordCount: number;
  readonly signals: readonly { readonly label: string; readonly samplesPerRecord: number }[];
  readonly digitalRange: readonly [number, number];
  readonly samples: readonly (readonly number[])[];
}

const decodePlan: fc.Arbitrary<DecodePlan> = family
  .chain((format) =>
    fc.record({
      format: fc.constant(format),
      recordCount: fc.integer({ min: 1, max: 3 }),
      signals: fc.array(
        fc.record({ label: labelBody, samplesPerRecord: fc.integer({ min: 1, max: 8 }) }),
        { minLength: 1, maxLength: 3 },
      ),
      // One declared range for every signal, deliberately narrower than the format range the
      // samples are drawn from: edfcore never clamps on read, so the samples must come back
      // untouched even when they fall outside what the header declares.
      digitalRange: digitalRange(format),
    }),
  )
  .chain((base) =>
    arraysOfLength(
      base.signals.map((signal) => signal.samplesPerRecord * base.recordCount),
      digitalSample(base.format),
    ).map((samples) => ({ ...base, samples })),
  );

describe('digital sample round-trip', () => {
  it('recovers every written sample bit-identically, de-interleaved per signal', () => {
    fc.assert(
      fc.property(decodePlan, (plan) => {
        const [digitalMinimum, digitalMaximum] = plan.digitalRange;
        const bytes = buildEdf({
          format: plan.format,
          recordCount: plan.recordCount,
          recordDurationSeconds: 1,
          raw: { startDate: CLEAN_START_DATE },
          signals: plan.signals.map((signal, index) => {
            const row = plan.samples[index];
            if (row === undefined) throw new Error(`no sample row for signal ${index}`);
            return {
              label: `${signal.label}${index}`,
              samplesPerRecord: signal.samplesPerRecord,
              digitalMinimum,
              digitalMaximum,
              sample: (recordIndex: number, sampleIndex: number): number => {
                const value = row[recordIndex * signal.samplesPerRecord + sampleIndex];
                if (value === undefined) {
                  throw new Error(`the plan has no sample ${recordIndex}/${sampleIndex}`);
                }
                return value;
              },
            };
          }),
        });

        const header = parseHeader(bytes, bytes.length);
        const records = { start: 0, count: plan.recordCount };
        const recordBytes = dataSection(header, bytes);

        plan.signals.forEach((_, index) => {
          const expected = plan.samples[index];
          if (expected === undefined) throw new Error(`no sample row for signal ${index}`);
          const digital = decodeDigital(header, recordBytes, records, index);
          expect(digital).toBeInstanceOf(Int32Array);
          expect(digital.length).toBe(expected.length);
          // Bit-identical, element by element — a Uint8Array comparison would pass on a
          // de-interleaving bug that swapped two signals of the same width.
          expect(Array.from(digital)).toEqual([...expected]);
        });
      }),
      { seed: SEEDS.digital, numRuns: RUNS },
    );
  });

  it('recovers the extreme sample of each format, where sign extension is decided', () => {
    // DESIGN section 7: "BDF sign extension exactly at 0x800000 and 0x7FFFFF".
    for (const format of ['EDF', 'BDF'] as const) {
      const { min, max } = FORMAT[format];
      const values = [min, min + 1, -1, 0, 1, max - 1, max];
      const bytes = buildEdf({
        format,
        recordCount: 1,
        recordDurationSeconds: 1,
        raw: { startDate: CLEAN_START_DATE },
        signals: [
          {
            label: 'Extremes',
            samplesPerRecord: values.length,
            digitalMinimum: min,
            digitalMaximum: max,
            sample: (_record, index) => values[index] ?? 0,
          },
        ],
      });
      const header = parseHeader(bytes, bytes.length);
      const digital = decodeDigital(header, dataSection(header, bytes), { start: 0, count: 1 }, 0);
      expect(Array.from(digital)).toEqual(values);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Physical round-trip
// ---------------------------------------------------------------------------

interface PhysicalPlan {
  readonly format: Family;
  readonly physicalRange: readonly [number, number];
  readonly digitalRange: readonly [number, number];
  readonly samples: readonly number[];
}

const physicalPlan: fc.Arbitrary<PhysicalPlan> = family.chain((format) =>
  fc.record({
    format: fc.constant(format),
    physicalRange,
    digitalRange: digitalRange(format),
    samples: fc.array(digitalSample(format), { minLength: 1, maxLength: 32 }),
  }),
);

function buildScaledFile(plan: {
  readonly format: Family;
  readonly physicalRange: readonly [number, number];
  readonly digitalRange: readonly [number, number];
  readonly samples: readonly number[];
}): Uint8Array {
  return buildEdf({
    format: plan.format,
    recordCount: 1,
    recordDurationSeconds: 1,
    raw: { startDate: CLEAN_START_DATE },
    signals: [
      {
        label: 'Scaled',
        samplesPerRecord: plan.samples.length,
        physicalMinimum: plan.physicalRange[0],
        physicalMaximum: plan.physicalRange[1],
        digitalMinimum: plan.digitalRange[0],
        digitalMaximum: plan.digitalRange[1],
        sample: (_record, index) => plan.samples[index] ?? 0,
      },
    ],
  });
}

describe('physical round-trip', () => {
  it('maps digital to physical along the affine map the declared ranges define', () => {
    fc.assert(
      fc.property(physicalPlan, (plan) => {
        const bytes = buildScaledFile(plan);
        const header = parseHeader(bytes, bytes.length);
        const signal = header.signals[0];
        if (signal === undefined) throw new Error('the file has no signal 0');
        const scale = requireScale(signal);

        const digital = decodeDigital(
          header,
          dataSection(header, bytes),
          { start: 0, count: 1 },
          0,
        );
        const physical = toPhysical(signal, digital);

        const [physicalMinimum, physicalMaximum] = plan.physicalRange;
        const [digitalMinimum, digitalMaximum] = plan.digitalRange;
        // The textbook form, computed here and nowhere in src/: the reference this round-trip is
        // checked against must not be the expression under test.
        const gain = (physicalMaximum - physicalMinimum) / (digitalMaximum - digitalMinimum);

        expect(physical).toBeInstanceOf(Float64Array);
        expect(physical.length).toBe(plan.samples.length);
        plan.samples.forEach((sample, index) => {
          const reference = physicalMinimum + (sample - digitalMinimum) * gain;
          const actual = physical[index];
          if (actual === undefined) throw new Error(`no physical value at ${index}`);
          expect(Number.isFinite(actual)).toBe(true);
          expect(Math.abs(actual - reference)).toBeLessThanOrEqual(
            affineFormSlack(signal, scale, sample),
          );
        });

        // The endpoints are what the declared ranges MEAN, so they are asserted explicitly.
        const endpoints = toPhysical(signal, Int32Array.from([digitalMinimum, digitalMaximum]));
        expect(Math.abs((endpoints[0] ?? Number.NaN) - physicalMinimum)).toBeLessThanOrEqual(
          affineFormSlack(signal, scale, digitalMinimum),
        );
        expect(Math.abs((endpoints[1] ?? Number.NaN) - physicalMaximum)).toBeLessThanOrEqual(
          affineFormSlack(signal, scale, digitalMaximum),
        );
      }),
      { seed: SEEDS.physical, numRuns: RUNS },
    );
  });

  it('recovers a physical value through quantisation to within half a quantisation step', () => {
    const quantisationPlan = family
      .chain((format) =>
        fc.record({
          format: fc.constant(format),
          physicalRange,
          digitalRange: digitalRange(format),
        }),
      )
      .chain((base) => {
        const low = Math.min(base.physicalRange[0], base.physicalRange[1]);
        const high = Math.max(base.physicalRange[0], base.physicalRange[1]);
        return fc
          .array(fc.double({ min: low, max: high, noNaN: true }), {
            minLength: 1,
            maxLength: 24,
          })
          .map((values) => ({ ...base, values }));
      });

    fc.assert(
      fc.property(quantisationPlan, (plan) => {
        const [physicalMinimum, physicalMaximum] = plan.physicalRange;
        const [digitalMinimum, digitalMaximum] = plan.digitalRange;
        const gain = (physicalMaximum - physicalMinimum) / (digitalMaximum - digitalMinimum);

        // What a writer does: quantise to the nearest digital step the declared ranges allow.
        // The trailing `+ 0` collapses `Math.round`'s negative zero onto positive zero — the file
        // stores an integer, and `toEqual` would otherwise separate -0 from the 0 that comes back.
        const samples = plan.values.map((value) => {
          const exact = (value - physicalMinimum) / gain + digitalMinimum;
          return Math.min(digitalMaximum, Math.max(digitalMinimum, Math.round(exact))) + 0;
        });

        const bytes = buildScaledFile({ ...plan, samples });
        const header = parseHeader(bytes, bytes.length);
        const signal = header.signals[0];
        if (signal === undefined) throw new Error('the file has no signal 0');
        const scale = requireScale(signal);

        const digital = decodeDigital(
          header,
          dataSection(header, bytes),
          { start: 0, count: 1 },
          0,
        );
        expect(Array.from(digital)).toEqual(samples);
        const physical = toPhysical(signal, digital);

        plan.values.forEach((value, index) => {
          const recovered = physical[index];
          const sample = samples[index];
          if (recovered === undefined || sample === undefined) {
            throw new Error(`no value at ${index}`);
          }
          // `bitValue` IS the physical size of one digital step, so the quantisation error the
          // declared ranges imply is half of it; the slack term is the float64 divergence
          // between the pinned expression and the textbook one, derived above.
          const tolerance = Math.abs(scale.bitValue) / 2 + affineFormSlack(signal, scale, sample);
          expect(Math.abs(recovered - value)).toBeLessThanOrEqual(tolerance);
        });
      }),
      { seed: SEEDS.quantisation, numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// 4. TAL round-trip
// ---------------------------------------------------------------------------

const digitString = (minLength: number, maxLength: number): fc.Arbitrary<string> =>
  fc.string({
    unit: fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'),
    minLength,
    maxLength,
  });

/** `("+" / "-") 1*DIGIT [ "." 1*DIGIT ]`, at most seven fractional digits so nothing truncates. */
const onsetText = fc
  .tuple(fc.constantFrom('+', '-'), digitString(1, 6), fc.option(digitString(1, 7), { nil: '' }))
  .map(([sign, whole, fraction]) => `${sign}${whole}${fraction === '' ? '' : `.${fraction}`}`);

/** `1*DIGIT [ "." 1*DIGIT ]` — a duration is never signed. */
const durationText = fc
  .tuple(digitString(1, 5), fc.option(digitString(1, 7), { nil: '' }))
  .map(([whole, fraction]) => `${whole}${fraction === '' ? '' : `.${fraction}`}`);

/**
 * Annotation text over a deliberately mixed alphabet: ASCII, Latin-1 accents, Greek, Cyrillic,
 * Arabic and CJK, so the UTF-8 path is exercised rather than the ASCII fast path alone.
 *
 * No `0x00`, `0x14` or `0x15` (they are structure, not text), no `'@'` (`description@@channel`
 * is a separate convention with its own tests), and nothing above the BMP: the fixture writer
 * encodes per UTF-16 code unit, so a surrogate pair would leave it as two U+FFFD and the test
 * would be measuring the writer rather than the reader.
 */
const annotationText = fc.string({
  unit: fc.constantFrom(
    'a',
    'B',
    'z',
    '9',
    ' ',
    '_',
    '-',
    '/',
    '(',
    ')',
    ':',
    'é',
    'ü',
    'ñ',
    'ß',
    'µ',
    '°',
    'Ω',
    'π',
    '中',
    '日',
    'あ',
    'Ж',
    'ا',
  ),
  minLength: 1,
  maxLength: 8,
});

const talSpec: fc.Arbitrary<TalSpec> = fc
  .record({
    onset: onsetText,
    duration: fc.option(durationText, { nil: undefined }),
    texts: fc.array(annotationText, { minLength: 1, maxLength: 2 }),
  })
  .map(({ onset, duration, texts }) =>
    duration === undefined ? { onset, texts } : { onset, duration, texts },
  );

describe('TAL round-trip', () => {
  it('recovers onsets, durations and unicode texts with exact tick equality', () => {
    const talPlan = fc.record({
      format: family,
      tals: fc.array(talSpec, { minLength: 1, maxLength: 4 }),
    });

    fc.assert(
      fc.property(talPlan, (plan) => {
        const bytesPerSample = FORMAT[plan.format].bytesPerSample;
        // The writer synthesises the timekeeping TAL for record 0; size the region for it plus
        // every generated TAL, so nothing is discarded at the region bound.
        const regionBytes =
          encodeTal({ onset: 0 }).length +
          plan.tals.reduce((total, tal) => total + encodeTal(tal).length, 0) +
          2;

        const bytes = buildEdf({
          format: plan.format,
          plus: 'C',
          recordCount: 1,
          recordDurationSeconds: 1,
          raw: { startDate: CLEAN_START_DATE },
          signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
          annotationSignals: [
            {
              samplesPerRecord: Math.ceil(regionBytes / bytesPerSample),
              tals: () => plan.tals,
            },
          ],
        });

        const header = parseHeader(bytes, bytes.length);
        const records = { start: 0, count: 1 };
        const result = decodeAnnotations(header, dataSection(header, bytes), records);

        // Record 0's timekeeping TAL is `+0`, so the two onset conventions coincide and any
        // rebasing mistake shows up as an inequality below rather than as a constant offset.
        expect(result.recordOnsetTicks[0]).toBe(0n);

        interface Expected {
          readonly onsetTicks: bigint;
          readonly durationTicks: bigint | undefined;
          readonly text: string;
          readonly order: number;
        }
        const expected: Expected[] = [];
        for (const tal of plan.tals) {
          for (const text of tal.texts ?? []) {
            expected.push({
              onsetTicks: ticksOfDecimal(String(tal.onset)),
              durationTicks:
                tal.duration === undefined ? undefined : ticksOfDecimal(String(tal.duration)),
              text,
              order: expected.length,
            });
          }
        }
        // The pinned total order is (onsetTicks, signalIndex, byteOffsetInRecord, insertion).
        // One record and one annotation signal collapse the middle two keys onto insertion order.
        expected.sort((a, b) =>
          a.onsetTicks === b.onsetTicks ? a.order - b.order : a.onsetTicks < b.onsetTicks ? -1 : 1,
        );

        expect(result.annotations).toHaveLength(expected.length);
        expected.forEach((want, index) => {
          const got = result.annotations[index];
          if (got === undefined) throw new Error(`no annotation at ${index}`);
          expect(got.onsetTicks).toBe(want.onsetTicks);
          expect(got.durationTicks).toBe(want.durationTicks);
          expect(got.text).toBe(want.text);
          expect(got.recordIndex).toBe(0);
          expect(got.signalIndex).toBe(1);
          expect(got.textEncoding).toBe('utf-8');
          expect(got.onsetSecondsFromFirstRecord).toBe(got.onsetSecondsFromHeaderStart);
        });

        // A negative onset is normal for a pre-stimulus event and is info, not a defect; nothing
        // else may be reported for a file this well formed.
        expect(
          result.diagnostics
            .map((diagnostic) => diagnostic.code)
            .filter((code) => code !== 'NEGATIVE_ANNOTATION_ONSET'),
        ).toEqual([]);
      }),
      { seed: SEEDS.annotations, numRuns: RUNS },
    );
  });
});
