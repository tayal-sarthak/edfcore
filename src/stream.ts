/**
 * Streaming iteration over a window.
 *
 * Layer 7. `readWindow` returns every chunk at once, which is right for a window you are about to
 * draw and wrong for a whole recording: the array holds every sample the window covers, so a
 * twelve-hour pass costs twelve hours of memory.
 *
 * A pipeline wants the opposite — one bounded piece at a time, with the previous one collectable.
 * That is spelled `for await`, and doing it by hand means reimplementing the record arithmetic and
 * the gap handling that `readWindow` already owns.
 *
 * Chunks arrive in time order, never span a gap, and carry the same `precededByGap` a
 * `readWindow` chunk would, so a consumer sees the discontinuities rather than a smooth lie.
 */

import { readRecords } from './recording.js';
import { resolveTimeWindow } from './time/window.js';
import type { EdfChunk, EdfRecording, ReadOptions, RecordRange, StreamSelection } from './types.js';

/** How many records to read at a time when the caller does not say. */
const DEFAULT_STREAM_RECORDS = 256;

/**
 * Yields a window one bounded chunk at a time.
 *
 * `chunkRecords` is the unit of I/O and of memory: each yielded chunk holds that many records of
 * the requested signals and no more. It is a count of records rather than of bytes or seconds
 * because the record is the only unit every signal in an EDF file shares — signals may sample at
 * different rates, so "a second of data" is a different number of samples per channel.
 */
export async function* streamRecords(
  recording: EdfRecording,
  selection: StreamSelection,
  options?: ReadOptions,
): AsyncGenerator<EdfChunk, void, undefined> {
  const chunkRecords = selection.chunkRecords ?? DEFAULT_STREAM_RECORDS;
  if (!Number.isSafeInteger(chunkRecords) || chunkRecords < 1) {
    throw new RangeError(
      `streamRecords(): chunkRecords must be a positive whole number, received ${chunkRecords}. ` +
        'Next: omit it for the default, or pass how many records you want to hold at once.',
    );
  }

  const ranges = resolveTimeWindow(
    recording.timeline,
    recording.index,
    selection.startSeconds,
    selection.durationSeconds,
  );

  for (const run of ranges) {
    let scanned = 0;
    while (scanned < run.count) {
      const records: RecordRange = {
        start: run.start + scanned,
        count: Math.min(chunkRecords, run.count - scanned),
      };
      // readRecords, not a private path: the chunk a consumer gets from streaming and the chunk
      // it gets from reading must be the same object in every respect, including its diagnostics.
      yield await readRecords(
        recording,
        { signalIndices: selection.signalIndices, records },
        options,
      );
      scanned += records.count;
    }
  }
}
