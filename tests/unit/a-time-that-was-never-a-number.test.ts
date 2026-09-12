/**
 * A time argument that is not a number, refused without naming a rule it appears to satisfy.
 *
 * `secondsToTicks` rejects anything `Number.isFinite` says no to, which is correct, and printed the
 * value into "must be a finite number of seconds, but was ${seconds}". For `NaN`, `Infinity` and
 * `undefined` that reads correctly. For anything else it read as a contradiction: the string `'0'`
 * came out as `but was 0`, and 0 is a finite number of seconds.
 *
 * A BigInt is the case that matters. Every instant this package hands out is ticks —
 * `onsetTicksFromFirstRecord`, `spanTicks`, `index.onsetTicks()` — so passing one back in where
 * seconds belong is a mistake the API's own shape invites, and it earned "startSeconds must be a
 * finite number of seconds, but was 10000000": a sentence whose rule the printed value meets, from
 * a value that is out by a factor of ten million (fixed in 0.6.92).
 */

import { describe, expect, it } from 'vitest';
import { annotationsAt } from '../../src/annotations-query.js';
import { secondsToTicks } from '../../src/tal/ticks.js';
import type { EdfAnnotation } from '../../src/types.js';

/** The cast a JavaScript caller does not need to write. */
const asSeconds = (value: unknown) => value as number;

function refusal(value: unknown, name = 'startSeconds'): string {
  try {
    secondsToTicks(asSeconds(value), name);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the value was accepted as a number of seconds');
}

describe('a value of the wrong type is described as its type', () => {
  it.each([
    ['a BigInt tick count', 10_000_000n, 'the BigInt 10000000n'],
    ['a string from a query parameter', '0', 'the string "0"'],
    ['null, which a config file produces', null, 'null'],
    ['an object', { startSeconds: 1 }, 'an object'],
    ['a boolean', true, 'a boolean'],
  ])('names %s as what it is', (_described, value, expected) => {
    const message = refusal(value);
    expect(message).toContain(
      `startSeconds must be a number of seconds, and was given ${expected}`,
    );
  });

  it('never prints it bare, which is what made the sentence contradict itself', () => {
    expect(refusal(10_000_000n)).not.toContain('but was 10000000.');
    expect(refusal('0')).not.toContain('but was 0.');
  });

  it('says how to convert, in terms of what the package hands out', () => {
    const message = refusal(10_000_000n);
    expect(message).toContain('Next: convert it first');
    expect(message).toContain('the matching *Seconds field beside it');
  });
});

describe('the numbers that were already described correctly', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['undefined', undefined],
  ])('still reads "must be a finite number of seconds, but was %s"', (described, value) => {
    expect(refusal(value)).toContain(
      `startSeconds must be a finite number of seconds, but was ${described}`,
    );
  });
});

describe('the caller name still reaches the message', () => {
  it("is the entry point's own word, not the shared helper's", () => {
    const thrown = (): string => {
      try {
        annotationsAt([] as readonly EdfAnnotation[], asSeconds('1.5'));
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error('the call was not refused');
    };
    expect(thrown()).toContain('seconds must be a number of seconds');
    expect(thrown()).toContain('the string "1.5"');
  });
});

describe('a real number of seconds', () => {
  it('still converts, including zero and a negative instant', () => {
    expect(secondsToTicks(0, 'startSeconds')).toBe(0n);
    expect(secondsToTicks(1.5, 'startSeconds')).toBe(15_000_000n);
    expect(secondsToTicks(-1.5, 'startSeconds')).toBe(-15_000_000n);
  });
});
