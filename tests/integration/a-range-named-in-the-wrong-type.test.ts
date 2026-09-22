/**
 * "Pass a start and a count", said to a caller who passed both.
 *
 * 0.6.221 split this clause on whether there are two numbers to clamp, and treated everything that
 * is not two numbers as a missing range. `{ start: 0n, count: 2n }` is not one. Both bounds are
 * there, named, and in the right order; they are BigInts, which this call cannot use because it
 * ADDS and MULTIPLIES them — `records.start + records.count`, `records.count *
 * header.recordByteLength` — rather than keying by them.
 *
 * So the advice written for an absent range went to a caller holding a complete one: it told them a
 * whole-file read has no default and spelled that range out, when what they had written was the
 * two-record read they wanted.
 *
 * A BigInt gets here because ticks are BigInt everywhere in this package, which is the same route
 * 0.6.242 traced for the signal index. There the spelling resolves, because a property key
 * stringifies and `signals[9n]` is `signals[9]`. Here it does not: arithmetic on a BigInt and a
 * number throws, and the two are not the same value.
 *
 * A range that really is absent keeps its own clause, and a range that is two numbers keeps the
 * clamp.
 */

import { describe, expect, it } from 'vitest';
import { EdfRangeError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf, readAnnotations, readRecords } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const RECORDS = 4;

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: RECORDS,
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

const CALLS: ReadonlyArray<readonly [string, (r: EdfRecording, records: unknown) => unknown]> = [
  ['readAnnotations', (r, records) => readAnnotations(r, records as never)],
  ['readRecords', (r, records) => readRecords(r, { records, signalIndices: [0] } as never)],
  ['readRecordBytes', (r, records) => readRecordBytes(r.source, r.header, records as never)],
];

describe.each(CALLS)('%s, given bounds in the wrong type', (_name, call) => {
  it.each([
    ['both BigInts', { start: 0n, count: 2n }],
    ['one BigInt', { start: 0, count: 2n }],
    ['both strings', { start: '0', count: '2' }],
  ])('no longer tells them to pass what they passed, for %s', async (_shape, records) => {
    const thrown = await refusal(async () => call(await opened(), records));
    expect(thrown.message).not.toContain('pass a start and a count');
    expect(thrown.message).not.toContain('there is no default');
  });

  it('says why this call cannot use them', async () => {
    const thrown = await refusal(async () => call(await opened(), { start: 0n, count: 2n }));
    expect(thrown.message).toContain('pass the two bounds as numbers');
    expect(thrown.message).toContain('counts and adds them rather than using them as keys');
    expect(thrown.message).toContain('Number(value) converts one');
  });

  it('still prints the bounds as written', async () => {
    const thrown = await refusal(async () => call(await opened(), { start: 0n, count: 2n }));
    expect(thrown.message).toContain('the BigInt 0n');
    expect(thrown.message).toContain('the BigInt 2n');
  });

  it('stays an EdfRangeError carrying the fields a handler branches on', async () => {
    const thrown = (await refusal(async () =>
      call(await opened(), { start: 0n, count: 2n }),
    )) as EdfRangeError;
    expect(thrown).toBeInstanceOf(EdfRangeError);
    expect(thrown.available).toEqual({ start: 0, count: RECORDS });
  });

  it('still answers for the same range written as numbers', async () => {
    expect(await call(await opened(), { start: 0, count: 2 })).toBeDefined();
  });
});

describe('a range that really is absent', () => {
  it.each([
    ['omitted', undefined],
    ['null', null],
    ['an empty object', {}],
    ['a string', '0-2'],
    ['a start alone, which names one bound rather than mistyping two', { start: 0 }],
    ['a count alone', { count: 2 }],
    ['a null bound beside a good one', { start: null, count: 2 }],
  ])('keeps the 0.6.221 clause for %s', async (_shape, records) => {
    const thrown = await refusal(async () => readAnnotations(await opened(), records as never));
    expect(thrown.message).toContain('pass a start and a count');
    expect(thrown.message).toContain(`start 0, count ${RECORDS}`);
  });
});

describe('a range that is two numbers', () => {
  it.each([
    ['past the end', { start: 0, count: RECORDS + 1 }],
    ['a negative start', { start: -1, count: 1 }],
    ['a NaN count', { start: 0, count: Number.NaN }],
  ])('keeps the clamp for %s', async (_shape, records) => {
    const thrown = await refusal(async () => readAnnotations(await opened(), records));
    expect(thrown.message).toContain('clamp the range against header.recordCount');
  });
});

describe('why the spelling does not resolve here, unlike a signal index', () => {
  it('is that these bounds are arithmetic, not a key', () => {
    const signals = ['a', 'b'];
    // A property key stringifies, which is why 0.6.242 reads an index out of a BigInt.
    expect(signals[1n as unknown as number]).toBe(signals[1]);
    // Arithmetic does not: mixing the two throws rather than converting.
    expect(() => (0n as unknown as number) + 2).toThrow(TypeError);
  });
});
