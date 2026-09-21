/**
 * `a object`, in the two arguments that reach this package's shared description of one.
 *
 * `describeSelection` names what arrived for `assertSignalIndices` and for `assertRecording`, and
 * it built the phrase as `a ${typeof value}`. Six of the seven things `typeof` can still return
 * there take "a". The seventh is `object` — and `object` is exactly what those two arguments are
 * when they are wrong: a `Set` of indices, a `Map` from a config, an object keyed by label, giving
 * `signalIndices is a object`; a header, a chunk or `header.signals` where the recording belongs,
 * giving `the recording is a object`.
 *
 * `io/source.ts` made the opposite choice for its own version and wrote down why: "No article, and
 * `byteSource`'s own refusal is phrased the same way — 'received Int8Array'. An article needs to
 * know that `Uint8Array` is said 'yoo-int', which no rule about vowels gets right, and getting it
 * wrong is the kind of thing a reader notices instead of the message." That is the cost, and this
 * helper was paying it on the one type it meets most.
 *
 * No rule about vowels is needed, because the set is closed: `undefined` and `null` are answered
 * above the article, and of the seven strings that can still arrive exactly one begins with a
 * vowel. This test executes that claim rather than asserting the single case, so a future value
 * cannot quietly rejoin the wrong branch.
 *
 * Nothing else about any message changes — not the reason, not the `Next:` clause, not the class.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

const refusal = async (call: () => unknown): Promise<Error> => {
  const thrown = await Promise.resolve()
    .then(call)
    .then(
      () => undefined,
      (error: unknown) => error as Error,
    );
  expect(thrown, 'nothing was refused').toBeDefined();
  return thrown as Error;
};

/** Every published call whose selection carries `signalIndices`, with a whole valid one. */
const CALLS: ReadonlyArray<
  readonly [string, (recording: unknown, signalIndices: unknown) => unknown]
> = [
  [
    'readWindow',
    (recording, signalIndices) =>
      readWindow(
        recording as never,
        {
          signalIndices,
          startSeconds: 0,
          durationSeconds: 2,
        } as never,
      ),
  ],
  [
    'readRecords',
    (recording, signalIndices) =>
      readRecords(
        recording as never,
        {
          signalIndices,
          records: { start: 0, count: 2 },
        } as never,
      ),
  ],
  [
    'readEnvelope',
    (recording, signalIndices) =>
      readEnvelope(
        recording as never,
        {
          signalIndices,
          startSeconds: 0,
          durationSeconds: 2,
          buckets: 4,
        } as never,
      ),
  ],
  [
    'readEnvelopeAtResolution',
    (recording, signalIndices) =>
      readEnvelopeAtResolution(
        recording as never,
        {
          signalIndices,
          startSeconds: 0,
          durationSeconds: 2,
          secondsPerBucket: 0.5,
        } as never,
      ),
  ],
  [
    'streamRecords',
    async (recording, signalIndices) => {
      let seen = 0;
      for await (const chunk of streamRecords(
        recording as never,
        {
          signalIndices,
          startSeconds: 0,
          durationSeconds: 2,
        } as never,
      )) {
        void chunk;
        seen += 1;
      }
      return seen;
    },
  ],
];

describe.each(CALLS)('%s', (_name, call) => {
  it.each([
    ['a Set of indices', new Set([0])],
    ['a Map from a config', new Map([['Fp1', 0]])],
    ['an object keyed by label', { Fp1: 0 }],
  ])('says signalIndices is "an object" rather than "a object", for %s', async (_shape, given) => {
    const thrown = await refusal(async () => call(await opened(), given));
    expect(thrown.message).not.toContain('a object');
    expect(thrown.message).toContain('signalIndices is an object');
  });

  it('keeps the reason and the next step unchanged', async () => {
    const thrown = await refusal(async () => call(await opened(), new Set([0])));
    expect(thrown.message).toContain('not an array of signal indices');
    expect(thrown.message).toContain('There is no "all signals" default');
    expect(thrown.message).toContain('Next: pass header.dataSignalIndices');
    expect(thrown).toBeInstanceOf(RangeError);
  });

  it.each([
    ['header.signals, which is an array', 'signals'],
    ['a Set', 'set'],
  ])('says the recording is "an object" too, for %s', async (_shape, kind) => {
    const recording = await opened();
    const given = kind === 'signals' ? recording.header.signals : new Set([recording]);
    const thrown = await refusal(() => call(given, [0]));
    expect(thrown.message).not.toContain('a object');
    expect(thrown.message).toContain('the recording is an object');
  });

  it('still reads for a selection that is one', async () => {
    expect(await call(await opened(), [0])).toBeDefined();
  });
});

describe('the closed set of what can still reach the article', () => {
  it('has exactly one vowel-initial member, which is why one branch is enough', () => {
    // `undefined` is answered as "missing" and `null` as "null", both above the article.
    const reachable = [
      typeof {},
      typeof true,
      typeof 0,
      typeof 0n,
      typeof '',
      typeof Symbol('s'),
      typeof (() => undefined),
    ];
    expect(new Set(reachable).size).toBe(7);
    expect(reachable.filter((name) => /^[aeiou]/.test(name))).toEqual(['object']);
  });

  it.each([
    ['a number', 5],
    ['a string', 'all'],
    ['a boolean', true],
    ['a bigint', 1n],
    ['a symbol', Symbol('s')],
  ])('still reads naturally for %s', async (expected, given) => {
    const thrown = await refusal(async () =>
      readWindow(await opened(), {
        signalIndices: given,
        startSeconds: 0,
        durationSeconds: 1,
      } as never),
    );
    expect(thrown.message).toContain(`signalIndices is ${expected}`);
  });

  it.each([
    ['null', null, 'signalIndices is null'],
    ['undefined', undefined, 'signalIndices is missing'],
  ])('keeps the word %s carries, with no article at all', async (_shape, given, expected) => {
    const thrown = await refusal(async () =>
      readWindow(await opened(), {
        signalIndices: given,
        startSeconds: 0,
        durationSeconds: 1,
      } as never),
    );
    expect(thrown.message).toContain(expected);
  });
});
