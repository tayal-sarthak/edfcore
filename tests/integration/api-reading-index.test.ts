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
import { openEdf } from '../../src/recording.js';
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
