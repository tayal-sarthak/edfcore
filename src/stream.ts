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

import { readRecords, resolveSignals } from './recording.js';
import { assertMonotonicOnsets } from './time/timeline.js';
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

  // Validated BEFORE the window is resolved, for the reason `readWindow` and `readEnvelope` both
  // state: a caller mistake is a caller mistake wherever the window lands. Resolving first meant
  // that a window past the end, one inside an EDF+D gap, or one of zero duration produced no
  // records, so `readRecords` never ran, so a signal index that does not exist — or the
  // annotations channel, the refusal this library exists for — was reported as "no data here".
  // Every other selection error in the package surfaces on the spot; this one waited for data.
  resolveSignals(recording.header, selection.signalIndices);

  const ranges = resolveTimeWindow(
    recording.timeline,
    recording.index,
    selection.startSeconds,
    selection.durationSeconds,
  );

  const recordDurationTicks = recording.header.recordDurationTicks;

  for (const run of ranges) {
    let scanned = 0;
    // The last record of the previous chunk of THIS run. Reset per run, because `readWindow` does
    // not compare across a gap either and a streamed chunk must be the same object it would get.
    let previousRecord: { recordIndex: number; onsetTicks: bigint } | undefined;

    while (scanned < run.count) {
      const records: RecordRange = {
        start: run.start + scanned,
        count: Math.min(chunkRecords, run.count - scanned),
      };
      // readRecords, not a private path: the chunk a consumer gets from streaming and the chunk
      // it gets from reading must be the same object in every respect, including its diagnostics.
      const chunk = await readRecords(
        recording,
        { signalIndices: selection.signalIndices, records },
        options,
      );

      /*
       * The one pair `readRecords` structurally cannot see: the SEAM between two chunks.
       *
       * It runs `assertMonotonicOnsetArray` over the onsets of the chunk it just read, so every
       * adjacent pair inside a chunk is compared and no pair that straddles two is. `readWindow`
       * hands a whole contiguous run to one call and therefore checks all of them; splitting the
       * same run into `chunkRecords`-sized reads checked none of the seams.
       *
       * TIMELINE_NOT_MONOTONIC is ALWAYS fatal — `readWindow` on the identical window throws —
       * and the streaming path returned the data instead, in reverse time order: a consumer that
       * places each chunk at its own `startSeconds`, which is what the docs prescribe, overwrote
       * earlier trace with later samples. Worse, whether it fired at all depended on
       * `chunkRecords`: on one eight-record file it threw at 3 and 5 and stayed silent at 1, 2, 4
       * and 256, and `chunkRecords` is documented as a memory knob. A performance parameter must
       * never decide whether a file is refused (fixed in 0.3.55).
       *
       * No extra read: a chunk's span is `lastOnset + recordDuration - firstOnset`, so its last
       * record's onset is `startTicks + durationTicks - recordDurationTicks`, on the same rebased
       * axis as the next chunk's `startTicks`.
       */
      if (previousRecord !== undefined) {
        assertMonotonicOnsets(previousRecord, {
          recordIndex: records.start,
          onsetTicks: chunk.startTicks,
        });
      }
      previousRecord = {
        recordIndex: records.start + records.count - 1,
        onsetTicks: chunk.startTicks + chunk.durationTicks - recordDurationTicks,
      };

      yield chunk;
      scanned += records.count;
    }
  }
}
