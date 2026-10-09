/**
 * `sampleAt` naming a record the file does not have.
 *
 * The function's own comment on its nominal branch states the rule: both halves of the bound there
 * are "what separates this from `gridSampleIndexAt`, which happily names a record the file does not
 * have". The scanned-index branch above it checked the SEGMENT and took the rest as an invariant —
 * and the comment says why that was thought sufficient: "a segment it returned already implies
 * `0 <= recordOffset < segment.records.count`".
 *
 * That holds for an index built from this header. It is not what the type guarantees, because
 * `readWindow`'s docblock teaches rebuilding a recording around a scanned index:
 *
 *     const index = await buildRecordIndex(rec);
 *     await readWindow({ ...rec, index }, selection)
 *
 * So a recording assembled by spread is a shape the package asks for, and an index from another file
 * is then one field away. `resolveTimeWindow` refuses that pair — which is why `readWindow`,
 * `readEnvelope` and `streamRecords` all throw for it — and `sampleAt` does not go through it. It was
 * the member of the family that answered: on a four-record file carrying a nine-record index it named
 * record 8, and the sample index that follows from it, which is a location in a file that ended five
 * records earlier.
 *
 * `undefined` is the right answer rather than a throw, because that is already what this function
 * returns for a time the recording does not cover — the nominal branch returns it for exactly this
 * bound, and `segmentAt` returns it for an instant inside a gap.
 *
 * The check is integer-only and exact, so a matched index cannot reach it: its segments are built
 * from this header's own record count (0.6.299).
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { sampleAt, sampleStartSecondsOf } from '../../src/sample-locate.js';
import type { EdfRecording } from '../../src/types.js';
import { minimalEdfPlus } from '../support/writer.js';

const file = (recordCount: number): Uint8Array =>
  minimalEdfPlus({
    recordCount,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
  } as never);

async function recordings(): Promise<{ short: EdfRecording; longIndex: EdfRecording }> {
  const short = await openEdf(byteSource(file(4)));
  const long = await openEdf(byteSource(file(9)));
  // A recording assembled by spread, the way `readWindow`'s docblock teaches — with the index of a
  // different file.
  return { short, longIndex: { ...short, index: await buildRecordIndex(long) } };
}

describe('a record the file ends before', () => {
  it('is what the foreign index really offers', async () => {
    const { short, longIndex } = await recordings();
    expect(short.header.recordCount).toBe(4);
    // The index says nine records in one segment, so the segment bound alone admits record 8.
    expect(longIndex.index.segments?.[0]?.records).toEqual({ start: 0, count: 9 });
  });

  it('is no longer named for a time past the end of the file', async () => {
    const { longIndex } = await recordings();
    // t = 8 s is inside the foreign index's only segment and past this file's four records.
    expect(sampleAt(longIndex, 0, 8)).toBeUndefined();
    expect(sampleAt(longIndex, 0, 4)).toBeUndefined();
    // `sampleStartSecondsOf` was never exposed: its own bound is the SAMPLE count, which the
    // foreign index does not move, so it refuses sample 80 of a 40-sample signal either way.
    expect(() => sampleStartSecondsOf(longIndex, 0, 80)).toThrow(/outside the 40 samples/);
  });

  it('still answers for every time the file does cover', async () => {
    const { longIndex } = await recordings();
    expect(sampleAt(longIndex, 0, 0)).toEqual({
      sampleIndex: 0,
      recordIndex: 0,
      sampleWithinRecord: 0,
    });
    expect(sampleAt(longIndex, 0, 3.5)).toEqual({
      sampleIndex: 35,
      recordIndex: 3,
      sampleWithinRecord: 5,
    });
  });

  it('is unchanged on a recording whose index is its own', async () => {
    const { short } = await recordings();
    const scanned = { ...short, index: await buildRecordIndex(short) };
    for (const seconds of [0, 0.5, 1, 2.75, 3.9]) {
      expect(sampleAt(scanned, 0, seconds), String(seconds)).toEqual(
        sampleAt(short, 0, seconds) ?? undefined,
      );
    }
    // And past the end it was already undefined, by the bound on the nominal branch.
    expect(sampleAt(scanned, 0, 4)).toBeUndefined();
    expect(sampleAt(short, 0, 4)).toBeUndefined();
  });

  it('agrees with the reads, which refuse the same pair outright', async () => {
    const { longIndex } = await recordings();
    // `resolveTimeWindow` catches index-against-timeline; `sampleAt` never reaches it, which is why
    // it needed its own bound.
    await expect(
      readWindow(longIndex, { signalIndices: [0], startSeconds: 0, durationSeconds: 9 }),
    ).rejects.toThrow(/built from different files/);
  });

  it('still returns undefined rather than throwing, as this function always has', async () => {
    const { short, longIndex } = await recordings();
    // The whole family answers absence with `undefined`: a time in a gap, a time past the end.
    expect(sampleAt(short, 0, 100)).toBeUndefined();
    expect(sampleAt(longIndex, 0, 100)).toBeUndefined();
  });
});
