/**
 * The timeline helpers agree with the scanned index, on every awkward shape — without the corpus.
 *
 * The companion to `header-helpers-agree.test.ts`, for the second group in
 * `tests/corpus/whole-api.test.ts`, which skips without `npm run corpus:fetch`. `contiguityOf`,
 * `segmentAt` and `gapAt` each answer a question the index already answers, and the way they fail
 * is by disagreeing with it rather than by being wrong on their own: a time reported as inside a
 * segment AND inside a gap, a gap count that does not match the segments it separates, segments
 * that skip a record or claim one twice.
 *
 * The zero-record-duration file is the one that makes this group worth running on built fixtures
 * as well as real ones. Records then occupy no time, so every segment's half-open interval
 * `[start, start)` is empty and `segmentAt` returns `undefined` for every instant — which is the
 * same answer the sample functions give, for the same reason, and looks exactly like a bug until
 * you notice there is no time axis to be on. It is a real shape: the sleep-edfx hypnogram is one,
 * and a fresh clone had no file of that shape reaching these helpers at all.
 *
 * What this does NOT check: that the segmentation itself is right — `time/segments.test.ts` owns
 * that — only that everything downstream reports the same segmentation.
 */

import { describe, expect, it } from 'vitest';
import {
  buildRecordIndex,
  byteSource,
  contiguityOf,
  gapAt,
  openEdf,
  segmentAt,
} from '../../src/index.js';
import type { EdfRecordIndex } from '../../src/types.js';
import { AWKWARD } from '../support/awkward-files.js';

async function scannedIndex(bytes: Uint8Array): Promise<EdfRecordIndex> {
  const recording = await openEdf(byteSource(bytes));
  return buildRecordIndex(recording);
}

describe.each(AWKWARD)('$name', ({ awkward, bytes }) => {
  it(`has segments and gaps that agree, where ${awkward}`, async () => {
    const recording = await openEdf(byteSource(bytes));
    const index = await buildRecordIndex(recording);

    // A scanned index has looked at every record, so it never answers "unknown".
    expect(contiguityOf(index)).not.toBe('unknown');
    expect(index.coverage).toBe('complete');

    const segments = index.segments ?? [];
    const gaps = index.gaps ?? [];
    // One gap per adjacent pair of segments — never a gap that no pair brackets.
    expect(gaps.length).toBe(Math.max(0, segments.length - 1));
    expect(contiguityOf(index)).toBe(gaps.length === 0 ? 'contiguous' : 'discontinuous');

    // The segments cover every record exactly once, in order and with no hole between them.
    let expectedNext = 0;
    let covered = 0;
    for (const segment of segments) {
      expect(segment.records.start, `segment ${segment.index} does not follow the last`).toBe(
        expectedNext,
      );
      expect(segment.index).toBe(segments.indexOf(segment));
      expectedNext = segment.records.start + segment.records.count;
      covered += segment.records.count;
    }
    expect(covered).toBe(recording.header.recordCount);

    // A gap names the two segments it lies between, and starts where the earlier one ends.
    for (const [position, gap] of gaps.entries()) {
      expect(gap.beforeSegmentIndex).toBe(position);
      expect(gap.afterSegmentIndex).toBe(position + 1);
      expect(gap.startTicks).toBe(segments[position]?.endTicks);
      expect(gap.endTicks).toBe(segments[position + 1]?.startTicks);
    }
  });

  it(`answers segmentAt and gapAt without contradicting itself, where ${awkward}`, async () => {
    const index = await scannedIndex(bytes);
    for (const segment of index.segments ?? []) {
      if (segment.durationSeconds === 0) {
        // No instant is inside a zero-width half-open interval. The sample helpers say the same.
        expect(segmentAt(index, segment.startSeconds), 'zero-width segment').toBeUndefined();
        continue;
      }
      const inside = segment.startSeconds + Math.min(0.5, segment.durationSeconds / 2);
      expect(segmentAt(index, inside)?.index, `inside segment ${segment.index}`).toBe(
        segment.index,
      );
      expect(gapAt(index, inside), `inside segment ${segment.index}`).toBeUndefined();
    }
    for (const gap of index.gaps ?? []) {
      const inside = gap.startSeconds + gap.durationSeconds / 2;
      expect(gapAt(index, inside)?.beforeSegmentIndex).toBe(gap.beforeSegmentIndex);
      expect(segmentAt(index, inside)).toBeUndefined();
    }
  });
});

describe('the shapes reach both answers', () => {
  it('include a discontinuous file and a zero-width one, or the two branches never ran', async () => {
    const indices = await Promise.all(AWKWARD.map((file) => scannedIndex(file.bytes)));
    expect(indices.some((index) => (index.gaps ?? []).length > 0)).toBe(true);
    expect(indices.some((index) => contiguityOf(index) === 'contiguous')).toBe(true);
    expect(
      indices.some((index) =>
        (index.segments ?? []).some((segment) => segment.durationSeconds === 0),
      ),
    ).toBe(true);
  });
});

describe('the matrix this file sweeps', () => {
  it('is the thirteen shapes it was written against', () => {
    // `awkward-files.ts` asks every consumer for this: without it, a shape removed from the matrix
    // quietly removes cases from here instead of failing anything.
    expect(AWKWARD).toHaveLength(13);
  });
});
