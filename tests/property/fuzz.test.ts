/**
 * The safety property, stated once:
 *
 *   FOR ANY BYTE SEQUENCE, edfcore either parses it or throws an `EdfError`. It never hangs, never
 *   allocates unboundedly, never returns NaN, and never returns believable garbage.
 *
 * Everything in this file is one instance of that sentence. The generators differ — flipped bits
 * in a valid file, uniformly random bytes, EDF-shaped noise, every truncation of a real file,
 * hostile numeric field text — but the assertion is always the same three clauses:
 *
 * 1. THROWS OR PARSES. Every call below passes arguments that are valid by construction, so the
 *    caller-error paths (`parseHeader`'s `sourceByteLength` guard, `decodeDigital`'s `out` sizing,
 *    an annotation index that is not an annotation signal) are unreachable. Anything thrown that
 *    is not an `EdfError` is therefore a leak: a bare `TypeError`, an "undefined is not a
 *    function", or a `RangeError` out of an allocation are all failures, not tolerated outcomes.
 * 2. BOUNDED. Each case runs under a wall-clock budget, so pathological slowness fails the test
 *    instead of stalling CI.
 * 3. NO BELIEVABLE GARBAGE. When a parse SUCCEEDS, no number edfcore computed may be NaN or
 *    infinite, and no decoded sample or physical value may be either. This is the clause the
 *    library exists for: a wrong number that looks like a number is worse than a refusal.
 *
 * Seeds are constants so any counterexample is reproducible, and a violation is reported with the
 * full byte sequence so it can be pasted straight into a permanent regression fixture.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../src/decode/digital.js';
import { toPhysical } from '../../src/decode/physical.js';
import { isEdfError } from '../../src/errors.js';
import { parseHeader } from '../../src/header/parse.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import type { EdfHeader } from '../../src/types.js';
import { flipBit, setHeaderField, setSignalField, truncate } from '../support/corrupt.js';
import { buildEdf } from '../support/writer.js';

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

const SEEDS = {
  bitFlipHeader: 0x5afe0001,
  bitFlipOpen: 0x5afe0002,
  randomHeader: 0x5afe0003,
  randomOpen: 0x5afe0004,
  shapedNoise: 0x5afe0005,
  scalingFields: 0x5afe0006,
  geometryFields: 0x5afe0007,
} as const;

const RUNS = 400;

/**
 * A synchronous JavaScript loop cannot be interrupted from the outside, so this budget catches
 * the realistic shape of a "hang" here — a quadratic or unbounded scan over a corrupt region that
 * still terminates — and vitest's own per-test timeout catches a truly infinite one. Every fixture
 * below is at most a few kilobytes, so a well-behaved parse is sub-millisecond and this ceiling is
 * three orders of magnitude of headroom rather than a tight fit.
 */
const CASE_BUDGET_MS = 500;

/** Enough records to exercise de-interleaving without letting a fuzzed geometry set the cost. */
const MAX_FUZZ_RECORDS = 64;

// ---------------------------------------------------------------------------
// Reporting: a violation has to be pasteable as a regression fixture
// ---------------------------------------------------------------------------

const HEX_PREVIEW_BYTES = 2048;

function hexDump(bytes: Uint8Array): string {
  const shown = bytes.subarray(0, HEX_PREVIEW_BYTES);
  const hex = Array.from(shown, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
  return bytes.length > shown.length
    ? `${bytes.length} bytes, first ${HEX_PREVIEW_BYTES}: ${hex}`
    : `${bytes.length} bytes: ${hex}`;
}

function violation(what: string, bytes: Uint8Array, detail: string, cause?: unknown): Error {
  return new Error(
    `SAFETY PROPERTY VIOLATED by ${what}: ${detail}\nRegression fixture — ${hexDump(bytes)}`,
    cause === undefined ? undefined : { cause },
  );
}

function describeThrown(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return `a thrown ${typeof error}: ${String(error)}`;
}

/** Clause 1. `EdfError` is the only acceptable outcome other than a successful parse. */
function requireEdfError(error: unknown, what: string, bytes: Uint8Array): void {
  if (isEdfError(error)) return;
  throw violation(
    what,
    bytes,
    `it threw ${describeThrown(error)}, which is not an EdfError. This call site passes ` +
      'arguments that are valid by construction, so no caller-error path can be reached and ' +
      'anything other than an EdfError escapes the error model in DESIGN section 6.',
    error,
  );
}

/** Clause 2, for synchronous work. */
function withinBudget<T>(what: string, bytes: Uint8Array, run: () => T): T {
  const started = Date.now();
  const result = run();
  const elapsed = Date.now() - started;
  if (elapsed > CASE_BUDGET_MS) {
    throw violation(what, bytes, `it took ${elapsed} ms, above the ${CASE_BUDGET_MS} ms budget`);
  }
  return result;
}

/** Clause 2, for the async I/O path. */
async function withinBudgetAsync<T>(
  what: string,
  bytes: Uint8Array,
  run: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  const result = await run();
  const elapsed = Date.now() - started;
  if (elapsed > CASE_BUDGET_MS) {
    throw violation(what, bytes, `it took ${elapsed} ms, above the ${CASE_BUDGET_MS} ms budget`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Clause 3: no NaN, no Infinity, no believable garbage
// ---------------------------------------------------------------------------

function requireFinite(
  what: string,
  bytes: Uint8Array,
  field: string,
  value: number | undefined,
): void {
  if (value !== undefined && Number.isFinite(value)) return;
  throw violation(what, bytes, `the parse succeeded but header.${field} is ${String(value)}`);
}

/**
 * Every number `parseHeader` COMPUTED, checked for being a real number.
 *
 * `declaredHeaderByteLength` and `declaredRecordCount` are deliberately excluded and deliberately
 * NOT asserted finite: `readNumericField` in `src/header/fields.ts` returns NaN for either when
 * the file's own field could not be read, precisely so the header never claims a size or a count
 * the file did not state. They are evidence about the bytes, not values edfcore computes with —
 * and everything derived from them (`headerByteLength`, `recordCount`) is required to be real.
 */
function requireNoGarbage(header: EdfHeader, bytes: Uint8Array, what: string): void {
  requireFinite(what, bytes, 'headerByteLength', header.headerByteLength);
  requireFinite(what, bytes, 'recordByteLength', header.recordByteLength);
  requireFinite(what, bytes, 'dataByteLength', header.dataByteLength);
  requireFinite(what, bytes, 'recordCount', header.recordCount);
  requireFinite(what, bytes, 'recordDurationSeconds', header.recordDurationSeconds);
  requireFinite(
    what,
    bytes,
    'startTime.secondsSinceMidnight',
    header.startTime.secondsSinceMidnight,
  );

  if (header.recordCount < 0 || !Number.isSafeInteger(header.recordCount)) {
    throw violation(what, bytes, `the parse succeeded but recordCount is ${header.recordCount}`);
  }

  for (const signal of header.signals) {
    const at = `signals[${signal.index}]`;
    requireFinite(what, bytes, `${at}.physicalMinimum`, signal.physicalMinimum);
    requireFinite(what, bytes, `${at}.physicalMaximum`, signal.physicalMaximum);
    requireFinite(what, bytes, `${at}.digitalMinimum`, signal.digitalMinimum);
    requireFinite(what, bytes, `${at}.digitalMaximum`, signal.digitalMaximum);
    requireFinite(what, bytes, `${at}.samplesPerRecord`, signal.samplesPerRecord);
    requireFinite(what, bytes, `${at}.sampleCount`, signal.sampleCount);
    requireFinite(what, bytes, `${at}.recordByteOffset`, signal.recordByteOffset);
    requireFinite(what, bytes, `${at}.recordByteLength`, signal.recordByteLength);

    // `undefined` exactly when the record duration is 0 (which is legal); otherwise a real rate.
    if (signal.sampleRateHz !== undefined) {
      requireFinite(what, bytes, `${at}.sampleRateHz`, signal.sampleRateHz);
    }

    // `scale: undefined` is the sanctioned refusal (DESIGN section 6, deferred-fatal). A scale
    // that EXISTS must define a usable gain: a zero `bitValue` or an infinite `offset` makes
    // `bitValue * (offset + digital)` NaN for every sample in the channel, which is the
    // believable-garbage outcome the whole library is built to refuse.
    const scale = signal.scale;
    if (scale === undefined) continue;
    requireFinite(what, bytes, `${at}.scale.bitValue`, scale.bitValue);
    requireFinite(what, bytes, `${at}.scale.offset`, scale.offset);
    if (scale.bitValue === 0) {
      throw violation(
        what,
        bytes,
        `the parse succeeded but ${at}.scale.bitValue is 0, so toPhysical() maps every sample ` +
          `to 0 regardless of its value (physical range ${signal.raw.physicalMinimum.trim()}..` +
          `${signal.raw.physicalMaximum.trim()}, digital range ` +
          `${signal.raw.digitalMinimum.trim()}..${signal.raw.digitalMaximum.trim()})`,
      );
    }
  }
}

/**
 * Decode what the header says is there, and require every number that comes out to be real.
 *
 * The record range is clamped to `MAX_FUZZ_RECORDS` so a fuzzed geometry cannot decide how much
 * work this does; `header.recordCount` is already resolved against the true byte length, so the
 * slice below always exists.
 */
function requireNoGarbageSamples(header: EdfHeader, bytes: Uint8Array, what: string): void {
  const count = Math.min(header.recordCount, MAX_FUZZ_RECORDS);
  if (count === 0 || header.recordByteLength === 0) return;
  const start = header.headerByteLength;
  const recordBytes = bytes.subarray(start, start + count * header.recordByteLength);
  if (recordBytes.length !== count * header.recordByteLength) {
    throw violation(
      what,
      bytes,
      `header.recordCount is ${header.recordCount} records of ${header.recordByteLength} bytes ` +
        `from offset ${start}, but the source only holds ${bytes.length} bytes`,
    );
  }

  const records = { start: 0, count };
  for (const index of header.dataSignalIndices) {
    const signal = header.signals[index];
    if (signal === undefined) continue;

    const digital = decodeDigital(header, recordBytes, records, index);
    for (let i = 0; i < digital.length; i += 1) {
      const value = digital[i];
      if (value === undefined || !Number.isInteger(value)) {
        throw violation(what, bytes, `digital sample ${i} of signal ${index} is ${String(value)}`);
      }
    }

    if (signal.scale === undefined) continue;
    const physical = toPhysical(signal, digital);
    const low = Math.min(signal.digitalMinimum, signal.digitalMaximum);
    const high = Math.max(signal.digitalMinimum, signal.digitalMaximum);
    for (let i = 0; i < physical.length; i += 1) {
      const value = physical[i];
      const sample = digital[i] ?? Number.NaN;
      // NaN is never acceptable: it can only come from a scale that does not define a gain.
      // +/-Infinity for a sample OUTSIDE the declared digital range is a different thing and is
      // honest — edfcore never clamps on read and the affine map extrapolates (DESIGN section 2,
      // "Clamping"), so a header declaring a 1e308-wide physical range over two digital counts
      // really does put an out-of-range sample past float64. Inside the declared range the value
      // lies between two finite physical bounds, so there it must be finite.
      const acceptable =
        value !== undefined &&
        !Number.isNaN(value) &&
        (Number.isFinite(value) || sample < low || sample > high);
      if (acceptable) continue;
      throw violation(
        what,
        bytes,
        `physical value ${i} of signal ${index} ("${signal.label}") is ${String(value)} for ` +
          `digital sample ${sample}, which is inside the declared range ${low}..${high}; its ` +
          `scale is bitValue ${signal.scale.bitValue}, offset ${signal.scale.offset}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// The two entry points under test
// ---------------------------------------------------------------------------

function fuzzParseHeader(bytes: Uint8Array, what: string): void {
  const header = withinBudget(what, bytes, () => {
    try {
      // `bytes.byteLength` is exactly what the doc comment asks for, so the RangeError guard on
      // `sourceByteLength` cannot fire and every throw below is about the file.
      return parseHeader(bytes, bytes.byteLength);
    } catch (error) {
      requireEdfError(error, what, bytes);
      return undefined;
    }
  });
  if (header === undefined) return;
  requireNoGarbage(header, bytes, what);
  requireNoGarbageSamples(header, bytes, what);
}

async function fuzzOpenEdf(bytes: Uint8Array, what: string): Promise<void> {
  await withinBudgetAsync(what, bytes, async () => {
    try {
      const recording = await openEdf(byteSource(bytes));
      requireNoGarbage(recording.header, bytes, what);

      const timeline = recording.timeline;
      for (const [field, value] of [
        ['spanSeconds', timeline.spanSeconds],
        ['coveredSeconds', timeline.coveredSeconds],
        ['startOffsetSeconds', timeline.startOffsetSeconds],
      ] as const) {
        if (!Number.isFinite(value)) {
          throw violation(what, bytes, `the file opened but timeline.${field} is ${String(value)}`);
        }
      }

      const count = Math.min(recording.header.recordCount, MAX_FUZZ_RECORDS);
      const signalIndices = recording.header.dataSignalIndices;
      if (count === 0 || signalIndices.length === 0) return;
      const chunk = await readRecords(recording, { records: { start: 0, count }, signalIndices });
      for (const chunkSignal of chunk.signals) {
        for (let i = 0; i < chunkSignal.digital.length; i += 1) {
          const value = chunkSignal.digital[i];
          if (value === undefined || !Number.isInteger(value)) {
            throw violation(
              what,
              bytes,
              `sample ${i} of signal ${chunkSignal.signalIndex} is ${String(value)}`,
            );
          }
        }
      }
      if (!Number.isFinite(chunk.startSeconds) || !Number.isFinite(chunk.durationSeconds)) {
        throw violation(
          what,
          bytes,
          `the chunk reports startSeconds ${chunk.startSeconds} and durationSeconds ` +
            `${chunk.durationSeconds}`,
        );
      }
    } catch (error) {
      // A violation this function raised is already the right error; only a foreign throw is
      // classified here.
      if (error instanceof Error && error.message.startsWith('SAFETY PROPERTY VIOLATED'))
        throw error;
      requireEdfError(error, what, bytes);
    }
  });
}

// ---------------------------------------------------------------------------
// Fixtures the fuzzers start from
// ---------------------------------------------------------------------------

/** A four-digit year is not clipped, so the base files carry no diagnostics of their own. */
const CLEAN_START_DATE = '1.1.2020';

const EDF_PLUS_BASE = buildEdf({
  plus: 'C',
  recordCount: 3,
  recordDurationSeconds: 1,
  raw: { startDate: CLEAN_START_DATE },
  signals: [
    { label: 'Fp1', samplesPerRecord: 8 },
    // A negative amplifier gain, so the fuzzers also walk an inverted physical range.
    { label: 'Fp2', samplesPerRecord: 4, physicalMinimum: 500, physicalMaximum: -500 },
  ],
  annotationSignals: [{ samplesPerRecord: 24 }],
});

const BDF_PLUS_BASE = buildEdf({
  format: 'BDF',
  plus: 'D',
  recordCount: 3,
  recordDurationSeconds: 0.5,
  raw: { startDate: CLEAN_START_DATE },
  signals: [{ label: 'A1', samplesPerRecord: 6 }],
  annotationSignals: [{ samplesPerRecord: 24 }],
  recordOnsetSeconds: (recordIndex) => recordIndex * 10,
});

const PLAIN_EDF_BASE = buildEdf({
  recordCount: 4,
  recordDurationSeconds: 1,
  raw: { startDate: CLEAN_START_DATE },
  signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
});

const FUZZ_BASES: readonly Uint8Array[] = [EDF_PLUS_BASE, BDF_PLUS_BASE, PLAIN_EDF_BASE];

interface BitFlipPlan {
  readonly baseIndex: number;
  readonly flips: readonly (readonly [number, number])[];
}

const bitFlipPlan: fc.Arbitrary<BitFlipPlan> = fc.record({
  baseIndex: fc.nat({ max: FUZZ_BASES.length - 1 }),
  flips: fc.array(fc.tuple(fc.nat({ max: 0xffff }), fc.integer({ min: 0, max: 7 })), {
    minLength: 1,
    maxLength: 5,
  }),
});

function applyFlips(plan: BitFlipPlan): Uint8Array {
  const base = FUZZ_BASES[plan.baseIndex] ?? EDF_PLUS_BASE;
  let bytes = base;
  for (const [position, bit] of plan.flips) {
    bytes = flipBit(bytes, position % bytes.length, bit);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// 1. Seeded byte-flip fuzzing over a valid file
// ---------------------------------------------------------------------------

describe('byte-flip fuzzing over a valid file', () => {
  it('parseHeader either parses the flipped file or throws an EdfError', () => {
    fc.assert(
      fc.property(bitFlipPlan, (plan) => {
        fuzzParseHeader(applyFlips(plan), 'parseHeader on a bit-flipped file');
      }),
      { seed: SEEDS.bitFlipHeader, numRuns: RUNS },
    );
  });

  it('openEdf either opens the flipped file or rejects with an EdfError', async () => {
    await fc.assert(
      fc.asyncProperty(bitFlipPlan, async (plan) => {
        await fuzzOpenEdf(applyFlips(plan), 'openEdf on a bit-flipped file');
      }),
      { seed: SEEDS.bitFlipOpen, numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Completely random bytes
// ---------------------------------------------------------------------------

/**
 * 0 and 1 bytes are the empty-file and one-byte cases; 255/256/257 straddle the fixed header, and
 * 511/512/513 straddle `256 * (ns + 1)` for a one-signal file. DESIGN section 7 names exactly
 * these boundaries under "Structural".
 */
const RANDOM_LENGTHS: readonly number[] = [0, 1, 8, 255, 256, 257, 511, 512, 513];

const randomBytes: fc.Arbitrary<Uint8Array> = fc.oneof(
  ...RANDOM_LENGTHS.map((length) => fc.uint8Array({ minLength: length, maxLength: length })),
  fc.uint8Array({ minLength: 0, maxLength: 2048 }),
);

const EDF_VERSION_BLOCK = Uint8Array.from([0x30, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20]);
const BDF_VERSION_BLOCK = Uint8Array.from([
  0xff,
  ...Array.from('BIOSEMI', (character) => character.charCodeAt(0)),
]);

/**
 * Random bytes behind a VALID version block.
 *
 * Uniform noise is refused at byte 0 as `NOT_AN_EDF_FILE` essentially always, which tests one
 * branch very thoroughly and the other 250 not at all. Keeping the discriminator intact drives
 * the generator through signal-count validation, the field-major per-signal block, the record
 * geometry and the TAL scanner instead.
 */
const shapedNoise: fc.Arbitrary<Uint8Array> = fc
  .tuple(
    fc.constantFrom(EDF_VERSION_BLOCK, BDF_VERSION_BLOCK),
    fc.uint8Array({ minLength: 248, maxLength: 1400 }),
  )
  .map(([version, rest]) => {
    const out = new Uint8Array(version.length + rest.length);
    out.set(version, 0);
    out.set(rest, version.length);
    return out;
  });

describe('uniformly random bytes', () => {
  it('parseHeader never escapes the error model, at any length', () => {
    fc.assert(
      fc.property(randomBytes, (bytes) => {
        fuzzParseHeader(bytes, 'parseHeader on random bytes');
      }),
      { seed: SEEDS.randomHeader, numRuns: RUNS },
    );
  });

  it('openEdf never escapes the error model, at any length', async () => {
    await fc.assert(
      fc.asyncProperty(randomBytes, async (bytes) => {
        await fuzzOpenEdf(bytes, 'openEdf on random bytes');
      }),
      { seed: SEEDS.randomOpen, numRuns: RUNS },
    );
  });

  it('survives random bytes behind a valid version block, header and data alike', async () => {
    await fc.assert(
      fc.asyncProperty(shapedNoise, async (bytes) => {
        fuzzParseHeader(bytes, 'parseHeader on EDF-shaped noise');
        await fuzzOpenEdf(bytes, 'openEdf on EDF-shaped noise');
      }),
      { seed: SEEDS.shapedNoise, numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Truncation at every plausible boundary
// ---------------------------------------------------------------------------

describe('truncation fuzzing', () => {
  it('holds at every byte length of a valid file, exhaustively', async () => {
    // Exhaustive rather than sampled: these files are under a kilobyte, so every truncation is
    // reachable, and the interesting boundaries (mid fixed-header, mid per-signal block, mid
    // record, mid annotation region) are exactly the ones a sampler would thin out.
    for (const base of FUZZ_BASES) {
      for (let length = 0; length <= base.length; length += 1) {
        const bytes = truncate(base, length);
        fuzzParseHeader(bytes, `parseHeader on a file truncated to ${length} bytes`);
        await fuzzOpenEdf(bytes, `openEdf on a file truncated to ${length} bytes`);
      }
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 4. Hostile numeric field text
// ---------------------------------------------------------------------------

/**
 * Field text an 8-byte numeric field can actually hold, chosen to reach the edges of float64.
 *
 * DESIGN section 7 requires `"1E3"`, `"-1.23E-4"`, `"+22"` and `".5"` under "Numeric abuse", and
 * `parseEdfNumber` accepts the exponent form — which means an 8-byte field can name a subnormal
 * (`5E-324`) or a value whose range overflows to Infinity (`-9.9E307` against `9.9E307`). Those
 * are the two ways a *finite* pair of physical bounds can still fail to define a gain.
 */
const HOSTILE_NUMBERS: readonly string[] = [
  '5E-324',
  '-5E-324',
  '1E-320',
  '2e-308',
  '9.9E307',
  '-9.9E307',
  '1E308',
  '-1E308',
  '1E300',
  '1E3',
  '-1.23E-4',
  '+22',
  '.5',
  '0',
  '-0',
  '1',
  '-1',
  '99999999',
  '-9999999',
  '0.0',
  '1E-8',
  '1E8',
  '',
  '20 48',
];

const hostileFieldText: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...HOSTILE_NUMBERS),
  fc.string({
    unit: fc.constantFrom('0', '1', '9', '+', '-', '.', 'e', 'E', ' '),
    minLength: 0,
    maxLength: 8,
  }),
);

/** One data signal, one record: the smallest file whose scale is worth computing. */
const SCALING_BASE = buildEdf({
  recordCount: 1,
  recordDurationSeconds: 1,
  raw: { startDate: CLEAN_START_DATE },
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
});

describe('hostile numeric field text', () => {
  it('never yields a scale that turns samples into NaN', () => {
    const scalingPlan = fc.record({
      physicalMinimum: hostileFieldText,
      physicalMaximum: hostileFieldText,
      digitalMinimum: hostileFieldText,
      digitalMaximum: hostileFieldText,
    });

    fc.assert(
      fc.property(scalingPlan, (plan) => {
        let bytes = SCALING_BASE;
        bytes = setSignalField(bytes, 1, 0, 'physicalMinimum', plan.physicalMinimum);
        bytes = setSignalField(bytes, 1, 0, 'physicalMaximum', plan.physicalMaximum);
        bytes = setSignalField(bytes, 1, 0, 'digitalMinimum', plan.digitalMinimum);
        bytes = setSignalField(bytes, 1, 0, 'digitalMaximum', plan.digitalMaximum);
        fuzzParseHeader(bytes, 'parseHeader on hostile scaling fields');
      }),
      { seed: SEEDS.scalingFields, numRuns: RUNS },
    );
  });

  it('never escapes the error model through the fixed geometry fields', async () => {
    const geometryPlan = fc.record({
      field: fc.constantFrom('recordDuration' as const, 'recordCount' as const),
      text: hostileFieldText,
    });

    await fc.assert(
      fc.asyncProperty(geometryPlan, async (plan) => {
        const bytes = setHeaderField(SCALING_BASE, plan.field, plan.text);
        fuzzParseHeader(bytes, `parseHeader with ${plan.field} = ${JSON.stringify(plan.text)}`);
        await fuzzOpenEdf(bytes, `openEdf with ${plan.field} = ${JSON.stringify(plan.text)}`);
      }),
      { seed: SEEDS.geometryFields, numRuns: RUNS },
    );
  });

  it('refuses, rather than reports, a record duration no tick count can express', () => {
    // A duration near the float64 ceiling multiplied by 10^7 ticks per second overflows, and a
    // tick count that cannot exist is not something edfcore may report as a number.
    for (const text of ['9.9E307', '1E308', '1.7E308']) {
      const bytes = setHeaderField(SCALING_BASE, 'recordDuration', text);
      let thrown: unknown;
      let header: EdfHeader | undefined;
      try {
        header = parseHeader(bytes, bytes.byteLength);
      } catch (error) {
        thrown = error;
      }
      if (header !== undefined) {
        expect(Number.isFinite(header.recordDurationSeconds)).toBe(true);
        expect(typeof header.recordDurationTicks).toBe('bigint');
        continue;
      }
      expect(isEdfError(thrown), `${text} threw ${describeThrown(thrown)}`).toBe(true);
    }
  });
});
