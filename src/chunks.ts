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
import { ticksToSeconds } from './tal/ticks.js';
import type { EdfChunk, EdfChunkSignal, EdfDiagnostic } from './types.js';

/** Reads as one line at the call site, and keeps the `chunks[i]` non-null assertions out of it. */
function at(chunks: readonly EdfChunk[], index: number): EdfChunk {
  const chunk = chunks[index];
  if (chunk === undefined) {
    throw new RangeError(
      `mergeChunks: no chunk at ${index}. Next: pass the array readWindow() returned, with no ` +
        'holes and nothing spliced out of it.',
    );
  }
  return chunk;
}

/**
 * Everything that makes two chunks joinable, checked before a byte is allocated.
 *
 * Three tests, and the second and third are the ones that earn their place.
 *
 * `precededByGap` alone is not enough, because it is `undefined` in two different situations: no
 * gap, and nobody looked. `openEdf` returns a probed index, `gapBefore` has nothing to report from
 * one, and `readRecords` reads by record number without ever consulting the timeline — so two
 * chunks a minute apart on an EDF+D file arrive record-adjacent with `precededByGap: undefined` on
 * both, and the field the refusal was keyed on says nothing at all. Every chunk carries its own
 * `startSeconds`, decoded from the annotation regions in its own bytes, so the evidence was in hand
 * the whole time: the second test compares the clock instead of asking the index.
 *
 * The per-signal sample-index test is the third: `trimToWindow` narrows a chunk on each signal's
 * own grid without changing the chunk's `durationSeconds`, so a trimmed chunk passes both the
 * record and the clock test while the samples between the two are gone. Comparing
 * `firstSampleIndex` against the previous chunk's end catches exactly that, per signal, which is
 * the granularity at which it actually happens.
 */
function assertJoinable(previous: EdfChunk, next: EdfChunk, index: number): void {
  if (next.precededByGap !== undefined) {
    // Branch on the sign. An overlap travels in `index.gaps` with a NEGATIVE duration (0.2.69), so
    // `chunk.precededByGap` carries it too, and a hardcoded gap reading produced "preceded by a
    // gap of -0.2 s" — a gap of negative duration — with an explanation that inverts what an
    // overlap does: across a gap two samples are seconds APART, across an overlap they cover the
    // SAME time, so concatenating duplicates it rather than skipping it.
    //
    // 0.3.3 stated the partition and 0.3.33 applied it to "the two places that still said it was".
    // This is the third; `src/chunks.ts` contained no mention of an overlap at all (fixed in
    // 0.3.41). The refusal itself is unchanged and right either way.
    const gap = next.precededByGap;
    const overlapping = gap.durationTicks < 0n;
    throw new RangeError(
      overlapping
        ? `mergeChunks: chunk ${index} is preceded by an overlap of ${-gap.durationSeconds} s — ` +
            'the records on either side of the join both claim that time. Concatenating them would ' +
            'store it twice and date every sample after the join late by it. Next: merge each ' +
            'contiguous run separately.'
        : `mergeChunks: chunk ${index} is preceded by a gap of ${gap.durationSeconds} s. ` +
            'Concatenating across it would put two samples that are seconds apart next to each ' +
            'other in one array, and every time computed from an index after the join would be ' +
            'wrong by the gap. Next: merge each contiguous run separately.',
    );
  }

  const expectedStart = previous.records.start + previous.records.count;
  if (next.records.start !== expectedStart) {
    throw new RangeError(
      `mergeChunks: chunk ${index} starts at record ${next.records.start}, but the chunk before ` +
        `it ends at ${expectedStart}. Chunks must be adjacent and in order. Next: pass them in ` +
        'the order readWindow() returned them, with none dropped.',
    );
  }

  // In exact ticks, never in float seconds: a float comparison here would let a sub-tick
  // discrepancy through, and an epsilon would let a real one through.
  //
  // The ticks are read off the chunks. Until 0.3.7 they were rounded BACK out of the seconds,
  // which recovered them only "for any recording shorter than ~28.5 years" — and rounded two
  // values independently before adding them, so a single lost tick in either produced a refusal
  // naming a discontinuity of 1e-7 s on chunks that are genuinely adjacent.
  const previousEndTicks = previous.startTicks + previous.durationTicks;
  const nextStartTicks = next.startTicks;
  if (previousEndTicks !== nextStartTicks) {
    // Branched on the SIGN, like the `precededByGap` path above. A negative difference is an
    // overlap, not a gap, and this path is the one that actually fires for an overlap after
    // `openEdf`: a probed index reports no gaps at all, so `precededByGap` is `undefined` and the
    // branch that was taught the distinction in 0.3.41 never runs. It printed "a discontinuity of
    // -0.2 s ... this is a gap in TIME", which names the wrong thing twice — a fourth site of the
    // defect 0.3.33 and 0.3.41 swept, forty lines below the third (fixed in 0.3.59).
    const deltaTicks = nextStartTicks - previousEndTicks;
    const overlapping = deltaTicks < 0n;
    const magnitude = ticksToSeconds(overlapping ? -deltaTicks : deltaTicks);
    throw new RangeError(
      `mergeChunks: chunk ${index} starts at ${next.startSeconds} s, but the chunk before it ends ` +
        `at ${ticksToSeconds(previousEndTicks)} s — ` +
        (overlapping
          ? `an overlap of ${magnitude} s. The two are record-adjacent, so the records on either ` +
            'side of the join both claim that time and the record numbers cannot show it. ' +
            'Concatenating them would store it twice and date every sample after the join late ' +
            'by it.'
          : `a discontinuity of ${magnitude} s. The two are record-adjacent, so this is a gap in ` +
            'TIME that the record numbers cannot show. Concatenating them would date every ' +
            'sample after the join wrong by that much.') +
        ' Either the index was never scanned, or these chunks came from separate reads. Next: ' +
        'await buildRecordIndex(recording) and merge each contiguous run separately.',
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
      startTicks: firstSignal.startTicks,
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
    startTicks: first.startTicks,
    // Measured against the ENDS, not summed over N durations: the run is contiguous, so the ends
    // are the truth. In ticks the distinction is about which value is right rather than about
    // accumulated rounding, and the seconds are then one conversion of that one exact number
    // instead of three float operations on three converted ones.
    durationTicks: last.startTicks + last.durationTicks - first.startTicks,
    durationSeconds: ticksToSeconds(last.startTicks + last.durationTicks - first.startTicks),
    byteOffset: first.byteOffset,
    byteLength,
    signals: Object.freeze(signals),
    // The gap BEFORE the whole run survives the merge. It describes what precedes the first
    // chunk, which is still what precedes the merged one.
    precededByGap: first.precededByGap,
    diagnostics: Object.freeze(diagnostics),
  };
}
