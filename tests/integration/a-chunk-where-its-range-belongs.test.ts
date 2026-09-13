/**
 * The chunk itself, where the range it was read with belongs.
 *
 * `recording.ts` writes the idiom out: `readAnnotations(edf, chunk.records)` — reading the
 * annotations that go with a chunk you already have is the reason that call takes a range at all.
 * `readRecords(edf, { records: chunk.records, signalIndices })` is the same move for re-reading
 * those records with a different selection. Both start from a chunk and ask for one field off it,
 * which makes passing the chunk the mistake this path invites.
 *
 * `assertRecordRange` has been thorough about wrong ranges since 0.4.443 — absent, null, an array,
 * a string, `{ start: 0 }` with no count — and a chunk reads as the same thing they all do:
 * `{ start: undefined, count: undefined }`. So it was refused with "is not inside the 6 data
 * records this file contains", a claim about a range that was never named, and told to clamp it
 * against `header.recordCount`, which no clamp can satisfy.
 *
 * The distinction is worth drawing precisely here and nowhere else: `decodeDigital` and
 * `decodeAnnotations` carry the same shape of guard, and a caller holding a chunk already holds
 * decoded samples, so neither has a recipe that starts from one.
 *
 * It stays an `EdfRangeError` carrying `requested` and `available`, because every other refusal
 * from this guard is one and a handler should not have to learn a second shape.
 */

import { describe, expect, it } from 'vitest';
import { EdfRangeError, isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf, readAnnotations, readRecords } from '../../src/recording.js';
import type { EdfChunk, EdfRecording, RecordRange } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const RECORDS = 6;

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    { samplesPerRecord: 40, tals: (r) => [{ onset: r + 0.25, texts: [`event ${r}`] }] },
  ],
});

async function opened(): Promise<{ recording: EdfRecording; chunk: EdfChunk }> {
  const recording = await openEdf(byteSource(FILE));
  const chunk = await readRecords(recording, {
    signalIndices: [0],
    records: { start: 1, count: 2 },
  });
  return { recording, chunk };
}

type Call = (recording: EdfRecording, records: unknown) => Promise<unknown>;

const CALLS: ReadonlyArray<readonly [string, Call]> = [
  ['readAnnotations', (recording, records) => readAnnotations(recording, records as RecordRange)],
  [
    'readRecords',
    (recording, records) =>
      readRecords(recording, { records: records as RecordRange, signalIndices: [0] }),
  ],
  [
    'readRecordBytes',
    (recording, records) =>
      readRecordBytes(recording.source, recording.header, records as RecordRange),
  ],
];

describe.each(CALLS)('%s, given the chunk rather than chunk.records', (_name, call) => {
  it('names the chunk and the field the range is on', async () => {
    const { recording, chunk } = await opened();
    const thrown = await call(recording, chunk).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown, 'the call resolved with a chunk where a range belongs').toBeDefined();
    expect(thrown?.message).toContain('that is a chunk, not a record range');
    expect(thrown?.message).toContain('chunk.records');
    // Never the old diagnosis: a range that was never named cannot be outside anything, and
    // clamping is not something the caller can do about it.
    expect(thrown?.message).not.toContain('is not inside');
    expect(thrown?.message).not.toContain('clamp');
  });

  it('is still an EdfRangeError carrying the fields a handler branches on', async () => {
    const { recording, chunk } = await opened();
    const thrown = (await call(recording, chunk).then(
      () => undefined,
      (error: unknown) => error as EdfRangeError,
    )) as EdfRangeError;
    expect(thrown).toBeInstanceOf(EdfRangeError);
    expect(isEdfError(thrown)).toBe(true);
    expect(thrown.available).toEqual({ start: 0, count: RECORDS });
  });

  it('still accepts the field itself', async () => {
    const { recording, chunk } = await opened();
    await expect(call(recording, chunk.records)).resolves.toBeDefined();
  });
});

describe('every other wrong range', () => {
  it.each([
    ['absent', undefined],
    ['null', null],
    ['an empty object', {}],
    ['only a start', { start: 0 }],
    ['a range past the end', { start: RECORDS - 1, count: RECORDS }],
  ])('is still refused as %s was before', async (_shape, records) => {
    const { recording } = await opened();
    const thrown = await readAnnotations(recording, records as RecordRange).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown).toBeInstanceOf(EdfRangeError);
    expect(thrown?.message).toContain(`is not inside the ${RECORDS} data records`);
  });
});
