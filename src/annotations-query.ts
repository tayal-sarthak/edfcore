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
  const from = secondsToTicks(window.startSeconds);
  const to = from + secondsToTicks(window.durationSeconds);
  if (to <= from) return Object.freeze([]);

  return Object.freeze(
    annotations.filter((annotation) => {
      const onset = annotation.onsetTicksFromFirstRecord;
      const end = onset + (annotation.durationTicks ?? 0n);
      // Half-open on both sides: [onset, end) against [from, to).
      return (
        onset < to && (end > from || (annotation.durationTicks === undefined && onset >= from))
      );
    }),
  );
}

/**
 * The annotations whose text matches.
 *
 * A string matches on the exact trimmed text, because annotation vocabularies are controlled —
 * `Sleep stage W` is a fixed token, and a substring match on `W` would also catch `Sleep stage
 * REM` in files that spell it `W/REM`. Pass a predicate or a RegExp when you want something
 * looser; edfcore does not guess which you meant.
 */
export function filterAnnotationsByText(
  annotations: readonly EdfAnnotation[],
  match: string | RegExp | ((text: string) => boolean),
): readonly EdfAnnotation[] {
  const test =
    typeof match === 'string'
      ? (text: string): boolean => text === match
      : match instanceof RegExp
        ? (text: string): boolean => match.test(text)
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
  const at = secondsToTicks(seconds);
  return Object.freeze(
    annotations.filter((annotation) => {
      const onset = annotation.onsetTicksFromFirstRecord;
      const duration = annotation.durationTicks ?? 0n;
      return duration === 0n ? onset === at : onset <= at && at < onset + duration;
    }),
  );
}
