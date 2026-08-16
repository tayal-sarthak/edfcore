/**
 * A header as text.
 *
 * Layer 7, and pure. `formatDiagnostics` already turns problems into something a human reads;
 * this does the same for the header itself — the thing that goes into a bug report, a CLI, or a
 * log line when a file behaves oddly.
 *
 * Two rules keep it useful rather than decorative. It never invents a value: a field edfcore
 * could not resolve prints as `unknown` rather than as a plausible default, because the whole
 * point of pasting this somewhere is that the reader can trust it. And it prints no patient
 * identification unless asked — a header carries a name and a birth date, and a summary that
 * lands in a chat log or an issue tracker should not carry them by default.
 */

import { trimEdfField } from './bytes/latin1.js';
import { TICKS_PER_SECOND } from './constants.js';
import { summarizeDiagnostics } from './diagnostics/summary.js';
import { formatCalendarDate } from './header/dates.js';
import { printable } from './text/printable.js';
import type { EdfCalendarDate, EdfHeader, FormatHeaderOptions } from './types.js';

/**
 * `formatCalendarDate`, not a second renderer for the same type.
 *
 * The private copy this replaced padded the month and the day but not the year, so any year below
 * 1000 came out one way here and another way everywhere else. That is reachable from a
 * conforming-length field: `parseSubfieldDate` requires the EDF+ `dd-MMM-yyyy` Startdate year to be
 * four characters, not to be >= 1000, so `Startdate 24-APR-0985` resolves to year 985 and one
 * `edfcore header` run printed `985-04-24` on the start line and `0985-04-24` in a
 * DATE_FIELDS_DISAGREE diagnostic eight lines below it (fixed in 0.3.110).
 */
function formatDate(date: EdfCalendarDate | undefined): string {
  return date === undefined ? 'unknown' : formatCalendarDate(date);
}

/**
 * `hh:mm:ss` from an exact tick count.
 *
 * Ticks, not `recordCount * recordDurationSeconds`. That product is float64, and a record duration
 * with no exact binary representation makes it land just under the true value: 100 records of
 * 0.29 s is exactly 29 s and computes as 28.999999999999996, which floors to 28. The header line
 * then reports a recording a whole second shorter than it is (fixed in 0.2.67).
 */
function formatDurationTicks(ticks: bigint): string {
  if (ticks < 0n) return 'unknown';
  const whole = Number(ticks / TICKS_PER_SECOND);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(rest)}`;
}

function formatRate(signal: EdfHeader['signals'][number]): string {
  // undefined is the honest answer for a zero record duration, which is legal EDF.
  return signal.sampleRateHz === undefined ? '—' : `${signal.sampleRateHz} Hz`;
}

/**
 * A multi-line summary of a header.
 *
 * Patient identification is omitted unless `includePatientId` is set. That is not a privacy
 * feature — the data is still in `header.patient` for anyone who wants it — it is a default
 * chosen so that the obvious thing to do with this string is also the safe one.
 */
export function formatHeader(header: EdfHeader, options?: FormatHeaderOptions): string {
  const lines: string[] = [];
  const start = header.startTime;

  lines.push(
    `${header.variant} · ${header.signals.length} signals · ${header.recordCount} records`,
  );
  // `unknown`, not a substituted midnight. The module promise two paragraphs up is that a field
  // edfcore could not resolve prints as `unknown` rather than as a plausible default, and the date
  // half has always honoured it. The clock half printed `00:00:00` for a starttime field that
  // failed its grammar — byte-identical to a file that genuinely started at midnight, which for a
  // sleep study is the most believable start there is (fixed in 0.3.17).
  const clock =
    start.clockSource === 'none'
      ? 'unknown'
      : `${String(start.clock.hour).padStart(2, '0')}:` +
        `${String(start.clock.minute).padStart(2, '0')}:` +
        `${String(start.clock.second).padStart(2, '0')}`;
  lines.push(`start        ${formatDate(start.resolvedDate)} ${clock} (local, no timezone)`);
  lines.push(
    `record       ${header.recordDurationSeconds} s · ${header.recordByteLength} bytes · ` +
      `${header.bytesPerSample} bytes/sample`,
  );
  // "duration" is only honest for a file whose records run end to end. On an EDF+D file this
  // number is what the records COVER, and the recording reaches further by however much the gaps
  // add up to — a four-record file with an hour-long hole in it printed `duration 00:00:04` for a
  // recording that spans 3604 s. Someone pasting that into a bug report says "a 4-second file".
  //
  // A header alone cannot know the span: it is the last record's onset minus the first's, and
  // those live in the timekeeping TALs. What a header does know is that this file claims to have
  // gaps, so the label says what the number is and the next line says where the span comes from.
  const discontinuous = header.continuity === 'discontinuous';
  const label = discontinuous ? 'covered     ' : 'duration    ';
  lines.push(
    `${label} ${formatDurationTicks(header.recordDurationTicks * BigInt(header.recordCount))} ` +
      `(${header.recordCount} × ${header.recordDurationSeconds} s)`,
  );
  if (discontinuous) {
    lines.push('             what the records cover; the gaps between them are not in it');
    lines.push('             buildRecordIndex(recording) reports the span and where the gaps are');
  }
  if (header.recordCountSource === 'sourceByteLength') {
    // Worth saying out loud: the count came from the file size, not from the header field.
    lines.push('             record count recovered from the source length');
  }

  if (options?.includePatientId === true) {
    // Through `printable`, for the reason every other field here is: these are 80 arbitrary bytes
    // each. 0.3.2 fixed this class in five outputs and missed these two, because the lines are off
    // by default and no test asked for them. A newline in the patient field opened a row matching
    // the signal-table shape exactly — `  0  99 signals · 0 records` — and one in the recording
    // field forged a `record       9 s` line at the left margin, contradicting the real geometry
    // three lines above it (fixed in 0.3.16).
    // `trimEdfField`, not `String.prototype.trim`. These are the untrimmed 80 bytes, and `.trim()`
    // strips whitespace but NOT U+0000 — so on the NUL-padded identification fields a large share
    // of real writers emit, the padding survived and `printable` turned every NUL into a `.`. An
    // empty patient field printed as eighty dots, which made the `|| 'unknown'` below unreachable
    // and read as redaction; a populated one trailed dots that read as truncation. It is the same
    // gap `redactDiagnostic` names in diagnostics/format.ts, and every other consumer of these
    // bytes — `parsePatientId`, `validateRecording`, `redactDiagnostic` — already used
    // `trimEdfField` (fixed in 0.3.48).
    lines.push(`patient      ${printable(trimEdfField(header.patient.raw)) || 'unknown'}`);
    lines.push(`recording    ${printable(trimEdfField(header.recording.raw)) || 'unknown'}`);
  }

  lines.push('');
  // Built from the SAME widths as the data rows below, not spaced by hand. The hand-spaced literal
  // had one space too many after `label` and one after `kind`, so `kind` sat at column 27 over data
  // at 26 and `rate` and `range` were two out — on every file, in the output whose whole purpose is
  // being read in a terminal (fixed in 0.3.96).
  lines.push(`  #  ${'label'.padEnd(21)}${'kind'.padEnd(12)}${'rate'.padEnd(9)} range`);
  for (const signal of header.signals) {
    const index = String(signal.index).padStart(3);
    // Control characters are replaced, not printed. A label holding a newline would otherwise
    // render as two rows and forge a signal the file does not contain; a tab would shift every
    // column after it. EDF pads labels with spaces and says nothing about what else may be in
    // them, so a writer can put anything there and a reader must not be steered by it.
    const label = printable(signal.label).slice(0, 20).padEnd(21);
    const kind = signal.kind.padEnd(12);
    const rate = formatRate(signal).padEnd(9);
    const range =
      signal.kind === 'annotations'
        ? '—'
        : signal.scale === undefined
          ? 'no usable scale'
          : // Through `printable` for the same reason the label is, and it is the same row: the
            // dimension is 8 arbitrary header bytes, `trimEdfField` strips only 0x20 and 0x00, and
            // this is the LAST thing on the line — so a newline in it puts everything after it at
            // column 0, where it reads as another signal. `edfcore signals` already sanitised this
            // field; `edfcore header` did not (fixed in 0.3.47).
            `${signal.physicalMinimum}..${signal.physicalMaximum} ${printable(signal.physicalDimension)}`;
    lines.push(`${index}  ${label}${kind}${rate} ${range}`);
  }

  if (header.diagnostics.length > 0) {
    lines.push('');
    // Fixed error-warning-info order, matching `formatValidationReport` since 0.2.15. Ordering by
    // arrival meant two files with the same diagnostics could summarise them differently.
    const counted = summarizeDiagnostics(header.diagnostics);
    const summary = (
      [
        [counted.errors, 'error'],
        [counted.warnings, 'warning'],
        [counted.infos, 'info'],
      ] as const
    )
      .filter(([count]) => count > 0)
      .map(([count, severity]) => `${count} ${severity}`)
      .join(', ');
    lines.push(`${header.diagnostics.length} diagnostic(s): ${summary}`);
    if (options?.diagnosticsHint !== false) {
      lines.push('Call formatDiagnostics(header.diagnostics) for the detail.');
    }
  }

  return lines.join('\n');
}
