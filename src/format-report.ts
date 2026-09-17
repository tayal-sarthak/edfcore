/**
 * A validation report as text.
 *
 * Layer 7, and pure. Part of `edfcore/validate`.
 *
 * `validateRecording` returns a report a program can branch on; this turns it into the thing a
 * person reads at the end of a CI job or a conformance sweep.
 *
 * The one judgement it makes is what to lead with. A sweep over a damaged file can produce six
 * figures of diagnostics — `TIMEKEEPING_TAL_MISSING` is per record — and a wall of them buries
 * the answer. So the counts come first, then the distinct codes with how often each occurred,
 * and only then the individual entries, capped. What a reader needs first is *which kinds* of
 * thing are wrong and how much of the file is affected.
 */

import { assertRedactableFields, formatDiagnostics } from './diagnostics/format.js';
import { summarizeDiagnostics } from './diagnostics/summary.js';
import { assertOptions } from './options.js';
import { plural, pluralise } from './text/counted.js';
import { printable } from './text/printable.js';
import type { EdfHeader, FormatReportOptions, ValidationReport } from './types.js';

/** Enough to see the pattern, few enough to read. Override with `maxItems`. */
const DEFAULT_MAX_ITEMS = 20;

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
  /*
   * The report, before `summarizeDiagnostics` is asked about its diagnostics.
   *
   * Without it the refusal came from that helper and carried that helper's advice: "Next: pass
   * header.diagnostics, or the diagnostics on the chunk or the report you have." This function does
   * not take diagnostics, so a caller who passed `report.diagnostics` — which is the obvious thing
   * to reach for, and the mistake most likely to be made — was told to pass exactly what they had
   * just passed. A message naming the wrong argument is the defect 0.6.97 and 0.6.104 exist for
   * (fixed in 0.6.113).
   */
  const given = report as { ok?: unknown; diagnostics?: unknown } | null | undefined;
  if (typeof given?.ok !== 'boolean' || !Array.isArray(given.diagnostics)) {
    /*
     * A FORGOTTEN AWAIT, which the advice below quotes back without the keyword.
     *
     * `validateRecording` is async, and the next step says "pass what validateRecording(recording)
     * resolved to" — so a reader who wrote `formatValidationReport(validateRecording(recording))`
     * was shown the expression they had just written and told to pass what it resolves to, with no
     * word for the difference. 0.6.215 named that shape for the index guard: advice a reader
     * follows and arrives back where they started.
     *
     * It is the likelier of the two mistakes this guard catches, because the sweep and the printer
     * are written on consecutive lines and only one of them is awaited.
     */
    if (typeof (report as { then?: unknown } | null | undefined)?.then === 'function') {
      throw new RangeError(
        'formatValidationReport(): that is a pending Promise, not a validation report. Next: ' +
          'await validateRecording(recording) — it resolves to the report this prints.',
      );
    }
    throw new RangeError(
      'formatValidationReport(): that is not a validation report — it has no `ok` and no ' +
        '`diagnostics` list. Next: pass what validateRecording(recording) resolved to, in whole: ' +
        'the verdict, the counts and the bytes read all come off the report, not off its ' +
        'diagnostics.',
    );
  }
  /*
   * An INSPECTION, which carries `ok`, `diagnostics` AND `bytesRead`, so the check above sees a
   * report and the two lines below it both render.
   *
   * `inspectEdf` and `validateRecording` are the two sweeps this package exports and the two
   * commands the CLI wraps, so the printer for one is what a caller reaches for holding the other.
   * The overlap is the whole of what this prints first: it announced `PASS` — a VERDICT — over an
   * object whose `ok` means only that the header parsed, printed `scanned undefined records` for a
   * call that scans none, and then died on `report.signalStats.length` with V8's `Cannot read
   * properties of undefined`, which is the failure 0.6.113 added the guard above to remove.
   *
   * `recordsScanned` is the field to test rather than `signalStats`, because it is the first of the
   * two a reader sees go wrong and the one that states what an inspection did not do.
   */
  if (typeof (given as { recordsScanned?: unknown }).recordsScanned !== 'number') {
    throw new RangeError(
      'formatValidationReport(): that is an inspection, not a validation report — inspectEdf() ' +
        'reads the header and stops, so it scanned no records and observed no sample ranges, and ' +
        '`ok` on it means the header parsed rather than the file conformed. Next: pass what ' +
        'validateRecording(recording) resolved to, or print an inspection with ' +
        'formatHeader(inspection.header).',
    );
  }
  const lines: string[] = [];
  /*
   * The HEADER option, before a signal is taken out of it.
   *
   * It is the one field on these options that is an object, and the recording is what a caller
   * holds — `formatValidationReport(report, { header: recording })` is one field short of the call
   * above it, `validateRecording(recording)`. Nothing checked it: the first argument has been
   * guarded since 0.6.113 and the options object since `assertOptions`, and the object inside them
   * was not.
   *
   * It only shows up once the report has SIGNAL STATS, because that is the only block this names
   * signals in — so a sweep with `scanSamples` off printed fine and the same call with it on threw
   * V8's `Cannot read properties of undefined (reading '0')` from `header.signals[…]`, or, for a
   * chunk, `text is not iterable` from `printable`. Whether it failed at all depended on how much
   * of the file had been read.
   *
   * The option's whole job is the difference between `EEG Fpz-Cz` and `signal 0`, so it is also the
   * one a caller adds last, to a call that already worked.
   */
  if (options?.header !== undefined) {
    // Being an array is not the test; being an array of the RIGHT signals is — a chunk carries one
    // too, and its entries have no `label` for a row to be named with. That is the rule 0.6.183 and
    // 0.6.186 settled for the lookups and for `trimToWindow`.
    const signals = (options.header as EdfHeader | undefined)?.signals as unknown;
    const named =
      Array.isArray(signals) &&
      (signals.length === 0 || typeof (signals[0] as { label?: unknown })?.label === 'string');
    if (!named) {
      throw new RangeError(
        'formatValidationReport(): options.header is not a header — nothing on it carries the ' +
          'labels this names the rows with, which is all this option does. Next: pass ' +
          'recording.header, or omit it and the rows read `signal 0`.',
      );
    }
  }
  const header = options?.header;

  // Before anything is rendered, and outside the `diagnostics.length > 0` branch below. A report
  // that passes still has to report a misspelled `redactFields`: the typo belongs to the call, and
  // the clean file is the cheap place to find out about it.
  assertOptions(options, 'formatValidationReport', 'diagnostic');
  assertRedactableFields(options?.redactFields);

  // One counting implementation, shared with the public `summarizeDiagnostics`.
  const summary = summarizeDiagnostics(report.diagnostics);

  const verdict = report.ok ? 'PASS' : 'FAIL';
  const severities =
    summary.total === 0
      ? 'no diagnostics'
      : (
          [
            [summary.errors, 'error'],
            [summary.warnings, 'warning'],
            [summary.infos, 'info'],
          ] as const
        )
          .filter(([count]) => count > 0)
          // Through `pluralise`, like the record count on the line below, and since 0.6.4 like
          // every other count this package prints. Until 0.4.421 this
          // interpolated the severity name raw, so the first line of every `edfcore validate`
          // read "2 error, 1 warning, 2 info" above a line reading "scanned 12 records" — one
          // function, two conventions, and the ungrammatical one on the line a reader sees first.
          .map(([count, severity]) => pluralise(count, severity))
          .join(', ');
  lines.push(`${verdict} — ${severities}`);
  lines.push(
    `scanned ${pluralise(report.recordsScanned, 'record')}, ` +
      `read ${report.bytesRead.toLocaleString('en-US')} ${plural('byte', report.bytesRead)}`,
  );

  if (summary.byCode.length > 0) {
    lines.push('');
    lines.push('by code:');
    // Already descending by count: the code affecting most of the file comes first.
    for (const { code, count } of summary.byCode) {
      lines.push(`  ${String(count).padStart(7)}  ${code}`);
    }
  }

  if (report.signalStats.length > 0) {
    lines.push('');
    lines.push('observed sample ranges:');
    /*
     * The range and the count are sized from the rows, not left to fall where they land.
     *
     * An observed range is as wide as the numbers in it, and those differ per channel: on the
     * PhysioNet polysomnogram the seven rows read `-2048..1819`, `-54..1905` and `136..980`, so
     * the word `over` sat at three different columns in one block and the sample counts under it
     * at three more. It is the same defect as the sample rate (0.6.23), the signal index (0.6.24)
     * and the event clock (0.6.25) — a value wider than the space it was given — in the fourth
     * formatter, and the same fix: measure the rows first.
     *
     * The count is right-aligned because it is a number and the eye compares magnitudes down a
     * column. A single-signal file has one row, so its widths are its own and its output does not
     * move.
     */
    const rows = report.signalStats.map((stats) => {
      const signal = header?.signals[stats.signalIndex];
      // Through `printable` for the reason `formatHeader` does it: a label is arbitrary bytes
      // from the file, and one holding a newline would open a row naming a signal that does not
      // exist — in a conformance report, which is read precisely because the file is suspect.
      const name = signal === undefined ? `signal ${stats.signalIndex}` : printable(signal.label);
      return {
        name: name.slice(0, 20).padEnd(21),
        range: `${stats.observedDigitalMin}..${stats.observedDigitalMax}`,
        count: stats.sampleCount.toLocaleString('en-US'),
        noun: plural('sample', stats.sampleCount),
        overflow:
          stats.outOfDigitalRangeCount > 0
            ? `  ${stats.outOfDigitalRangeCount} outside the declared range`
            : '',
      };
    });
    const rangeWidth = Math.max(...rows.map((row) => row.range.length));
    const countWidth = Math.max(...rows.map((row) => row.count.length));

    for (const row of rows) {
      lines.push(
        `  ${row.name}${row.range.padEnd(rangeWidth)} over ${row.count.padStart(countWidth)} ` +
          `${row.noun}${row.overflow}`,
      );
    }
  }

  if (report.diagnostics.length > 0) {
    const maxItems = options?.maxItems ?? DEFAULT_MAX_ITEMS;
    lines.push('');
    lines.push(
      formatDiagnostics(report.diagnostics, {
        maxItems,
        ...(options?.redactFields === undefined ? {} : { redactFields: options.redactFields }),
      }),
    );
  }

  return lines.join('\n');
}

/** The header type, re-exported so a consumer of the subpath can name the option. */
export type { EdfHeader };
