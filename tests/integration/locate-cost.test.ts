/**
 * What `index.locate` costs, against the numbers `discontinuous.md` prints.
 *
 * The page makes two claims about it that a caller plans around. It is a binary search over
 * monotonic onsets, so it costs `O(log recordCount)` one-record reads on a probed index — and
 * every onset it reads is memoised, so a second `locate` nearby usually costs nothing:
 *
 *     locate(13.5)  →  3 reads   (records 0 and 5 were already memoised by openEdf)
 *     locate(13.9)  →  0 reads
 *
 * The second line is the one worth holding. Zero is not a number a test usually gets to assert,
 * and it is the difference between scrubbing a viewport and hammering an object store: a UI that
 * calls `locate` on every pointer move is either free or a request per frame, and nothing about
 * the call site says which. A memo dropped in a refactor changes no result at all.
 *
 * The first line is worth holding for the parenthesis rather than the count. Three reads, because
 * records 0 and 5 are already known — the probe `openEdf` paid for is not wasted, and the search
 * starts from what it left behind.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { spySource } from '../support/spy-source.js';
import { minimalEdfPlus } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('discontinuous.md') ?? '';

/** `recording.timeline.spanSeconds;  // 16 — last record's end minus record 0's start` */
const SPAN = Number(/spanSeconds;\s*\/\/\s*(\d+)/.exec(PAGE)?.[1]);
const COVERED = Number(/coveredSeconds;\s*\/\/\s*(\d+)/.exec(PAGE)?.[1]);

/** `locate(13.5)  →  3 reads` */
const COSTS = [...PAGE.matchAll(/locate\(([\d.]+)\)\s*→\s*(\d+) reads/g)].map(
  ([, seconds = '', reads = '']) => ({ seconds: Number(seconds), reads: Number(reads) }),
);

/** `// { recordIndex: 3, recordStartSeconds: 13, offsetInRecordSeconds: 0.5 }` */
const RESOLVED =
  /await recording\.index\.locate\(([\d.]+)\);\s*\/\/ \{ recordIndex: (\d+), recordStartSeconds: (\d+), offsetInRecordSeconds: ([\d.]+) \}/.exec(
    PAGE,
  );

/** `await recording.index.locate(5);` followed by `// undefined` */
const IN_THE_GAP = Number(
  /await recording\.index\.locate\((\d+)\);\s*\/\/ undefined/.exec(PAGE)?.[1],
);

/**
 * The file the page draws: six one-second records with a ten-second hole after record 2, so the
 * span is 16 and the coverage 6.
 */
const BYTES = minimalEdfPlus({
  plus: 'D',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
  recordOnsetSeconds: (record) => (record <= 2 ? record : record + 10),
});

describe('the file the page describes', () => {
  it('states the two spans it is built from', () => {
    expect(Number.isInteger(SPAN)).toBe(true);
    expect(Number.isInteger(COVERED)).toBe(true);
  });

  it('has them, computed independently as the page says', async () => {
    const recording = await openEdf(byteSource(BYTES));
    expect(recording.header.variant).toBe('EDF+D');
    expect(recording.header.continuity).toBe('discontinuous');
    expect(recording.timeline.spanSeconds).toBe(SPAN);
    expect(recording.timeline.coveredSeconds).toBe(COVERED);
    // "the difference is time that sits inside the recording and that no record covers"
    expect(SPAN - COVERED).toBe(10);
  });
});

describe('what locate answers', () => {
  it('resolves the instant the page resolves, to the same record and offset', async () => {
    expect(RESOLVED).not.toBeNull();
    const recording = await openEdf(byteSource(BYTES));
    const found = await recording.index.locate(Number(RESOLVED?.[1]));
    expect(found?.recordIndex).toBe(Number(RESOLVED?.[2]));
    expect(found?.recordStartSeconds).toBe(Number(RESOLVED?.[3]));
    expect(found?.offsetInRecordSeconds).toBe(Number(RESOLVED?.[4]));
  });

  it('returns undefined inside the gap, which is not a failure', async () => {
    // "`undefined` means the instant is in a gap or outside the recording, never that the lookup
    //  failed."
    const recording = await openEdf(byteSource(BYTES));
    expect(await recording.index.locate(IN_THE_GAP)).toBeUndefined();
  });
});

describe('what locate costs', () => {
  it('prints two costs, one of which is zero', () => {
    expect(COSTS).toHaveLength(2);
    expect(COSTS.map((cost) => cost.reads)).toContain(0);
  });

  it('costs what the page prints, including the second call costing nothing', async () => {
    const spy = spySource(byteSource(BYTES));
    const recording = await openEdf(spy);
    // openEdf has already paid for records 0 and 5, which is the parenthesis on the first line.
    const afterOpen = spy.reads.length;
    expect(afterOpen).toBe(4);

    let before = afterOpen;
    for (const { seconds, reads } of COSTS) {
      await recording.index.locate(seconds);
      expect(spy.reads.length - before, `locate(${seconds})`).toBe(reads);
      before = spy.reads.length;
    }
  });

  it('reads one record at a time, never a range of them', async () => {
    // "one-record reads on a probed index" — a binary search that widened to ranges would still
    // answer correctly and cost far more over HTTP.
    const spy = spySource(byteSource(BYTES));
    const recording = await openEdf(spy);
    const before = spy.reads.length;
    await recording.index.locate(COSTS[0]?.seconds ?? 0);
    for (const read of spy.reads.slice(before)) {
      expect(read.length).toBe(recording.header.recordByteLength);
    }
  });

  it('memoises whatever it read, so repeating the first call is also free', async () => {
    const spy = spySource(byteSource(BYTES));
    const recording = await openEdf(spy);
    await recording.index.locate(COSTS[0]?.seconds ?? 0);
    const settled = spy.reads.length;
    await recording.index.locate(COSTS[0]?.seconds ?? 0);
    expect(spy.reads.length).toBe(settled);
  });
});
