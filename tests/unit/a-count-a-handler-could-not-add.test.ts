/**
 * `EdfRangeError.requested`, when the range it refused was not made of numbers.
 *
 * The narrowing on this error stops at the two names: "a wrong shape keeps whatever it had under
 * those two names and nothing else". Those two names are declared `number`. So a range refused for
 * being the wrong TYPE — the case 0.6.243 wrote its `mistyped` branch for — put its string or its
 * BigInt straight onto the error, under a field a handler reads as a count.
 *
 * `error.requested.start + error.requested.count` was then `'01'`, or threw V8's "Cannot mix BigInt
 * and other types" inside the handler. The message had already said the values cannot be counted —
 * "this counts and adds them rather than using them as keys, so a BigInt or a string is not the same
 * value here" — and the payload beside it handed them back as though they could be.
 *
 * A typed payload is the one part of an error a program acts on rather than reads, which is the whole
 * reason `errors.ts` carries these fields. A field that lies about its type is worse here than a
 * message that lies, because nothing prints it for a human to notice.
 *
 * `NaN` rather than a dropped field or a coercion. Both fields are declared and required;
 * `Number.isFinite` is already how a handler has to check them; `NaN` is the one number that cannot
 * be mistaken for a count; and `Number('0')` would make the payload agree with a value the call
 * refused.
 *
 * What is unchanged: `requested` is still an object rather than `undefined`, still carries exactly
 * those two names and nothing else, and a well-formed range still arrives as itself. The value a
 * caller actually wrote is still named — in the message, through `describeRecordRange`.
 */

import { describe, expect, it } from 'vitest';
import { EdfRangeError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf, readRecords } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { minimalEdf } from '../support/writer.js';

const bytes = minimalEdf();
const open = (): Promise<EdfRecording> => openEdf(byteSource(bytes));

const refusal = async (call: () => unknown): Promise<EdfRangeError> => {
  const thrown = await Promise.resolve()
    .then(call)
    .then(
      () => undefined,
      (error: unknown) => error as Error,
    );
  expect(thrown, 'nothing was refused').toBeInstanceOf(EdfRangeError);
  return thrown as EdfRangeError;
};

const WRONG_TYPES: ReadonlyArray<readonly [string, unknown]> = [
  ['strings', { start: '0', count: '1' }],
  ['BigInts', { start: 0n, count: 1n }],
  ['one of each', { start: 0, count: '1' }],
  ['booleans', { start: true, count: true }],
  ['nothing at all', undefined],
  ['an empty object', {}],
];

describe.each(WRONG_TYPES)('a range made of %s', (_name, records) => {
  it('puts numbers on the payload, whatever it was given', async () => {
    const recording = await open();
    const error = await refusal(() =>
      readRecords(recording, { signalIndices: [0], records } as never),
    );
    expect(typeof error.requested.start).toBe('number');
    expect(typeof error.requested.count).toBe('number');
  });

  it('is a payload a handler can do arithmetic on without throwing', async () => {
    const recording = await open();
    const error = await refusal(() =>
      readRecords(recording, { signalIndices: [0], records } as never),
    );
    const total = error.requested.start + error.requested.count;
    expect(typeof total).toBe('number');
    expect(Number.isFinite(total)).toBe(false);
  });

  it('keeps exactly the two declared names and nothing else', async () => {
    const recording = await open();
    const error = await refusal(() =>
      readRecords(recording, { signalIndices: [0], records } as never),
    );
    expect(Object.keys(error.requested).sort()).toEqual(['count', 'start']);
  });
});

describe('the value a caller actually wrote', () => {
  it('is still named, in the message', async () => {
    const recording = await open();
    const strings = await refusal(() =>
      readRecords(recording, { signalIndices: [0], records: { start: '0', count: '1' } } as never),
    );
    expect(strings.message).toContain('the string "0"');
    const bigints = await refusal(() =>
      readRecords(recording, { signalIndices: [0], records: { start: 0n, count: 1n } } as never),
    );
    expect(bigints.message).toContain('the BigInt 0n');
  });
});

describe('a range that really is one', () => {
  it('arrives on the payload as itself', async () => {
    const recording = await open();
    const error = await refusal(() =>
      readRecords(recording, { signalIndices: [0], records: { start: 99, count: 4 } }),
    );
    expect(error.requested).toEqual({ start: 99, count: 4 });
    expect(error.available).toEqual({ start: 0, count: recording.header.recordCount });
  });

  it('and `available` is always this file, so it is always finite', async () => {
    const recording = await open();
    const error = await refusal(() =>
      readRecords(recording, { signalIndices: [0], records: { start: '0', count: '1' } } as never),
    );
    expect(Number.isFinite(error.available.start)).toBe(true);
    expect(Number.isFinite(error.available.count)).toBe(true);
  });
});

describe('the primitives that share this error', () => {
  it('report the same way', async () => {
    const recording = await open();
    const error = await refusal(() =>
      readRecordBytes(recording.source, recording.header, { start: '0', count: '1' } as never),
    );
    expect(error.requested).toEqual({ start: Number.NaN, count: Number.NaN });
  });
});
