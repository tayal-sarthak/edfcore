/**
 * Querying annotations that are already in hand.
 *
 * Layer 7, and pure: nothing here reads. `readAnnotations` returns every event in a record range,
 * and the next thing a caller does is almost always narrow it — to a time window, to a label, to
 * the stages of a hypnogram.
 *
 * Doing that by hand goes wrong in one specific way. The obvious filter is
 * `a.onsetSecondsFromFirstRecord >= from && ... < to`, and those are float64 seconds converted
 * from exact tick counts. An onset stored as `+30.0000001` and a bound of `30.0000001` need not
 * compare equal once both have been through a division by 10,000,000. Every comparison here is on
 * ticks, which are exact, and the bounds are converted to ticks once.
 *
 * The ticks compared are `onsetTicksFromFirstRecord`, not `onsetTicks`. The window is in the same
 * seconds `resolveTimeWindow` and `readWindow` take, and those put `t = 0` at the start of record
 * 0; `onsetTicks` is on the header's timebase, which sits up to a second earlier when the file
 * declares a sub-second start offset in record 0's timekeeping TAL. Comparing against the wrong
 * one puts events in the neighbouring window on exactly the files that bother to state their
 * offset.
 */

import { assertMatcher, matchesText } from './header/lookup.js';
import { secondsToTicks } from './tal/ticks.js';
import { describeValue } from './text/describe.js';
import type { EdfAnnotation, EdfAnnotationWindow } from './types.js';

/**
 * The list itself, before it is filtered or walked.
 *
 * `readAnnotations` returns `{ annotations, recordOnsetTicks, diagnostics }`, so the whole result is
 * what a caller has in hand and `filterAnnotationsByTime(result, window)` is the call the variable
 * name suggests. It reached `annotations.filter` and threw V8's "annotations.filter is not a
 * function"; `countAnnotationsByText` walks its argument instead and said "annotations is not
 * iterable". Neither names the argument, and neither mentions the one field that fixes it.
 *
 * 0.6.95 did this for the two formatters, whose `''` is an answer. These throw, so the cost is a
 * message rather than a wrong result — but it is the same argument, four functions over (fixed in
 * 0.6.107).
 */
function assertAnnotations(annotations: readonly EdfAnnotation[], call: string): void {
  if (!Array.isArray(annotations)) {
    throw new RangeError(
      `${call}(): the annotations are ${describeValue(annotations)}, not an array. Next: pass the ` +
        '`annotations` field of what readAnnotations(recording, records) resolved to, which is a ' +
        'result object rather than the list itself.',
    );
  }
  /*
   * And the ELEMENTS, which being an array says nothing about.
   *
   * The three printers closed this one at a time — `formatDiagnostics` in 0.6.160,
   * `summarizeDiagnostics` in 0.6.168, `formatAnnotations` in 0.6.185 — and these four QUERIES share
   * a guard that still stopped at `Array.isArray`. Three of the four then answered:
   * `filterAnnotationsByText` and `annotationsAt` returned `[]`, which means "no event matches" said
   * of a list holding no events at all, and `countAnnotationsByText` returned one row counting
   * `undefined`. Only `filterAnnotationsByTime` failed, with V8's `Cannot mix BigInt and other
   * types` out of the tick comparison.
   *
   * `header.diagnostics` and `timeline.diagnostics` are the lists that get passed: they are the
   * other arrays a reader holds after opening a file, and the printers for both sit beside these
   * four in the barrel.
   *
   * The onset is the field to test — every one of these four reads it, and it is the one an
   * annotation cannot be without.
   */
  const first = annotations[0] as { onsetTicksFromFirstRecord?: unknown } | undefined;
  if (annotations.length === 0 || typeof first?.onsetTicksFromFirstRecord === 'bigint') return;
  throw new RangeError(
    `${call}(): the value at 0 carries no onset, so this is not a list of annotations — and three ` +
      'of these four calls answer with a list, so a wrong one reads as a recording with nothing in ' +
      'it. Next: pass the `annotations` field of what readAnnotations(recording, records) resolved ' +
      'to, or print a list of diagnostics with formatDiagnostics().',
  );
}

/**
 * The annotations that overlap a time window, in the recording's own timebase.
 *
 * Overlap, not containment: an annotation with a duration counts when any part of it falls in the
 * window, so a 30-second sleep epoch is returned for a window inside it. A zero-duration event
 * counts when its onset is in `[startSeconds, startSeconds + durationSeconds)` — half-open, so
 * adjacent windows partition the recording without double-counting the boundary.
 */
export function filterAnnotationsByTime(
  annotations: readonly EdfAnnotation[],
  window: EdfAnnotationWindow,
): readonly EdfAnnotation[] {
  assertAnnotations(annotations, 'filterAnnotationsByTime');
  // The window itself, before a field of it is read. 0.6.79 made this argument for the reading
  // API and 0.6.98 finished it there; this is the one function left in the package that takes a
  // window object, and it reached `window.startSeconds` on an absent one — V8's `TypeError:
  // Cannot read properties of undefined (reading 'startSeconds')`, naming a field rather than the
  // argument, with no `Next:` clause.
  if (typeof window !== 'object' || window === null) {
    /*
     * A NUMBER, which is an INSTANT, and the one wrong window whose advice led somewhere worse than
     * where it started.
     *
     * "Pass a window carrying startSeconds and durationSeconds" is followable: a reader holding a
     * cursor position writes `{ startSeconds: t, durationSeconds: 0 }`, because a window over one
     * instant has no length. `annotationsAt`'s own docblock says what that does — the window form
     * "works — a zero-length window — except that `filterAnnotationsByTime` returns nothing for a
     * non-positive duration, so the obvious call returns an empty list at every position" — and it
     * is why that function exists at all. So the advice ended in silence rather than in an error,
     * at the call a viewer makes on every mouse move.
     *
     * The sibling is one export away and takes exactly what was passed. 0.6.88 made this argument
     * for `readWindow` and `readRecords`, the other pair in this package that differ only in the
     * unit they bound by.
     */
    throw new RangeError(
      `filterAnnotationsByTime(): the window is ${describeValue(window)}, not an object.` +
        (typeof window === 'number'
          ? ' That is an instant, and this call bounds events by an interval — a zero-length one ' +
            'returns nothing, so a cursor position asked for as a window reads as no annotations ' +
            'at every position. Next: call annotationsAt(annotations, seconds), which takes the ' +
            'instant, or pass a window carrying startSeconds and durationSeconds.'
          : ' Next: pass a window carrying startSeconds and durationSeconds.'),
    );
  }
  /*
   * An ARRAY, which is an object and therefore walked straight past the check above.
   *
   * 0.6.167 closed this route for the reading API's selection and recorded what it costs: an array
   * "reproduced the exact failure 0.6.79 removed — each call named whichever field it happened to
   * read first". Here that field is `window.startSeconds`, and the advice attached to an absent
   * bound is about "an object whose bounds are spelled something else" — which sends a reader to
   * rename fields on a value that has none.
   *
   * The array a caller has in hand is the one this function's own neighbour returns.
   * `resolveTimeWindow` is named for the window and returns the RECORD RANGES it maps to, so
   * `const window = resolveTimeWindow(timeline, index, from, span)` reads exactly like the argument
   * this takes.
   */
  if (Array.isArray(window)) {
    throw new RangeError(
      'filterAnnotationsByTime(): the window is an array, and this call bounds events by time ' +
        'rather than by record. resolveTimeWindow() returns the record ranges a window maps to, ' +
        'not the window. Next: pass the startSeconds and durationSeconds you gave that call, on ' +
        'an object.',
    );
  }
  const from = secondsToTicks(window.startSeconds, 'window.startSeconds');
  const to = from + secondsToTicks(window.durationSeconds, 'window.durationSeconds');
  if (to <= from) return Object.freeze([]);

  return Object.freeze(
    annotations.filter((annotation) => {
      const onset = annotation.onsetTicksFromFirstRecord;
      const end = onset + (annotation.durationTicks ?? 0n);
      // Half-open on both sides: [onset, end) against [from, to). An instantaneous event has an
      // empty interval, so `end > from` can never hold for one and it needs the second clause.
      //
      // That clause tests `end === onset` — the event's actual duration — and NOT
      // `durationTicks === undefined`, which is a fact about the WRITER rather than the event. A
      // TAL may spell an instant either by omitting the duration field or by writing `0`, the two
      // are the same instant, and `annotations.md` says edfcore does not distinguish them. Keying
      // on the spelling dropped every explicitly-zero event from the window starting at its own
      // onset — and from the previous window too, so in an adjacent-window partition it belonged
      // to no window at all (fixed in 0.2.20).
      return onset < to && (end > from || (end === onset && onset >= from));
    }),
  );
}

/**
 * The annotations whose text matches.
 *
 * A string matches the text VERBATIM, because annotation vocabularies are controlled —
 * `Sleep stage W` is a fixed token, and a substring match on `W` would also catch `Sleep stage
 * REM` in files that spell it `W/REM`. Pass a predicate or a RegExp when you want something
 * looser; edfcore does not guess which you meant.
 *
 * Verbatim means verbatim, in both directions: `annotation.text` is the TAL's bytes as written and
 * is never trimmed (`api-types.md` says so of the field itself), so an event a scorer spelled
 * `'Sleep stage W '` is not matched by `'Sleep stage W'`, and a query with its own stray space
 * matches nothing. This docblock used to say "the exact trimmed text", which is neither what this
 * function does nor what the field holds, and the failure it describes is silent: a padded
 * vocabulary returns an empty list rather than an error (corrected in 0.3.51). For such a file,
 * pass the predicate that says what you mean — `(text) => text.trim() === label`.
 */
export function filterAnnotationsByText(
  annotations: readonly EdfAnnotation[],
  match: string | RegExp | ((text: string) => boolean),
): readonly EdfAnnotation[] {
  assertAnnotations(annotations, 'filterAnnotationsByText');
  const test =
    typeof match === 'string'
      ? (text: string): boolean => text === match
      : match instanceof RegExp
        ? // Not `match.test` directly: a `g` or `y` flag makes `test` stateful across the array
          // and silently returns about half the true matches. See `matchesText`.
          matchesText(match)
        : assertMatcher(
            match,
            'filterAnnotationsByText',
            'a string matched verbatim, a RegExp, or a predicate on the text',
            'pass the label as a string, or (text) => text.trim() === label for a file whose ' +
              'vocabulary is padded',
          );
  return Object.freeze(annotations.filter((annotation) => test(annotation.text)));
}

/**
 * Counts annotations by their exact text, most frequent first.
 *
 * The first thing worth knowing about an unfamiliar scoring file: which labels it uses and how
 * often. Ties keep insertion order, so the output is deterministic for a given input.
 */
export function countAnnotationsByText(
  annotations: readonly EdfAnnotation[],
): ReadonlyArray<{ readonly text: string; readonly count: number }> {
  assertAnnotations(annotations, 'countAnnotationsByText');
  const counts = new Map<string, number>();
  for (const annotation of annotations) {
    counts.set(annotation.text, (counts.get(annotation.text) ?? 0) + 1);
  }
  return Object.freeze(
    [...counts].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count),
  );
}

/**
 * The annotations covering an instant.
 *
 * A viewer with a cursor asks this on every mouse move. The window form works — a zero-length
 * window — except that `filterAnnotationsByTime` returns nothing for a non-positive duration, so
 * the obvious call returns an empty list at every position. This is the instant form: an
 * annotation covers `t` when `onset <= t < onset + duration`, and a zero-duration event covers
 * only its own onset.
 */
export function annotationsAt(
  annotations: readonly EdfAnnotation[],
  seconds: number,
): readonly EdfAnnotation[] {
  assertAnnotations(annotations, 'annotationsAt');
  /*
   * And the OTHER WAY. `filterAnnotationsByTime` is the neighbour this function's docblock names,
   * the two differ only in whether they bound by an instant or by an interval, and a window here
   * reached `secondsToTicks` — which answered "seconds must be a number of seconds, and was given
   * an object. Next: convert it first". There is no conversion: a window is not a number spelled
   * differently, and the reader was being sent to invent one.
   */
  const given = seconds as { startSeconds?: unknown; durationSeconds?: unknown } | null | undefined;
  if (typeof given === 'object' && given !== null && !Array.isArray(given)) {
    if ('startSeconds' in given || 'durationSeconds' in given) {
      throw new RangeError(
        'annotationsAt(): that is a time window, and this call takes a single instant in seconds. ' +
          'Next: pass window.startSeconds for the instant under a cursor, or call ' +
          'filterAnnotationsByTime(annotations, window), which is the one that takes an interval.',
      );
    }
  }
  const at = secondsToTicks(seconds, 'seconds');
  return Object.freeze(
    annotations.filter((annotation) => {
      const onset = annotation.onsetTicksFromFirstRecord;
      const duration = annotation.durationTicks ?? 0n;
      return duration === 0n ? onset === at : onset <= at && at < onset + duration;
    }),
  );
}
