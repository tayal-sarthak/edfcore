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

import { matchesText } from './header/lookup.js';
import { secondsToTicks } from './tal/ticks.js';
import type { EdfAnnotation, EdfAnnotationWindow } from './types.js';

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
  const test =
    typeof match === 'string'
      ? (text: string): boolean => text === match
      : match instanceof RegExp
        ? // Not `match.test` directly: a `g` or `y` flag makes `test` stateful across the array
          // and silently returns about half the true matches. See `matchesText`.
          matchesText(match)
        : match;
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
  const at = secondsToTicks(seconds, 'seconds');
  return Object.freeze(
    annotations.filter((annotation) => {
      const onset = annotation.onsetTicksFromFirstRecord;
      const duration = annotation.durationTicks ?? 0n;
      return duration === 0n ? onset === at : onset <= at && at < onset + duration;
    }),
  );
}
