/**
 * Streaming a window and joining it back is reading the window.
 *
 * `merge-split.test.ts` proves it for `readWindow`: the chunks one call returns merge back into the
 * read they were split from. `streamRecords` is the other way to get a window in pieces, and it is
 * different code — a `readRecords` per piece, a seam check between them, and a `chunkRecords` knob
 * that decides how many pieces there are. Its own docblock says the pieces must be "the same object
 * in every respect" as a read chunk, and `stream-equals-read.test.ts` checks that one piece at a
 * time. Whether they reassemble was not checked.
 *
 * It is the round trip a pipeline actually performs. `streamRecords` exists so a caller can walk a
 * twelve-hour recording without holding it; a filter or an FFT that needs one array at the end
 * merges what it kept. If the pieces do not join, the memory bound the call exists for is bought
 * with an answer the caller cannot reconstruct.
 *
 * So the stream is merged at four chunk sizes — including one that yields a single piece and one
 * that yields a piece per record — and compared against `readWindow` on the same window: the
 * samples, the record range, the byte offset and length, the exact start and duration in ticks, and
 * the diagnostics.
 *
 * On a discontinuous file the answer changes, and correctly. The stream crosses the gap in pieces,
 * so merging all of them is refused — with the overlap-aware message `chunks.ts` produces — and the
 * advice that refusal ends with works: merged run by run, each run reassembles into the chunk
 * `readWindow` returns for it.
 */

import { describe, expect, it } from 'vitest';
import { mergeChunks } from '../../src/chunks.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfChunk, EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const RECORDS = 12;
const PER_RECORD = 16;

const wave = (record: number, index: number): number =>
  (((record * PER_RECORD + index) * 13) % 257) - 128;

const CONTIGUOUS = buildEdf({
  plus: 'C',
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: PER_RECORD, sample: wave }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const GAPPED = buildEdf({
  plus: 'D',
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (record) => (record < 5 ? record : record + 20),
  signals: [{ label: 'Fp1', samplesPerRecord: PER_RECORD, sample: wave }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const shape = (chunk: EdfChunk): string =>
  JSON.stringify(
    {
      records: chunk.records,
      startTicks: `${chunk.startTicks}n`,
      durationTicks: `${chunk.durationTicks}n`,
      startSeconds: chunk.startSeconds,
      durationSeconds: chunk.durationSeconds,
      byteOffset: chunk.byteOffset,
      byteLength: chunk.byteLength,
      precededByGap: chunk.precededByGap,
      diagnostics: chunk.diagnostics,
      signals: chunk.signals.map((series) => ({
        signalIndex: series.signalIndex,
        sampleCount: series.sampleCount,
        firstSampleIndex: series.firstSampleIndex,
        startTicks: `${series.startTicks}n`,
        outOfDigitalRangeCount: series.outOfDigitalRangeCount,
        digital: [...series.digital.subarray(0, series.sampleCount)],
      })),
    },
    // `precededByGap` carries tick counts of its own.
    (_key, member: unknown) => (typeof member === 'bigint' ? `${member}n` : member),
  );

async function pieces(
  recording: EdfRecording,
  chunkRecords: number,
  durationSeconds: number,
): Promise<readonly EdfChunk[]> {
  const out: EdfChunk[] = [];
  for await (const chunk of streamRecords(recording, {
    startSeconds: 0,
    durationSeconds,
    signalIndices: [0],
    chunkRecords,
  })) {
    out.push(chunk);
  }
  return out;
}

describe('on a contiguous file', () => {
  it.each([1, 2, 5, RECORDS])(
    'streaming in pieces of %d records and merging gives the window',
    async (chunkRecords) => {
      const recording = await openEdf(byteSource(CONTIGUOUS));
      const [whole] = await readWindow(recording, {
        startSeconds: 0,
        durationSeconds: RECORDS,
        signalIndices: [0],
      });
      if (whole === undefined) throw new Error('the window returned nothing');

      const streamed = await pieces(recording, chunkRecords, RECORDS);
      expect(streamed.length).toBe(Math.ceil(RECORDS / chunkRecords));
      expect(shape(mergeChunks(streamed))).toBe(shape(whole));
    },
  );

  it('and the comparison is of a real chunk', async () => {
    const recording = await openEdf(byteSource(CONTIGUOUS));
    const [whole] = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: RECORDS,
      signalIndices: [0],
    });
    expect(whole?.signals[0]?.sampleCount).toBe(RECORDS * PER_RECORD);
    expect(new Set(whole?.signals[0]?.digital ?? []).size).toBeGreaterThan(100);
  });
});

describe('on a file with a gap', () => {
  async function located(): Promise<EdfRecording> {
    const recording = await openEdf(byteSource(GAPPED));
    return { ...recording, index: await buildRecordIndex(recording) };
  }

  it('refuses to merge across it, which is what the pieces are for', async () => {
    const recording = await located();
    const streamed = await pieces(recording, 2, 40);
    expect(streamed.length).toBeGreaterThan(2);

    let message = '';
    try {
      mergeChunks(streamed);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('preceded by a gap of 20 s');
    expect(message).toContain('merge each contiguous run separately');
  });

  it('and merges run by run into the chunks readWindow returns', async () => {
    const recording = await located();
    const runs = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: 40,
      signalIndices: [0],
    });
    expect(runs).toHaveLength(2);

    const streamed = await pieces(recording, 2, 40);
    // Following the advice: group the pieces by the run they belong to.
    const byRun = new Map<number, EdfChunk[]>();
    for (const chunk of streamed) {
      const run = runs.findIndex(
        (candidate) =>
          chunk.records.start >= candidate.records.start &&
          chunk.records.start < candidate.records.start + candidate.records.count,
      );
      byRun.set(run, [...(byRun.get(run) ?? []), chunk]);
    }
    expect(byRun.size).toBe(runs.length);

    for (const [run, group] of byRun) {
      const expected = runs[run];
      if (expected === undefined) throw new Error(`no run ${run}`);
      expect(shape(mergeChunks(group)), `run ${run}`).toBe(shape(expected));
    }
  });
});
