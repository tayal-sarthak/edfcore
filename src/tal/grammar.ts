/**
 * The byte-level TAL state machine.
 *
 * Layer 3. Sole owner of turning ONE annotation region into time-stamped annotation lists.
 * `annotations.ts` adds provenance and EDF+ semantics on top; nothing here knows about records,
 * signals, or timekeeping.
 *
 * Two rules define the module, and both are where other EDF readers go wrong:
 *
 * 1. Parsing is HARD-BOUNDED to `[regionStart, regionStart + regionBytes)`. A TAL with no
 *    terminating 0x00 inside the region is discarded, never continued past the bound — the bytes
 *    after it are the next signal's samples, and parsing those is how a reader invents
 *    annotations that are not in the file.
 * 2. The region is split on the STRUCTURAL bytes (0x00, 0x14, 0x15) FIRST and each text run is
 *    decoded as UTF-8 LAST. That order is safe in exactly one direction: every byte of a
 *    multi-byte UTF-8 sequence is >= 0x80 and can never collide with a structural byte, while a
 *    string that has already been decoded can no longer be split on bytes at all.
 *
 * `src/tal/` is the only part of edfcore allowed to use `TextDecoder`, and only for annotation
 * text. Header bytes go through `decodeHeaderLatin1`, for the cross-runtime reason documented in
 * `src/bytes/latin1.ts`.
 *
 * Each defect is reported at most once per region, with an occurrence count: a corrupt region
 * can hold thousands of malformed TALs, and one diagnostic per TAL would be an unbounded
 * allocation dressed up as diligence. Nothing is hidden — `occurrences` says how many there were.
 */

import { decodeHeaderLatin1 } from '../bytes/latin1.js';
import { sliceBytes } from '../bytes/view.js';
import {
  TAL_FIELD_TERMINATOR,
  TAL_ONSET_DURATION_SEPARATOR,
  TAL_TERMINATOR,
} from '../constants.js';
import { parseSignedTicks, parseUnsignedTicks } from './ticks.js';

export type TalTextEncoding = 'utf-8' | 'latin-1-fallback';

/** One text run of a TAL: the bytes between two 0x14 separators, decoded. */
export interface TalText {
  /** Verbatim. Never trimmed, never case-folded, and a BOM is kept as a character. */
  readonly text: string;
  readonly encoding: TalTextEncoding;
  readonly byteOffsetInRegion: number;
  readonly byteLength: number;
}

/** The subset of the diagnostic vocabulary this module can observe. */
export type TalIssueCode =
  | 'TAL_MALFORMED'
  | 'TAL_TRUNCATED_AT_REGION_END'
  | 'TAL_REGION_NOT_NUL_TERMINATED'
  | 'ANNOTATION_TEXT_NOT_UTF8';

/**
 * One defect, described once per region.
 *
 * `detail` states what was wrong AND what was done about it, because the disposition differs
 * per defect: a missing onset sign keeps the annotation, a missing duration discards it.
 */
export interface TalIssue {
  readonly code: TalIssueCode;
  /** Of the first occurrence. Relative to the region start. */
  readonly byteOffsetInRegion: number;
  readonly byteLength: number;
  /** Occurrences in this region. Only the first is described. */
  readonly occurrences: number;
  readonly detail: string;
  /** The first occurrence's bytes, escaped and truncated, for the diagnostic message. */
  readonly raw: string;
}

/** One TAL that survived parsing. Times are exact ticks; the digits they came from are kept. */
export interface ParsedTal {
  /**
   * Position of this TAL in the region, counting the ones that were skipped. Timekeeping is a
   * property of TAL slot 0, so a record whose first TAL was malformed must not have its second
   * TAL promoted into the timekeeping role.
   */
  readonly ordinal: number;
  readonly byteOffsetInRegion: number;
  /** Includes the terminating 0x00. */
  readonly byteLength: number;
  readonly onsetRaw: string;
  readonly onsetTicks: bigint;
  readonly durationRaw: string | undefined;
  readonly durationTicks: bigint | undefined;
  readonly texts: readonly TalText[];
}

export interface TalRegionParse {
  readonly tals: readonly ParsedTal[];
  readonly issues: readonly TalIssue[];
}

/** The two halves of the EDF+ `description@@channel` convention. */
export interface TalTextParts {
  /** The description exactly as written, minus a trailing `@@channel` suffix. */
  readonly text: string;
  readonly channelLabel: string | undefined;
}

/** Caps the bytes copied into a diagnostic. The full region is one hexdump from `byteOffset`. */
export const TAL_PREVIEW_MAX_BYTES: number = 48;

/**
 * `recordOnsetTicks` is a `BigInt64Array`, and assigning an out-of-range bigint to one WRAPS
 * silently instead of throwing. A value that cannot round-trip through int64 is therefore
 * refused here rather than stored wrong. The bound is ~29,000 years, so nothing real is lost.
 */
const INT64_MIN: bigint = -(2n ** 63n);
const INT64_MAX: bigint = 2n ** 63n - 1n;

/**
 * An int64 tick count needs at most 19 digits, plus a sign, a point and 7 fractional digits.
 * The cap exists so a corrupt region of digits cannot drive quadratic bigint work: the digits
 * are counted before any bigint is built.
 */
const MAX_TIMESTAMP_FIELD_CHARS = 40;

const CHANNEL_LABEL_SEPARATOR = '@@';

const ASCII_HIGH_BIT = 0x80;
const ASCII_DEL = 0x7f;
const ASCII_FIRST_PRINTABLE = 0x20;

interface MutableTalIssue {
  code: TalIssueCode;
  byteOffsetInRegion: number;
  byteLength: number;
  occurrences: number;
  detail: string;
  raw: string;
}

type IssueLog = Map<TalIssueCode, MutableTalIssue>;

interface TalScan {
  readonly tal: ParsedTal | undefined;
  /** Where the next TAL slot begins. Always greater than the slot that produced it. */
  readonly next: number;
}

interface TextDecoderLike {
  decode(input: Uint8Array): string;
}

type TextDecoderConstructorLike = new (
  label: string,
  options: { fatal: boolean; ignoreBOM: boolean },
) => TextDecoderLike;

/** `undefined` = not looked up yet, `null` = this runtime has no `TextDecoder`. */
let cachedUtf8Decoder: TextDecoderLike | null | undefined;

/**
 * A strict UTF-8 decoder, or `null`.
 *
 * `fatal` is what makes invalid UTF-8 detectable at all; without it the decoder substitutes
 * U+FFFD and the file's bytes are gone. `ignoreBOM` keeps a leading U+FEFF as a character,
 * because annotation text is exposed verbatim and a silently stripped BOM is a silently changed
 * string. Every runtime edfcore supports has `TextDecoder`; the `null` branch exists so an
 * exotic one degrades to Latin-1 with a diagnostic instead of throwing.
 */
function utf8Decoder(): TextDecoderLike | null {
  if (cachedUtf8Decoder === undefined) {
    const Decoder = (globalThis as { TextDecoder?: TextDecoderConstructorLike }).TextDecoder;
    cachedUtf8Decoder =
      Decoder === undefined ? null : new Decoder('utf-8', { fatal: true, ignoreBOM: true });
  }
  return cachedUtf8Decoder;
}

/**
 * `noUncheckedIndexedAccess` types `region[i]` as `number | undefined`. -1 is not a byte value,
 * so every structural comparison below is simply false past the end of the region.
 */
function readByte(region: Uint8Array, index: number): number {
  return region[index] ?? -1;
}

function indexOfByte(region: Uint8Array, start: number, end: number, byte: number): number {
  for (let i = start; i < end; i += 1) {
    if (readByte(region, i) === byte) return i;
  }
  return -1;
}

function escapeControls(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    out +=
      code < ASCII_FIRST_PRINTABLE || code === ASCII_DEL
        ? `\\x${code.toString(16).padStart(2, '0')}`
        : text.charAt(i);
  }
  return out;
}

/**
 * Bytes as a short, escaped, single-line string for a diagnostic message.
 *
 * Latin-1 and not UTF-8 on purpose: this is evidence about bytes, so every byte must map to
 * exactly one visible character even when the run is the invalid UTF-8 being complained about.
 */
export function previewBytes(bytes: Uint8Array, offset: number, length: number): string {
  const shown = Math.min(length, TAL_PREVIEW_MAX_BYTES);
  const text = escapeControls(decodeHeaderLatin1(sliceBytes(bytes, offset, shown)));
  return length > shown ? `${text}...` : text;
}

function logIssue(
  log: IssueLog,
  code: TalIssueCode,
  region: Uint8Array,
  offset: number,
  length: number,
  detail: string,
): void {
  const existing = log.get(code);
  if (existing !== undefined) {
    existing.occurrences += 1;
    return;
  }
  log.set(code, {
    code,
    byteOffsetInRegion: offset,
    byteLength: length,
    occurrences: 1,
    detail,
    raw: previewBytes(region, offset, length),
  });
}

function isAsciiRun(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte >= ASCII_HIGH_BIT) return false;
  }
  return true;
}

function decodeTextRun(region: Uint8Array, start: number, length: number, log: IssueLog): TalText {
  const bytes = sliceBytes(region, start, length);

  // ASCII is UTF-8, byte for byte, and it is what almost every file contains. Taking it here
  // means the decoder is only ever built for text that actually needs one.
  if (isAsciiRun(bytes)) {
    return {
      text: decodeHeaderLatin1(bytes),
      encoding: 'utf-8',
      byteOffsetInRegion: start,
      byteLength: length,
    };
  }

  const decoder = utf8Decoder();
  if (decoder !== null) {
    try {
      return {
        text: decoder.decode(bytes),
        encoding: 'utf-8',
        byteOffsetInRegion: start,
        byteLength: length,
      };
    } catch {
      // A fatal decoder rejects invalid UTF-8 with a TypeError. Fall through to Latin-1.
    }
  }

  logIssue(
    log,
    'ANNOTATION_TEXT_NOT_UTF8',
    region,
    start,
    length,
    decoder === null
      ? 'this runtime has no TextDecoder, so the text run could not be verified as UTF-8 and ' +
          'was decoded as ISO-8859-1'
      : 'the text run is not valid UTF-8 and was decoded as ISO-8859-1 instead',
  );
  return {
    text: decodeHeaderLatin1(bytes),
    encoding: 'latin-1-fallback',
    byteOffsetInRegion: start,
    byteLength: length,
  };
}

function outsideInt64(ticks: bigint): boolean {
  return ticks < INT64_MIN || ticks > INT64_MAX;
}

/**
 * One TAL slot at `start`, which is known to hold a non-0x00 byte.
 *
 * Returns `tal: undefined` for a slot that was skipped; `next` still advances past it, so the
 * rest of the region is parsed either way. That is the whole point of `TAL_MALFORMED` being a
 * warning: one bad TAL must not cost the file.
 */
function scanTal(region: Uint8Array, start: number, ordinal: number, log: IssueLog): TalScan {
  const regionLength = region.length;

  const bodyEnd = indexOfByte(region, start, regionLength, TAL_TERMINATOR);
  if (bodyEnd < 0) {
    logIssue(
      log,
      'TAL_TRUNCATED_AT_REGION_END',
      region,
      start,
      regionLength - start,
      'a TAL begins here and has no terminating 0x00 inside the region, so it was discarded ' +
        "rather than continued into the following signal's samples",
    );
    return { tal: undefined, next: regionLength };
  }
  const next = bodyEnd + 1;

  const timestampEnd = indexOfByte(region, start, bodyEnd, TAL_FIELD_TERMINATOR);
  if (timestampEnd < 0) {
    logIssue(
      log,
      'TAL_MALFORMED',
      region,
      start,
      bodyEnd - start,
      'the timestamp is not terminated by 0x14, so the TAL was skipped',
    );
    return { tal: undefined, next };
  }

  const separator = indexOfByte(region, start, timestampEnd, TAL_ONSET_DURATION_SEPARATOR);
  const onsetEnd = separator < 0 ? timestampEnd : separator;

  if (onsetEnd - start > MAX_TIMESTAMP_FIELD_CHARS) {
    logIssue(
      log,
      'TAL_MALFORMED',
      region,
      start,
      onsetEnd - start,
      `the onset field is ${onsetEnd - start} bytes long, which no time in 100 ns ticks needs; ` +
        'the TAL was skipped',
    );
    return { tal: undefined, next };
  }

  const onsetRaw = decodeHeaderLatin1(sliceBytes(region, start, onsetEnd - start));
  const signedOnset = parseSignedTicks(onsetRaw);
  let onsetTicks = signedOnset.ticks;
  if (!signedOnset.ok) {
    // `parseSignedTicks` fails for a missing sign and for a bad magnitude alike. Only the first
    // is recoverable, and re-parsing without the sign is how they are told apart.
    const unsignedOnset = parseUnsignedTicks(onsetRaw);
    if (!unsignedOnset.ok) {
      logIssue(
        log,
        'TAL_MALFORMED',
        region,
        start,
        Math.max(onsetEnd - start, 1),
        `the onset "${onsetRaw}" is not ("+" / "-") 1*DIGIT [ "." 1*DIGIT ], so the TAL was ` +
          'skipped',
      );
      return { tal: undefined, next };
    }
    onsetTicks = unsignedOnset.ticks;
    logIssue(
      log,
      'TAL_MALFORMED',
      region,
      start,
      onsetEnd - start,
      `the onset "${onsetRaw}" has no mandatory sign; the value is unambiguous, so the TAL was ` +
        'kept and the onset read as positive',
    );
  }
  if (outsideInt64(onsetTicks)) {
    logIssue(
      log,
      'TAL_MALFORMED',
      region,
      start,
      onsetEnd - start,
      `the onset "${onsetRaw}" is outside the +/-2^63 tick range edfcore can represent, so the ` +
        'TAL was skipped',
    );
    return { tal: undefined, next };
  }

  let durationRaw: string | undefined;
  let durationTicks: bigint | undefined;
  if (separator >= 0) {
    const durationStart = separator + 1;
    const durationLength = timestampEnd - durationStart;
    if (durationLength > MAX_TIMESTAMP_FIELD_CHARS) {
      logIssue(
        log,
        'TAL_MALFORMED',
        region,
        durationStart,
        durationLength,
        `the duration field is ${durationLength} bytes long, which no time in 100 ns ticks ` +
          'needs; the TAL was skipped',
      );
      return { tal: undefined, next };
    }
    durationRaw = decodeHeaderLatin1(sliceBytes(region, durationStart, durationLength));
    const duration = parseUnsignedTicks(durationRaw);
    if (!duration.ok || outsideInt64(duration.ticks)) {
      logIssue(
        log,
        'TAL_MALFORMED',
        region,
        durationStart,
        Math.max(durationLength, 1),
        `0x15 is present but the duration "${durationRaw}" is not 1*DIGIT [ "." 1*DIGIT ] — a ` +
          'duration is never signed — so the TAL was skipped',
      );
      return { tal: undefined, next };
    }
    durationTicks = duration.ticks;
  }

  const texts: TalText[] = [];
  let runStart = timestampEnd + 1;
  for (let i = runStart; i < bodyEnd; i += 1) {
    if (readByte(region, i) !== TAL_FIELD_TERMINATOR) continue;
    texts.push(readTextRun(region, runStart, i, log));
    runStart = i + 1;
  }
  if (runStart < bodyEnd) {
    // The grammar terminates every text with 0x14, so a run left over here means the last text
    // ran straight into the TAL terminator. The bytes are unambiguous, so the text is kept.
    logIssue(
      log,
      'TAL_MALFORMED',
      region,
      runStart,
      bodyEnd - runStart,
      'the last text of the TAL is not terminated by 0x14; the text was kept verbatim',
    );
    texts.push(readTextRun(region, runStart, bodyEnd, log));
  }

  return {
    tal: {
      ordinal,
      byteOffsetInRegion: start,
      byteLength: next - start,
      onsetRaw,
      onsetTicks,
      durationRaw,
      durationTicks,
      texts,
    },
    next,
  };
}

function readTextRun(region: Uint8Array, start: number, end: number, log: IssueLog): TalText {
  if (indexOfByte(region, start, end, TAL_ONSET_DURATION_SEPARATOR) >= 0) {
    logIssue(
      log,
      'TAL_MALFORMED',
      region,
      start,
      end - start,
      'a text run contains 0x15, which the grammar reserves for the onset/duration separator; ' +
        'the text was kept verbatim',
    );
  }
  return decodeTextRun(region, start, end - start, log);
}

/**
 * Every TAL in `[regionStart, regionStart + regionBytes)`, and nothing outside it.
 *
 * `region = *TAL *%x00`, so a 0x00 where a TAL would start means the padding has begun. Content
 * after that point is `TAL_REGION_NOT_NUL_TERMINATED`; parsing then RESUMES at those bytes
 * rather than stopping, because they are still inside this signal's own region and a writer
 * that pads between TALs would otherwise lose every annotation after the first pad. Recovery is
 * bounded: each attempt consumes at least one byte, and a slot that does not parse is skipped
 * to just past its 0x00.
 */
export function parseTalRegion(
  bytes: Uint8Array,
  regionStart: number,
  regionBytes: number,
): TalRegionParse {
  const region = sliceBytes(bytes, regionStart, regionBytes);
  const log: IssueLog = new Map();
  const tals: ParsedTal[] = [];

  let position = 0;
  let ordinal = 0;
  while (position < regionBytes) {
    if (readByte(region, position) === TAL_TERMINATOR) {
      let scan = position;
      while (scan < regionBytes && readByte(region, scan) === TAL_TERMINATOR) scan += 1;
      if (scan === regionBytes) break;
      logIssue(
        log,
        'TAL_REGION_NOT_NUL_TERMINATED',
        region,
        scan,
        regionBytes - scan,
        'the region tail after the last TAL is not all 0x00; parsing resumed at this byte',
      );
      // A TAL found after padding did not begin the region, so it must never be promoted into
      // the timekeeping role: slot 0 is a position, not "the first TAL we managed to parse".
      if (ordinal === 0) ordinal = 1;
      position = scan;
      continue;
    }

    const scan = scanTal(region, position, ordinal, log);
    if (scan.tal !== undefined) tals.push(scan.tal);
    ordinal += 1;
    position = scan.next;
  }

  return { tals, issues: [...log.values()] };
}

/**
 * `description@@channel` split at the LAST `@@`, because the channel label is the suffix and a
 * description is free to contain anything.
 *
 * A trailing `@@` with nothing after it is not a channel label: the text keeps it verbatim.
 * `@@Fp1` with nothing before it yields an empty description and the channel — the run itself
 * is not empty, so it is still a real annotation.
 */
export function splitChannelLabel(run: string): TalTextParts {
  const at = run.lastIndexOf(CHANNEL_LABEL_SEPARATOR);
  if (at < 0 || at + CHANNEL_LABEL_SEPARATOR.length >= run.length) {
    return { text: run, channelLabel: undefined };
  }
  return { text: run.slice(0, at), channelLabel: run.slice(at + CHANNEL_LABEL_SEPARATOR.length) };
}
