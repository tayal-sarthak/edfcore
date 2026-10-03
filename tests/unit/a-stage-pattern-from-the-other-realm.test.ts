/**
 * The second of the two calls that dispatched on `match instanceof RegExp`.
 *
 * 0.6.285 made the argument for `matchSignals` and carries it: `instanceof` is false for a pattern
 * built in another realm — an iframe, a worker, an Electron contextBridge, jsdom, a Node `vm`
 * context — so a cross-realm RegExp fell to the branch that wants a function and was refused with
 *
 *     filterAnnotationsByText(): the matcher is the RegExp /stage/i, and this call takes a string
 *     matched verbatim, a RegExp, or a predicate on the text. Next: pass the label as a string, or
 *     (text) => text.trim() === label for a file whose vocabulary is padded
 *
 * naming the kind it had just refused, because `describeValue` reads the same built-in tag the
 * dispatch would not. `the-matcher-typeof-flattens.test.ts` states that rule in this very family:
 * "The tag rather than `instanceof`, for the reason that file gives: it is the same across realms."
 *
 * This is the likelier of the two to be running across a boundary. Narrowing fifty thousand scored
 * events to the stages of a hypnogram is exactly the work a viewer moves off the main thread, and
 * `annotations-query.ts` is Layer 7 and pure for that reason — nothing here reads, so it is the half
 * of the package that can run anywhere.
 *
 * The verbatim-string form and the predicate form were never affected: `typeof` is realm-agnostic.
 * `matchesText` recompiles from `.source` and `.flags`, so the `g`/`y` statefulness it exists to
 * prevent is prevented for a cross-realm pattern too (0.6.286).
 */

import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { filterAnnotationsByText } from '../../src/annotations-query.js';
import type { EdfAnnotation } from '../../src/types.js';

/** A real second realm: `vm` built-ins have their own prototypes, so `instanceof` is false. */
function otherRealm<T>(expression: string): T {
  return runInNewContext(`(${expression})`) as T;
}

const EVENTS = ['Sleep stage W', 'Arousal', 'Sleep stage N2', 'Sleep stage REM', 'Arousal'].map(
  (text, i) =>
    ({
      onsetTicks: BigInt(i) * 10000000n,
      onsetSeconds: i,
      onsetTicksFromFirstRecord: BigInt(i) * 10000000n,
      onsetSecondsFromFirstRecord: i,
      durationTicks: undefined,
      durationSeconds: undefined,
      text,
      channel: undefined,
      channelLabel: undefined,
      recordIndex: 0,
      isTimekeeping: false,
    }) as unknown as EdfAnnotation,
);

const texts = (matched: readonly EdfAnnotation[]): readonly string[] =>
  matched.map((annotation) => annotation.text);

describe('filterAnnotationsByText takes a pattern from another realm', () => {
  it('is handed a RegExp instanceof cannot recognise', () => {
    const pattern = otherRealm<RegExp>('/stage/i');
    // The premise. If this ever becomes true, these tests are checking nothing.
    expect(pattern instanceof RegExp).toBe(false);
    expect(Object.prototype.toString.call(pattern)).toBe('[object RegExp]');
  });

  it('keeps the same events a pattern from this realm keeps', () => {
    const here = texts(filterAnnotationsByText(EVENTS, /stage/i));
    const there = texts(filterAnnotationsByText(EVENTS, otherRealm<RegExp>('/stage/i')));
    expect(here).toEqual(['Sleep stage W', 'Sleep stage N2', 'Sleep stage REM']);
    expect(there).toEqual(here);
  });

  it('keeps the flags, which travel on .source and .flags rather than on the class', () => {
    expect(texts(filterAnnotationsByText(EVENTS, otherRealm<RegExp>('/STAGE/i')))).toHaveLength(3);
    expect(texts(filterAnnotationsByText(EVENTS, otherRealm<RegExp>('/STAGE/')))).toHaveLength(0);
  });

  it('is not made stateful by a g flag, which is what matchesText exists for', () => {
    // Four candidates match; a stateful `test` would return about half of them.
    const matched = filterAnnotationsByText(EVENTS, otherRealm<RegExp>('/a/g'));
    expect(texts(matched)).toEqual([
      'Sleep stage W',
      'Arousal',
      'Sleep stage N2',
      'Sleep stage REM',
      'Arousal',
    ]);
  });

  it('still matches a string verbatim, which typeof never got wrong', () => {
    expect(texts(filterAnnotationsByText(EVENTS, 'Arousal'))).toEqual(['Arousal', 'Arousal']);
    expect(texts(filterAnnotationsByText(EVENTS, 'Sleep stage'))).toEqual([]);
  });

  it('still refuses a matcher that is neither a string, a RegExp nor a function', () => {
    expect(() => filterAnnotationsByText(EVENTS, 42 as never)).toThrow(/the matcher is 42/);
    expect(() => filterAnnotationsByText(EVENTS, { source: 'a' } as never)).toThrow(
      /text\.trim\(\) === label/,
    );
  });
});
