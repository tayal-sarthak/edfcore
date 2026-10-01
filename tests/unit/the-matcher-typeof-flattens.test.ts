/**
 * A RegExp, named as one.
 *
 * `typeof` answers `object` for a RegExp and `function` for a predicate, so of the two kinds of
 * matcher this package accepts, exactly one gets flattened into the word every wrong value shares.
 * The guards that refuse it already name the kind in their advice — "matchSignals(header, pattern)
 * for a RegExp or a predicate" — while the subject of the same sentence said "an object" and left
 * the reader to work out that the object they passed was one.
 *
 * `a-pattern-where-a-label-belongs.test.ts` says why this is the spelling worth naming: `matchSignals`
 * takes a pattern and `findSignals` takes a label, and "a montage selector is more often a pattern
 * than an exact label". So the RegExp-to-the-label-half mistake is the commoner of the two, and it
 * was the one whose message could not say what had arrived.
 *
 * `describe.ts` already names a binary value by its built-in tag "because that IS the mistake
 * wherever one turns up", and 0.6.256 applied the same reasoning to a typed array in the Status-word
 * guard. The tag rather than `instanceof`, for the reason that file gives: it is the same across
 * realms.
 *
 * `String(value)` is the pattern as written, which is the whole of what a reader needs to recognise
 * it — and unlike a file's contents it is something they typed.
 */

import { describe, expect, it } from 'vitest';
import { filterAnnotationsByText } from '../../src/annotations-query.js';
import { findSignals, getSignal, isAnnotationLabel } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { describeValue } from '../../src/text/describe.js';
import type { EdfHeader } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fp1-Ref', samplesPerRecord: 8 },
    { label: 'EEG C3-Ref', samplesPerRecord: 8 },
  ],
});

const header = async (): Promise<EdfHeader> => (await openEdf(byteSource(FILE))).header;

const refusal = (call: () => unknown): string => {
  let thrown: Error | undefined;
  try {
    call();
  } catch (error) {
    thrown = error as Error;
  }
  expect(thrown, 'nothing was refused').toBeDefined();
  return (thrown as Error).message;
};

describe('a RegExp where a label belongs', () => {
  it('is named as a RegExp rather than as an object', async () => {
    const h = await header();
    const message = refusal(() => getSignal(h, /EEG/ as never));
    expect(message).toContain('the selector is the RegExp /EEG/');
    expect(message).not.toContain('an object');
  });

  it('is shown as written, flags and all', async () => {
    const h = await header();
    expect(refusal(() => getSignal(h, /EEG Fp1/i as never))).toContain('the RegExp /EEG Fp1/i');
    expect(refusal(() => findSignals(h, /^EEG/gu as never))).toContain('the RegExp /^EEG/gu');
  });

  it('still gets the advice that names the call which takes one', async () => {
    const h = await header();
    const message = refusal(() => findSignals(h, /EEG/ as never));
    expect(message).toContain('findSignals()');
    expect(message).toContain('matchSignals');
  });

  it('is named in the other guards that read their subject from this helper', () => {
    expect(refusal(() => isAnnotationLabel(/EDF Annotations/ as never))).toContain(
      'the label is the RegExp /EDF Annotations/',
    );
    // And the call that genuinely takes a pattern still takes it, so naming the kind did not make
    // it a wrong one anywhere.
    expect(filterAnnotationsByText([], /x/)).toEqual([]);
  });
});

describe('the other kind of matcher', () => {
  it('needs nothing, because typeof already answers for it', async () => {
    const h = await header();
    const predicate = (label: string): boolean => label.startsWith('EEG');
    expect(refusal(() => getSignal(h, predicate as never))).toContain('a function');
  });
});

describe('the helper itself', () => {
  it('names a RegExp, and leaves every other spelling alone', () => {
    expect(describeValue(/a/)).toBe('the RegExp /a/');
    expect(describeValue({})).toBe('an object');
    expect(describeValue([])).toBe('an object');
    expect(describeValue(new Map())).toBe('an object');
    expect(describeValue('a')).toBe('the string "a"');
    expect(describeValue(5)).toBe('5');
    expect(describeValue(5n)).toBe('the BigInt 5n');
    expect(describeValue(null)).toBe('null');
    expect(describeValue(undefined)).toBe('undefined');
    expect(describeValue(new Uint8Array(1))).toBe('Uint8Array');
    expect(describeValue(Promise.resolve())).toBe('a pending Promise');
  });

  it('uses the tag, so a RegExp from another realm is named too', () => {
    const crossRealm = { [Symbol.toStringTag]: 'RegExp' };
    // Not the mechanism — the point is that `instanceof` is not what decides this.
    expect(Object.prototype.toString.call(crossRealm)).toBe('[object RegExp]');
    expect(describeValue(crossRealm)).toContain('the RegExp');
  });
});

describe('a matcher passed to the call that takes one', () => {
  it('still matches, so nothing about the accepted path moved', async () => {
    const h = await header();
    expect(getSignal(h, 'EEG Fp1-Ref').label).toBe('EEG Fp1-Ref');
    expect(findSignals(h, 'EEG C3-Ref')).toHaveLength(1);
  });
});
