/**
 * A record range that is not a range, refused the way every other wrong one already was.
 *
 * `assertRecordRange` is the guard behind `readRecords` and `readAnnotations`, and it was already
 * thorough about the values a range can hold: a negative start, a fractional one, a `NaN` count, a
 * range running past the last record, and shapes that are not ranges at all — an array, a string,
 * `{ start: 0 }` with no count — all read as `{ start: undefined, count: undefined }` and were
 * refused with the file's record count and a next step.
 *
 * Two values were not: `undefined` and `null`. Those are the ones that reach `records.start`
 * before anything has looked at them, and they produced
 * `TypeError: Cannot read properties of undefined (reading 'start')` — which names neither the
 * option, nor the file, nor anything to do about it, from a package where every thrown message
 * ends with a `Next:` clause.
 *
 * They are also the likeliest two. A range built from JSON, from a config file, from a
 * JavaScript call site, or from an object spread that dropped a key is absent rather than
 * malformed; `{ start: 0, count: undefined }` is what a half-built object looks like, and it was
 * already handled. The whole thing missing was not.
 *
 * `readAnnotations` is checked alongside `readRecords` because it shares the guard — one fix, two
 * entry points, and the reason to check both is that sharing is a fact about today's code.
 *
 * A count of zero is still accepted: a range naming no records is answerable, and the answer is
 * nothing. Only the absence of a range is a mistake.
 */

import { describe, expect, it } from 'vitest';
import { EdfRangeError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations, readRecords } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { minimalEdfPlus } from '../support/writer.js';

const RECORDS = 4;

const open = (): Promise<EdfRecording> =>
  openEdf(byteSource(minimalEdfPlus({ recordCount: RECORDS, recordDurationSeconds: 1 })));

type Call = (recording: EdfRecording, records: unknown) => Promise<unknown>;

const CALLS: ReadonlyMap<string, Call> = new Map<string, Call>([
  [
    'readRecords',
    (recording, records) => readRecords(recording, { records, signalIndices: [0] } as never),
  ],
  ['readAnnotations', (recording, records) => readAnnotations(recording, records as never)],
]);

const refusalOf = async (call: Call, records: unknown): Promise<Error | undefined> => {
  const recording = await open();
  return call(recording, records).then(
    () => undefined,
    (thrown: unknown) => thrown as Error,
  );
};

describe.each([...CALLS.entries()])('%s', (_name, call) => {
  it.each([
    ['omitted', undefined],
    ['null', null],
  ])('refuses a range that is %s, in edfcore words', async (_shape, records) => {
    const failure = await refusalOf(call, records);
    expect(failure, 'the call resolved with no range').toBeDefined();
    expect(failure).toBeInstanceOf(EdfRangeError);
    // Not a TypeError about a property of undefined.
    expect(failure?.message).not.toContain('Cannot read properties');
    expect(failure?.message).toContain('Next:');
    // Names the file's own count, which is what the caller has to clamp against.
    expect(failure?.message).toContain(`${RECORDS} data records this file contains`);
  });

  it('answers a missing range exactly as it answers a half-built one', async () => {
    // `{ start: 0 }` was already refused with this message. The absent case now joins it rather
    // than taking a different path out of the library.
    const absent = await refusalOf(call, undefined);
    const halfBuilt = await refusalOf(call, {});
    expect(absent?.message).toBe(halfBuilt?.message);
  });

  it('carries the fields a handler branches on', async () => {
    const failure = (await refusalOf(call, undefined)) as EdfRangeError;
    expect(failure.available).toEqual({ start: 0, count: RECORDS });
    // `requested` is the stand-in, so a handler reading it finds an object rather than undefined.
    expect(failure.requested).toEqual({});
  });

  it.each([
    ['a negative start', { start: -1, count: 1 }],
    ['a fractional start', { start: 0.5, count: 1 }],
    ['a NaN count', { start: 0, count: Number.NaN }],
    ['a range past the end', { start: RECORDS - 1, count: RECORDS }],
    ['an array', [0, 1]],
    ['a string', '0-1'],
  ])('still refuses %s the same way', async (_shape, records) => {
    const failure = await refusalOf(call, records);
    expect(failure).toBeInstanceOf(EdfRangeError);
    expect(failure?.message).toContain('Next:');
  });

  it('still accepts a range that names no records', async () => {
    const recording = await open();
    await expect(call(recording, { start: 0, count: 0 })).resolves.toBeDefined();
  });
});
