/**
 * Joining chunks that a read returned as several.
 *
 * Layer 7, and pure: nothing here reads. `readWindow` splits at every discontinuity, so a window
 * over an EDF+D file comes back as one chunk per contiguous run. Code that then wants ONE array —
 * a filter, an FFT, a CSV writer — has to join them, and joining is where the gap gets lost.
 *
 * Concatenating two runs separated by five minutes produces an array in which sample `i` and
 * sample `i + 1` are five minutes apart. Every time derived from an index past that point is
 * wrong by five minutes, and nothing in the result says so. `mergeChunks` refuses instead. A
 * caller who genuinely wants the samples end to end can concatenate them in three lines and own
 * the consequence; what they should not get is a helper that hides it.
 *
 * The refusals are caller mistakes, not file defects, so they are plain `RangeError`s — the same
 * convention every option check in the package follows.
 */

import { appendDiagnostics } from './diagnostics/collector.js';
import type { EdfChunk, EdfChunkSignal, EdfDiagnostic } from './types.js';

/** Reads as one line at the call site, and keeps the `chunks[i]` non-null assertions out of it. */
function at(chunks: readonly EdfChunk[], index: number): EdfChunk {
  const chunk = chunks[index];
  if (chunk === undefined) throw new RangeError(`mergeChunks: no chunk at ${index}.`);
  return chunk;
}

/**
 * Everything that makes two chunks joinable, checked before a byte is allocated.
 *
 * The record-adjacency test is the obvious one. The per-signal sample-index test is the one that
 * earns its place: `trimToWindow` narrows a chunk on each signal's own grid, so two chunks can
 * still be record-adjacent after a trim has removed the samples between them. Comparing
 * `firstSampleIndex` against the previous chunk's end catches exactly that, per signal, which is
 * the granularity at which it actually happens.
 */
function assertJoinable(previous: EdfChunk, next: EdfChunk, index: number): void {
  if (next.precededByGap !== undefined) {
    throw new RangeError(
      `mergeChunks: chunk ${index} is preceded by a gap of ${next.precededByGap.durationSeconds} s. ` +
        'Concatenating across it would put two samples that are seconds apart next to each other ' +
        'in one array, and every time computed from an index after the join would be wrong by the ' +
        'gap. Merge each contiguous run separately.',
    );
  }

  const expectedStart = previous.records.start + previous.records.count;
  if (next.records.start !== expectedStart) {
    throw new RangeError(
      `mergeChunks: chunk ${index} starts at record ${next.records.start}, but the chunk before ` +
        `it ends at ${expectedStart}. Chunks must be adjacent and in order.`,
    );
  }

  if (next.signals.length !== previous.signals.length) {
    throw new RangeError(
      `mergeChunks: chunk ${index} carries ${next.signals.length} signal(s), the chunk before it ` +
        `${previous.signals.length}. Every chunk must have been read with the same signal selection.`,
    );
  }

  for (let i = 0; i < next.signals.length; i += 1) {
    const before = previous.signals[i] as EdfChunkSignal;
    const after = next.signals[i] as EdfChunkSignal;
    if (after.signalIndex !== before.signalIndex) {
      throw new RangeError(
        `mergeChunks: chunk ${index} has signal ${after.signalIndex} in position ${i}, the chunk ` +
          `before it signal ${before.signalIndex}. The selection must be in the same order too.`,
      );
    }
    const expectedSample = before.firstSampleIndex + before.sampleCount;
    if (after.firstSampleIndex !== expectedSample) {
      throw new RangeError(
        `mergeChunks: signal ${after.signalIndex} of chunk ${index} starts at sample ` +
          `${after.firstSampleIndex}, but the chunk before it ends at ${expectedSample}. ` +
          'A trimmed chunk cannot be merged with the one after it — trim after merging, not before.',
      );
    }
  }
}

/**
 * One chunk covering every input chunk, or a `RangeError` explaining why they do not join.
 *
 * Accepts only chunks that are adjacent, in order, gapless, and read with the same signals in the
 * same order. A single chunk is returned as-is, so the common continuous-file case costs nothing.
 *
 * The samples are copied, so the result holds a second copy of the data the inputs already hold.
 * That is unavoidable — `Int32Array`s are not splices of one buffer — and it is why this is a
 * separate call rather than something `readWindow` does on the way out.
 */
export function mergeChunks(chunks: readonly EdfChunk[]): EdfChunk {
  if (chunks.length === 0) {
    throw new RangeError(
      'mergeChunks: nothing to merge. `readWindow` returns [] for a window that lands past the ' +
        'end of the recording, so check the length before merging.',
    );
  }

  const first = at(chunks, 0);
  if (chunks.length === 1) return first;

  for (let i = 1; i < chunks.length; i += 1) {
    assertJoinable(at(chunks, i - 1), at(chunks, i), i);
  }

  const last = at(chunks, chunks.length - 1);

  const signals = first.signals.map((firstSignal, position) => {
    let total = 0;
    let outOfRange = 0;
    for (const chunk of chunks) {
      const signal = chunk.signals[position] as EdfChunkSignal;
      total += signal.sampleCount;
      outOfRange += signal.outOfDigitalRangeCount;
    }

    const digital = new Int32Array(total);
    let written = 0;
    for (const chunk of chunks) {
      const signal = chunk.signals[position] as EdfChunkSignal;
      // `digital` may be longer than `sampleCount` — the decoder is allowed to hand back a buffer
      // it sized for whole records. `sampleCount` is the truth, so the subarray is taken from it.
      digital.set(signal.digital.subarray(0, signal.sampleCount), written);
      written += signal.sampleCount;
    }

    return {
      signalIndex: firstSignal.signalIndex,
      sampleCount: total,
      digital,
      firstSampleIndex: firstSignal.firstSampleIndex,
      startSeconds: firstSignal.startSeconds,
      outOfDigitalRangeCount: outOfRange,
    } satisfies EdfChunkSignal;
  });

  let byteLength = 0;
  const diagnostics: EdfDiagnostic[] = [];
  for (const chunk of chunks) {
    byteLength += chunk.byteLength;
    // Not `push(...chunk.diagnostics)`: a scan over a damaged annotation section reports one
    // diagnostic per record, and the spread blows the call stack past ~125,000 of them (0.1.6).
    appendDiagnostics(diagnostics, chunk.diagnostics);
  }

  return {
    records: {
      start: first.records.start,
      count: last.records.start + last.records.count - first.records.start,
    },
    startSeconds: first.startSeconds,
    // Two float operations against the ends, not a sum of N durations: adding the durations up
    // accumulates rounding once per chunk, and the run is contiguous so the ends are the truth.
    durationSeconds: last.startSeconds + last.durationSeconds - first.startSeconds,
    byteOffset: first.byteOffset,
    byteLength,
    signals: Object.freeze(signals),
    // The gap BEFORE the whole run survives the merge. It describes what precedes the first
    // chunk, which is still what precedes the merged one.
    precededByGap: first.precededByGap,
    diagnostics: Object.freeze(diagnostics),
  };
}
