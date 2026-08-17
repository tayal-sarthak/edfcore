/**
 * Diagnostics, counted.
 *
 * Layer 1. Imports one type module and nothing else, which is what lets any layer summarise a
 * diagnostics array without taking on a dependency.
 *
 * `formatDiagnostics` turns a list into text for a human. This turns the same list into numbers
 * for a program: the question "is anything wrong with this header, and how wrong" has no answer
 * on `EdfHeader` — `validateRecording` produces a `report.ok`, but that needs a full scan, and a
 * caller who has only just parsed the header has nothing to test but `diagnostics.length`.
 *
 * The one thing worth knowing before acting on `errors > 0`: an `error` here does not mean the
 * file failed to read. It means at least one diagnostic has `error` severity, and the `deferred`
 * codes — a signal whose gain cannot be computed — carry that severity while the file parses,
 * reads and decodes perfectly. `signal.scale` is `undefined` for that one signal and every other
 * signal is fine. Refusing the whole recording on that count throws away good data.
 */

import type { EdfDiagnostic, EdfDiagnosticCode, EdfSeverity } from '../types.js';

/**
 * One diagnostic code and how often it fired. The severity is carried here too so a caller
 * ranking codes never has to reach back into the diagnostics array to find out whether the most
 * frequent one is also the most serious — it usually is not.
 */
export interface EdfCodeCount {
  readonly code: EdfDiagnosticCode;
  readonly severity: EdfSeverity;
  readonly count: number;
}

/**
 * Counts over a diagnostics array, for deciding what to show before showing anything. A file
 * with four hundred notes is a real case — one bad field repeated per record — so the summary
 * exists to be rendered instead of the list, not alongside it.
 */
export interface EdfDiagnosticSummary {
  readonly total: number;
  readonly errors: number;
  readonly warnings: number;
  readonly infos: number;
  /** The highest severity present, or `undefined` when there are no diagnostics at all. */
  readonly worst: EdfSeverity | undefined;
  /** Distinct codes, most frequent first. Ties keep first-seen order. */
  readonly byCode: readonly EdfCodeCount[];
}

/** Descending, so the first entry is the worst thing in the list. */
const SEVERITY_RANK: Record<EdfSeverity, number> = { error: 3, warning: 2, info: 1 };

/**
 * Counts by severity and by code.
 *
 * `worst` is by severity rank, not by insertion order and not alphabetical — `error` beats
 * `warning` beats `info`. It is `undefined` for an empty list rather than `'info'`, which would
 * claim a note exists when none does.
 *
 * `byCode` is ordered by count, descending: on a damaged file one code usually accounts for most
 * of the list — `TIMEKEEPING_TAL_MISSING` is reported per record — and that is the one to look at
 * first. `Array.prototype.sort` is stable, so equal counts keep the order they were first seen.
 */
export function summarizeDiagnostics(diagnostics: readonly EdfDiagnostic[]): EdfDiagnosticSummary {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  let worst: EdfSeverity | undefined;

  const counts = new Map<EdfDiagnosticCode, EdfCodeCount>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'error') errors += 1;
    else if (diagnostic.severity === 'warning') warnings += 1;
    else infos += 1;

    if (worst === undefined || SEVERITY_RANK[diagnostic.severity] > SEVERITY_RANK[worst]) {
      worst = diagnostic.severity;
    }

    const existing = counts.get(diagnostic.code);
    counts.set(diagnostic.code, {
      code: diagnostic.code,
      // The severity of a code is fixed by `severityOf`, so the first one seen is the one.
      severity: existing?.severity ?? diagnostic.severity,
      count: (existing?.count ?? 0) + 1,
    });
  }

  return {
    total: diagnostics.length,
    errors,
    warnings,
    infos,
    worst,
    byCode: Object.freeze([...counts.values()].sort((a, b) => b.count - a.count)),
  };
}
