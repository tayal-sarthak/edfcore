/**
 * Every numeric guard on the public surface, handed a string instead of a number.
 *
 * The guards are right to refuse one — `Number.isSafeInteger('4')` is false and
 * `Number.isFinite('1')` is false — and each of them then printed the value with `${value}`. So the
 * refusal for the string `'4'` read "must be a positive whole number, received 4", which is a
 * sentence whose rule its own evidence satisfies.
 *
 * 0.6.92 fixed it in the time layer, 0.6.94 in the sample family, and both were one-off. This is
 * the sweep across the rest: the envelope's two numbers, the stream's chunk size, the two
 * segment-lookup times, and the byte length `parseHeader` takes (fixed in 0.6.99).
 *
 * Behavioural rather than a source scan, so it covers each guard by the route a caller reaches it
 * by. A string is the case that matters: it is what a query parameter, a `<input>` value, a CSV
 * cell and a config file all hand over, and it is the one wrong type that spells a valid number.
 */

import { describe, expect, it } from 'vitest';
import { envelopeOfSamples, readEnvelopeAtResolution } from '../../src/envelope.js';
import { parseHeader } from '../../src/header/parse.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex, gapAt, segmentAt } from '../../src/record-index.js';
import { openEdf, readRecords } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import { buildEdf } from '../support/writer.js';

const BYTES = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

/** The cast a JavaScript caller does not need to write. */
const loosely = <T>(value: unknown) => value as T;

async function refusal(run: () => unknown): Promise<string> {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the string was accepted as a number');
}

async function guards(): Promise<ReadonlyArray<readonly [string, () => unknown]>> {
  const recording = await openEdf(byteSource(BYTES));
  const index = await buildRecordIndex(recording);
  const window = { signalIndices: [0], startSeconds: 0, durationSeconds: 2 };
  const chunk = await readRecords(recording, {
    records: { start: 0, count: 1 },
    signalIndices: [0],
  });
  const chunkSignal = chunk.signals[0];
  if (chunkSignal === undefined) throw new Error('fixture yielded no chunk signal');
  return [
    ['envelopeOfSamples buckets', () => envelopeOfSamples(chunkSignal, loosely('4'))],
    [
      'readEnvelopeAtResolution secondsPerBucket',
      () => readEnvelopeAtResolution(recording, { ...window, secondsPerBucket: loosely('1') }),
    ],
    [
      'streamRecords chunkRecords',
      () =>
        streamRecords(recording, { ...window, chunkRecords: loosely('1') })
          [Symbol.asyncIterator]()
          .next(),
    ],
    ['segmentAt seconds', () => segmentAt(index, loosely('1'))],
    ['gapAt seconds', () => gapAt(index, loosely('1'))],
    ['parseHeader sourceByteLength', () => parseHeader(BYTES, loosely('256'))],
  ];
}

describe('a string where a number belongs', () => {
  it('is described as a string by every guard on the surface', async () => {
    for (const [name, run] of await guards()) {
      const message = await refusal(run);
      expect({ name, says: message.includes('the string "') }).toEqual({ name, says: true });
    }
  });

  it('is never printed bare, which is what made the sentences contradict themselves', async () => {
    for (const [name, run] of await guards()) {
      const message = await refusal(run);
      expect({ name, bare: /received (?:\d|-)/.test(message) }).toEqual({ name, bare: false });
    }
  });

  it('covers enough guards that a passing run is not a vacuous one', async () => {
    expect((await guards()).length).toBeGreaterThanOrEqual(6);
  });
});

describe('a BigInt, which this package hands out for every instant', () => {
  it('is named as one rather than as the number it prints as', async () => {
    const recording = await openEdf(byteSource(BYTES));
    const index = await buildRecordIndex(recording);
    expect(await refusal(() => segmentAt(index, loosely(10_000_000n)))).toContain(
      'the BigInt 10000000n',
    );
  });
});

describe('the numbers that were already described correctly', () => {
  it('still print bare', async () => {
    const recording = await openEdf(byteSource(BYTES));
    const index = await buildRecordIndex(recording);
    expect(await refusal(() => segmentAt(index, Number.NaN))).toContain('received NaN');
    expect(await refusal(() => parseHeader(BYTES, -1))).toContain('received -1');
  });
});
