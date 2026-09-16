/**
 * The RANGES a window maps to, where one range belongs.
 *
 * `readAnnotations(recording, records)` and `readRecordBytes(source, header, records)` take a single
 * `RecordRange`. The call that turns seconds into records is `resolveTimeWindow`, and it returns an
 * ARRAY of them — one per contiguous run, because a window over an EDF+D file crosses gaps.
 *
 * So a caller who has a time window and needs records writes
 * `readAnnotations(edf, resolveTimeWindow(edf.timeline, edf.index, from, span))`, and on a
 * continuous file — every plain EDF, every EDF+C — that array holds exactly one element, which is
 * precisely what makes it look right.
 *
 * `assertRecordRange` has counted an array among the shapes it handles since 0.4.443, and what it
 * handled it with was the generic sentence: an array has no `start` and no `count`, so it read as
 * `{ start: undefined, count: undefined }`, was refused for not being inside the file's records, and
 * was told to clamp it against `header.recordCount`. No clamp reaches an array.
 *
 * 0.6.167 closed the same route for the reading API's selection and 0.6.170 for the annotation
 * window, both naming `resolveTimeWindow` as where the array comes from. This is the third and last
 * shape in the package an array of its ranges can be mistaken for.
 *
 * It stays an `EdfRangeError` carrying `requested` and `available`, like every other refusal from
 * this guard.
 */

import { describe, expect, it } from 'vitest';
import { EdfRangeError, isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf, readAnnotations, readRecords } from '../../src/recording.js';
import { resolveTimeWindow } from '../../src/time/window.js';
import type { EdfRecording } from '../../src/types.js';
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

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

type Call = (recording: EdfRecording, records: unknown) => Promise<unknown>;

const CALLS: ReadonlyArray<readonly [string, Call]> = [
  ['readAnnotations', (recording, records) => readAnnotations(recording, records as never)],
  [
    'readRecords',
    (recording, records) =>
      readRecords(recording, { signalIndices: [0], records: records as never }),
  ],
  [
    'readRecordBytes',
    (recording, records) => readRecordBytes(recording.source, recording.header, records as never),
  ],
];

describe.each(CALLS)('%s, given what resolveTimeWindow returned', (_name, call) => {
  it('is refused as a list of ranges rather than as a range with no bounds', async () => {
    const recording = await opened();
    const ranges = resolveTimeWindow(recording.timeline, recording.index, 1, 2);
    // The shape that makes the mistake read correctly: one run, so one element.
    expect(ranges.length).toBe(1);
    const thrown = await call(recording, ranges).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown, 'the array was read as a range').toBeDefined();
    expect(thrown?.message).toContain('an array of record ranges');
    // The old sentence described bounds the array never had, and asked for a clamp.
    expect(thrown?.message).not.toContain('start: undefined');
  });

  it('names the element to pass, and the call that takes the seconds instead', async () => {
    const recording = await opened();
    const ranges = resolveTimeWindow(recording.timeline, recording.index, 0, 3);
    const thrown = await call(recording, ranges).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown?.message).toContain('Next:');
    expect(thrown?.message).toContain('readWindow()');
  });

  it('stays the typed error every other bad range here throws', async () => {
    const recording = await opened();
    const thrown = await call(recording, [{ start: 0, count: 2 }]).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown).toBeInstanceOf(EdfRangeError);
    expect(isEdfError(thrown)).toBe(true);
  });

  it('still reads when one element of that array is passed', async () => {
    const recording = await opened();
    const ranges = resolveTimeWindow(recording.timeline, recording.index, 1, 2);
    await expect(call(recording, ranges[0])).resolves.toBeDefined();
  });
});

describe('the ranges themselves', () => {
  it('are still refused one at a time when they fall outside the file', async () => {
    const recording = await opened();
    await expect(readAnnotations(recording, { start: RECORDS - 1, count: 4 })).rejects.toThrow(
      /is not inside the 6 data records/,
    );
  });
});
