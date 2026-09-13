/**
 * De-interleaving and sign extension.
 *
 * Layer 3. Sole owner of turning record bytes into sample values: the 2- and 3-byte two's
 * complement expressions exist here and nowhere else in edfcore.
 *
 * Bitwise operators appear in this file and are correct here — a sample is 16 or 24 bits, so
 * `|` and `<<` are exact on it. They are never applied to an OFFSET: a data offset in a
 * multi-gigabyte BDF routinely exceeds 2^31, where every bitwise operator silently wraps it
 * negative. Every offset below is plain arithmetic, exact to 2^53.
 */

import { isByteArray } from '../bytes/latin1.js';
import { EdfBudgetError, EdfChannelNotFoundError, EdfRangeError } from '../errors.js';
import { resolveMaterializeBudget } from '../options.js';
import { pluralise } from '../text/counted.js';
import { describeRecordRange, describeValue } from '../text/describe.js';
import type { EdfHeader, EdfSignal, RecordRange } from '../types.js';

const BYTES_PER_INT32 = 4;

/**
 * The allocation ceiling for a decode that has to allocate.
 *
 * A trailing optional argument on functions whose signature is otherwise fixed by the public
 * API, so passing nothing keeps the documented call shape and the 256 MiB default.
 */
export interface MaterializeOptions {
  readonly maxMaterializeBytes?: number;
}

/**
 * Samples, plus what was noticed about them on the way past. The out-of-range tally rides along
 * because the decode loop is already visiting every sample — counting it here costs nothing,
 * where asking for it afterwards would be a second pass over the whole array.
 */
export interface DecodedDigital {
  readonly digital: Int32Array;
  /**
   * Samples outside the DECLARED digital range, counted in the same pass that decodes them so
   * `EdfChunkSignal.outOfDigitalRangeCount` costs nothing. edfcore never clamps: a non-zero
   * count means the declared range is wrong, not that the samples are.
   */
  readonly outOfDigitalRangeCount: number;
}

/** Hoisted out of the two decode loops so neither reloads a property per sample. */
interface DeinterleavePlan {
  readonly recordCount: number;
  readonly recordByteLength: number;
  readonly recordByteOffset: number;
  readonly samplesPerRecord: number;
  readonly digitalLow: number;
  readonly digitalHigh: number;
}

function assertWithinBudget(
  requiredBytes: number,
  what: string,
  bytesPerSample: number,
  options: MaterializeOptions | undefined,
): void {
  const budgetBytes = resolveMaterializeBudget(options?.maxMaterializeBytes);
  if (requiredBytes <= budgetBytes) return;
  // How many DO fit. The caller is being asked to divide by a width this message knows and does
  // not print, from two numbers it does print.
  const fits = Math.floor(budgetBytes / bytesPerSample);
  const advice =
    fits > 0
      ? `decode at most ${fits} samples per call, reuse an \`out\` array, or raise options.maxMaterializeBytes.`
      : 'this budget does not fit one sample — reuse an `out` array, or raise options.maxMaterializeBytes.';
  throw new EdfBudgetError(
    `Decoding ${what} needs a ${requiredBytes}-byte array, above the ${budgetBytes}-byte ` +
      'maxMaterializeBytes budget, so the allocation was refused before it was attempted. ' +
      `Next: ${advice}`,
    { requiredBytes, budgetBytes },
  );
}

function signalAt(header: EdfHeader, signalIndex: number): EdfSignal {
  const signal = header.signals[signalIndex];
  if (signal !== undefined) return signal;
  throw new EdfChannelNotFoundError(
    `signalIndex ${signalIndex} is not one of the ${header.signals.length} signals in this ` +
      'header. Next: pass an index taken from header.signals, or resolve one with ' +
      'getSignal(header, label).',
    { selector: signalIndex, availableLabels: header.signals.map((s) => s.label) },
  );
}

/**
 * `recordBytes` must be exactly the requested records and nothing else.
 *
 * Both halves matter. The range check catches a caller asking for records the file does not
 * have; the length check catches a buffer that does not start where `records.start` says it
 * does — which is unrecoverable rather than merely wrong, because nothing in the bytes
 * identifies which record they came from.
 */
/**
 * The header and the record buffer, before either is measured against the other.
 *
 * Both decoders answer a size mismatch by stating the file's own geometry — "1 records of 716 bytes
 * each are exactly 716" — which is the right message and the wrong one to compute from an argument
 * nobody checked. A recording where the header belongs made it read "of this file is exactly NaN
 * bytes (1 x undefined)", and an `ArrayBuffer` where the bytes belong made it "recordBytes is
 * undefined bytes — NaN whole records". Both are sentences about the FILE with arithmetic nonsense
 * in them, from a caller's wrong argument (fixed in 0.6.122).
 *
 * Shared by `decodeAnnotations`, which is the other function that measures a record buffer against a
 * header and must refuse the same pair in the same words.
 */
export function assertDecodable(header: EdfHeader, recordBytes: Uint8Array, call: string): void {
  if (!Number.isSafeInteger((header as { recordByteLength?: unknown } | null)?.recordByteLength)) {
    throw new RangeError(
      `${call}(): that is not a header — it has no recordByteLength, so there is no record size ` +
        'to measure the buffer against. Next: pass recording.header.',
    );
  }
  if (!isByteArray(recordBytes)) {
    throw new RangeError(
      `${call}(): the record bytes are ${describeValue(recordBytes)}, not a Uint8Array. Next: ` +
        'pass what readRecordBytes(source, header, records) resolved to, unsliced.',
    );
  }
}

function assertRecordRange(header: EdfHeader, recordBytes: Uint8Array, records: RecordRange): void {
  const available: RecordRange = { start: 0, count: header.recordCount };
  const startValid = Number.isSafeInteger(records.start) && records.start >= 0;
  const countValid = Number.isSafeInteger(records.count) && records.count >= 0;
  if (!startValid || !countValid || records.start + records.count > header.recordCount) {
    throw new EdfRangeError(
      `records ${describeRecordRange(records)} is not inside the ` +
        `${header.recordCount} data records this file contains. Next: clamp the range against ` +
        'header.recordCount before decoding.',
      { requested: records, available },
    );
  }

  const expectedBytes = records.count * header.recordByteLength;
  if (recordBytes.length === expectedBytes) return;
  const wholeRecords =
    header.recordByteLength > 0 ? Math.floor(recordBytes.length / header.recordByteLength) : 0;
  throw new EdfRangeError(
    `recordBytes is ${pluralise(recordBytes.length, 'byte')} — ` +
      `${pluralise(wholeRecords, 'whole record')} — but ` +
      `${records.count} records of ${header.recordByteLength} bytes each are exactly ` +
      `${expectedBytes}. decodeDigital cannot tell which record a differently sized buffer ` +
      'begins at, so it will not guess. ' +
      'Next: pass the buffer returned by readRecordBytes(source, header, records) unmodified.',
    // `available` is the FILE's range — "what the file has, always starting at 0", which is what
    // `api-errors.md` documents and what the branch above passes. This one passed the buffer's
    // whole-record count based at `records.start`, so the same error class described two different
    // things and the documented recipe, `clampToFile(error.available)`, clamped against a range
    // the file never had. The byte counts are already stated exactly in the message above, so
    // nothing is lost (fixed in 0.3.80).
    { requested: records, available },
  );
}

/**
 * A plain `RangeError`, deliberately not `EdfRangeError`: a signal block that overflows its own
 * record means the header's offset arithmetic is inconsistent with its record size, which is an
 * edfcore bug or a hand-built header — never the caller asking for something reasonable.
 */
function assertSignalFitsRecord(header: EdfHeader, signal: EdfSignal, blockBytes: number): void {
  if (signal.recordByteOffset + blockBytes <= header.recordByteLength) return;
  throw new RangeError(
    `signal ${signal.index} occupies bytes [${signal.recordByteOffset}, ` +
      `${signal.recordByteOffset + blockBytes}) of a ${header.recordByteLength}-byte record, ` +
      'which does not fit. The header this was called with is internally inconsistent. Next: if ' +
      'it came from parseHeader() rather than being built by hand, report it as a bug.',
  );
}

/**
 * The destination for `sampleCount` samples: `out` when it is large enough, otherwise a fresh
 * array checked against the budget first.
 *
 * A longer `out` is narrowed with `subarray`, which shares its memory — the zero-allocation
 * path survives — while keeping `result.length` equal to the true sample count, so no caller
 * can mistake spare capacity for data.
 */
/**
 * The KIND of a reused `out` array, which none of the three resolvers that take one checked.
 *
 * Every one of them tested the LENGTH and then wrote through it, so an array of the wrong kind
 * passed. `toPhysical(signal, digital, new Int32Array(n))` is the one that costs data: the
 * physical values are written into an integer array, which truncates every one of them, and for a
 * bit value below 1 — which is most EEG channels in microvolts — the result is a buffer of zeros
 * returned as if it were the signal. Nothing said so.
 *
 * The other two return the array they were given, so the caller got back something other than the
 * `Int32Array` their signatures promise.
 *
 * `Object.prototype.toString`, not `instanceof`: a typed array from another realm is still the
 * right kind, and `a-clone-forgets-the-class.test.ts` is about exactly that distinction.
 */
export function assertOutKind(
  out: unknown,
  kind: string,
  call: string,
  because: string,
  /*
   * What the rejected value is CALLED at the call site, because for one of the four resolvers it
   * is not `out`.
   *
   * `toPhysicalEnvelope` takes a PAIR — `{ min, max }` — and checks each side with this helper, so
   * an object carrying only `min` was refused with "out is undefined, not a Float64Array" to a
   * caller who plainly passed an object. The clause after the dash already said `out.max`, so one
   * sentence named two different things and only the second was true; the test that fixed the
   * dereference in 0.6.144 is titled "names a missing max rather than dereferencing it" and could
   * only assert `out is undefined`.
   *
   * Defaulted, so the three single-array resolvers say exactly what they said before.
   */
  subject = 'out',
): void {
  if (Object.prototype.toString.call(out) === `[object ${kind}]`) return;
  const article = kind.startsWith('I') ? 'an' : 'a';
  throw new RangeError(
    `${call}(): ${subject} is ${describeValue(out)}, not ${article} ${kind} — ${because}. Next: ` +
      `pass ${article} ${kind} long enough for the samples, or omit out and let ${call}() ` +
      'allocate.',
  );
}

function resolveOut(
  out: Int32Array | undefined,
  sampleCount: number,
  options: MaterializeOptions | undefined,
): Int32Array {
  if (out === undefined) {
    assertWithinBudget(
      sampleCount * BYTES_PER_INT32,
      `${sampleCount} digital samples`,
      BYTES_PER_INT32,
      options,
    );
    return new Int32Array(sampleCount);
  }
  assertOutKind(
    out,
    'Int32Array',
    'decodeDigital',
    'and this call returns the array it is given, so a different kind would reach the caller in ' +
      'place of the Int32Array the signature promises',
  );
  if (out.length < sampleCount) {
    throw new RangeError(
      `out holds ${out.length} samples but this decode produces ${sampleCount}. Next: size the ` +
        'reused array to records.count * signal.samplesPerRecord, or omit it and let ' +
        'decodeDigital allocate.',
    );
  }
  return out.length === sampleCount ? out : out.subarray(0, sampleCount);
}

/** EDF: little-endian 16-bit two's complement. Returns the out-of-declared-range count. */
function decodeInt16(bytes: Uint8Array, out: Int32Array, plan: DeinterleavePlan): number {
  const { recordCount, recordByteLength, recordByteOffset, samplesPerRecord } = plan;
  const low = plan.digitalLow;
  const high = plan.digitalHigh;
  let outOfRange = 0;
  let write = 0;
  for (let r = 0; r < recordCount; r++) {
    const base = r * recordByteLength + recordByteOffset;
    for (let k = 0; k < samplesPerRecord; k++) {
      const p = base + k * 2;
      // In bounds by construction: assertRecordRange pinned bytes.length to
      // recordCount * recordByteLength, and assertSignalFitsRecord pinned this block inside a
      // record. A per-sample undefined check would cost more than the decode itself.
      // biome-ignore lint/style/noNonNullAssertion: bounds are established above.
      let value = bytes[p]! | (bytes[p + 1]! << 8);
      if (value & 0x8000) value -= 0x10000;
      if (value < low || value > high) outOfRange++;
      out[write] = value;
      write++;
    }
  }
  return outOfRange;
}

/** BDF: little-endian 24-bit two's complement, sign-extended from bit 23. */
function decodeInt24(bytes: Uint8Array, out: Int32Array, plan: DeinterleavePlan): number {
  const { recordCount, recordByteLength, recordByteOffset, samplesPerRecord } = plan;
  const low = plan.digitalLow;
  const high = plan.digitalHigh;
  let outOfRange = 0;
  let write = 0;
  for (let r = 0; r < recordCount; r++) {
    const base = r * recordByteLength + recordByteOffset;
    for (let k = 0; k < samplesPerRecord; k++) {
      const p = base + k * 3;
      // biome-ignore lint/style/noNonNullAssertion: see decodeInt16.
      let value = bytes[p]! | (bytes[p + 1]! << 8) | (bytes[p + 2]! << 16);
      if (value & 0x800000) value -= 0x1000000;
      if (value < low || value > high) outOfRange++;
      out[write] = value;
      write++;
    }
  }
  return outOfRange;
}

/**
 * Decode one signal out of a record range, with the out-of-declared-range tally.
 *
 * The count compares against `min`/`max` of the DECLARED digital minimum and maximum rather
 * than against the pair as written: an inverted declaration (`digitalMinimum > digitalMaximum`)
 * would otherwise report every sample in the file as out of range, which tells the caller
 * nothing about the samples.
 */
export function decodeDigitalCounted(
  header: EdfHeader,
  recordBytes: Uint8Array,
  records: RecordRange,
  signalIndex: number,
  out?: Int32Array,
  options?: MaterializeOptions,
): DecodedDigital {
  assertDecodable(header, recordBytes, 'decodeDigital');
  const signal = signalAt(header, signalIndex);
  assertRecordRange(header, recordBytes, records);

  const bytesPerSample = header.bytesPerSample;
  const samplesPerRecord = signal.samplesPerRecord;
  assertSignalFitsRecord(header, signal, samplesPerRecord * bytesPerSample);

  const sampleCount = records.count * samplesPerRecord;
  const digital = resolveOut(out, sampleCount, options);
  const plan: DeinterleavePlan = {
    recordCount: records.count,
    recordByteLength: header.recordByteLength,
    // `records.start` located the bytes; inside the buffer record 0 is at offset 0.
    recordByteOffset: signal.recordByteOffset,
    samplesPerRecord,
    digitalLow: Math.min(signal.digitalMinimum, signal.digitalMaximum),
    digitalHigh: Math.max(signal.digitalMinimum, signal.digitalMaximum),
  };

  const outOfDigitalRangeCount =
    bytesPerSample === 2
      ? decodeInt16(recordBytes, digital, plan)
      : decodeInt24(recordBytes, digital, plan);

  return { digital, outOfDigitalRangeCount };
}

/**
 * `recordBytes` must be exactly `records.count * header.recordByteLength` bytes and must begin
 * at record `records.start`; anything else throws `EdfRangeError`. `out` is reused when
 * supplied and long enough.
 *
 * The out-of-range tally reaches callers through `EdfChunkSignal.outOfDigitalRangeCount` — it is the same single
 * pass, so a caller never needs a second one to produce it.
 */
export function decodeDigital(
  header: EdfHeader,
  recordBytes: Uint8Array,
  records: RecordRange,
  signalIndex: number,
  out?: Int32Array,
  options?: MaterializeOptions,
): Int32Array {
  return decodeDigitalCounted(header, recordBytes, records, signalIndex, out, options).digital;
}
