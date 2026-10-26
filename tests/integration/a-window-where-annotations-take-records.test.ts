/**
 * A time window handed to the call that reads annotations by record.
 *
 * `readRecords(recording, { signalIndices, startSeconds, durationSeconds })` has been refused as a
 * time window since 0.6.88, because `readWindow` sits beside it and takes exactly that. The same
 * mistake one call over, `readAnnotations(recording, { startSeconds, durationSeconds })`, never
 * reached that guard — `readAnnotations` takes the range itself, not a selection — and was refused
 * by the range guard as `records { start: undefined, count: undefined }`: bounds nobody wrote,
 * "not inside" a file they were never measured against.
 *
 * The answer is the call that turns seconds into records, which is also the only seconds route
 * that ends at annotations: readWindow() returns samples.
 */

import { describe, expect, it } from 'vitest';
import { EdfRangeError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { minimalEdfPlus } from '../support/writer.js';

const WINDOW = { startSeconds: 0, durationSeconds: 2 };

const refusal = async (call: () => Promise<unknown>): Promise<Error> =>
  call().then(
    () => {
      throw new Error('the window was accepted');
    },
    (error: unknown) => error as Error,
  );

describe('a time window where a record range belongs', () => {
  it('is named a time window by readAnnotations, with the call that converts it', async () => {
    const recording = await openEdf(byteSource(minimalEdfPlus({ recordCount: 4 })));
    const thrown = await refusal(() => readAnnotations(recording, WINDOW as never));
    expect(thrown).toBeInstanceOf(EdfRangeError);
    expect(thrown.message).toContain('that is a time window, not a record range');
    expect(thrown.message).toContain('resolveTimeWindow(');
    expect(thrown.message).not.toContain('start: undefined');
  });

  it('is named the same way by readRecordBytes, which shares the guard', async () => {
    const recording = await openEdf(byteSource(minimalEdfPlus({ recordCount: 4 })));
    const thrown = await refusal(() =>
      readRecordBytes(recording.source, recording.header, WINDOW as never),
    );
    expect(thrown.message).toContain('that is a time window, not a record range');
  });

  it('leaves a real range alone', async () => {
    const recording = await openEdf(byteSource(minimalEdfPlus({ recordCount: 4 })));
    const result = await readAnnotations(recording, { start: 0, count: 4 });
    expect(result.annotations).toEqual([]);
  });
});
