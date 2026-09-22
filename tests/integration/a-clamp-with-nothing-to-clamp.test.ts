/**
 * "Clamp the range against header.recordCount", said to a caller holding no numbers.
 *
 * `assertRecordRange` sits behind `readRecords`, `readAnnotations` and `readRecordBytes`, and its
 * two shape branches are each documented as a fix for the sentence beneath them. Both name the same
 * half of it: advice "to clamp it against `header.recordCount`, which no clamp can satisfy". A
 * chunk got a sentence in 0.4.443 and an array of ranges one in 0.6.212 — one shape each. Every
 * other range with no numbers in it kept the clamp: the `records ?? {}` stand-in at the top of the
 * guard, which exists because `undefined` and `null` are "the likeliest two"; a half-built
 * `{ start: 0 }`; a range whose fields arrived from JSON as strings.
 *
 * A caller does not have to pass any of those literally to get here. `readRecords` refuses a
 * missing SELECTION with "pass { records, signalIndices }", and 0.6.88 refuses one carrying
 * `startSeconds` instead — so `readRecords(recording, { signalIndices: [0] })` passes both guards
 * and reaches this one with nothing. It is written that way because the range reads as optional,
 * and no message answered that belief. It is not optional, deliberately, and `readAnnotations`
 * gives the reason: a full-file scan "is a legitimate thing to want and an expensive thing to do by
 * accident, so it is always visible in the caller's source". That range, counted for the file in
 * hand, is what a caller with nothing to clamp needs, and it is what the clause says now.
 *
 * ONLY the advice changed. The sentence naming the range and the file's record count is true of
 * both cases and is what the callers of this guard are pinned on — including
 * `missing-record-range.test.ts`, which has required the absent range and the half-built one to
 * answer identically since 0.4.443, and they still do.
 */

import { describe, expect, it } from 'vitest';
import { EdfRangeError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const RECORDS = 6;

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

interface Call {
  /** The call with no range on it — what a caller writes. */
  readonly without: (recording: EdfRecording) => unknown;
  /** The same call with one, so the guard is the only thing refusing. */
  readonly with: (recording: EdfRecording) => unknown;
}

const CALLS: ReadonlyArray<readonly [string, Call]> = [
  [
    'readAnnotations',
    {
      without: (recording) => readAnnotations(recording, undefined as never),
      with: (recording) => readAnnotations(recording, { start: 0, count: RECORDS }),
    },
  ],
  [
    'readRecords',
    {
      without: (recording) => readRecords(recording, { signalIndices: [0] } as never),
      with: (recording) =>
        readRecords(recording, { signalIndices: [0], records: { start: 0, count: RECORDS } }),
    },
  ],
  [
    'readRecordBytes',
    {
      without: (recording) =>
        readRecordBytes(recording.source, recording.header, undefined as never),
      with: (recording) =>
        readRecordBytes(recording.source, recording.header, { start: 0, count: RECORDS }),
    },
  ],
];

describe.each(CALLS)('%s, reached with no range', (_name, call) => {
  it('no longer advises a clamp, or an index lookup for a time', async () => {
    const thrown = await refusal(async () => call.without(await opened()));
    expect(thrown.message).not.toContain('clamp the range');
    expect(thrown.message).not.toContain('index.locate');
  });

  it('asks for the two numbers instead, and says there is no default', async () => {
    const thrown = await refusal(async () => call.without(await opened()));
    expect(thrown.message).toContain('pass a start and a count');
    expect(thrown.message).toContain('there is no default');
  });

  it('spells out the whole-file range, counted for this file', async () => {
    const thrown = await refusal(async () => call.without(await opened()));
    expect(thrown.message).toContain(`start 0, count ${RECORDS}`);
  });

  it('keeps the sentence every caller of this guard is pinned on', async () => {
    const thrown = await refusal(async () => call.without(await opened()));
    expect(thrown.message).toContain(`is not inside the ${RECORDS} data records this file`);
  });

  it('stays an EdfRangeError carrying the fields a handler branches on', async () => {
    const thrown = await refusal(async () => call.without(await opened()));
    expect(thrown).toBeInstanceOf(EdfRangeError);
    expect((thrown as EdfRangeError).available).toEqual({ start: 0, count: RECORDS });
  });

  it('still answers for the range the message spells out', async () => {
    expect(await call.with(await opened())).toBeDefined();
  });
});

describe('the other shapes that have nothing to clamp', () => {
  it.each([
    ['null', null],
    ['an empty object', {}],
    ['a half-built range with no count', { start: 0 }],
    ['a string', '0-6'],
    ['only a count', { count: 1 }],
    ['a null field', { start: null, count: 1 }],
  ])('answers %s the same way', async (_shape, records) => {
    const recording = await opened();
    const thrown = await refusal(() => readAnnotations(recording, records as never));
    expect(thrown.message).toContain('pass a start and a count');
    expect(thrown.message).not.toContain('clamp the range');
  });
});

describe('a range that really is two numbers', () => {
  it.each([
    ['past the end', { start: 0, count: RECORDS + 1 }],
    ['a negative start', { start: -1, count: 1 }],
    ['a fractional start', { start: 0.5, count: 1 }],
    ['a NaN count', { start: 0, count: Number.NaN }],
  ])('keeps the clamp for %s, where a clamp is the fix', async (_shape, records) => {
    const recording = await opened();
    const thrown = await refusal(() => readAnnotations(recording, records));
    expect(thrown.message).toContain(`is not inside the ${RECORDS} data records`);
    expect(thrown.message).toContain('clamp the range against header.recordCount');
  });
});

describe('the two shapes that already had a sentence of their own', () => {
  it('keeps the chunk refusal', async () => {
    const recording = await opened();
    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 2,
    });
    const thrown = await refusal(() => readAnnotations(recording, chunks[0] as never));
    expect(thrown.message).toContain('that is a chunk, not a record range');
  });

  it('keeps the refusal for an array of ranges', async () => {
    const recording = await opened();
    const thrown = await refusal(() =>
      readAnnotations(recording, [{ start: 0, count: 1 }] as never),
    );
    expect(thrown.message).toContain('that is an array of record ranges');
  });
});
