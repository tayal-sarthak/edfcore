/**
 * `filterAnnotationsByText(annotations, async (text) => …)`, which kept every event.
 *
 * 0.6.274 closed this in `matchSignals`, where an async predicate matched every channel. Here the
 * cost points the other way. This module's own note says what makes a wrong answer dangerous in these
 * four calls: three of them "answer with a list, so a wrong one reads as a recording with nothing in
 * it". A filter that keeps EVERYTHING is the same confusion from the other side — on a scoring file
 * with fifty thousand events, a listing nobody can tell from a correct one.
 *
 * A Promise is always truthy, so the predicate's answer never mattered. `isScoredEvent(text)` against
 * a database or a server is async, and the predicate wrapping it is the obvious thing to write.
 *
 * Tested on the first annotation's answer rather than by inspecting the function, for the reason
 * 0.6.274 gives: `AsyncFunction` is not the only way to return a Promise. A `.then` property read,
 * never a call.
 *
 * The string and RegExp forms never had this problem. A truthy non-boolean is not refused, because
 * `(text) => text.length` is ordinary JavaScript and the caller means it.
 */

import { describe, expect, it } from 'vitest';
import { filterAnnotationsByText } from '../../src/annotations-query.js';
import type { EdfAnnotation } from '../../src/types.js';

const EVENTS = ['Lights out', 'Arousal', 'Lights on', 'Arousal'].map(
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

type Filter = (annotations: readonly EdfAnnotation[], match: unknown) => readonly EdfAnnotation[];
const filter = filterAnnotationsByText as unknown as Filter;

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

describe('a predicate that answers with a Promise', () => {
  it('is refused rather than keeping every event', () => {
    const message = refusal(() => filter(EVENTS, async (text: string) => text === 'Arousal'));
    expect(message).toContain('the predicate returned a pending Promise');
    expect(message).toContain('every annotation would have been kept');
  });

  it('names what a list that kept everything reads as', () => {
    expect(refusal(() => filter(EVENTS, async () => true))).toContain(
      'reads as a recording where everything matched',
    );
  });

  it('is refused for a plain function that returns one too', () => {
    const notDeclaredAsync = (text: string): unknown => Promise.resolve(text === 'Arousal');
    expect(refusal(() => filter(EVENTS, notDeclaredAsync))).toContain('a pending Promise');
  });

  it('is refused even when the Promise would have resolved to false', () => {
    expect(refusal(() => filter(EVENTS, async () => false))).toContain('a pending Promise');
  });

  it('is a caller mistake, so it is a plain RangeError', () => {
    expect(() => filter(EVENTS, async () => true)).toThrow(RangeError);
  });

  it('does not await, settle or subscribe to what it was given', () => {
    const neverSettles = () => new Promise<never>(() => {});
    expect(refusal(() => filter(EVENTS, neverSettles))).toContain('a pending Promise');
  });
});

describe('what the old behaviour produced', () => {
  it('was the whole list back, which is what a correct filter also looks like', () => {
    const everything = filterAnnotationsByText(EVENTS, () => true);
    expect(everything).toHaveLength(EVENTS.length);
  });
});

describe('the matchers that still work', () => {
  it('include a synchronous predicate', () => {
    expect(filterAnnotationsByText(EVENTS, (text) => text === 'Arousal')).toHaveLength(2);
  });

  it('include a truthy non-boolean, which is ordinary JavaScript', () => {
    expect(filter(EVENTS, (text: string) => text.length as unknown)).toHaveLength(4);
  });

  it('include the string and RegExp forms, which never had this problem', () => {
    expect(filterAnnotationsByText(EVENTS, 'Arousal')).toHaveLength(2);
    expect(filterAnnotationsByText(EVENTS, /^Lights/)).toHaveLength(2);
  });

  it('and an empty list has no first answer to test, so nothing changes for it', () => {
    expect(filter([], async () => true)).toHaveLength(0);
  });
});

describe('the guard above it', () => {
  it('still refuses a matcher that is not one', () => {
    expect(refusal(() => filter(EVENTS, {}))).toContain('the matcher is an object');
  });
});
