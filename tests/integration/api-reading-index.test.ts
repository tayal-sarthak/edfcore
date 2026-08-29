/**
 * The two snippets on `api-reading.md` that print values, and the progress contract beside them.
 *
 * `documented-read-counts.test.ts` checks the read counts that page states in prose. These are the
 * two blocks where it prints a file's fields: what `openEdf` reports on an eight-hour EDF+C, and
 * what `buildRecordIndex` reports on a file with a one-minute hole in it.
 *
 * The `onProgress` sentences go with them because they are the part a caller writes code against
 * and cannot test cheaply themselves: "fires once per chunk", and — the one worth pinning — "A file
 * with no annotations signal is not scanned at all, because its record onsets are arithmetic.
 * `onProgress` still fires once with the traversal complete, so a progress bar finishes."
 *
 * A progress bar that never reaches its end is the kind of defect that ships: it looks like
 * slowness, the file is fine, and nothing throws.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { ByteSource } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf, minimalEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('api-reading.md') ?? '';

const shows = (expression: string): string =>
  new RegExp(`console\\.log\\(${expression.replace(/[.()?]/g, '\\$&')}\\);\\s*//\\s*([^\\n]+)`)
    .exec(PAGE)?.[1]
    ?.trim() ?? '';

const number = (expression: string): number => Number(/^-?[\d.]+/.exec(shows(expression))?.[0]);

/** Eight hours of ten-second records, contiguous: the file the first snippet opens. */
const EIGHT_HOURS = buildEdf({
  plus: 'C',
  recordCount: 2880,
  recordDurationSeconds: 10,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 4 }],
  annotationSignals: [{ samplesPerRecord: 30 }],
});

/** A hundred ten-second records with a minute missing after the fiftieth. */
const WITH_A_MINUTE_GONE = buildEdf({
  plus: 'D',
  recordCount: 100,
  recordDurationSeconds: 10,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 4 }],
  annotationSignals: [{ samplesPerRecord: 30 }],
  recordOnsetSeconds: (record: number) => record * 10 + (record < 50 ? 0 : 60),
});

describe('what openEdf prints for an eight-hour EDF+C', () => {
  it('is the variant, the record count and the span the page shows', async () => {
    const recording = await openEdf(byteSource(EIGHT_HOURS));

    expect(`'${recording.header.variant}'`).toBe(shows('recording.header.variant'));
    expect(recording.header.recordCount).toBe(number('recording.header.recordCount'));
    expect(recording.timeline.spanSeconds).toBe(number('recording.timeline.spanSeconds'));
    expect(`'${recording.index.coverage}'`).toBe(shows('recording.index.coverage'));
  });

  it('spans exactly what its records cover, which is why it is the contiguous example', async () => {
    const recording = await openEdf(byteSource(EIGHT_HOURS));
    expect(recording.timeline.spanSeconds).toBe(recording.timeline.coveredSeconds);
    expect(recording.timeline.spanSeconds).toBe(
      recording.header.recordCount * recording.header.recordDurationSeconds,
    );
  });
});

describe('what buildRecordIndex prints for a file with a hole', () => {
  it('is the coverage, the segment count and the gap the page shows', async () => {
    const recording = await openEdf(byteSource(WITH_A_MINUTE_GONE));
    const index = await buildRecordIndex(recording);

    expect(`'${index.coverage}'`).toBe(shows('index.coverage'));
    expect(index.segments?.length).toBe(number('index.segments?.length'));

    // `[ { startSeconds: 500, endSeconds: 560, ... } ]`
    const gap =
      /console\.log\(index\.gaps\);\s*\/\/ \[ \{ startSeconds: (\d+), endSeconds: (\d+)/.exec(PAGE);
    expect(gap, 'no gap printed on api-reading.md').not.toBeNull();
    expect(index.gaps).toHaveLength(1);
    expect(index.gaps?.[0]).toMatchObject({
      startSeconds: Number(gap?.[1]),
      endSeconds: Number(gap?.[2]),
    });
  });
});

describe('the progress contract', () => {
  function counting(bytes: Uint8Array): { source: ByteSource; reads: number } {
    const state = { reads: 0 };
    return {
      get reads() {
        return state.reads;
      },
      source: {
        byteLength: bytes.byteLength,
        read: (offset: number, length: number) => {
          state.reads += 1;
          return Promise.resolve(bytes.subarray(offset, offset + length));
        },
      },
    };
  }

  it('fires once per chunk while scanning', async () => {
    const recording = await openEdf(byteSource(WITH_A_MINUTE_GONE));
    const calls: Array<[number, number]> = [];
    await buildRecordIndex(recording, {
      onProgress: (done, total) => calls.push([done, total]),
      // One record a chunk, so the count is the record count and not an implementation detail.
      maxMaterializeBytes: recording.header.recordByteLength,
    });

    expect(calls).toHaveLength(recording.header.recordCount);
    expect(calls[calls.length - 1]).toEqual([100, 100]);
  });

  it('finishes the bar on a file that is never scanned at all', async () => {
    // "A file with no annotations signal is not scanned at all … `onProgress` still fires once
    // with the traversal complete, so a progress bar finishes." A bar that stops short looks like
    // slowness: the file is fine and nothing throws.
    const plain = minimalEdf({ recordCount: 40 });
    const counted = counting(plain);
    const recording = await openEdf(counted.source);
    const before = counted.reads;

    const calls: Array<[number, number]> = [];
    const index = await buildRecordIndex(recording, {
      onProgress: (done, total) => calls.push([done, total]),
    });

    expect(counted.reads).toBe(before);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([40, 40]);
    expect(index.coverage).toBe('complete');
  });
});

// ---------------------------------------------------------------------------
// The window the page splits at a gap
// ---------------------------------------------------------------------------

/**
 * The page's one worked `readWindow` result, built and run.
 *
 * `api-reading.md` shows a 65-second window over a discontinuous file coming back as two chunks:
 *
 *     [ { records: { start: 498, count: 2 }, startSeconds: 498 },
 *       { records: { start: 500, count: 3 }, startSeconds: 560, precededByGap: {...} } ]
 *
 * It is the only place the page shows what "one chunk per contiguous run" produces, and every
 * figure in it was prose. The counts are the part worth running: 2 and 3 are not the same number
 * and neither is 5, so a reader can see from them that the window did not simply return every
 * record between its ends. Both come out of the half-open rule — record 499 ends exactly at 500 s
 * and is in; record 503 starts exactly at 563 s and is out — which is the rule that decides
 * whether an epoch boundary double-counts.
 *
 * `startSeconds: 560` is the other half. Sixty seconds of the window lie inside the gap, so the
 * second chunk starts 62 seconds after the first despite being 2 records later, and a consumer
 * that assumed `startSeconds` advanced with the record number would place three records a minute
 * early. The transcript's `precededByGap: {...}` is checked as present and as that minute.
 */
const SPLIT_WINDOW = (() => {
  // Anchored to the snippet that PRINTS the two chunks, not to the first window on the page:
  // an unanchored pattern found an earlier `startSeconds`/`durationSeconds` pair belonging to a
  // different example and built a window nothing on this page describes.
  // `// [ { records:`, the printed line — an earlier snippet passes a `records:` range in as an
  // ARGUMENT, and anchoring on the bare field found that one.
  const printedAt = PAGE.indexOf('// [ { records: { start:');
  if (printedAt === -1) throw new Error('api-reading.md no longer prints the split result');
  const before = PAGE.slice(0, printedAt);
  const pairs = [...before.matchAll(/startSeconds: (\d+),\s*\n\s*durationSeconds: (\d+),/g)];
  const last = pairs[pairs.length - 1];
  if (last === undefined) throw new Error('api-reading.md no longer shows the split window');
  return { startSeconds: Number(last[1]), durationSeconds: Number(last[2]) };
})();

/** `{ records: { start: 498, count: 2 }, startSeconds: 498 }` -> the three numbers, in order. */
const SPLIT_CHUNKS: ReadonlyArray<{ start: number; count: number; startSeconds: number }> = [
  ...PAGE.matchAll(/records: \{ start: (\d+), count: (\d+) \}, startSeconds: (\d+)/g),
].map((match) => ({
  start: Number(match[1]),
  count: Number(match[2]),
  startSeconds: Number(match[3]),
}));

const GAP_SECONDS =
  (SPLIT_CHUNKS[1]?.startSeconds ?? 0) -
  ((SPLIT_CHUNKS[0]?.startSeconds ?? 0) + (SPLIT_CHUNKS[0]?.count ?? 0));

/** One-second records, with the gap the transcript implies between record 499 and record 500. */
const SPLIT_FILE = buildEdf({
  plus: 'D',
  recordCount: 520,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 4 }],
  annotationSignals: [{ samplesPerRecord: 30 }],
  recordOnsetSeconds: (record) =>
    record < (SPLIT_CHUNKS[1]?.start ?? 0) ? record : record + GAP_SECONDS,
});

describe('the window the page splits', () => {
  it('reads two chunks out of the page, so a passing run is not a vacuous one', () => {
    expect(SPLIT_CHUNKS).toHaveLength(2);
    expect(SPLIT_WINDOW.durationSeconds).toBeGreaterThan(0);
    // The counts differ from each other and from their sum, so the split is visible in them.
    expect(SPLIT_CHUNKS[0]?.count).not.toBe(SPLIT_CHUNKS[1]?.count);
    expect(GAP_SECONDS).toBeGreaterThan(0);
  });

  it('returns the two chunks the page prints, with their records and their starts', async () => {
    const recording = await openEdf(byteSource(SPLIT_FILE));
    const index = await buildRecordIndex(recording);
    const chunks = await readWindow(
      { ...recording, index },
      { ...SPLIT_WINDOW, signalIndices: [0] },
    );

    expect(chunks).toHaveLength(SPLIT_CHUNKS.length);
    for (const [position, printed] of SPLIT_CHUNKS.entries()) {
      const chunk = chunks[position];
      expect(chunk?.records, `chunk ${position} records`).toEqual({
        start: printed.start,
        count: printed.count,
      });
      expect(chunk?.startSeconds, `chunk ${position} startSeconds`).toBe(printed.startSeconds);
    }
  });

  it('carries the gap on the second chunk and nothing on the first', async () => {
    const recording = await openEdf(byteSource(SPLIT_FILE));
    const index = await buildRecordIndex(recording);
    const chunks = await readWindow(
      { ...recording, index },
      { ...SPLIT_WINDOW, signalIndices: [0] },
    );

    expect(chunks[0]?.precededByGap).toBeUndefined();
    expect(chunks[1]?.precededByGap?.durationSeconds).toBe(GAP_SECONDS);
  });

  it('drops the record that starts exactly at the window end, which is what makes the count 3', async () => {
    // Half-open. Record 503 starts at 563 s, the exclusive end, and a closed window would return
    // four records here — the difference between epochs that partition and epochs that overlap.
    const recording = await openEdf(byteSource(SPLIT_FILE));
    const index = await buildRecordIndex(recording);
    const end = SPLIT_WINDOW.startSeconds + SPLIT_WINDOW.durationSeconds;
    const chunks = await readWindow(
      { ...recording, index },
      { ...SPLIT_WINDOW, signalIndices: [0] },
    );
    const second = chunks[1];
    const lastRecord = (second?.records.start ?? 0) + (second?.records.count ?? 0) - 1;
    expect(await index.onsetTicks(lastRecord + 1)).toBe(BigInt(end) * 10_000_000n);
  });
});
