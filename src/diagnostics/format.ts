/**
 * Rendering diagnostics for humans.
 *
 * Layer 1. Layout only: by the message contract a diagnostic's own message already names the
 * field, the raw bytes as written, the rule and the next step, so this module adds structure —
 * severity marker, code, location, the bytes as hex — and invents no wording.
 *
 * Output is deterministic and asserted as such: no locale-sensitive number or date formatting,
 * no iteration over an unordered collection, and no ANSI escapes unless `color` is requested.
 */

import { trimEdfField } from '../bytes/latin1.js';
import { HEADER_FIELDS, SIGNAL_FIELD_WIDTHS } from '../constants.js';
import { requireItemLimit } from '../options.js';
import { printable } from '../text/printable.js';
import type { EdfDiagnostic, EdfSeverity } from '../types.js';

/**
 * How to render a diagnostics array as text. `redactFields` is the one to reach for before the
 * output leaves your machine — a diagnostic quotes the bytes it is complaining about, and for an
 * identification field those bytes are a person's name.
 */
export interface FormatDiagnosticsOptions {
  readonly color?: boolean;
  readonly maxItems?: number;
  /**
   * Field names whose CONTENT must not appear in the output — `['patientId', 'recordingId']` is
   * the one that matters.
   *
   * A diagnostic names the raw bytes as written, by design: that is what makes a report
   * actionable. For an identification field those bytes are a person's name and birth date, and
   * a diagnostic about them is not rare — a writer that packs the name into one token is
   * non-conformant, which is exactly the file someone runs a tool on and pastes the output of.
   * Withholding `header.patient` while the diagnostic below it spells the same string out is not
   * withholding it at all.
   *
   * The diagnostic still appears in full otherwise: code, severity, byte offset, the rule, and
   * the next step. Only the value is replaced, so the report still says what is wrong and where.
   */
  readonly redactFields?: readonly string[];
}

/**
 * Every value `field` can hold on a diagnostic edfcore produces.
 *
 * Two of the three sources are the header layout itself, so a field added there is redactable the
 * day it exists; the other three are the diagnostics that name something the layout has no entry
 * for — the whole header block, the data-record region, and the record size the geometry implies.
 * `redaction-vocabulary.test.ts` builds the same set out of `src/` and refuses a difference, which
 * is what stops this from drifting behind a diagnostic that names a new field.
 */
const REDACTABLE_FIELDS: ReadonlySet<string> = new Set([
  ...Object.keys(HEADER_FIELDS),
  ...Object.keys(SIGNAL_FIELD_WIDTHS),
  'dataRecords',
  'header',
  'recordByteLength',
]);

/**
 * A name outside the vocabulary is refused rather than ignored.
 *
 * `redactFields` is the one option in this package whose silent failure sends a person's name
 * somewhere it should not go, and matching is exact — `'patientID'`, `'patient'` and
 * `'patient_id'` all withheld nothing and reported nothing, so the caller who asked for redaction
 * got a report with the name in it and no way to tell. It is the same shape `parseArgs` refuses a
 * misspelled `--patinet` for, and for the same reason: a flag that silently does nothing prints
 * the output the caller was trying to avoid.
 *
 * Checked before anything is rendered, so an empty diagnostics array reports the typo too. A leak
 * found on the first clean file costs nothing; found on the file that has a problem it is already
 * on someone's screen — which is also why `formatValidationReport` calls this itself rather than
 * relying on the `formatDiagnostics` below it: that call is inside an `if (length > 0)`, so a PASS
 * would have said nothing and the same argument would have leaked on the next file.
 */
export function assertRedactableFields(fields: readonly string[] | undefined): void {
  for (const field of fields ?? []) {
    if (REDACTABLE_FIELDS.has(field)) continue;
    throw new RangeError(
      `options.redactFields names ${JSON.stringify(field)}, which is not a field any edfcore ` +
        'diagnostic reports, so nothing would have been withheld for it. Next: pass names from ' +
        `${[...REDACTABLE_FIELDS].sort().join(', ')} — "patientId" and "recordingId" are the two ` +
        "that carry a person's name.",
    );
  }
}

const INDENT = '  ';

/** A report is a summary, not a hex dump; longer runs are elided with a count. */
const MAX_RAW_BYTES_SHOWN = 24;

const ANSI_RESET = '\u001b[0m';
const ANSI_DIM = '\u001b[2m';

const SEVERITY_COLORS: Readonly<Record<EdfSeverity, string>> = {
  error: '\u001b[31m',
  warning: '\u001b[33m',
  info: '\u001b[36m',
};

/**
 * A multi-line report, one block per diagnostic. Returns `''` for an empty list so the result
 * can be concatenated into a larger report without a stray blank line.
 */
export function formatDiagnostics(
  diagnostics: readonly EdfDiagnostic[],
  options?: FormatDiagnosticsOptions,
): string {
  const color = options?.color === true;
  const shown = requireItemLimit(options?.maxItems, diagnostics.length);
  const lines: string[] = [];

  assertRedactableFields(options?.redactFields);
  const redact = new Set(options?.redactFields ?? []);

  for (let i = 0; i < shown; i++) {
    const diagnostic = diagnostics[i];
    // i < shown <= diagnostics.length, so this only satisfies noUncheckedIndexedAccess.
    if (diagnostic === undefined) continue;
    appendDiagnostic(lines, diagnostic, color, redact);
  }

  const hidden = diagnostics.length - shown;
  if (hidden > 0) lines.push(paint(`... and ${hidden} more`, ANSI_DIM, color));

  return lines.join('\n');
}

const REDACTED = '[redacted]';

/**
 * Removes a field's content from every place `appendDiagnostic` would print it.
 *
 * The message is prose with the value interpolated into it, so the value is substituted out by
 * text rather than by re-rendering the message: the raw string is known exactly, and both its
 * padded and trimmed spellings are removed. `rawBytes` is dropped outright — it is the field's
 * literal bytes, and a hex dump with an ASCII column is not a redaction of anything.
 *
 * Substitution is done on the value, never on the code or the rule, so what is left still
 * identifies the problem: `[PATIENT_ID_NONCONFORMANT] ... at byte offset 8` remains readable.
 */
function redactDiagnostic(diagnostic: EdfDiagnostic): EdfDiagnostic {
  const raw = diagnostic.raw;
  let message = diagnostic.message;
  const spellings: string[] = [];
  if (raw !== undefined) {
    /*
     * `raw.trim()` is not the same as the field's trimmed value, and that gap was the leak.
     * `trimEdfField` strips 0x20 AND 0x00; `String.prototype.trim` strips whitespace but not
     * U+0000. Every identification diagnostic builds its message from `trimEdfField(raw)`, so on
     * a field padded with NULs — which a large share of real writers emit, and which
     * `header/fields.ts` treats as normal — none of the four spellings matched and the name went
     * through verbatim while `raw:` and `actual:` said `[redacted]`. Output that LOOKS redacted is
     * worse than an obvious leak (fixed in 0.3.31).
     */
    spellings.push(JSON.stringify(raw), JSON.stringify(raw.trim()), raw, raw.trim());
    const trimmed = trimEdfField(raw);
    spellings.push(trimmed, JSON.stringify(trimmed));
  }
  /*
   * And the diagnostic's own `actual`, computed BEFORE it is replaced below.
   *
   * A message does not have to spell the value the way the field does. `DATE_IMPLAUSIBLE` writes
   * the patient's date of birth as `2050-05-02` while the file says `02-MAY-2050`, so no spelling
   * derived from `raw` could ever match it — and that diagnostic fires on a perfectly conformant
   * identification field, with no NUL padding and no grammar violation needed. `actual` already
   * carries whatever the message chose to print, which is exactly what has to be substituted.
   */
  if (diagnostic.actual !== undefined) {
    const actual = String(diagnostic.actual);
    spellings.push(actual, JSON.stringify(actual));
  }
  for (const spelling of spellings) {
    if (spelling.length > 0) message = message.split(spelling).join(REDACTED);
  }
  return {
    ...diagnostic,
    message,
    raw: raw === undefined ? undefined : REDACTED,
    rawBytes: undefined,
    actual: diagnostic.actual === undefined ? undefined : REDACTED,
  };
}

function appendDiagnostic(
  lines: string[],
  input: EdfDiagnostic,
  color: boolean,
  redactFields: ReadonlySet<string>,
): void {
  const diagnostic =
    input.field !== undefined && redactFields.has(input.field) ? redactDiagnostic(input) : input;
  const marker = paint(
    `${diagnostic.severity} [${diagnostic.code}]`,
    SEVERITY_COLORS[diagnostic.severity],
    color,
  );

  /*
   * Split on ANY line terminator, not on `\n` alone.
   *
   * Every diagnostic line this function emits starts at column 0 and a continuation is indented,
   * which is what stops a newline inside a message from forging one: `error [ANY_CODE] this file
   * is fine` two spaces in is visibly not a line edfcore reported. A carriage return defeats that
   * without being split on at all — a terminal returns the cursor to column 0 and the text after
   * it overwrites `warning [REAL_CODE] ` in place, so the forged line lands exactly where a real
   * one would. `expected` and `actual` were already immune, because they go through `printable`
   * and every control byte becomes a dot; the message is the field with the other defence, and it
   * had a hole in it (fixed in 0.4.440).
   */
  const messageLines = diagnostic.message.split(/\r\n|\r|\n/);
  const first = messageLines[0] ?? '';
  lines.push(`${marker} ${first}`.trimEnd());
  for (let i = 1; i < messageLines.length; i++) {
    const line = messageLines[i];
    if (line === undefined) continue;
    lines.push(`${INDENT}${line.trim()}`);
  }

  const location = locationOf(diagnostic);
  if (location !== undefined) detail(lines, location, color);
  if (diagnostic.raw !== undefined) detail(lines, `raw: ${quote(diagnostic.raw)}`, color);
  if (diagnostic.rawBytes !== undefined && diagnostic.rawBytes.length > 0) {
    detail(lines, `bytes: ${hexDump(diagnostic.rawBytes)}`, color);
  }
  // `expected` and `actual` frequently hold a field's bytes as written — `actual` is the label
  // itself for a label diagnostic — and unlike `message`, whose continuation lines are indented,
  // a detail line is emitted whole. A newline in one therefore lands at the left margin, where
  // `error [ANY_CODE] this file is fine` is indistinguishable from a diagnostic edfcore reported.
  // `printable`, not `quote`: these are unquoted values and a dot keeps the width honest.
  if (diagnostic.expected !== undefined) {
    detail(lines, `expected: ${printable(String(diagnostic.expected))}`, color);
  }
  if (diagnostic.actual !== undefined) {
    detail(lines, `actual: ${printable(String(diagnostic.actual))}`, color);
  }
  if (diagnostic.specReference !== undefined) {
    detail(lines, `spec: ${diagnostic.specReference}`, color);
  }
}

function detail(lines: string[], text: string, color: boolean): void {
  lines.push(`${INDENT}${paint(text, ANSI_DIM, color)}`);
}

function locationOf(diagnostic: EdfDiagnostic): string | undefined {
  const parts: string[] = [];
  if (diagnostic.byteOffset !== undefined) {
    parts.push(
      diagnostic.byteLength === undefined
        ? `byte offset ${diagnostic.byteOffset}`
        : `byte offset ${diagnostic.byteOffset} (${diagnostic.byteLength} bytes)`,
    );
  }
  if (diagnostic.field !== undefined) parts.push(diagnostic.field);
  if (diagnostic.signalIndex !== undefined) parts.push(`signal ${diagnostic.signalIndex}`);
  if (diagnostic.recordIndex !== undefined) parts.push(`record ${diagnostic.recordIndex}`);
  return parts.length === 0 ? undefined : `at ${parts.join(', ')}`;
}

/** `30 20 20 20  |0   |`. Built byte by byte — TextDecoder is banned outside `src/tal/`. */
function hexDump(bytes: Uint8Array): string {
  const shown = bytes.subarray(0, MAX_RAW_BYTES_SHOWN);
  const hex: string[] = [];
  let ascii = '';
  for (const byte of shown) {
    hex.push(byte.toString(16).padStart(2, '0'));
    ascii += isPrintableAscii(byte) ? String.fromCharCode(byte) : '.';
  }
  const elided = bytes.length - shown.length;
  return `${hex.join(' ')}  |${ascii}|${elided > 0 ? ` +${elided} more` : ''}`;
}

function isPrintableAscii(byte: number): boolean {
  return byte >= 0x20 && byte <= 0x7e;
}

/** Keeps every entry on one line: control and non-ASCII characters become escapes, not bytes. */
function quote(value: string): string {
  let out = '"';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === '"' || char === '\\') out += `\\${char}`;
    else if (isPrintableAscii(code)) out += char;
    else if (code <= 0xff) out += `\\x${code.toString(16).padStart(2, '0')}`;
    else out += `\\u{${code.toString(16)}}`;
  }
  return `${out}"`;
}

function paint(text: string, color: string, enabled: boolean): string {
  return enabled ? `${color}${text}${ANSI_RESET}` : text;
}
