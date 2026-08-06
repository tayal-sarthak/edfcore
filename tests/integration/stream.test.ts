/**
 * Streaming iteration.
 *
 * The claim is that streaming a window yields exactly the samples reading it does, in the same
 * order, while never holding more than one chunk. The first half is checked by concatenating the
 * stream and comparing it to `readWindow`; the second by counting what a chunk actually contains.
 */

import { describe, expect, it } from 'vitest';
import { EdfChannelNotFoundError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfChunk, EdfRecording, StreamSelection } from '../../src/types.js';
import { minimalEdfPlus } from '../support/writer.js';

const RECORDS = 50;
const SAMPLES_PER_RECORD = 8;

async function recording(): Promise<EdfRecording> {
  return openEdf(
    byteSource(
      minimalEdfPlus({
        recordCount: RECORDS,
        recordDurationSeconds: 1,
        signals: [
          {
            label: 'EEG Fpz-Cz',
            samplesPerRecord: SAMPLES_PER_RECORD,
            sample: (record: number, sample: number) => record * SAMPLES_PER_RECORD + sample,
          },
        ],
      }),
    ),
  );
}

describe('streamRecords', () => {
  it('yields exactly what readWindow returns, in order', async () => {
    const edf = await recording();
    const selection = { signalIndices: [0], startSeconds: 0, durationSeconds: RECORDS };

    const [whole] = await readWindow(edf, selection);
    const expected = [...(whole?.signals[0]?.digital ?? [])];

    const streamed: number[] = [];
    for await (const chunk of streamRecords(edf, { ...selection, chunkRecords: 7 })) {
      streamed.push(...(chunk.signals[0]?.digital ?? []));
    }

    expect(streamed).toEqual(expected);
    expect(streamed).toHaveLength(RECORDS * SAMPLES_PER_RECORD);
  });

  it('never holds more than chunkRecords records at once', async () => {
    // The whole point: a twelve-hour pass must not cost twelve hours of memory.
    const edf = await recording();
    const chunkRecords = 4;
    let largest = 0;
    let chunks = 0;

    for await (const chunk of streamRecords(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: RECORDS,
      chunkRecords,
    })) {
      largest = Math.max(largest, chunk.records.count);
      chunks += 1;
    }

    expect(largest).toBe(chunkRecords);
    expect(chunks).toBe(Math.ceil(RECORDS / chunkRecords));
  });

  it('gives the same samples whatever the chunk size', async () => {
    const edf = await recording();
    const selection = { signalIndices: [0], startSeconds: 0, durationSeconds: RECORDS };

    const collect = async (chunkRecords: number): Promise<number[]> => {
      const out: number[] = [];
      for await (const chunk of streamRecords(edf, { ...selection, chunkRecords })) {
        out.push(...(chunk.signals[0]?.digital ?? []));
      }
      return out;
    };

    expect(await collect(1)).toEqual(await collect(RECORDS));
    expect(await collect(3)).toEqual(await collect(11));
  });

  it('yields nothing for a window that selects nothing', async () => {
    const edf = await recording();
    const seen: unknown[] = [];
    for await (const chunk of streamRecords(edf, {
      signalIndices: [0],
      startSeconds: 9999,
      durationSeconds: 1,
    })) {
      seen.push(chunk);
    }
    expect(seen).toEqual([]);
  });

  it('rejects a bad chunkRecords and a bad selection', async () => {
    const edf = await recording();
    const base = { signalIndices: [0], startSeconds: 0, durationSeconds: RECORDS };

    const drain = async (selection: Parameters<typeof streamRecords>[1]): Promise<void> => {
      for await (const _ of streamRecords(edf, selection)) {
        // The first `next()` is what performs the work, so draining is what surfaces the throw.
      }
    };

    await expect(drain({ ...base, chunkRecords: 0 })).rejects.toThrow(RangeError);
    await expect(drain({ ...base, signalIndices: [99] })).rejects.toThrow();
  });

  it('stops reading when the consumer breaks out early', async () => {
    // A generator abandoned mid-loop must not keep pulling records.
    const edf = await recording();
    let pulled = 0;
    for await (const chunk of streamRecords(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: RECORDS,
      chunkRecords: 2,
    })) {
      pulled += chunk.records.count;
      if (pulled >= 4) break;
    }
    expect(pulled).toBe(4);
  });
});

describe('streamRecords validates its selection wherever the window lands', () => {
  // An async generator does not run its body until the first `next()`, so the refusal surfaces on
  // the first pull rather than at the call — which is what `for await` does anyway.
  async function drain(recording: EdfRecording, selection: StreamSelection): Promise<EdfChunk[]> {
    const chunks: EdfChunk[] = [];
    for await (const chunk of streamRecords(recording, selection)) chunks.push(chunk);
    return chunks;
  }

  it('refuses a signal index that does not exist, even over an empty window', async () => {
    // Before 0.2.22 the window resolved to zero records, `readRecords` never ran, and the bad
    // index was reported as "no data for this epoch" — the wrong diagnosis entirely.
    const recording = await openEdf(byteSource(minimalEdfPlus({ recordCount: 4 })));

    await expect(
      drain(recording, { signalIndices: [99], startSeconds: 1000, durationSeconds: 10 }),
    ).rejects.toThrow(EdfChannelNotFoundError);

    // And it is the same refusal readWindow gives for the identical selection.
    await expect(
      readWindow(recording, { signalIndices: [99], startSeconds: 1000, durationSeconds: 10 }),
    ).rejects.toThrow(EdfChannelNotFoundError);
  });

  it('refuses the annotations channel over an empty window too', async () => {
    // The refusal this library exists for: TAL bytes decoded as samples produce numbers that look
    // like a signal. It must not be skippable by asking for a stretch with no records in it.
    const recording = await openEdf(byteSource(minimalEdfPlus({ recordCount: 4 })));
    const annotationsIndex = recording.header.annotationSignalIndices[0] as number;

    await expect(
      drain(recording, {
        signalIndices: [annotationsIndex],
        startSeconds: 0,
        durationSeconds: 0,
      }),
    ).rejects.toThrow(/annotations channel/);
  });

  it('still yields nothing, silently, for a valid selection over an empty window', async () => {
    // The fix must not turn "no data here" into an error. An empty stretch is an ordinary answer.
    const recording = await openEdf(byteSource(minimalEdfPlus({ recordCount: 4 })));
    expect(
      await drain(recording, { signalIndices: [0], startSeconds: 1000, durationSeconds: 10 }),
    ).toEqual([]);
  });
});
