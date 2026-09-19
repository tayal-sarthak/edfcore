/**
 * `EdfRangeError.requested`, which carried whatever was refused.
 *
 * The field is declared a `RecordRange`, and the range guards handed over the value they had just
 * rejected. So `readRecordBytes(source, header, chunk)` — the mistake 0.6.153 gave its own message —
 * put the ENTIRE CHUNK on the error: `signals`, and every sample in every `digital` array, under a
 * field a handler reads `.start` off and gets `undefined` from.
 *
 * What that costs is not the type. `JSON.stringify(error)` and every structured logger walk own
 * enumerable properties, so one refused call wrote a recording's samples into a log line — which is
 * the outcome `describeRecordRange` and `quoteLabels` both exist to prevent: "printing its contents
 * is how a 512-signal selection ends up on one line behind `edfcore: `".
 *
 * Narrowed in the constructor rather than at each guard, so no later one can reintroduce it. A
 * well-formed range is unchanged, and a wrong shape keeps whatever it had under `start` and `count`
 * and nothing else — the same pair the message prints.
 */

import { describe, expect, it } from 'vitest';
import { EdfRangeError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import type { EdfChunk, EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const RECORDS = 6;

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 16 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function opened(): Promise<{ recording: EdfRecording; chunk: EdfChunk }> {
  const recording = await openEdf(byteSource(FILE));
  const chunks = await readWindow(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 3,
  });
  return { recording, chunk: chunks[0] as EdfChunk };
}

const thrownBy = async (call: () => Promise<unknown>): Promise<EdfRangeError> =>
  (await call().then(
    () => undefined,
    (error: unknown) => error,
  )) as EdfRangeError;

describe('a chunk given where its own range belongs', () => {
  it('no longer puts the recording on the error', async () => {
    const { recording, chunk } = await opened();
    const error = await thrownBy(() =>
      readRecordBytes(recording.source, recording.header, chunk as never),
    );
    expect(error).toBeInstanceOf(EdfRangeError);
    expect(Object.keys(error.requested).sort()).toEqual(['count', 'start']);
    expect((error.requested as unknown as Record<string, unknown>).signals).toBeUndefined();
  });

  it('no longer writes a recording’s samples into a log line', async () => {
    const { recording, chunk } = await opened();
    const error = await thrownBy(() =>
      readRecordBytes(recording.source, recording.header, chunk as never),
    );
    const logged = JSON.stringify({ requested: error.requested, available: error.available });
    expect(logged.length).toBeLessThan(80);
    // The chunk really does hold samples, so the old payload really did carry them.
    expect(chunk.signals[0]?.digital.length).toBeGreaterThan(0);
  });

  it('still says what it always said', async () => {
    const { recording, chunk } = await opened();
    const error = await thrownBy(() =>
      readRecordBytes(recording.source, recording.header, chunk as never),
    );
    expect(error.message).toContain('that is a chunk, not a record range');
    expect(error.available).toEqual({ start: 0, count: RECORDS });
  });
});

describe('an array of ranges given where one belongs', () => {
  it('keeps the payload to the two fields as well', async () => {
    const { recording } = await opened();
    const error = await thrownBy(() =>
      readAnnotations(recording, [{ start: 0, count: 1 }] as never),
    );
    expect(Object.keys(error.requested).sort()).toEqual(['count', 'start']);
    expect(Array.isArray(error.requested)).toBe(false);
  });
});

describe('a range that really is one', () => {
  it('still travels intact', async () => {
    const { recording } = await opened();
    const error = await thrownBy(() =>
      readRecords(recording, { signalIndices: [0], records: { start: RECORDS - 1, count: 4 } }),
    );
    expect(error.requested).toEqual({ start: RECORDS - 1, count: 4 });
    expect(error.available).toEqual({ start: 0, count: RECORDS });
  });

  it('still reports a half-built one as the stand-in, which a handler reads', async () => {
    const { recording } = await opened();
    const error = await thrownBy(() => readRecords(recording, { signalIndices: [0] } as never));
    expect(error.requested).toEqual({});
    expect(error.requested.start).toBeUndefined();
  });

  it('still carries what a bad start and count held, under their own names', async () => {
    const { recording } = await opened();
    const error = await thrownBy(() =>
      readRecords(recording, {
        signalIndices: [0],
        records: { start: '0', count: '1' } as never,
      }),
    );
    expect(error.requested).toEqual({ start: '0', count: '1' });
  });
});
