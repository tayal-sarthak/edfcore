/**
 * The selector's KIND, in the two lookups that match on the label as written.
 *
 * `assertSelector` was added in 0.6.86 for a selector that never arrived, and it checks exactly
 * that: not `undefined`, not `null`. Whatever else arrives is handed to `trimEdfField`, which
 * slices it.
 *
 * `matchSignals` has refused the mirror of this since 0.6.103 — a plain string where a pattern
 * belongs — and its message names the sibling that takes one: "pass a RegExp for a pattern, or
 * findSignals(header, label) for an exact label". Written the other way round, which is the
 * likelier mistake because a montage selector is more often a pattern than an exact label,
 * `findSignals(header, /EEG/)` and `getSignal(header, /EEG/)` threw V8's
 * "text.slice is not a function" — an internal name, no `Next:` clause, and no mention of
 * `matchSignals` at all. One of the two spellings of one confusion had the better message, and it
 * was the rarer one.
 *
 * A predicate lands one step further in and says something different again — "text.charCodeAt is
 * not a function" — so the same class of mistake produced two different internal names depending
 * on which kind of matcher was passed.
 */

import { describe, expect, it } from 'vitest';
import { findSignals, getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
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

/** Selectors that are neither a label nor an index, and how each one is written by accident. */
const NOT_A_LABEL: ReadonlyArray<readonly [string, unknown]> = [
  ['a RegExp', /EEG/],
  ['a predicate', (label: string): boolean => label.startsWith('EEG')],
  ['a boolean', true],
];

describe.each(NOT_A_LABEL)('a selector that is %s', (_name, selector) => {
  it('is refused by findSignals, naming the call and pointing at matchSignals', async () => {
    const h = await header();
    try {
      (findSignals as unknown as (a: EdfHeader, b: unknown) => unknown)(h, selector);
      expect.unreachable('a selector of the wrong kind must not be walked over the signals');
    } catch (error) {
      expect((error as Error).message).toContain('findSignals()');
      expect((error as Error).message).toContain('matchSignals');
      // Never the internal name the slice threw.
      expect((error as Error).message).not.toContain('slice');
      expect((error as Error).message).not.toContain('charCodeAt');
    }
  });

  it('is refused by getSignal, named for the call the reader actually wrote', async () => {
    const h = await header();
    try {
      (getSignal as unknown as (a: EdfHeader, b: unknown) => unknown)(h, selector);
      expect.unreachable('a selector of the wrong kind must not be walked over the signals');
    } catch (error) {
      expect((error as Error).message).toContain('getSignal()');
      // Not `findSignals()`, which is where the delegation would have raised it.
      expect((error as Error).message).not.toContain('findSignals');
    }
  });
});

describe('the selectors these two do take', () => {
  it('still finds a label', async () => {
    expect(findSignals(await header(), 'EEG C3-Ref').map((s) => s.index)).toEqual([1]);
    expect((await getSignal(await header(), 'EEG C3-Ref')).index).toBe(1);
  });

  it('still takes an index on getSignal', async () => {
    expect(getSignal(await header(), 0).label).toBe('EEG Fp1-Ref');
  });

  it('still says "missing" for a selector that never arrived', async () => {
    const h = await header();
    expect(() => (findSignals as unknown as (a: EdfHeader, b?: unknown) => unknown)(h)).toThrow(
      /the selector is missing/,
    );
  });
});
