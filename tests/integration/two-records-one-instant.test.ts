/**
 * The seventeenth shape: records that overlap in time, and the four claims it corrected.
 *
 * An overlap is a file where a record starts before the one before it ended, so two records claim
 * the same instant. edfcore has always known about them — the gap list carries one with a NEGATIVE
 * duration (0.2.69), `mergeChunks` refuses to join across one, `edfcore gaps` prints it in its own
 * column, and the probe raises `RECORD_ONSET_SPACING_VIOLATION`, which is a warning rather than an
 * error because "an overlapping file is still readable".
 *
 * The matrix had never held one, and four sweeps turned out to be asserting things that are true
 * only of files whose records do not overlap:
 *
 * - `header-helpers-agree` said the sum of the record durations never exceeds the span. It exceeds
 *   it by exactly the overlap, because an overlap counts an instant twice.
 * - `timeline-helpers-agree` said an instant inside a segment is answered with THAT segment, and
 *   that the midpoint of a gap is in no segment. Two segments contain an overlapped instant, and
 *   an overlap's interval runs backwards so its midpoint is inside a segment rather than in a hole.
 * - `reading-helpers-agree` said a window at a sample's start begins at that sample's record, and
 *   that a window's chunks join. Neither holds here, and the second was the half of its own comment
 *   the code had never run: "either join or are refused with a reason" had only ever seen joining.
 *
 * None of the four was a defect in `src/`. All four were claims the matrix had no counterexample
 * for, which is what a matrix is for. Each now states the weaker thing that is true of every file
 * and the stronger thing that is true of this one.
 *
 * None of them was a defect in `src/` — the library refuses the unindexed read with a message in
 * the file's own numbers, returns both covering records in separate chunks when it has an index,
 * and refuses to join them. This file pins those answers, which is what the four sweeps were
 * asserting past rather than about.
 */

import { describe, expect, it } from 'vitest';
import { mergeChunks } from '../../src/chunks.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex, gapAt, segmentAt } from '../../src/record-index.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { AWKWARD } from '../support/awkward-files.js';

const SHAPE = AWKWARD.find((file) => file.name === 'records that overlap in time');

async function shape() {
  if (SHAPE === undefined) throw new Error('the matrix lost the overlapping shape');
  return openEdf(byteSource(SHAPE.bytes));
}

describe('the shape', () => {
  it('is in the matrix, which is seventeen shapes', () => {
    expect(SHAPE).toBeDefined();
    expect(AWKWARD).toHaveLength(17);
  });

  it('is the only one the probe reports a spacing violation for', async () => {
    const offenders: string[] = [];
    for (const file of AWKWARD) {
      const recording = await openEdf(byteSource(file.bytes));
      if (
        recording.timeline.diagnostics.some((one) => one.code === 'RECORD_ONSET_SPACING_VIOLATION')
      ) {
        offenders.push(file.name);
      }
    }
    expect(offenders).toEqual(['records that overlap in time']);
  });

  it('covers more time than it spans, which is the arithmetic of counting twice', async () => {
    const { header, timeline } = await shape();
    expect(header.recordCount * header.recordDurationSeconds).toBe(6);
    expect(timeline.spanSeconds).toBe(3.5);
    expect(timeline.coveredSeconds).toBeGreaterThan(timeline.spanSeconds);
  });

  it('is read rather than refused, because the code is a warning', async () => {
    // The considered half: `mergeChunks` refuses the join, not the reader the file.
    await expect(shape()).resolves.toBeDefined();
  });
});

describe('what the index says about it', () => {
  it('carries the overlap in the gap list, with a negative duration', async () => {
    const index = await buildRecordIndex(await shape());
    const overlaps = (index.gaps ?? []).filter((gap) => gap.durationSeconds < 0);
    expect(overlaps.length).toBeGreaterThan(0);
    expect(overlaps[0]?.durationSeconds).toBe(-0.5);
  });

  it('answers an overlapped instant with a segment, not with a hole', async () => {
    const index = await buildRecordIndex(await shape());
    const overlap = (index.gaps ?? []).find((gap) => gap.durationSeconds < 0);
    if (overlap === undefined) throw new Error('no overlap in the index');
    const inside = overlap.startSeconds + overlap.durationSeconds / 2;
    expect(gapAt(index, inside)).toBeUndefined();
    expect(segmentAt(index, inside)).toBeDefined();
  });
});

describe('what a read of it does', () => {
  it('is refused outright without an index, and the message names the overlap', async () => {
    // Before any of the below: the two probes cannot map seconds to records on this file, and say
    // so in the file's own numbers rather than generically.
    const recording = await shape();
    await expect(
      readWindow(recording, { startSeconds: 0, durationSeconds: 1, signalIndices: [0] }),
    ).rejects.toThrow(/at least one record starts before the previous one ends/);
    await expect(
      readWindow(recording, { startSeconds: 0, durationSeconds: 1, signalIndices: [0] }),
    ).rejects.toThrow(/Next: await buildRecordIndex/);
  });
});

describe('what a read of it does, once it has an index', () => {
  it('returns both records that cover the window, in separate chunks', async () => {
    /*
     * The answer, and it is the right one. A window is mapped per contiguous run, and where two
     * records claim the same instant the run ends between them — so both come back, in two chunks,
     * rather than in one concatenation that would store that time twice.
     *
     * This is what the sweep in `reading-helpers-agree.test.ts` was asserting past: it took
     * `chunks[0].records.start` and expected the record it asked about, which is chunk ONE's
     * business on a file like this. The library was right and the claim was too narrow.
     */
    const recording = await shape();
    const index = await buildRecordIndex(recording);
    const chunks = await readWindow(
      { ...recording, index },
      { startSeconds: 2.5, durationSeconds: 1, signalIndices: [0] },
    );

    const covered = chunks.flatMap((chunk) => {
      const range = chunk.records;
      return Array.from({ length: range.count }, (_, at) => range.start + at);
    });
    // Records 4 and 5 both cover [2.5, 3.5), and both are returned.
    expect(covered).toContain(4);
    expect(covered).toContain(5);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('refuses to join what it does return, with a reason', async () => {
    const recording = await shape();
    const index = await buildRecordIndex(recording);
    const chunks = await readWindow(
      { ...recording, index },
      { startSeconds: 0, durationSeconds: 4, signalIndices: [0] },
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(() => mergeChunks(chunks)).toThrow(/overlap of/);
    expect(() => mergeChunks(chunks)).toThrow(/Next: /);
  });
});
