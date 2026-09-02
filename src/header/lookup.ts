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
import { ticksToSeconds } from '../tal/ticks.js';
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

/**
 * Enough labels to recognise the file, few enough to read in a terminal.
 *
 * Every other listing this package prints is capped — 24 bytes of hex, 16 bytes of field evidence,
 * twenty diagnostics — and this one was not, in the one message whose length grows with the file.
 * A mistyped label on a 512-signal recording put five thousand characters on one line behind
 * `edfcore: `, and `inspect.ts` names a 512-signal file as the realistic one. The full list is
 * still on the error, as `availableLabels`, for a program that wants it.
 */
const LABELS_SHOWN = 12;

/** The whole label list, capped, saying how many it withheld — never silently truncated. */
function quoteLabels(header: EdfHeader, first?: string): string {
  const labels = header.signals.map((signal) => signal.label);
  const ordered =
    first === undefined ? labels : [first, ...labels.filter((label) => label !== first)];
  const shown = ordered.slice(0, LABELS_SHOWN).map((label) => JSON.stringify(label));
  const hidden = ordered.length - shown.length;
  return hidden > 0 ? `${shown.join(', ')}, and ${hidden} more` : shown.join(', ');
}

/**
 * `String.prototype.toLowerCase`, not `toLocaleLowerCase`: the second one folds `'I'` to a dotless
 * `'ı'` under a Turkish locale, and this package's output is deterministic and locale-free.
 */
const foldCase = (text: string): string => trimEdfField(text).toLowerCase().replace(/\s+/g, ' ');

/**
 * The label that differs from the selector only in case or in internal spacing, if there is one.
 *
 * The module note above says why matching is exact and case-sensitive: `'Fp1'` and `'FP1'` are
 * written by different systems and edfcore has no montage vocabulary to decide they are the same
 * electrode. That is a decision about MATCHING, not a reason to make the reader work out what
 * happened — the message said "is case-sensitive" while holding the label that proves it is what
 * bit them.
 *
 * Naming it changes nothing about which signal is returned. It is still refused.
 */
function differsOnlyInCase(header: EdfHeader, selector: string): string | undefined {
  const wanted = foldCase(selector);
  return header.signals.find((signal) => foldCase(signal.label) === wanted)?.label;
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
    const near = differsOnlyInCase(header, selector);
    throw new EdfChannelNotFoundError(
      `no signal is labelled ${JSON.stringify(trimEdfField(selector))} in this file. ` +
        (near === undefined
          ? ''
          : `This file has ${JSON.stringify(near)}, which differs only in case or spacing. `) +
        `Labels, in signal order: ${quoteLabels(header, near)}. Matching is exact on the ` +
        'trimmed label and is case-sensitive. Next: pass ' +
        (near === undefined ? 'one of those labels' : `${JSON.stringify(near)}`) +
        ', or select by index.',
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
 * A membership test over a caller's RegExp that cannot be poisoned by its own flags.
 *
 * `RegExp.prototype.test` is STATEFUL when the pattern carries `g` or `y`: it starts from
 * `lastIndex` and advances it on every match. Used across an array — which is what every filter
 * here does — that makes the result depend on what the previous element matched, so `/EEG/g` over
 * four EEG channels returns the first and third and silently drops the other two. The caller sees
 * half a montage with no error, and even a match-everything pattern stops returning every signal
 * once it carries the flag.
 *
 * A `g` flag on a membership test means nothing, so honouring its statefulness serves no one. The
 * regex is CLONED rather than reset in place: resetting the caller's object would mutate an
 * argument, and a module-level `const PATTERN = /x/g` shared with a `String.replace` elsewhere
 * would then behave differently depending on whether edfcore had been called first.
 */
export function matchesText(match: RegExp): (text: string) => boolean {
  const pattern = new RegExp(match.source, match.flags);
  return (text: string): boolean => {
    // `y` anchors at `lastIndex`, so this also makes a sticky pattern test from the start of each
    // string rather than from wherever the previous element left off.
    pattern.lastIndex = 0;
    return pattern.test(text);
  };
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
  const test = match instanceof RegExp ? matchesText(match) : match;
  return Object.freeze(
    header.signals.filter((signal) => signal.kind === 'data' && test(signal.label)),
  );
}

/**
 * The recording's total declared length in seconds.
 *
 * The arithmetic every caller writes by hand — except that the hand-written version is
 * `recordCount * recordDurationSeconds`, and that product is float64. A record duration with no
 * exact binary representation lands just under the true value: 100 records of 0.29 s is exactly
 * 29 s and multiplies out to 28.999999999999996. The count is exact and the duration is exact in
 * ticks, so the product is computed there and converted once.
 *
 * That is the same defect `formatHeader`'s duration line was fixed for in 0.2.67, and until 0.3.1
 * the two disagreed about the same file: the header line said `00:00:29` while this returned a
 * number that floors to 28.
 *
 * Zero for a file whose record duration is zero — legal EDF, and the honest answer, since such a
 * file's records do not advance in time.
 *
 * This is the DECLARED length. On an EDF+D file the recording spans longer than this, because the
 * gaps between records are not covered by any record; `timeline.spanSeconds` is that number.
 */
export function declaredDurationSeconds(header: EdfHeader): number {
  return ticksToSeconds(BigInt(header.recordCount) * header.recordDurationTicks);
}
