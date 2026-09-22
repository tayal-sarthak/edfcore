/**
 * `signalIndices: [9n]`, told a BigInt is "not a number this header can be indexed by".
 *
 * It is the one thing it is. `header.signals[9n]` is the property access `header.signals[9]` is —
 * a BigInt key stringifies exactly as the number does — which is why an IN-RANGE one already
 * resolved: `readWindow(recording, { signalIndices: [1n], … })` reads signal 1 today, reports
 * `signalIndex` as the number 1 on the chunk, and `[1, 1n]` deduplicates to one signal because
 * 0.6.135 keys `seen` on the resolved `signal.index`.
 *
 * So the spelling was accepted where it worked and blamed where it did not. 0.6.218 drew exactly
 * this distinction for the canonical decimal STRING — "`header.signals['9']` is the property access
 * `header.signals[9]` is" — and 0.6.225 and 0.6.226 carried it to the other two copies. A BigInt is
 * the other spelling the same property access takes, and it is one this package produces: ticks are
 * BigInt everywhere in it, so an index derived from tick arithmetic arrives written this way.
 *
 * The round trip is what makes it a spelling. Past the safe-integer range `Number()` loses digits,
 * and a BigInt there names no index at all, so it stays described as the BigInt it is.
 */

import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../src/decode/digital.js';
import { EdfChannelNotFoundError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { sampleAt } from '../../src/sample-locate.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const SIGNALS = 3;

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 16 },
    { label: 'Fp2', samplesPerRecord: 8 },
  ],
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

/** The three copies of the diagnosis, each reached through a different published call. */
const CALLS: ReadonlyArray<
  readonly [string, (recording: EdfRecording, selector: unknown) => unknown, string]
> = [
  [
    'the reading calls',
    (recording, selector) =>
      readWindow(recording, {
        signalIndices: [selector] as never,
        startSeconds: 0,
        durationSeconds: 1,
      }),
    'is outside the',
  ],
  [
    'sampleAt',
    (recording, selector) => sampleAt(recording, selector as never, 0.5),
    'is outside the',
  ],
  [
    'decodeDigital',
    async (recording, selector) => {
      const bytes = await readRecordBytes(recording.source, recording.header, {
        start: 0,
        count: 2,
      });
      return decodeDigital(recording.header, bytes, { start: 0, count: 2 }, selector as never);
    },
    'is not one of the',
  ],
];

describe.each(CALLS)('%s', (_name, call, outOfRange) => {
  it('diagnoses a BigInt as the index it spells', async () => {
    const recording = await opened();
    const thrown = await refusal(() => call(recording, 9n));
    expect(thrown.message).toContain(`signalIndex 9 ${outOfRange}`);
    expect(thrown.message).not.toContain('not a number this header can be indexed by');
  });

  it('says the same thing for the BigInt as for the number', async () => {
    const recording = await opened();
    const asBigInt = await refusal(() => call(recording, 9n));
    const asNumber = await refusal(() => call(recording, 9));
    expect(asBigInt.message).toBe(asNumber.message);
  });

  it('says the same thing for the BigInt as for the decimal string', async () => {
    const recording = await opened();
    const asBigInt = await refusal(() => call(recording, 9n));
    const asString = await refusal(() => call(recording, '9'));
    expect(asBigInt.message).toBe(asString.message);
  });

  it('leaves a BigInt past the safe-integer range described as one', async () => {
    const recording = await opened();
    const thrown = await refusal(() => call(recording, 2n ** 70n));
    expect(thrown.message).toContain('not a number this header can be indexed by');
    expect(thrown.message).toContain('BigInt');
  });

  it('stays an EdfChannelNotFoundError', async () => {
    const recording = await opened();
    expect(await refusal(() => call(recording, 9n))).toBeInstanceOf(EdfChannelNotFoundError);
  });

  it('still answers for a BigInt the file does have', async () => {
    const recording = await opened();
    expect(await call(recording, 1n)).toBeDefined();
  });
});

describe('why the spelling resolves at all', () => {
  it('reads the signal a BigInt names, and reports its index as a number', async () => {
    const recording = await opened();
    const chunks = await readWindow(recording, {
      signalIndices: [1n] as never,
      startSeconds: 0,
      durationSeconds: 1,
    });
    const signal = chunks[0]?.signals[0];
    expect(signal?.signalIndex).toBe(1);
    expect(typeof signal?.signalIndex).toBe('number');
  });

  it('deduplicates a BigInt against the number, as 0.6.135 requires', async () => {
    const recording = await opened();
    const chunks = await readWindow(recording, {
      signalIndices: [1, 1n] as never,
      startSeconds: 0,
      durationSeconds: 1,
    });
    expect(chunks[0]?.signals).toHaveLength(1);
  });

  it('is the same property access the number makes', () => {
    const signals = ['a', 'b'];
    expect(signals[1n as unknown as number]).toBe(signals[1]);
  });
});

describe('everything else keeps its diagnosis', () => {
  it.each([
    ['a label', 'Fp1'],
    ['a padded number string', '  9  '],
    ['an empty string', ''],
    ['an object', {}],
    ['null', null],
  ])('describes %s as what it is', async (_shape, selector) => {
    const recording = await opened();
    const thrown = await refusal(() =>
      readWindow(recording, {
        signalIndices: [selector] as never,
        startSeconds: 0,
        durationSeconds: 1,
      }),
    );
    expect(thrown.message).toContain('not a number this header can be indexed by');
  });

  it.each([
    ['a fraction', 1.5, 'falls between two signals'],
    ['past the end', 99, `is outside the ${SIGNALS} signals`],
  ])('keeps the sentence for %s', async (_shape, selector, expected) => {
    const recording = await opened();
    const thrown = await refusal(() =>
      readWindow(recording, {
        signalIndices: [selector] as never,
        startSeconds: 0,
        durationSeconds: 1,
      }),
    );
    expect(thrown.message).toContain(expected);
  });
});
