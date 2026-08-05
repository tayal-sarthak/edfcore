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

import type { EdfCalendarDate, EdfHeader, FormatHeaderOptions } from './types.js';

function formatDate(date: EdfCalendarDate | undefined): string {
  if (date === undefined) return 'unknown';
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${date.year}-${month}-${day}`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'unknown';
  const whole = Math.floor(seconds);
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
    `duration     ${formatDuration(header.recordCount * header.recordDurationSeconds)} ` +
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
    const label = signal.label.slice(0, 20).padEnd(21);
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
    const counts = new Map<string, number>();
    for (const diagnostic of header.diagnostics) {
      counts.set(diagnostic.severity, (counts.get(diagnostic.severity) ?? 0) + 1);
    }
    const summary = [...counts].map(([severity, count]) => `${count} ${severity}`).join(', ');
    lines.push(`${header.diagnostics.length} diagnostic(s): ${summary}`);
    lines.push('Call formatDiagnostics(header.diagnostics) for the detail.');
  }

  return lines.join('\n');
}
