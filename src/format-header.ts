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

import { TICKS_PER_SECOND } from './constants.js';
import { summarizeDiagnostics } from './diagnostics/summary.js';
import type { EdfCalendarDate, EdfHeader, FormatHeaderOptions } from './types.js';

function formatDate(date: EdfCalendarDate | undefined): string {
  if (date === undefined) return 'unknown';
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${date.year}-${month}-${day}`;
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

/** Control characters become a dot, so one field can never become two rows or shift a column. */
function printable(text: string): string {
  let out = '';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? '.' : character;
  }
  return out;
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
  lines.push(
    `start        ${formatDate(start.resolvedDate)} ${String(start.clock.hour).padStart(2, '0')}:` +
      `${String(start.clock.minute).padStart(2, '0')}:${String(start.clock.second).padStart(2, '0')}` +
      ` (local, no timezone)`,
  );
  lines.push(
    `record       ${header.recordDurationSeconds} s · ${header.recordByteLength} bytes · ` +
      `${header.bytesPerSample} bytes/sample`,
  );
  lines.push(
    `duration     ${formatDurationTicks(header.recordDurationTicks * BigInt(header.recordCount))} ` +
      `(${header.recordCount} × ${header.recordDurationSeconds} s)`,
  );
  if (header.recordCountSource === 'sourceByteLength') {
    // Worth saying out loud: the count came from the file size, not from the header field.
    lines.push('             record count recovered from the source length');
  }

  if (options?.includePatientId === true) {
    lines.push(`patient      ${header.patient.raw.trim() || 'unknown'}`);
    lines.push(`recording    ${header.recording.raw.trim() || 'unknown'}`);
  }

  lines.push('');
  lines.push('  #  label                 kind         rate      range');
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
          : `${signal.physicalMinimum}..${signal.physicalMaximum} ${signal.physicalDimension}`;
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
    lines.push('Call formatDiagnostics(header.diagnostics) for the detail.');
  }

  return lines.join('\n');
}
