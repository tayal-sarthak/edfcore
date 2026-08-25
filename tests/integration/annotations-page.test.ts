/**
 * The example on `annotations.md`, run.
 *
 * That page introduces the annotations channel by printing one file's values — the region's own
 * header fields, the four events a full-file read returns, and what a scan of a 200-record file
 * costs. It is the page a reader lands on from a search for "how do I read EDF+ annotations", and
 * every figure on it was prose.
 *
 * The transcript is the part worth having under test. `-0.75 undefined pre-stimulus baseline` says
 * four things at once: onsets are reported relative to record 0, a negative onset is legal and
 * kept, an absent duration is `undefined` rather than `0`, and the list is sorted by time across
 * record boundaries. Any one of those changing leaves the page describing a library that no longer
 * behaves that way, and none of them is the kind of thing a reader would think to doubt.
 *
 * The read-cost block is checked with it, because it is the sentence the page uses to argue for
 * spelling the record range out at the call site: a full scan of a twelve-hour study is a full
 * download of it.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import type { ByteSource } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf, minimalEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('annotations.md') ?? '';

/** `region.samplesPerRecord;  // 60` -> 60. */
const shows = (expression: string): string =>
  new RegExp(`${expression.replace(/[.()]/g, '\\$&')};\\s*//\\s*([^\\n]+)`)
    .exec(PAGE)?.[1]
    ?.trim() ?? '';

const number = (expression: string): number => Number(/^-?[\d.]+/.exec(shows(expression))?.[0]);

/**
 * The file the region snippet describes: 768 bytes of samples before a 120-byte region.
 *
 * 384 samples at two bytes each is the 768, and 60 annotation samples are the 120 — both numbers
 * the page prints, so the fixture is the page's arithmetic rather than a guess at it.
 */
const STUDY = buildEdf({
  plus: 'C',
  recordCount: 3,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 384 }],
  annotationSignals: [
    {
      samplesPerRecord: 60,
      tals: (record: number) =>
        record === 0
          ? [
              { onset: -0.75, texts: ['pre-stimulus baseline'] },
              { onset: 1, duration: 30, texts: ['Sleep stage W'] },
            ]
          : record === 1
            ? [
                { onset: 1.25, texts: ['spike'] },
                { onset: 2, duration: 30, texts: ['Sleep stage 1'] },
              ]
            : [],
    },
  ],
});

describe('the annotations region', () => {
  it('has the fields the page prints', async () => {
    const { header } = await openEdf(byteSource(STUDY));
    const index = header.annotationSignalIndices[0];
    if (index === undefined) throw new Error('fixture has no annotations channel');
    const region = header.signals[index];

    expect(region?.kind).toBe('annotations');
    expect(`'${region?.label}'`).toBe(shows('region.label'));
    expect(region?.samplesPerRecord).toBe(number('region.samplesPerRecord'));
    expect(region?.recordByteLength).toBe(number('region.recordByteLength'));
    expect(region?.recordByteOffset).toBe(number('region.recordByteOffset'));
    // "undefined — there is nothing to scale".
    expect(region?.scale).toBeUndefined();
    expect(shows('region.scale').startsWith('undefined')).toBe(true);
  });

  it('is exactly samplesPerRecord * bytesPerSample, which is the sentence above the snippet', async () => {
    const { header } = await openEdf(byteSource(STUDY));
    const index = header.annotationSignalIndices[0] as number;
    const region = header.signals[index];
    expect(region?.recordByteLength).toBe((region?.samplesPerRecord ?? 0) * 2);
  });
});

describe('reading every event in the file', () => {
  it('prints what the page prints, in that order', async () => {
    const recording = await openEdf(byteSource(STUDY));
    const { annotations } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });

    // The transcript, parsed off the page: `// -0.75 undefined pre-stimulus baseline`.
    const printed = [...PAGE.matchAll(/^\/\/ (-?[\d.]+)\s+(undefined|\d+)\s+(.+)$/gm)].map(
      (match) => ({
        onset: Number(match[1]),
        duration: match[2] === 'undefined' ? undefined : Number(match[2]),
        text: (match[3] as string).trim(),
      }),
    );
    expect(printed).toHaveLength(4);

    expect(
      annotations.map((event) => ({
        onset: event.onsetSecondsFromFirstRecord,
        duration: event.durationSeconds,
        text: event.text,
      })),
    ).toEqual(printed);
  });

  it('keeps a negative onset rather than clamping it, and says so once', async () => {
    // The first row of the transcript is a pre-stimulus event. Clamping it to zero would move an
    // event onto the recording's start instant and print the same four lines with a wrong first.
    const recording = await openEdf(byteSource(STUDY));
    const { annotations, diagnostics } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });

    expect(annotations[0]?.onsetSecondsFromFirstRecord).toBeLessThan(0);
    expect(diagnostics.map((one) => one.code)).toEqual(['NEGATIVE_ANNOTATION_ONSET']);
  });
});

describe('a file with no annotations channel', () => {
  it('returns an empty list with no diagnostics, as the page says', async () => {
    const recording = await openEdf(byteSource(minimalEdf({ recordCount: 2 })));
    const result = await readAnnotations(recording, { start: 0, count: 2 });

    expect(result.annotations).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    // And the grid is still there, which is the rest of that paragraph.
    expect(result.recordOnsetTicks).toHaveLength(2);
  });
});

describe('what a scan of the file costs', () => {
  /** "a 200-record file with 632-byte records" — 286 data samples and 30 annotation samples. */
  function twoHundredRecords(): { source: ByteSource; reads: number[] } {
    const bytes = buildEdf({
      plus: 'C',
      recordCount: 200,
      recordDurationSeconds: 1,
      signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 286 }],
      annotationSignals: [{ samplesPerRecord: 30 }],
    });
    const reads: number[] = [];
    return {
      reads,
      source: {
        byteLength: bytes.byteLength,
        read: (offset: number, length: number) => {
          reads.push(length);
          return Promise.resolve(bytes.subarray(offset, offset + length));
        },
      },
    };
  }

  it('is the one read of that many bytes the page prints, for both ranges', async () => {
    const file = twoHundredRecords();
    const recording = await openEdf(file.source);
    expect(recording.header.recordByteLength).toBe(632);

    const rows = [
      ...PAGE.matchAll(/\{ start: 0, count:\s*(\d+) \}\s+one read of\s+([\d,]+) bytes/g),
    ];
    expect(rows.length).toBeGreaterThanOrEqual(2);

    for (const row of rows) {
      const count = Number(row[1]);
      const expected = Number((row[2] as string).replace(/,/g, ''));
      file.reads.length = 0;
      await readAnnotations(recording, { start: 0, count });
      expect(file.reads).toEqual([expected]);
      // And the page's arithmetic: count records at the record size.
      expect(expected).toBe(count * recording.header.recordByteLength);
    }
  });
});
