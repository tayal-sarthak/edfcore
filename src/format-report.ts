/**
 * A validation report as text.
 *
 * Part of `edfcore/validate`. `validateRecording` returns a report a program can branch on; this
 * turns it into the thing a person reads at the end of a CI job or a conformance sweep.
 *
 * The one judgement it makes is what to lead with. A sweep over a damaged file can produce six
 * figures of diagnostics — `TIMEKEEPING_TAL_MISSING` is per record — and a wall of them buries
 * the answer. So the counts come first, then the distinct codes with how often each occurred,
 * and only then the individual entries, capped. What a reader needs first is *which kinds* of
 * thing are wrong and how much of the file is affected.
 */

import { formatDiagnostics } from './diagnostics/format.js';
import type { EdfHeader, FormatReportOptions, ValidationReport } from './types.js';

/** Enough to see the pattern, few enough to read. Override with `maxItems`. */
const DEFAULT_MAX_ITEMS = 20;

function pluralise(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * A multi-line summary of a validation report.
 *
 * `header` is optional and only used to name signals: a report is perfectly readable without it,
 * and a caller who has one gets `EEG Fpz-Cz` instead of `signal 0`.
 */
export function formatValidationReport(
  report: ValidationReport,
  options?: FormatReportOptions,
): string {
  const lines: string[] = [];
  const header = options?.header;

  const bySeverity = new Map<string, number>();
  const byCode = new Map<string, number>();
  for (const diagnostic of report.diagnostics) {
    bySeverity.set(diagnostic.severity, (bySeverity.get(diagnostic.severity) ?? 0) + 1);
    byCode.set(diagnostic.code, (byCode.get(diagnostic.code) ?? 0) + 1);
  }

  const verdict = report.ok ? 'PASS' : 'FAIL';
  const severities =
    bySeverity.size === 0
      ? 'no diagnostics'
      : [...bySeverity].map(([severity, count]) => `${count} ${severity}`).join(', ');
  lines.push(`${verdict} — ${severities}`);
  lines.push(
    `scanned ${pluralise(report.recordsScanned, 'record')}, ` +
      `read ${report.bytesRead.toLocaleString('en-US')} bytes`,
  );

  if (byCode.size > 0) {
    lines.push('');
    lines.push('by code:');
    // Descending by count: the code affecting most of the file is the one to look at first.
    for (const [code, count] of [...byCode].sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${String(count).padStart(7)}  ${code}`);
    }
  }

  if (report.signalStats.length > 0) {
    lines.push('');
    lines.push('observed sample ranges:');
    for (const stats of report.signalStats) {
      const signal = header?.signals[stats.signalIndex];
      const name = signal === undefined ? `signal ${stats.signalIndex}` : signal.label;
      const overflow =
        stats.outOfDigitalRangeCount > 0
          ? `  ${stats.outOfDigitalRangeCount} outside the declared range`
          : '';
      lines.push(
        `  ${name.slice(0, 20).padEnd(21)}${stats.observedDigitalMin}..${stats.observedDigitalMax}` +
          ` over ${stats.sampleCount.toLocaleString('en-US')} samples${overflow}`,
      );
    }
  }

  if (report.diagnostics.length > 0) {
    const maxItems = options?.maxItems ?? DEFAULT_MAX_ITEMS;
    lines.push('');
    lines.push(formatDiagnostics(report.diagnostics, { maxItems }));
  }

  return lines.join('\n');
}

/** The header type, re-exported so a consumer of the subpath can name the option. */
export type { EdfHeader };
