/**
 * The discontinuity walk-through on `concepts.md`, executed.
 *
 * `concepts-arithmetic.test.ts` runs the read the page costs out. This is the other worked example
 * on the same page, and it is the one the page exists to make: a six-record file with a ten-second
 * hole, read three ways. A probed index that admits what it has not seen, the refusal you get for
 * asking a time question of it, and the two chunks a scanned index turns the same call into.
 *
 * The page states the consequence in a sentence nothing was checking: "record 3 is reported at
 * t = 3 s when it truly starts at t = 13 s. Nothing throws, nothing looks wrong, and every event
 * you align against it is ten seconds out." Every number in that sentence — 3, 13, 10 — is printed
 * again lower down as a field value, and the refusal message is quoted in full.
 *
 * A quoted error message is the part most likely to go stale, because rewording one is a small,
 * obviously-safe edit made in a different file. It is also the part a reader searches for when they
 * hit it.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('concepts.md') ?? '';

const number = (pattern: RegExp): number => Number(pattern.exec(PAGE)?.[1]);

/** Six one-second records, three of them after a ten-second hole. */
const WITH_A_GAP = buildEdf({
  plus: 'D',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 100 }],
  annotationSignals: [{ samplesPerRecord: 30 }],
  recordOnsetSeconds: (record: number) => (record < 3 ? record : record + 10),
});

async function opened(): Promise<EdfRecording> {
  return openEdf(byteSource(WITH_A_GAP));
}

describe('what openEdf knows', () => {
  it('admits it has not seen the middle', async () => {
    const recording = await opened();

    expect(recording.index.coverage).toBe('probed');
    expect(recording.index.segments).toBeUndefined();
    expect(recording.index.gaps).toBeUndefined();
  });

  it('reports the span and the coverage the page prints, and they differ', async () => {
    const recording = await opened();

    expect(recording.timeline.spanSeconds).toBe(
      number(/timeline\.spanSeconds\s+=\s+(\d+)\s+last record end/),
    );
    expect(recording.timeline.coveredSeconds).toBe(
      number(/timeline\.coveredSeconds\s+=\s+(\d+)\s+sum of the record durations/),
    );
    // "they differ, so there is a gap" — the whole basis of the section.
    expect(recording.timeline.spanSeconds).not.toBe(recording.timeline.coveredSeconds);
  });
});

describe('asking a time question of a probed index', () => {
  /*
   * Two pages quote this message in full, and both quoted a version the library had stopped
   * producing: "the gap" where it now says "the discontinuity", and neither carried the
   * "Exactly: … ticks of 100 ns" sentence at all. That sentence exists because the two second
   * counts in the clause above it can PRINT the same on a long recording — so the pages were
   * missing the one clause that makes the message actionable in the case it was written for.
   *
   * Rewording an error is a small edit in a different file, which is exactly why a quotation of
   * one rots. Both pages are checked here rather than one, because the drift was in both.
   */
  const QUOTING = ['concepts.md', 'discontinuous.md'] as const;

  async function refusal(): Promise<Error> {
    const recording = await opened();
    const error = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: 20,
      signalIndices: [0],
    }).then(
      () => undefined,
      (thrown: unknown) => thrown as Error,
    );
    expect(error).toBeInstanceOf(RangeError);
    return error as Error;
  }

  it.each(QUOTING)('is refused with the message %s quotes', async (page) => {
    const text = (DOCS_PAGES.get(page) ?? '').replace(/^\/\/ ?/gm, '').replace(/\s+/g, ' ');
    const quoted =
      /RangeError: (this file cannot be mapped[\s\S]*?index\.locate\(seconds\)\.)/.exec(text)?.[1];
    expect(quoted, `no refusal quoted on ${page}`).toBeDefined();

    const error = await refusal();
    expect(error.message.replace(/\s+/g, ' ')).toBe(quoted);
  });

  it('names the ticks, which is the clause the pages had lost', async () => {
    // The two second counts can print the same on a long recording; the ticks always differ. A
    // message that appears to contradict itself is a message nobody acts on.
    const error = await refusal();
    expect(error.message).toContain('Exactly: 160000000 against 60000000 ticks of 100 ns.');
  });
});

describe('what buildRecordIndex learns', () => {
  it('finds the two segments and the one gap the page prints', async () => {
    const recording = await opened();
    const index = await buildRecordIndex(recording);

    expect(index.coverage).toBe('complete');
    expect(index.segments?.map((segment) => segment.records)).toEqual([
      { start: 0, count: 3 },
      { start: 3, count: 3 },
    ]);
    expect(index.segments?.map((segment) => segment.startSeconds)).toEqual([
      number(/records: \{ start: 0, count: 3 \}, startSeconds: (\d+)/),
      number(/records: \{ start: 3, count: 3 \}, startSeconds: (\d+)/),
    ]);
    expect(index.gaps).toHaveLength(1);
    expect(index.gaps?.[0]).toMatchObject({
      startSeconds: number(/gaps;\s*\/\/ \[ \{ startSeconds: (\d+)/),
      endSeconds: number(/gaps;\s*\/\/ \[ \{ startSeconds: \d+, endSeconds: (\d+)/),
      durationSeconds: number(/endSeconds: \d+, durationSeconds: (\d+)/),
    });
  });

  it('turns the same call into the two chunks the page describes', async () => {
    const recording = await opened();
    const index = await buildRecordIndex(recording);

    const chunks = await readWindow(
      { ...recording, index },
      { startSeconds: 0, durationSeconds: 20, signalIndices: [0] },
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.startSeconds).toBe(0);
    expect(chunks[0]?.precededByGap).toBeUndefined();
    expect(chunks[1]?.startSeconds).toBe(13);
    expect(chunks[1]?.precededByGap?.durationSeconds).toBe(10);
  });

  it('is what stops record 3 being reported ten seconds early', async () => {
    // The sentence the section is built on: read as if contiguous, record 3 lands at t = 3 s when
    // it truly starts at 13. The nominal grid and the truth are both asserted, because the page's
    // point is the difference between them.
    const recording = await opened();
    const index = await buildRecordIndex(recording);

    expect(await index.onsetTicks(3)).toBe(130_000_000n);
    expect(3 * recording.header.recordDurationSeconds).toBe(3);
  });
});
