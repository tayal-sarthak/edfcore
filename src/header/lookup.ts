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
import { describeValue } from '../text/describe.js';
import type { EdfHeader, EdfSignal } from '../types.js';

/**
 * True for the two reserved annotation labels, matched on the trimmed text and case-sensitively.
 *
 * Both are accepted for either family: the label identifies the channel's ROLE, and a BDF+ file
 * written by an EDF+ library carries `'EDF Annotations'` — refusing to recognise it there would
 * expose a text channel as if it held samples.
 */
export function isAnnotationLabel(label: string): boolean {
  // The label, not the signal that carries it. `header.signals.filter(isAnnotationLabel)` is the
  // shape a predicate invites, and it reached `trimEdfField` and threw "text.slice is not a
  // function" — an internal name, from the one function in this module that takes a plain string
  // (fixed in 0.6.108).
  if (typeof label !== 'string') {
    throw new RangeError(
      `isAnnotationLabel(): the label is ${describeValue(label)}, not a string. Next: pass ` +
        'signal.label, which is the field this asks about.',
    );
  }
  const trimmed = trimEdfField(label);
  return trimmed === EDF_ANNOTATIONS_LABEL || trimmed === BDF_ANNOTATIONS_LABEL;
}

/**
 * The selector, before the signals are walked with it.
 *
 * All three of these take a selector a caller supplies and nothing checked it. Omitting it made
 * the failure depend on the FILE rather than on the call: `findSignals(header)` and
 * `getSignal(header)` reached `trimEdfField(undefined)` and threw V8's "Cannot read properties of
 * undefined (reading 'length')", while `matchSignals(header)` returned `[]` on a file with no
 * data signals — the predicate is never called — and threw "test is not a function" on every other
 * one, leaking an internal name (fixed in 0.6.86).
 *
 * A selector arrives from a montage in a config file, a channel name in a URL, or a spread that
 * dropped a key at least as often as it is written out, which is the argument `assertSignalIndices`
 * makes for the other required argument in this package.
 */
function assertSelector(selector: unknown, call: string, accepts: string): void {
  if (selector !== undefined && selector !== null) return;
  throw new RangeError(
    `${call}(): the selector is ${selector === null ? 'null' : 'missing'}. ` +
      `Next: pass ${accepts}.`,
  );
}

/**
 * The selector's KIND, which `assertSelector` above never checked.
 *
 * It checks that a selector ARRIVED — the 0.6.86 fix — and then hands whatever did to
 * `trimEdfField`, which slices it. `matchSignals` has been refusing the mirror of this since
 * 0.6.103 and names `findSignals` while doing it: "the matcher is the string \"EEG\" ... pass a
 * RegExp for a pattern, or findSignals(header, label) for an exact label". The same mistake in
 * the other direction — `findSignals(header, /EEG/)`, or `getSignal(header, /EEG/)` — threw V8's
 * "text.slice is not a function": an internal name, no `Next:` clause, and no mention of the
 * function that does take a pattern. One of the two spellings of one confusion had the better
 * message, and it was not the spelling the reader is more likely to write, because a montage is
 * far more often a pattern than an exact label.
 *
 * A boolean reaches it too, from a ternary that resolved to a flag rather than to a name.
 */
function assertLabel(label: unknown, call: string): void {
  if (typeof label === 'string') return;
  throw new RangeError(
    `${call}(): the selector is ${describeValue(label)}, and this call matches on the label as ` +
      'written. Next: pass the label as a string, or matchSignals(header, pattern) for a RegExp ' +
      'or a predicate.',
  );
}

/**
 * The HEADER, which `declaredDurationSeconds` checks below and its three siblings did not.
 *
 * 0.6.108 wrote the gap down — "the header, which this module's other four entry points also take
 * and which none of them checked" — and then closed it only for the function it was standing in.
 * The other three reached `header.signals` and threw V8's `Cannot read properties of undefined
 * (reading 'filter')`: a `TypeError` naming an internal field, with no `Next:` clause.
 *
 * `getSignal(recording, 0)` was the worst of the three. It read `header.signals[0]`, so the
 * message was "Cannot read properties of undefined (reading '0')" — which reads as a complaint
 * about the selector, the argument that was right.
 */
function assertHeaderSignals(header: EdfHeader, call: string): void {
  if (Array.isArray((header as { signals?: unknown } | null | undefined)?.signals)) return;
  throw new RangeError(
    `${call}(): that is not a header — it has no signals. Next: pass recording.header, or what ` +
      'parseHeader(bytes, sourceByteLength) returned.',
  );
}

/** Every signal with this label, in signal order. Empty when none matches. */
export function findSignals(header: EdfHeader, label: string): readonly EdfSignal[] {
  assertHeaderSignals(header, 'findSignals');
  assertSelector(label, 'findSignals', 'the label to look for');
  assertLabel(label, 'findSignals');
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
  assertHeaderSignals(header, 'getSignal');
  assertSelector(selector, 'getSignal', 'a label, or an index into header.signals');
  if (typeof selector === 'number') {
    const signal = header.signals[selector];
    if (signal !== undefined) return signal;
    /*
     * A fractional index is not "outside" anything. `getSignal(header, 1.5)` — which is what a
     * midpoint, an average or a division by a sample rate produces — was told it "is outside the 7
     * signals this file declares. Next: pass an index in 0..6", and 1.5 already is one: the message
     * named a rule the rejected value satisfies (fixed in 0.6.93).
     */
    throw new EdfChannelNotFoundError(
      `signal index ${selector} ${
        Number.isInteger(selector)
          ? `is outside the ${header.signals.length} signals this file declares`
          : 'is not a whole number, so it falls between two signals rather than outside them'
      }. Labels, in signal order: ${quoteLabels(header)}. Next: pass a whole index in ` +
        `0..${header.signals.length - 1}, or a label.`,
      { selector, availableLabels: header.signals.map((signal) => signal.label) },
    );
  }

  // Its own, before the delegation, and named for THIS call: `findSignals` carries the identical
  // guard, and a reader who wrote `getSignal` should not be told about a function they did not.
  assertLabel(selector, 'getSignal');
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
/**
 * A matcher that arrived but is not one of the kinds the call takes.
 *
 * `assertSelector` above checks that one arrived; it never checked WHAT arrived, and `test` is then
 * assigned from whatever did. `matchSignals(header, 'Fp1')` — a plain string, which this module's
 * own docblock says is `findSignals`'s case — reached `test(signal.label)` and threw V8's "test is
 * not a function": an internal name, no `Next:` clause, and no mention of the function that does
 * take a label.
 *
 * `filterAnnotationsByText` did the same and worse. A predicate is only called once there is
 * something to call it on, so a wrong matcher returned `[]` for a recording with no events and
 * threw for the same argument on the next file — the third time in this package that the quality of
 * a refusal depended on the data rather than on the call (0.6.79, 0.6.86, and this one, fixed in
 * 0.6.103).
 */
export function assertMatcher<T>(match: T, call: string, accepts: string, instead: string): T {
  if (typeof match === 'function') return match;
  throw new RangeError(
    `${call}(): the matcher is ${describeValue(match)}, and this call takes ${accepts}. ` +
      `Next: ${instead}.`,
  );
}

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
  assertHeaderSignals(header, 'matchSignals');
  assertSelector(match, 'matchSignals', 'a RegExp, or a function taking a label');
  const test =
    match instanceof RegExp
      ? matchesText(match)
      : assertMatcher(
          match,
          'matchSignals',
          'a RegExp or a predicate on the label',
          'pass a RegExp for a pattern, or findSignals(header, label) for an exact label — the ' +
            'case this function deliberately does not cover',
        );
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
  /*
   * The header, which this module's other four entry points also take and which none of them
   * checked. It is the one function here whose name says RECORDING, and `declaredDurationSeconds`
   * is the sort of thing a reader asks of one — so the mistake it invites is passing it, and
   * `BigInt(undefined)` answered "Cannot convert undefined to a BigInt": not edfcore's voice, no
   * `Next:` clause, and nothing about the argument (fixed in 0.6.108).
   */
  if (!Number.isInteger((header as { recordCount?: unknown } | null | undefined)?.recordCount)) {
    throw new RangeError(
      'declaredDurationSeconds(): that is not a header — it has no recordCount. Next: pass ' +
        'recording.header, or what parseHeader(bytes, sourceByteLength) returned. For the span of ' +
        'a discontinuous file, which is longer, read timeline.spanSeconds.',
    );
  }
  return ticksToSeconds(BigInt(header.recordCount) * header.recordDurationTicks);
}
