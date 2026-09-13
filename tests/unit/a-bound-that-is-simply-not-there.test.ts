/**
 * The advice attached to an omitted time bound.
 *
 * `secondsToTicks` refuses a non-finite value and sends the reader to "check the expression that
 * produced it — Number() on an absent environment variable, query parameter or config key yields
 * NaN, and a division by zero yields Infinity". That is exactly right for `NaN` and for
 * `Infinity`, which are the two values a computation hands back.
 *
 * `undefined` is not one of them. Nothing computes `undefined`; a field is simply not there — a
 * selection built one key at a time, a spread that dropped one, a window object whose bounds are
 * spelled `start` and `duration`. Every one of those was answered with instructions to audit a
 * config key that was never involved.
 *
 * 0.6.87 made this argument in as many words — "every clause of that is about a value the caller
 * never computed: it sends them to audit a config key, when what they wrote is an argument of the
 * wrong shape" — and closed ONE route to it: `{ records }` handed to a call that takes a window.
 * This is the rest of them.
 *
 * The subject of the sentence is deliberately unchanged. 0.6.92 decided that `NaN`, `Infinity` and
 * `undefined` all read correctly as themselves after "but was", and they do; it is the `Next:`
 * clause that could not be true of all three.
 */

import { describe, expect, it } from 'vitest';
import { annotationsAt, filterAnnotationsByTime } from '../../src/annotations-query.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { secondsToTicks } from '../../src/tal/ticks.js';
import type { EdfAnnotation } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

const refusalOf = async (call: () => unknown): Promise<string> => {
  try {
    await call();
  } catch (error) {
    return (error as Error).message;
  }
  return '';
};

/** Each one omits a bound rather than computing a bad one. */
const OMISSIONS: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
  [
    'readWindow with no durationSeconds',
    async () => {
      const recording = await openEdf(byteSource(FILE));
      return readWindow(recording, { signalIndices: [0], startSeconds: 0 } as never);
    },
  ],
  [
    'a window object whose fields are spelled something else',
    async () =>
      filterAnnotationsByTime(
        [] as readonly EdfAnnotation[],
        {
          start: 0,
          duration: 1,
        } as never,
      ),
  ],
  [
    'annotationsAt with the instant left off',
    async () => (annotationsAt as unknown as (a: unknown) => unknown)([]),
  ],
];

describe.each(OMISSIONS)('%s', (_name, call) => {
  it('still names the value as itself', async () => {
    expect(await refusalOf(call)).toContain('but was undefined');
  });

  it('no longer sends the reader to audit a computation that never happened', async () => {
    const message = await refusalOf(call);
    expect(message).not.toContain('Number() on an absent environment variable');
    expect(message).not.toContain('a division by zero yields Infinity');
  });

  it('says what an absent bound actually is', async () => {
    const message = await refusalOf(call);
    expect(message).toContain('nothing computes undefined');
    expect(message).toContain('Next:');
  });
});

describe('the two values a computation does produce', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('still sends %s to the expression that produced it', (described, value) => {
    try {
      secondsToTicks(value, 'startSeconds');
      expect.unreachable('a non-finite second count must not convert');
    } catch (error) {
      expect((error as Error).message).toContain(
        `startSeconds must be a finite number of seconds, but was ${described}`,
      );
      expect((error as Error).message).toContain('Next: check the expression that produced it');
    }
  });

  it('still refuses a value that is not a number at all by its own route', () => {
    expect(() =>
      (secondsToTicks as unknown as (a: unknown, b: string) => bigint)('1', 'seconds'),
    ).toThrow(/must be a number of seconds, and was given the string "1"/);
  });

  it('still converts an ordinary bound', () => {
    expect(secondsToTicks(1.5, 'startSeconds')).toBe(15000000n);
  });
});
