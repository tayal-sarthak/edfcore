/**
 * The ten fixed header fields.
 *
 * Layer 2. Sole owner of the 256-byte fixed header: where each field lives, what its bytes say
 * verbatim, and which diagnostic a field that fails its grammar deserves. It owns no ORDER —
 * `header/parse.ts` decides that and calls the functions here one field at a time, because the
 * fixed header has to be read in dependency order rather than in file order (the signal count
 * has to be trusted before the header-size field is worth reading at all).
 *
 * Raw first, always: a numeric field that failed to parse is exactly the case where the caller
 * needs the bytes as written, so every field is exposed as text before it is interpreted.
 */

import { hexBytes } from '../bytes/hex.js';
import { hasNonPrintableAscii } from '../bytes/latin1.js';
import { type EdfNumberParse, parseEdfInteger, parseEdfNumber } from '../bytes/numbers.js';
import { readAsciiField, sliceBytes } from '../bytes/view.js';
import { EDF_MAX_SIGNAL_COUNT, HEADER_FIELDS, TICKS_PER_SECOND } from '../constants.js';
import { type DiagnosticInit, type DiagnosticSink, fatalError } from '../diagnostics/collector.js';
import type { EdfFormatError } from '../errors.js';
import type { EdfRawHeaderFields } from '../types.js';

/** The ten fixed fields. Same keys as `EdfRawHeaderFields`, by construction. */
export type FixedHeaderFieldName = keyof typeof HEADER_FIELDS;

const CHAR_NUL = 0x00;
const CHAR_SPACE = 0x20;

/** Enough bytes to recognise the problem in a message without pasting an 80-byte field. */
const RAW_EVIDENCE_MAX_BYTES = 16;

/** 10^7 is far below 2^53, so this conversion is exact. */
const TICKS_PER_SECOND_FLOAT = Number(TICKS_PER_SECOND);

const FIELD_DESCRIPTIONS: Readonly<Record<FixedHeaderFieldName, string>> = {
  version: 'version of this data format',
  patientId: 'local patient identification',
  recordingId: 'local recording identification',
  startDate: 'startdate of the recording',
  startTime: 'starttime of the recording',
  headerByteLength: 'number of bytes in the header record',
  reserved: 'reserved field',
  recordCount: 'number of data records',
  recordDuration: 'duration of a data record in seconds',
  signalCount: 'number of signals',
};

/**
 * The text fields whose bytes are checked against the spec's printable-ASCII alphabet.
 *
 * `version` is excluded because BDF's is 0xFF followed by `'BIOSEMI'` by definition. The numeric
 * fields are excluded because a byte outside the alphabet there fails the grammar instead, which
 * is a stronger statement than "unusual bytes".
 */
const ASCII_CHECKED_FIELDS: readonly FixedHeaderFieldName[] = [
  'patientId',
  'recordingId',
  'startDate',
  'startTime',
  'reserved',
];

/** `'EDF specification, header record bytes 236-243'`. */
export function fixedFieldSpecReference(field: FixedHeaderFieldName): string {
  const { offset, length } = HEADER_FIELDS[field];
  return `EDF specification, header record bytes ${offset}-${offset + length - 1}`;
}

/** `'number of data records (8 bytes at offset 236)'`. */
export function describeFixedField(field: FixedHeaderFieldName): string {
  const { offset, length } = HEADER_FIELDS[field];
  return `${FIELD_DESCRIPTIONS[field]} (${length} bytes at offset ${offset})`;
}

/** Every fixed field as the text it holds, padding included and nothing interpreted. */
export function readRawHeaderFields(headerBytes: Uint8Array): EdfRawHeaderFields {
  const read = (field: FixedHeaderFieldName): string =>
    readAsciiField(headerBytes, HEADER_FIELDS[field].offset, HEADER_FIELDS[field].length);
  return {
    version: read('version'),
    patientId: read('patientId'),
    recordingId: read('recordingId'),
    startDate: read('startDate'),
    startTime: read('startTime'),
    headerByteLength: read('headerByteLength'),
    reserved: read('reserved'),
    recordCount: read('recordCount'),
    recordDuration: read('recordDuration'),
    signalCount: read('signalCount'),
  };
}

function isPadding(code: number): boolean {
  return code === CHAR_SPACE || code === CHAR_NUL;
}

/**
 * The bounds of a field's content inside its own bytes, stripping the same padding
 * `trimEdfField` does.
 *
 * Padding is excluded on purpose: `NON_ASCII_HEADER_FIELD` is about what the field SAYS, and a
 * writer that pads with NUL instead of space has produced the same value. That deviation is
 * already reported for numeric fields, as `NUMERIC_FIELD_NOT_LEFT_JUSTIFIED`.
 */
function contentBounds(raw: string): { readonly start: number; readonly end: number } {
  let start = 0;
  let end = raw.length;
  while (end > start && isPadding(raw.charCodeAt(end - 1))) end--;
  while (start < end && isPadding(raw.charCodeAt(start))) start++;
  return { start, end };
}

/** Index of the first byte outside printable ASCII, or 0 when the caller says there is one. */
function firstNonPrintable(bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] as number;
    if (byte < 0x20 || byte > 0x7e) return i;
  }
  return 0;
}

/**
 * A window of at most `RAW_EVIDENCE_MAX_BYTES` centred on the OFFENDING byte, not on the start
 * of the field.
 *
 * The old window was `subarray(0, 16)`. `patientId` and `recordingId` are 80 bytes each and
 * `reserved` is 44, and in the EDF+ layouts the subfields that realistically carry a non-ASCII
 * byte — the patient NAME, the recording EQUIPMENT — begin well past byte 16. So for the exact
 * case this warning exists for, an accented name or a bare 0xB5 for micro, the sixteen bytes
 * quoted were all printable ASCII while the sentence around them said those bytes were the
 * non-conformant ones. The reader could see they were not, and had no way to find the real one
 * (fixed in 0.3.26).
 */
function evidenceWindow(content: Uint8Array): { readonly hex: string; readonly at: number } {
  const at = firstNonPrintable(content);
  // A few bytes of lead-in, so the offending byte has context rather than sitting at the edge.
  const from = Math.max(0, Math.min(at - 4, content.length - RAW_EVIDENCE_MAX_BYTES));
  return { hex: hexBytes(content, Math.max(0, from), RAW_EVIDENCE_MAX_BYTES), at };
}

/**
 * Report `NON_ASCII_HEADER_FIELD` for every fixed text field carrying a byte outside ASCII
 * 32..126.
 *
 * A warning, never more: the field still decodes truthfully, because edfcore reads header text
 * as ISO-8859-1 — real equipment writes accented patient names and a bare 0xB5 for micro.
 */
export function reportNonAsciiHeaderFields(headerBytes: Uint8Array, sink: DiagnosticSink): void {
  for (const field of ASCII_CHECKED_FIELDS) {
    const { offset, length } = HEADER_FIELDS[field];
    const raw = readAsciiField(headerBytes, offset, length);
    const { start, end } = contentBounds(raw);
    const content = sliceBytes(headerBytes, offset + start, end - start);
    if (!hasNonPrintableAscii(content)) continue;
    const evidence = evidenceWindow(content);
    sink.report({
      code: 'NON_ASCII_HEADER_FIELD',
      message:
        `${describeFixedField(field)} is ${JSON.stringify(raw)} and carries bytes outside ` +
        `printable ASCII 32..126, the first at byte ${offset + start + evidence.at}: ` +
        `${evidence.hex}. The EDF specification restricts header ` +
        'text to ASCII 32..126. Next: nothing is lost — edfcore decodes header text as ' +
        'ISO-8859-1 (never TextDecoder, whose "latin1" label decodes 0x80 differently in Node ' +
        'and in a browser), so read the field as Latin-1 rather than as UTF-8.',
      field,
      byteOffset: offset,
      byteLength: length,
      rawBytes: content,
      raw,
      expected: 'ASCII 32..126',
      actual: evidence.hex,
      specReference: fixedFieldSpecReference(field),
    });
  }
}

/**
 * Everything a numeric-field diagnostic needs that the parse result does not carry.
 *
 * Per-signal fields use this too — `header/signals.ts` supplies its own offsets and wording, so
 * the comma/malformed/justification decision exists in exactly one place.
 */
export interface NumericFieldContext {
  /** Goes on the diagnostic's `field`. */
  readonly field: string;
  /** `'number of data records (8 bytes at offset 236)'` — completes the first sentence. */
  readonly description: string;
  readonly byteOffset: number;
  readonly byteLength: number;
  /** What the grammar wanted: `'a whole number of data records, or -1 when unknown'`. */
  readonly expected: string;
  readonly specReference: string;
  /** The actionable next step, without a trailing full stop. */
  readonly nextStep: string;
  readonly signalIndex?: number;
}

function contextInit(
  context: NumericFieldContext,
  raw: string,
): Omit<DiagnosticInit, 'code' | 'message'> {
  return {
    field: context.field,
    byteOffset: context.byteOffset,
    byteLength: context.byteLength,
    raw,
    expected: context.expected,
    specReference: context.specReference,
    ...(context.signalIndex === undefined ? {} : { signalIndex: context.signalIndex }),
  };
}

/**
 * `'0,5'` is a half and `'1,024'` is one thousand and twenty-four, and nothing in the bytes says
 * which was meant — so this is fatal with no opt-in, at every call site.
 */
function commaError(parse: EdfNumberParse, context: NumericFieldContext): EdfFormatError {
  return fatalError({
    code: 'COMMA_DECIMAL_SEPARATOR',
    message:
      `${context.description} is ${JSON.stringify(parse.raw)}, which uses a comma as the ` +
      'decimal separator. "0,5" (a half) and "1,024" (one thousand and twenty-four) are ' +
      'indistinguishable, and substituting "." in the second silently turns 1024 into 1.024, ' +
      `so edfcore refuses to guess. ${context.specReference}: the field is an ASCII number ` +
      'with "." as the decimal separator. Next: rewrite the field in the source file — the ' +
      'docs carry a preprocessing recipe — because no reading of these bytes is safe.',
    ...contextInit(context, parse.raw),
    actual: parse.raw,
  });
}

function invalidError(parse: EdfNumberParse, context: NumericFieldContext): EdfFormatError {
  const blank = parse.problem === 'empty' ? ' (blank)' : '';
  return fatalError({
    code: 'NUMERIC_FIELD_INVALID',
    message:
      `${context.description} is ${JSON.stringify(parse.raw)}${blank}, which is not ` +
      `${context.expected}. ${context.specReference}. Next: ${context.nextStep}.`,
    ...contextInit(context, parse.raw),
    actual: parse.raw,
  });
}

/**
 * The value is trustworthy, the layout is not: leading padding means the writer right-justified
 * the field, and a NUL in the padding means it used the wrong pad byte.
 */
function reportLayout(
  parse: EdfNumberParse,
  context: NumericFieldContext,
  sink: DiagnosticSink,
): void {
  if (parse.problem !== 'not-left-justified') return;
  sink.report({
    code: 'NUMERIC_FIELD_NOT_LEFT_JUSTIFIED',
    message:
      `${context.description} is ${JSON.stringify(parse.raw)}: the value ${parse.value} was ` +
      'read from it, but the field is right-justified or NUL-padded, where EDF requires the ' +
      `digits to start at the first byte and the rest of the field to be spaces. ` +
      `${context.specReference}. Next: nothing to do — the value is used as read, and ` +
      'header.raw keeps the bytes as written.',
    ...contextInit(context, parse.raw),
    actual: parse.raw,
  });
}

/**
 * The value of a field that edfcore cannot proceed without.
 *
 * A comma decimal or a failed grammar throws: these fields decide where bytes are and what they
 * mean, so a wrong reading would be worse than no reading.
 */
export function requireNumericField(
  parse: EdfNumberParse,
  context: NumericFieldContext,
  sink: DiagnosticSink,
): number {
  if (parse.problem === 'comma-decimal') throw commaError(parse, context);
  if (!parse.ok) throw invalidError(parse, context);
  reportLayout(parse, context, sink);
  return parse.value;
}

/**
 * The value of a field edfcore can survive without, or `NaN` when it could not be read.
 *
 * Only for the two fields with an authoritative alternative source — the declared header size,
 * which always loses to the computed one, and the record count, which is recoverable from the
 * source length. The caller reports what it did instead; a comma decimal is still fatal.
 */
export function readNumericField(
  parse: EdfNumberParse,
  context: NumericFieldContext,
  sink: DiagnosticSink,
): number {
  if (parse.problem === 'comma-decimal') throw commaError(parse, context);
  if (!parse.ok) return Number.NaN;
  reportLayout(parse, context, sink);
  return parse.value;
}

function fixedContext(
  field: FixedHeaderFieldName,
  expected: string,
  nextStep: string,
): NumericFieldContext {
  const { offset, length } = HEADER_FIELDS[field];
  return {
    field,
    description: describeFixedField(field),
    byteOffset: offset,
    byteLength: length,
    expected,
    specReference: fixedFieldSpecReference(field),
    nextStep,
  };
}

/**
 * The signal count at offset 252, validated to 1..9999.
 *
 * Fatal on anything else, including a comma, and deliberately reported as
 * `SIGNAL_COUNT_INVALID` rather than as the generic numeric codes: every per-signal field
 * address is `256 + ns * blockOffset + i * width`, so an unusable ns makes every byte after the
 * fixed header unlocatable. It is validated before any ns-sized allocation for the same reason.
 */
export function parseSignalCount(raw: string, sink: DiagnosticSink): number {
  const context = fixedContext(
    'signalCount',
    'a whole number of signals in 1..9999',
    'inspect the first 256 bytes in a hex viewer; nothing after them can be located without ' +
      'this field',
  );
  const parse = parseEdfInteger(raw);
  if (parse.ok && parse.value >= 1 && parse.value <= EDF_MAX_SIGNAL_COUNT) {
    reportLayout(parse, context, sink);
    return parse.value;
  }
  throw fatalError({
    code: 'SIGNAL_COUNT_INVALID',
    message:
      `${context.description} is ${JSON.stringify(raw)}, which is not ${context.expected}. ` +
      'Every per-signal field address is 256 + ns * blockOffset + i * width and the whole ' +
      `header is 256 * (ns + 1) bytes, so an unusable ns leaves no byte after the fixed ` +
      `header locatable. ${context.specReference}. Next: ${context.nextStep}.`,
    ...contextInit(context, raw),
    actual: raw,
  });
}

/**
 * The declared header size at offset 184, checked against the computed `256 * (ns + 1)`.
 *
 * The computed value ALWAYS wins, which is what makes this a warning rather than a fatal
 * numeric field: a value edfcore never uses cannot make it read the wrong bytes. An unreadable
 * field is reported the same way and returned as `NaN`, so `header.declaredHeaderByteLength`
 * never claims a size the file did not state.
 */
export function checkDeclaredHeaderByteLength(
  raw: string,
  computedHeaderByteLength: number,
  sink: DiagnosticSink,
): number {
  const context = fixedContext(
    'headerByteLength',
    'a whole number of bytes equal to 256 * (number of signals + 1)',
    'nothing to do — edfcore uses the computed size',
  );
  const declared = readNumericField(parseEdfInteger(raw), context, sink);
  if (declared === computedHeaderByteLength) return declared;
  sink.report({
    code: 'HEADER_SIZE_MISMATCH',
    message:
      `${context.description} is ${JSON.stringify(raw)}, but the header of a file with this ` +
      `many signals is exactly ${computedHeaderByteLength} bytes (256 * (ns + 1)). ` +
      `${context.specReference}. Next: the computed size wins, so the first data record is ` +
      `read at byte ${computedHeaderByteLength}; header.declaredHeaderByteLength keeps what ` +
      'the file claimed.',
    ...contextInit(context, raw),
    expected: String(computedHeaderByteLength),
    actual: Number.isNaN(declared) ? raw : String(declared),
  });
  return declared;
}

/**
 * The record duration at offset 244, in seconds.
 *
 * May legitimately be 0 — an EDF+ file whose records carry only annotations does exactly that —
 * and `ZERO_RECORD_DURATION` says so without refusing the file. A NEGATIVE duration is refused:
 * it is not a tolerable oddity but a value that would make every record onset, sample time and
 * sample rate derived from it run backwards. So is a POSITIVE duration that no 100 ns tick count
 * can express, in either direction — see the comment on that check.
 */
export function parseRecordDuration(raw: string, sink: DiagnosticSink): number {
  const context = fixedContext(
    'recordDuration',
    'a number of seconds, written in ASCII digits with "." as the decimal separator, such as ' +
      '"1", "0.1" or "30"',
    'header.raw.recordDuration keeps the bytes as written; every sample time in the file is a ' +
      'multiple of this value, and edfcore will not assume one second',
  );
  const seconds = requireNumericField(parseEdfNumber(raw), context, sink);

  if (seconds < 0) {
    throw fatalError({
      code: 'NUMERIC_FIELD_INVALID',
      message:
        `${context.description} is ${JSON.stringify(raw)}, i.e. ${seconds} seconds. A data ` +
        'record cannot last a negative time, and every record onset, sample time and sample ' +
        `rate derived from it would run backwards. ${context.specReference}. Next: ` +
        `${context.nextStep}.`,
      ...contextInit(context, raw),
      expected: 'a duration of 0 seconds or more',
      actual: String(seconds),
    });
  }

  // edfcore measures time in exact 100 ns ticks, so a POSITIVE duration that no tick count can
  // express is not a duration it can honour, and the two failures look nothing alike from the
  // outside. Too large and `seconds * 10^7` overflows float64 before it can become a bigint, which
  // surfaced as a bare `RangeError` about BigInt() — an error about a number, thrown at a caller
  // who passed the right arguments, for a defect that is entirely the file's. Too small and it
  // rounds to zero ticks while `recordDurationSeconds` keeps claiming a positive length, which
  // leaves `recordDurationTicks` at 0 next to a non-zero `recordDurationSeconds` and makes every
  // `sampleRateHz` in the file Infinity. Zero itself stays legal and is reported just below.
  const ticks = seconds * TICKS_PER_SECOND_FLOAT;
  if (seconds > 0 && (!Number.isFinite(ticks) || Math.round(ticks) === 0)) {
    throw fatalError({
      code: 'NUMERIC_FIELD_INVALID',
      message:
        `${context.description} is ${JSON.stringify(raw)}, i.e. ${seconds} seconds, which is ` +
        (Number.isFinite(ticks)
          ? 'shorter than the 100 ns tick edfcore measures time in, so every data record would ' +
            'occupy no time at all while the field claims otherwise'
          : 'so large that its length in 100 ns ticks is not a number at all') +
        `. ${context.specReference}. Next: ${context.nextStep}.`,
      ...contextInit(context, raw),
      expected: 'a duration of 0 seconds, or of at least 100 ns',
      actual: String(seconds),
    });
  }

  if (seconds === 0) {
    sink.report({
      code: 'ZERO_RECORD_DURATION',
      message:
        `${context.description} is ${JSON.stringify(raw)}. Zero is legal — EDF+ uses it for a ` +
        'recording whose data records carry annotations and nothing else — but it makes every ' +
        'sample rate undefined, because samplesPerRecord / 0 is not a rate. EDF+ additional ' +
        'specification 1. Next: signal.sampleRateHz is undefined for every signal in this ' +
        'file; index samples by signal.samplesPerRecord and never divide by ' +
        'header.recordDurationSeconds.',
      ...contextInit(context, raw),
      expected: 'a positive number of seconds, or 0 for an annotations-only recording',
      actual: '0',
      specReference: 'EDF+ additional specification 1 (annotations-only recordings)',
    });
  }

  return seconds;
}

/**
 * The declared record count at offset 236, verbatim.
 *
 * `-1` is the sanctioned "the writer never closed the file" value and is returned as `-1`; an
 * unreadable field is returned as `NaN`. Both mean the same thing to the caller — the count has
 * to come from the source length instead — and `header/parse.ts` reports which happened, since
 * only it knows the source length that resolves it.
 */
export function parseDeclaredRecordCount(raw: string, sink: DiagnosticSink): number {
  const context = fixedContext(
    'recordCount',
    'a whole number of data records, or -1 when the writer did not know it',
    'the count is recovered from the source length instead',
  );
  return readNumericField(parseEdfInteger(raw), context, sink);
}
