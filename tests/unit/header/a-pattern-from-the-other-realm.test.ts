/**
 * A RegExp refused by a message that names it a RegExp.
 *
 * `matchSignals` dispatched on `match instanceof RegExp`, which is false for a pattern built in
 * another realm — an iframe, a worker, an Electron contextBridge, jsdom, a Node `vm` context. A
 * cross-realm `/EEG/i` therefore fell to `assertMatcher`, which wants a function, and came back as:
 *
 *     matchSignals(): the matcher is the RegExp /EEG/i, and this call takes a RegExp or a
 *     predicate on the label. Next: pass a RegExp for a pattern, or findSignals(header, label)
 *     for an exact label
 *
 * Every clause of which is true of what the caller did. The subject is right because `describeValue`
 * reads the built-in tag — 0.6.269 chose the tag there "because it is the same across realms" — so
 * one half of this module could name the value a RegExp while the half beside it decided it was not
 * one. That is 0.6.284's defect with the arguments swapped: there the guard was right and the
 * describer could not name the value; here the describer is right and the guard refuses it.
 *
 * Nothing in the matching needed to change for a cross-realm pattern to work. `matchesText`
 * recompiles from `.source` and `.flags`, which every realm spells identically, so the dispatch was
 * keeping out a pattern the matcher could always have used — which is what makes this a one-line
 * fix rather than a feature.
 *
 * `isRegExpMatcher` is the one home for the rule, shared with `filterAnnotationsByText` next door
 * (0.6.285).
 */

import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { isRegExpMatcher, matchSignals } from '../../../src/header/lookup.js';
import { parseHeader } from '../../../src/header/parse.js';
import { minimalEdfPlus } from '../../support/writer.js';

/** A real second realm: `vm` built-ins have their own prototypes, so `instanceof` is false. */
function otherRealm<T>(expression: string): T {
  return runInNewContext(`(${expression})`) as T;
}

const FIXTURE = minimalEdfPlus({
  signals: [
    { label: 'EEG Fpz-Cz', samplesPerRecord: 10 },
    { label: 'EEG Pz-Oz', samplesPerRecord: 10 },
    { label: 'EMG submental', samplesPerRecord: 10 },
  ],
});
const HEADER = parseHeader(FIXTURE, FIXTURE.byteLength);

describe('matchSignals takes a pattern from another realm', () => {
  it('is handed a RegExp instanceof cannot recognise', () => {
    const pattern = otherRealm<RegExp>('/EEG/i');
    // The premise. If this ever becomes true, these tests are checking nothing.
    expect(pattern instanceof RegExp).toBe(false);
    expect(Object.prototype.toString.call(pattern)).toBe('[object RegExp]');
    expect(isRegExpMatcher(pattern)).toBe(true);
  });

  it('matches the same signals a pattern from this realm does', () => {
    const here = matchSignals(HEADER, /EEG/i).map((signal) => signal.label);
    const there = matchSignals(HEADER, otherRealm<RegExp>('/EEG/i')).map((signal) => signal.label);
    expect(here).toEqual(['EEG Fpz-Cz', 'EEG Pz-Oz']);
    expect(there).toEqual(here);
  });

  it('keeps the flags, which travel on .source and .flags rather than on the class', () => {
    // Lower-case `eeg` matches only with `i`, so the flag is what this asserts.
    expect(matchSignals(HEADER, otherRealm<RegExp>('/eeg/i')).length).toBe(2);
    expect(matchSignals(HEADER, otherRealm<RegExp>('/eeg/')).length).toBe(0);
  });

  it('is not made stateful by a g flag, the reason matchesText recompiles at all', () => {
    const sticky = otherRealm<RegExp>('/EEG/g');
    expect(matchSignals(HEADER, sticky).map((signal) => signal.label)).toEqual([
      'EEG Fpz-Cz',
      'EEG Pz-Oz',
    ]);
  });

  it('still refuses a matcher that is neither a RegExp nor a function', () => {
    expect(() => matchSignals(HEADER, 'EEG' as never)).toThrow(/findSignals\(header, label\)/);
    expect(() => matchSignals(HEADER, 42 as never)).toThrow(/the matcher is 42/);
  });

  it('answers false for everything that is not a RegExp anywhere', () => {
    expect(isRegExpMatcher({ source: 'EEG', flags: 'i' })).toBe(false);
    expect(isRegExpMatcher(otherRealm<object>('({ source: "EEG", flags: "i" })'))).toBe(false);
    expect(isRegExpMatcher((label: string) => label.startsWith('EEG'))).toBe(false);
    expect(isRegExpMatcher(undefined)).toBe(false);
  });
});
