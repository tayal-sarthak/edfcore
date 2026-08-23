/**
 * Header prefetch and record-range translation.
 *
 * Layer 6. Nothing here interprets a byte: this module decides WHICH bytes to ask a `ByteSource`
 * for, and hands them to the pure layer unchanged. Two rules are the whole file.
 *
 * 1. A header costs exactly TWO source reads — 256 bytes to learn the signal count, then the
 *    remaining `256 * ns` as one range. Never one read per signal block, and never a speculative
 *    read of a size the file has not stated.
 * 2. The unit of I/O is the RECORD RANGE, never the channel range. `readRecordBytes` issues one
 *    contiguous read covering every signal over the requested records, and de-interleaving
 *    happens in memory afterwards. There is no cheap single-channel read in EDF — ten seconds of
 *    one channel out of thirty is a 27x overread spread over ten requests, against a single
 *    153,600-byte read for all thirty — and this API says so instead of hiding it.
 *
 * The exact-length contract is re-verified here even though every bundled adapter already checks
 * it, because a `ByteSource` may be the caller's own and a silently short read is
 * indistinguishable from a truncated file.
 */

import { parseEdfInteger } from '../bytes/numbers.js';
import { readAsciiField } from '../bytes/view.js';
import { EDF_HEADER_BLOCK_BYTES, EDF_MAX_SIGNAL_COUNT, HEADER_FIELDS } from '../constants.js';
import { EdfBudgetError, EdfRangeError } from '../errors.js';
import { parseHeader } from '../header/parse.js';
import { resolveMaterializeBudget } from '../options.js';
import type { ByteSource, EdfHeader, OpenOptions, ReadOptions, RecordRange } from '../types.js';
import { assertExactRead } from './source.js';

/**
 * The signal count, read leniently and reported to nobody.
 *
 * This is a PREFETCH HINT and nothing else: it decides how many bytes the second read asks for.
 * Every judgement about the field — the 1..9999 range, the layout, which diagnostic a bad value
 * deserves and in which order — belongs to `header/parse.ts`, which owns the pinned check order.
 * Returning `undefined` here simply means the second read is skipped and `parseHeader` gets the
 * 256 bytes we have, so it can produce the right error rather than this module guessing at one.
 */
function signalCountHint(fixedHeader: Uint8Array): number | undefined {
  if (fixedHeader.length < EDF_HEADER_BLOCK_BYTES) return undefined;
  const { offset, length } = HEADER_FIELDS.signalCount;
  const parse = parseEdfInteger(readAsciiField(fixedHeader, offset, length));
  if (!parse.ok || parse.value < 1 || parse.value > EDF_MAX_SIGNAL_COUNT) return undefined;
  return parse.value;
}

/**
 * Parse the header of `source`, reading it in exactly two ranges.
 *
 * Both reads are clamped to the source length so that a file too short for the header it declares
 * reaches `parseHeader` and is reported as `SOURCE_TOO_SMALL` — a file defect — instead of
 * surfacing as an `EdfSourceError` about a range past the end, which would blame the source for
 * the file's problem.
 */
export async function readHeader(source: ByteSource, options?: OpenOptions): Promise<EdfHeader> {
  const sourceByteLength = source.byteLength;
  const firstLength = Math.min(EDF_HEADER_BLOCK_BYTES, sourceByteLength);
  const fixedHeader = assertExactRead(await source.read(0, firstLength, options), 0, firstLength);

  const signalCount = signalCountHint(fixedHeader);
  if (signalCount === undefined) return parseHeader(fixedHeader, sourceByteLength, options);

  const headerByteLength = EDF_HEADER_BLOCK_BYTES * (signalCount + 1);
  const remaining = Math.min(headerByteLength, sourceByteLength) - firstLength;
  if (remaining <= 0) return parseHeader(fixedHeader, sourceByteLength, options);

  const rest = assertExactRead(
    await source.read(firstLength, remaining, options),
    firstLength,
    remaining,
  );

  // One contiguous buffer, because `parseHeader` addresses per-signal fields by absolute offset.
  // At most 256 * 10000 bytes, so this allocation needs no budget of its own.
  const headerBytes = new Uint8Array(firstLength + remaining);
  headerBytes.set(fixedHeader, 0);
  headerBytes.set(rest, firstLength);
  return parseHeader(headerBytes, sourceByteLength, options);
}

function describeRange(range: RecordRange): string {
  return `{ start: ${range.start}, count: ${range.count} }`;
}

function assertRecordRange(header: EdfHeader, records: RecordRange): void {
  const available: RecordRange = { start: 0, count: header.recordCount };
  /*
   * Read off a stand-in when there is no range at all.
   *
   * `records` is typed, and the type is not the only way in: a selection built from JSON, from a
   * config file or from a JavaScript call site arrives at run time. Every wrong SHAPE already
   * reached the message below — an array, a string and `{ start: 0 }` all read as
   * `{ start: undefined, count: undefined }` and are refused with a next step — while `undefined`
   * and `null` threw `TypeError: Cannot read properties of undefined (reading 'start')` from the
   * two lines under this one, which names neither the option nor anything to do about it
   * (fixed in 0.4.443).
   */
  const range: RecordRange = records ?? ({} as RecordRange);
  const startValid = Number.isSafeInteger(range.start) && range.start >= 0;
  const countValid = Number.isSafeInteger(range.count) && range.count >= 0;
  if (startValid && countValid && range.start + range.count <= header.recordCount) return;
  throw new EdfRangeError(
    `records ${describeRange(range)} is not inside the ` +
      `${header.recordCount} data records this file contains. Next: clamp the range against ` +
      'header.recordCount, or call index.locate(seconds) to find a record index for a time.',
    { requested: range, available },
  );
}

/**
 * Refused BEFORE the allocation, never during it.
 *
 * A record range is the one read in edfcore whose size the caller controls directly, so it is the
 * one that can take a browser tab down by honest arithmetic. A typed error naming both numbers
 * beats an out-of-memory crash with no attribution.
 */
function assertWithinBudget(
  requiredBytes: number,
  records: RecordRange,
  options?: ReadOptions,
): void {
  const budgetBytes = resolveMaterializeBudget(options?.maxMaterializeBytes);
  if (requiredBytes <= budgetBytes) return;
  throw new EdfBudgetError(
    `Reading records ${describeRange(records)} needs a ${requiredBytes}-byte buffer, above the ` +
      `${budgetBytes}-byte maxMaterializeBytes budget, so the read was refused before anything ` +
      'was allocated. Next: read fewer records per call, or raise options.maxMaterializeBytes.',
    { requiredBytes, budgetBytes },
  );
}

/**
 * The bytes of a record range: ONE contiguous read covering every signal.
 *
 * The returned buffer is exactly `records.count * header.recordByteLength` bytes and begins at
 * record `records.start`, which is precisely what `decodeDigital` and `decodeAnnotations` demand
 * — pass it to them unsliced.
 *
 * A zero-record range issues no read at all. A zero-length HTTP range is not expressible (`bytes=
 * n--1`), and there is nothing to fetch, so returning the empty buffer is both cheaper and more
 * honest than asking for it.
 */
export async function readRecordBytes(
  source: ByteSource,
  header: EdfHeader,
  records: RecordRange,
  options?: ReadOptions,
): Promise<Uint8Array> {
  assertRecordRange(header, records);
  const byteLength = records.count * header.recordByteLength;
  if (byteLength === 0) return new Uint8Array(0);

  assertWithinBudget(byteLength, records, options);
  const byteOffset = header.headerByteLength + records.start * header.recordByteLength;
  return assertExactRead(
    await source.read(byteOffset, byteLength, options),
    byteOffset,
    byteLength,
  );
}
