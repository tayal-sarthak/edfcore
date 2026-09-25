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
 * One ELEMENT, before it is counted.
 *
 * The check above refuses the summary itself; it cannot refuse the summary's own rows, because
 * those are an array. `byCode` carries `code` and `severity` — both of the fields this loop reads —
 * so `summarizeDiagnostics(summary.byCode)` counted them and returned a summary that is wrong in
 * the two numbers the call exists for: `total` became the number of distinct codes rather than of
 * diagnostics, and every `count` became 1. On a file where one code fired four hundred times that
 * reads as a file with one of it.
 *
 * `formatDiagnostics` refused the same rows in 0.6.160, one directory over, and threw on the third
 * field it reads. This one reads only the two a row has, so it answered instead — and the answer is
 * itself a well-formed summary, which is the outcome this package treats as the worst kind.
 *
 * Said in words rather than through `describeValue`, for the reason the check above gives.
 */
function assertDiagnostic(diagnostic: EdfDiagnostic, index: number): void {
  if (typeof (diagnostic as { message?: unknown } | null | undefined)?.message === 'string') return;
  throw new RangeError(
    `summarizeDiagnostics(): the value at ${index} carries no message, so it is not a ` +
      'diagnostic — a row of a by-code summary counts a code rather than being one, and counting ' +
      'those again reports the number of distinct codes as the number of diagnostics. Next: pass ' +
      'header.diagnostics, or the diagnostics on the chunk or the report you have.',
  );
}

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
  // Described in words rather than by type, because this module "imports one type module and
  // nothing else" and that is the property that lets any layer summarise. Without the check the
  // `for..of` below answered `diagnostics is not iterable`: an internal name, no `Next:` clause, and
  // no mention of the three places a caller gets a list (fixed in 0.6.107).
  // Cast in the test, not on the value: `Array.isArray` over a `readonly T[]` narrows the whole
  // parameter to `any[]` and the element type is lost for the rest of the function.
  /*
   * A FORGOTTEN AWAIT, ahead of it, because "not an array" is true of a pending Promise and the
   * advice below names three fields the caller does not have yet.
   *
   * `formatDiagnostics` names the keyword one directory over — it reads its subject out of
   * `describeValue`, whose own note lists the five async calls whose resolved values other guards
   * take and says a message about "an object" is "true of the thing they meant to pass too". This
   * function is that note's twin and was left out of it: it takes the same array, `format.ts`
   * says so in its own `Next:` clause, and a reader who follows that clause from there arrives
   * here with the same Promise.
   *
   * The keyword is half of it, the way it is for `resolveTimeWindow` and `buildTimeline` (0.6.253):
   * none of these calls resolves to a diagnostics array. Each resolves to the header, the report,
   * the chunk or the recording that CARRIES one, so the fix is a field as well as a keyword.
   *
   * A property read and said in words, for the two reasons this module already gives: nothing here
   * awaits or subscribes to anything, and the check below is "described in words rather than by
   * type" so that any layer can summarise without taking on a dependency.
   */
  if (typeof (diagnostics as { then?: unknown } | null | undefined)?.then === 'function') {
    throw new RangeError(
      'summarizeDiagnostics(): the diagnostics are a pending Promise, so there is nothing to ' +
        'summarise yet — and no call in this package resolves to a diagnostics array, so the ' +
        'keyword is half of the fix. Next: pass (await readHeader(source)).diagnostics, or the ' +
        'diagnostics on the recording, chunk or report you already have.',
    );
  }
  if (!Array.isArray(diagnostics as unknown)) {
    throw new RangeError(
      'summarizeDiagnostics(): the diagnostics are not an array, so there is nothing to ' +
        'summarise. Next: pass header.diagnostics, or the diagnostics on the chunk or the ' +
        'report you have.',
    );
  }
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  let worst: EdfSeverity | undefined;

  const counts = new Map<EdfDiagnosticCode, EdfCodeCount>();
  for (const [index, diagnostic] of diagnostics.entries()) {
    assertDiagnostic(diagnostic, index);
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
