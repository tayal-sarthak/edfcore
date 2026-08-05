/**
 * Finding a signal by name.
 *
 * Layer 2. Two functions and a predicate, and the reason they exist rather than being left to
 * the caller: deleting name lookup does not delete `signals.find(s => s.label === label)`, which
 * silently returns the first of a duplicate pair. CHB-MIT ships `'T8-P8'` twice, and picking one
 * of them by accident is how the wrong channel ends up in a paper.
 *
 * Matching is exact on the TRIMMED label and is case-sensitive. Nothing else is normalised: EDF
 * labels are electrode names, `'Fp1'` and `'FP1'` are written by different systems, and edfcore
 * has no montage vocabulary to decide they are the same thing.
 */

import { trimEdfField } from '../bytes/latin1.js';
import { BDF_ANNOTATIONS_LABEL, EDF_ANNOTATIONS_LABEL } from '../constants.js';
import { EdfAmbiguousChannelError, EdfChannelNotFoundError } from '../errors.js';
import type { EdfHeader, EdfSignal } from '../types.js';

/**
 * True for the two reserved annotation labels, matched on the trimmed text and case-sensitively.
 *
 * Both are accepted for either family: the label identifies the channel's ROLE, and a BDF+ file
 * written by an EDF+ library carries `'EDF Annotations'` — refusing to recognise it there would
 * expose a text channel as if it held samples.
 */
export function isAnnotationLabel(label: string): boolean {
  const trimmed = trimEdfField(label);
  return trimmed === EDF_ANNOTATIONS_LABEL || trimmed === BDF_ANNOTATIONS_LABEL;
}

/** Every signal with this label, in signal order. Empty when none matches. */
export function findSignals(header: EdfHeader, label: string): readonly EdfSignal[] {
  const wanted = trimEdfField(label);
  return Object.freeze(header.signals.filter((signal) => signal.label === wanted));
}

function quoteLabels(header: EdfHeader): string {
  return header.signals.map((signal) => JSON.stringify(signal.label)).join(', ');
}

/**
 * One signal, by index or by label.
 *
 * A numeric selector indexes `header.signals` directly. A label that matches nothing throws
 * `EdfChannelNotFoundError` carrying every available label; a label that matches more than one
 * signal throws `EdfAmbiguousChannelError` carrying the indices, because there is no answer
 * edfcore could return that would not be a guess.
 */
export function getSignal(header: EdfHeader, selector: number | string): EdfSignal {
  if (typeof selector === 'number') {
    const signal = header.signals[selector];
    if (signal !== undefined) return signal;
    throw new EdfChannelNotFoundError(
      `signal index ${selector} is outside the ${header.signals.length} signals this file ` +
        `declares. Labels, in signal order: ${quoteLabels(header)}. Next: pass an index in ` +
        `0..${header.signals.length - 1}, or a label.`,
      { selector, availableLabels: header.signals.map((signal) => signal.label) },
    );
  }

  const matches = findSignals(header, selector);
  const first = matches[0];
  if (first === undefined) {
    throw new EdfChannelNotFoundError(
      `no signal is labelled ${JSON.stringify(trimEdfField(selector))} in this file. Labels, ` +
        `in signal order: ${quoteLabels(header)}. Matching is exact on the trimmed label and ` +
        'is case-sensitive. Next: pass one of those labels, or select by index.',
      { selector, availableLabels: header.signals.map((signal) => signal.label) },
    );
  }
  if (matches.length === 1) return first;

  const matchingIndices = matches.map((signal) => signal.index);
  throw new EdfAmbiguousChannelError(
    `label ${JSON.stringify(trimEdfField(selector))} matches ${matches.length} signals ` +
      `(indices ${matchingIndices.join(', ')}), so getSignal cannot choose one — returning the ` +
      'first is how the wrong channel ends up in a paper. Next: call findSignals() to get them ' +
      'all, or select by index.',
    { label: trimEdfField(selector), matchingIndices },
  );
}

/**
 * Every data signal whose label matches a pattern.
 *
 * `findSignals` matches one exact label, which is right when you know what you want. This is for
 * the other case: a montage is a family — `EEG Fpz-Cz`, `EEG Pz-Oz` — and picking it out by hand
 * means filtering `header.signals` and remembering to drop the annotations channel, which is the
 * step people forget. Its bytes are TAL text, so decoding them as samples produces numbers that
 * look like a signal.
 *
 * Annotation channels are never returned. Pass a RegExp or a predicate; a plain string is the
 * exact-match case `findSignals` already covers.
 */
export function matchSignals(
  header: EdfHeader,
  match: RegExp | ((label: string) => boolean),
): readonly EdfSignal[] {
  const test = match instanceof RegExp ? (label: string): boolean => match.test(label) : match;
  return Object.freeze(
    header.signals.filter((signal) => signal.kind === 'data' && test(signal.label)),
  );
}

/**
 * The recording's total declared length in seconds.
 *
 * `recordCount * recordDurationSeconds`, which is the arithmetic every caller writes by hand.
 * Zero for a file whose record duration is zero — legal EDF, and the honest answer, since such a
 * file's records do not advance in time.
 *
 * This is the DECLARED length. On an EDF+D file the recording spans longer than this, because the
 * gaps between records are not covered by any record; `timeline.spanSeconds` is that number.
 */
export function declaredDurationSeconds(header: EdfHeader): number {
  return header.recordCount * header.recordDurationSeconds;
}
