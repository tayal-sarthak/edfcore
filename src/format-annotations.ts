/**
 * Annotations as text.
 *
 * Layer 7, and pure. `formatHeader` does this for the header and `formatDiagnostics` for problems;
 * this is the third, and the one a hypnogram or an event list actually needs.
 *
 * The clock is built from `onsetTicksFromFirstRecord` by integer division, never from the float
 * seconds. That is not fussiness: `onsetSecondsFromFirstRecord` is a float64 produced by dividing
 * an exact tick count by 10,000,000, so an onset written `+1.0000001` can print a millisecond
 * field that is off by one — and an event list is exactly where someone reads a number off the
 * screen and types it into something else.
 *
 * A NEGATIVE onset is legal and prints as one. EDF+ measures onsets from the header start time
 * and a recording may begin after its first annotation, so `-00:00:01.500` is a real thing a real
 * file says. Clamping it to zero would silently move an event.
 */

import { TICKS_PER_SECOND } from './constants.js';
import type { EdfAnnotation } from './types.js';

export interface FormatAnnotationsOptions {
  /** Rows to print. Defaults to every annotation; the count of the rest is always stated. */
  readonly maxItems?: number;
  /** Include the `description@@channel` label EDF+ allows. Off by default: most files have none. */
  readonly includeChannel?: boolean;
}

const TICKS_PER_MILLISECOND = TICKS_PER_SECOND / 1000n;

/**
 * `hh:mm:ss.mmm`, from exact ticks.
 *
 * Truncates to the millisecond rather than rounding, so the printed time never names an instant
 * later than the event. Hours are not wrapped at 24 — a 30-hour recording is a real thing and
 * `30:12:00.000` is more useful than `06:12:00.000` on day two.
 */
function clock(ticks: bigint): string {
  const negative = ticks < 0n;
  const absolute = negative ? -ticks : ticks;

  const totalMilliseconds = absolute / TICKS_PER_MILLISECOND;
  const milliseconds = totalMilliseconds % 1000n;
  const totalSeconds = totalMilliseconds / 1000n;
  const seconds = totalSeconds % 60n;
  const totalMinutes = totalSeconds / 60n;
  const minutes = totalMinutes % 60n;
  const hours = totalMinutes / 60n;

  const pad = (value: bigint, width: number): string => String(value).padStart(width, '0');
  return (
    `${negative ? '-' : ''}${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}` +
    `.${pad(milliseconds, 3)}`
  );
}

/** A duration in seconds, or blank. `undefined` and an explicit `0` are the same instant. */
function duration(annotation: EdfAnnotation): string {
  const ticks = annotation.durationTicks;
  if (ticks === undefined || ticks === 0n) return '';
  return `${clock(ticks)}`;
}

/**
 * A multi-line listing, one annotation per line, in the order given.
 *
 * Returns `''` for an empty list rather than a blank line, so it concatenates into a larger
 * report cleanly — the same rule `formatDiagnostics` follows.
 *
 * The order is the caller's. `readAnnotations` already returns them sorted by onset, and
 * re-sorting here would quietly discard a deliberate `filterAnnotationsByText` ordering.
 */
export function formatAnnotations(
  annotations: readonly EdfAnnotation[],
  options?: FormatAnnotationsOptions,
): string {
  if (annotations.length === 0) return '';

  const limit =
    options?.maxItems === undefined || !Number.isFinite(options.maxItems)
      ? annotations.length
      : Math.max(0, Math.min(annotations.length, Math.floor(options.maxItems)));

  const rows: string[] = [];
  for (let i = 0; i < limit; i += 1) {
    const annotation = annotations[i];
    if (annotation === undefined) continue;
    const parts = [
      clock(annotation.onsetTicksFromFirstRecord),
      duration(annotation).padEnd(12),
      annotation.text,
    ];
    if (options?.includeChannel === true && annotation.channelLabel !== undefined) {
      parts.push(`@@${annotation.channelLabel}`);
    }
    rows.push(parts.join('  ').trimEnd());
  }

  const hidden = annotations.length - limit;
  // Always stated. A truncated listing that does not say so reads as a complete one.
  if (hidden > 0) rows.push(`... and ${hidden} more`);

  return rows.join('\n');
}
