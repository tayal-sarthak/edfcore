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
import { requireItemLimit } from './options.js';
import { floorDiv } from './tal/ticks.js';
import { printable } from './text/printable.js';
import type { EdfAnnotation } from './types.js';

/**
 * Options for `formatAnnotations`. Truncation always says how much it withheld — a listing that
 * silently stopped would be indistinguishable from a recording that simply had no more events,
 * which is the one thing a reader scanning event output cannot afford to guess at.
 */
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
 * FLOORS to the millisecond rather than rounding, so the printed time never names an instant later
 * than the event — in either direction. Hours are not wrapped at 24 — a 30-hour recording is a
 * real thing and `30:12:00.000` is more useful than `06:12:00.000` on day two.
 */
function clock(ticks: bigint): string {
  // Floored toward -Infinity, not truncated toward zero. Taking the magnitude first and then
  // truncating moves a NEGATIVE onset LATER: `-1.5009 s` printed as `-00:00:01.500`, 0.9 ms after
  // the event. The positive twin `+1.5009` printed `00:00:01.500`, correctly before its event, so
  // the guarantee held for exactly the half of the range that the note at the top of this file
  // has to argue is legal at all. `-1.5009` now prints `-00:00:01.501` (fixed in 0.3.45).
  const flooredMilliseconds = floorDiv(ticks, TICKS_PER_MILLISECOND);
  const negative = flooredMilliseconds < 0n;
  const totalMilliseconds = negative ? -flooredMilliseconds : flooredMilliseconds;

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

  const limit = requireItemLimit(options?.maxItems, annotations.length);

  /*
   * Both time columns are sized from the rows being printed, the way `formatHeader` sizes its
   * index column, because both can hold a value wider than a fixed width.
   *
   * `hh:mm:ss.mmm` is twelve characters until it is not. A negative onset spends one on the sign —
   * `-00:00:01.500`, which the note at the top of this file argues is legal and which 0.3.45
   * exists to print correctly — and the hours are deliberately not wrapped at 24, so a week of
   * long-term monitoring reads `168:00:00.000`. Either one on one row of a listing moved the text
   * column on that row and no other, and the onset column was not padded at all, so the misaligned
   * row was usually the first: a pre-stimulus baseline sorts before everything (fixed in 0.6.25).
   *
   * Twelve is the floor, so a listing whose times all fit prints exactly what it printed before —
   * including one where every event is instantaneous and every duration is empty.
   */
  const cells = [];
  for (let i = 0; i < limit; i += 1) {
    const annotation = annotations[i];
    if (annotation === undefined) continue;
    cells.push({
      onset: clock(annotation.onsetTicksFromFirstRecord),
      duration: duration(annotation),
      annotation,
    });
  }
  const onsetWidth = Math.max(12, ...cells.map((cell) => cell.onset.length));
  const durationWidth = Math.max(12, ...cells.map((cell) => cell.duration.length));

  const rows: string[] = [];
  for (const { onset, duration: span, annotation } of cells) {
    // Annotation text is exposed verbatim by design — the TAL grammar reserves 0x00, 0x14 and
    // 0x15 and nothing else, so 0x0a and 0x09 reach `text` unchanged. One event holding a newline
    // would print as two rows, and the second would carry no time of its own, so it reads as an
    // event at the time above it. `annotation.text` still holds the bytes as written.
    const parts = [
      onset.padEnd(onsetWidth),
      span.padEnd(durationWidth),
      printable(annotation.text),
    ];
    if (options?.includeChannel === true && annotation.channelLabel !== undefined) {
      parts.push(`@@${printable(annotation.channelLabel)}`);
    }
    rows.push(parts.join('  ').trimEnd());
  }

  const hidden = annotations.length - limit;
  // Always stated. A truncated listing that does not say so reads as a complete one.
  if (hidden > 0) rows.push(`... and ${hidden} more`);

  return rows.join('\n');
}
