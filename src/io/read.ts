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
 *    happens in memory afterwards. There is no cheap single-channel read in EDF. Ten seconds of
 *    ONE channel out of thirty at 256 Hz is the same 153,600-byte read as all thirty, of which
 *    5,120 bytes are the channel asked for: one request, 30x overread. The alternative collects
 *    the stripes a record at a time — ten requests of 512 bytes, no overread at all, and ten
 *    round trips instead of one. `large-files.md` works the same window through both. This said
 *    "a 27x overread spread over ten requests" until 0.6.73, which is neither strategy and
 *    neither number.
 *
 * The exact-length contract is re-verified here even though every bundled adapter already checks
 * it, because a `ByteSource` may be the caller's own and a silently short read is
 * indistinguishable from a truncated file.
 */

import { parseEdfInteger } from '../bytes/numbers.js';
import { readAsciiField } from '../bytes/view.js';
import { EDF_HEADER_BLOCK_BYTES, EDF_MAX_SIGNAL_COUNT, HEADER_FIELDS } from '../constants.js';
import { assertParseOptions } from '../diagnostics/collector.js';
import { EdfBudgetError, EdfRangeError } from '../errors.js';
import { parseHeader } from '../header/parse.js';
import { resolveMaterializeBudget } from '../options.js';
import { pluralise } from '../text/counted.js';
import { describeRecordRange } from '../text/describe.js';
import type { ByteSource, EdfHeader, OpenOptions, ReadOptions, RecordRange } from '../types.js';
import { assertByteSource, assertExactRead } from './source.js';

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
  // The refusal `openEdf` gives, in the two functions it is the convenience wrapper over.
  // `api-primitives.md` sends a reader who has outgrown the top layer to exactly these, and neither
  // checked its source: both read a field off it on their first line, so `readHeader(bytes)` — the
  // same mistake 0.4.444 named `openEdf(bytes)` for — came back as V8's `Cannot read properties of
  // undefined (reading 'byteLength')` (fixed in 0.6.105).
  assertByteSource(source);
  /*
   * Named for THIS call, before the first read is issued.
   *
   * `OpenOptions` carries both families, and `assertReadOptions` fires on the very first
   * `source.read` — so `openEdf(source, true)` was answered with a sentence about a byte budget
   * and a cancellation signal, when `strict` is the only boolean among these options and plainly
   * what a bare `true` meant (0.6.154).
   */
  assertParseOptions(options);
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
  /*
   * The CHUNK, which carries the range on `.records` rather than being it.
   *
   * `readAnnotations(edf, chunk.records)` is written out as the idiom in `recording.ts` — it is
   * the whole reason that call takes a range at all — and `readRecords(edf, records: chunk.records)`
   * is how the same records are re-read with a different signal selection. Both hand the caller a
   * chunk and ask for one field off it, so passing the chunk is the mistake this path invites, and
   * it is the only range guard in the package whose own documented recipe starts from one.
   *
   * A chunk has no `start` and no `count`, so it read as `{ start: undefined, count: undefined }`
   * and was refused with "is not inside the 6 data records this file contains" — a claim about a
   * range that was never named — followed by advice to clamp it against `header.recordCount`,
   * which no clamp can satisfy.
   *
   * Still an `EdfRangeError` carrying `requested` and `available`, so a handler written against
   * this guard branches the same way it always did.
   */
  if (typeof (records as { records?: unknown } | null | undefined)?.records === 'object') {
    throw new EdfRangeError(
      'that is a chunk, not a record range: a chunk carries its range on .records rather than ' +
        'being it, so no start and no count reached this call. Next: pass chunk.records, which ' +
        'is the range that chunk was read with.',
      { requested: range, available },
    );
  }
  /*
   * An ARRAY OF RANGES, which is what the call that maps a window to records returns.
   *
   * `resolveTimeWindow(timeline, index, from, span)` answers with one `RecordRange` per contiguous
   * run, and this takes one range — so `readAnnotations(edf, resolveTimeWindow(…))` is the pair a
   * caller writes when they have seconds and this call wants records. On a continuous file the
   * array holds exactly one element, which is what makes it read correctly.
   *
   * The comment above this guard has counted an array among the shapes that "are refused with a
   * next step" since 0.4.443, and by the generic message an array reads as
   * `{ start: undefined, count: undefined }` — refused for not being inside the file's records, then
   * told to clamp it. 0.6.167 and 0.6.170 each closed this same route one call over and recorded
   * what it costs: advice that sends a reader to fix fields on a value that has none.
   */
  if (Array.isArray(records)) {
    throw new EdfRangeError(
      'that is an array of record ranges, not one of them: resolveTimeWindow() answers with one ' +
        'range per contiguous run, and this call reads a single range. Next: pass one element of ' +
        'it — a continuous file gives exactly one — or call readWindow(), which takes the seconds ' +
        'directly and reads every run.',
      { requested: range, available },
    );
  }
  const startValid = Number.isSafeInteger(range.start) && range.start >= 0;
  const countValid = Number.isSafeInteger(range.count) && range.count >= 0;
  if (startValid && countValid && range.start + range.count <= header.recordCount) return;
  /*
   * A CLAMP is advice you can only follow when there are two numbers to clamp.
   *
   * The two branches above are each documented as a fix for this sentence, and both name the same
   * half of it: "advice to clamp it against `header.recordCount`, which no clamp can satisfy". Each
   * carved out one shape. Every other range with no numbers in it still got the clamp — the
   * `records ?? {}` stand-in at the top of this guard, which exists because `undefined` and `null`
   * are "the likeliest two"; a half-built `{ start: 0 }`; a range whose fields arrived as strings
   * from JSON.
   *
   * The belief behind writing one is the part no message addressed. `readRecords` refuses a missing
   * SELECTION with "pass { records, signalIndices }", and 0.6.88 refuses one carrying
   * `startSeconds` instead, so a selection holding only `signalIndices` passes both guards and
   * arrives here with nothing — written that way because the range reads as optional. It is not,
   * deliberately, and `readAnnotations` gives the reason: a full-file scan "is a legitimate thing to
   * want and an expensive thing to do by accident, so it is always visible in the caller's source".
   * So the advice for a range with no numbers is the range itself, counted for this file.
   *
   * Only the advice differs. The sentence naming the range and the file's record count is what
   * every caller of this guard is pinned on, and it is true of both.
   */
  const clampable = typeof range.start === 'number' && typeof range.count === 'number';
  throw new EdfRangeError(
    `records ${describeRecordRange(range)} is not inside the ` +
      `${header.recordCount} data records this file contains. Next: ` +
      (clampable
        ? 'clamp the range against header.recordCount, or call index.locate(seconds) to find a ' +
          'record index for a time.'
        : 'pass a start and a count — there is no default, so a whole-file read is written out ' +
          `rather than implied, and here that is start 0, count ${header.recordCount}. Or call ` +
          'readWindow(), which takes seconds and resolves the records itself.'),
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
  /*
   * How many records DO fit, rather than "fewer".
   *
   * A caller told to read fewer records has to work out the record size, divide, and floor —
   * from two numbers this message already prints and one it does not. The arithmetic is
   * `requiredBytes / records.count` per record, exactly, because that is how `requiredBytes` was
   * computed one line up.
   *
   * A count of zero cannot reach here: it needs no bytes, so it is never above the budget.
   */
  const perRecord = requiredBytes / records.count;
  const fits = Math.floor(budgetBytes / perRecord);
  const advice =
    fits > 0
      ? `read at most ${pluralise(fits, 'record')} per call, or raise options.maxMaterializeBytes.`
      : `one record of this file needs ${perRecord} bytes, so no count fits — raise options.maxMaterializeBytes.`;
  throw new EdfBudgetError(
    `Reading records ${describeRecordRange(records)} needs a ${requiredBytes}-byte buffer, above the ` +
      `${budgetBytes}-byte maxMaterializeBytes budget, so the read was refused before anything ` +
      `was allocated. Next: ${advice}`,
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
  assertByteSource(source);
  /*
   * The HEADER, before the range is measured against it.
   *
   * `assertRecordRange` reads `header.recordCount` and prints it, so a wrong header put the blame
   * on the argument that was right: `readRecordBytes(source, recording, records)` — the recording
   * being the object the source came off — answered `records { start: 0, count: 1 } is not inside
   * the undefined data records this file contains`, and told the caller to clamp a range that was
   * already inside the file. A chunk gave the same sentence.
   *
   * The timeline is worse and reaches further. It HAS a `recordCount`, so the range check passes
   * and `records.count * header.recordByteLength` is `NaN` — reported as an `EdfBudgetError`,
   * "needs a NaN-byte buffer, above the 268435456-byte maxMaterializeBytes budget", advising a
   * smaller read. An `EdfError`, so `isEdfError` sent a caller mistake down the file-or-budget
   * branch, which is the one distinction `errors.ts` exists to keep.
   *
   * `recordByteLength` is the field to test: it is the one this function multiplies by, and
   * `decode/digital.ts` already names it for the same reason.
   */
  if (
    !Number.isInteger(
      (header as { recordByteLength?: unknown } | null | undefined)?.recordByteLength,
    )
  ) {
    throw new RangeError(
      'readRecordBytes(): that is not a header — it has no recordByteLength, which is the record ' +
        'size every offset and length below is measured in. Next: pass recording.header, or what ' +
        'parseHeader(bytes, sourceByteLength) returned.',
    );
  }
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
