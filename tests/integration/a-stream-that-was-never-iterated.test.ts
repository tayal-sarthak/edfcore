/**
 * `streamRecords` refusing a bad call before anything iterates it.
 *
 * `async function*` does not run its body until the first `next()`, so every check the function
 * makes was deferred to the first `for await` — and `streamRecords(recording)`, with no selection at
 * all, returned an object successfully. The function's own comment makes this argument one level
 * down, about `resolveSignals`: "Every other selection error in the package surfaces on the spot;
 * this one waited for data."
 *
 * Waiting for iteration is worse than waiting for data, because the two happen in different places.
 * A pipeline that builds the stream in one function and consumes it in another gets the refusal in
 * the second, with the arguments it names nowhere in sight; a stream that is built and then dropped
 * — an aborted view, an early `return` — never reports the mistake at all.
 *
 * It is a plain function that validates and returns a generator now (fixed in 0.6.118).
 */

import { describe, expect, it } from 'vitest';
import { buildRecordIndex, openEdf } from '../../src/index.js';
import { byteSource } from '../../src/io/bytes.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfChunk, EdfRecording, StreamSelection } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const CONTINUOUS = buildEdf({
  plus: 'C',
  recordCount: 8,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

/** A real EDF+D file with a five-second hole, which a probed index cannot map a window onto. */
const DISCONTINUOUS = buildEdf({
  plus: 'D',
  recordCount: 4,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (record) => (record < 2 ? record : record + 5),
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = (bytes: Uint8Array) => openEdf(byteSource(bytes));

/** The cast a JavaScript caller does not need to write. */
const loosely = <T>(value: unknown) => value as T;

const WINDOW: StreamSelection = { signalIndices: [0], startSeconds: 0, durationSeconds: 4 };

/** Builds the stream and throws it away, which is what a deferred check never sees. */
function built(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the call was accepted and returned a generator');
}

describe('the call itself', () => {
  it('refuses a missing selection without being iterated', async () => {
    const recording = await opened(CONTINUOUS);
    const message = built(() =>
      (streamRecords as unknown as (r: EdfRecording) => unknown)(recording),
    );
    expect(message).toContain('streamRecords(): the selection is missing, not an object');
  });

  it.each([
    [
      'a signal index the file does not have',
      { ...WINDOW, signalIndices: [9] },
      /outside the 2 signals|not one of/,
    ],
    ['a chunkRecords of zero', { ...WINDOW, chunkRecords: 0 }, /chunkRecords must be a positive/],
    ['a NaN window bound', { ...WINDOW, startSeconds: Number.NaN }, /finite number of seconds/],
  ])('refuses %s without being iterated', async (_described, selection, pattern) => {
    const recording = await opened(CONTINUOUS);
    expect(built(() => streamRecords(recording, loosely<StreamSelection>(selection)))).toMatch(
      pattern,
    );
  });

  it('refuses a window a probed index cannot map, which is about the call too', async () => {
    const recording = await opened(DISCONTINUOUS);
    expect(built(() => streamRecords(recording, WINDOW))).toContain(
      'cannot be mapped from seconds to records',
    );
  });

  it('refuses the recording itself', async () => {
    const recording = await opened(CONTINUOUS);
    expect(built(() => streamRecords(loosely<EdfRecording>(recording.header), WINDOW))).toContain(
      'that is a header, not a recording',
    );
  });
});

describe('a stream that is built and dropped', () => {
  it('reported nothing at all before, which is what made the deferral cost something', async () => {
    const recording = await opened(CONTINUOUS);
    // The shape a viewer writes: build the stream, decide not to consume it. Nothing iterates, so a
    // deferred check never runs — and the mistake is in the arguments, which are right here.
    let caught: string | undefined;
    try {
      const stream = streamRecords(
        recording,
        loosely<StreamSelection>({ ...WINDOW, chunkRecords: -1 }),
      );
      void stream;
    } catch (error) {
      caught = (error as Error).message;
    }
    expect(caught).toContain('chunkRecords must be a positive whole number');
  });
});

describe('a call that is right', () => {
  it('still streams, in chunks of the size asked for', async () => {
    const recording = await opened(CONTINUOUS);
    const chunks: EdfChunk[] = [];
    for await (const chunk of streamRecords(recording, { ...WINDOW, chunkRecords: 2 })) {
      chunks.push(chunk);
    }
    expect(chunks.map((chunk) => chunk.records.count)).toEqual([2, 2]);
  });

  it('still streams a discontinuous file once the index is complete', async () => {
    const recording = await opened(DISCONTINUOUS);
    const index = await buildRecordIndex(recording);
    const chunks: EdfChunk[] = [];
    for await (const chunk of streamRecords(
      { ...recording, index },
      { signalIndices: [0], startSeconds: 0, durationSeconds: 20 },
    )) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.precededByGap?.durationSeconds).toBe(5);
  });
});
