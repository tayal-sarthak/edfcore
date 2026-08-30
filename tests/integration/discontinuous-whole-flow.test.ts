/**
 * "The whole flow" at the end of `discontinuous.md`, run — and the diagram at the top of it.
 *
 * That page opens with an ASCII timeline of one file and closes with a four-step program over the
 * same file, printing six lines. `discontinuous-page.test.ts` covers the objects in between — the
 * `index.segments` and `index.gaps` blocks, and `locate(13.5)`. The diagram and the program were
 * prose at both ends of it.
 *
 * The diagram is the page's premise: six one-second records, a ten-second hole after record 2, and
 * a row of byte offsets — 768, 1400, 2032, 2664, 3296, 3928 — which is the sentence "they are still
 * stored back to back on disk" written as numbers. A reader takes those offsets to a hex editor,
 * and the second row is what the page exists to correct: record 3 starts at 13 s, not 3 s. Both
 * rows are now read out of the diagram and checked, and the same offsets appear again in the
 * four-read block under "openEdf never scans", where they are the ranges the open actually issues.
 *
 * The program's output is the other half. Three of its six lines come from `console.log` inside
 * loops the page writes itself — the segment lines, the gap line, and the trimmed sample counts —
 * so they are composed here by the same expressions and compared against the page's text. The
 * trimmed lines are the ones worth having: `256 samples from 2 s` and `256 samples from 13 s` are
 * `trimToWindow` applied to a window that spans a gap, and the second one is the whole point of the
 * page. A reader who trusted the nominal grid would expect the second chunk to start at 4 s.
 *
 * `index.locate(5)` is checked with them. It returns `undefined` for an instant inside the hole,
 * which is the answer the page prints and the one a caller has to handle: there is no sample there,
 * and no index can invent one.
 *
 * What this does NOT check: the refusal a probed index raises for a time query, or the shape of the
 * segment and gap objects. Those are `discontinuous.test.ts` and `discontinuous-page.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { trimToWindow } from '../../src/time/window.js';
import type { EdfRecordIndex, EdfRecording } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { spySource } from '../support/spy-source.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('discontinuous.md') ?? '';

/** The page's file: six one-second records, a ten-second hole after record 2. */
const BYTES = buildEdf({
  plus: 'D',
  recordCount: 6,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (record) => (record < 3 ? record : record + 10),
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 256 }],
  annotationSignals: [{ samplesPerRecord: 60 }],
});

async function located(): Promise<{ recording: EdfRecording; index: EdfRecordIndex }> {
  const recording = await openEdf(byteSource(BYTES));
  return { recording, index: await buildRecordIndex(recording) };
}

// ---------------------------------------------------------------------------
// The diagram
// ---------------------------------------------------------------------------

/** The three rows of the timeline diagram, as numbers. */
function diagram(): { starts: readonly number[]; offsets: readonly number[] } {
  const block = /```text\n(record\s+0[\s\S]*?)```/.exec(PAGE)?.[1] ?? '';
  const row = (label: string): readonly number[] =>
    [...(new RegExp(`${label}([^\\n]*)`).exec(block)?.[1] ?? '').matchAll(/(\d+)s?\b/g)]
      .map((match) => Number(match[1]))
      // The gap column spells its own bounds ("3s .. 13s"); the per-record rows do not.
      .filter((value) => Number.isFinite(value));
  return { starts: row('starts at'), offsets: row('byte offset') };
}

describe('the timeline the page draws', () => {
  const { starts, offsets } = diagram();

  it('reads as two rows of six, so a passing run is not a vacuous one', () => {
    expect(offsets).toEqual([768, 1400, 2032, 2664, 3296, 3928]);
    // "starts at" carries the gap column's own two bounds between records 2 and 3.
    expect(starts).toEqual([0, 1, 2, 3, 13, 13, 14, 15]);
  });

  it('puts the records at the byte offsets it prints', async () => {
    const { recording } = await located();
    const { header } = recording;
    expect(header.headerByteLength).toBe(offsets[0]);
    expect(header.recordByteLength).toBe(632);
    for (const [record, offset] of offsets.entries()) {
      expect(offset).toBe(header.headerByteLength + record * header.recordByteLength);
    }
  });

  it('and at the times it prints, which is the row the page exists to correct', async () => {
    const { index } = await located();
    const onDisk = [0, 1, 2, 13, 14, 15];
    for (const [record, second] of onDisk.entries()) {
      expect(Number(await index.onsetTicks(record))).toBe(second * 10_000_000);
    }
    // Record 3 is at 13 s. The nominal grid would put it at 3.
    expect(Number(await index.onsetTicks(3)) / 10_000_000).not.toBe(3);
  });
});

describe('what opening it costs', () => {
  /** The block under "openEdf never scans": four ranges, whatever the file size. */
  const PRINTED = [...PAGE.matchAll(/\{ offset:\s*(\d+), length:\s*(\d+) \}/g)].map((match) => ({
    offset: Number(match[1]),
    length: Number(match[2]),
  }));

  it('prints four ranges, so a passing run is not a vacuous one', () => {
    expect(PRINTED).toHaveLength(4);
  });

  it('issues exactly those, in that order', async () => {
    const spy = spySource(byteSource(BYTES));
    await openEdf(spy);
    expect(spy.reads.map(({ offset, length }) => ({ offset, length }))).toEqual(PRINTED);
  });

  it('probes the first and the last record, which is what the last two ranges are', async () => {
    const { recording } = await located();
    const { header } = recording;
    expect(PRINTED[2]).toEqual({
      offset: header.headerByteLength,
      length: header.recordByteLength,
    });
    expect(PRINTED[3]).toEqual({
      offset: header.headerByteLength + 5 * header.recordByteLength,
      length: header.recordByteLength,
    });
  });
});

// ---------------------------------------------------------------------------
// The program
// ---------------------------------------------------------------------------

/** Every `// line` under the program's third fence, in order. */
function printedLines(): readonly string[] {
  const at = PAGE.indexOf('// 2. Pay for the structure only when there is structure to find.');
  const fence = PAGE.slice(at, PAGE.indexOf('```', at));
  return [...fence.matchAll(/^\/\/ ((?:segment|gap of|\d+ s gap|\d+ samples)[^\n]*)$/gm)].map(
    (match) => match[1] ?? '',
  );
}

describe('the six lines the program prints', () => {
  const PRINTED = printedLines();

  it('are all there, so a passing run is not a vacuous one', () => {
    expect(PRINTED).toEqual([
      'segment 0: 0..3 s',
      'segment 1: 13..16 s',
      'gap of 10 s at 3 s',
      '256 samples from 2 s',
      '10 s gap before this chunk',
      '256 samples from 13 s',
    ]);
  });

  it('step 1 finds the file suspect without reading anything', async () => {
    const spy = spySource(byteSource(BYTES));
    const { header, timeline } = await openEdf(spy);
    const before = spy.reads.length;
    const suspect =
      header.continuity === 'discontinuous' || timeline.spanSeconds !== timeline.coveredSeconds;
    expect(suspect).toBe(true);
    expect(spy.reads).toHaveLength(before);
    // Both halves of the disjunction hold for this file, which is what the page says.
    expect(header.continuity).toBe('discontinuous');
    expect(timeline.spanSeconds).not.toBe(timeline.coveredSeconds);
  });

  it('step 2 prints the segment and gap lines', async () => {
    const { index } = await located();
    const lines = [
      ...(index.segments ?? []).map(
        (segment) => `segment ${segment.index}: ${segment.startSeconds}..${segment.endSeconds} s`,
      ),
      ...(index.gaps ?? []).map(
        (gap) => `gap of ${gap.durationSeconds} s at ${gap.startSeconds} s`,
      ),
    ];
    expect(lines).toEqual(PRINTED.slice(0, 3));
  });

  it('step 3 prints the trimmed counts, one chunk per contiguous run', async () => {
    const { recording, index } = await located();
    const { header } = recording;
    const signal = getSignal(header, 'EEG Fpz-Cz');
    const chunks = await readWindow(
      { ...recording, index },
      { startSeconds: 2, durationSeconds: 12, signalIndices: [signal.index] },
    );
    expect(chunks).toHaveLength(2);

    const lines: string[] = [];
    for (const chunk of chunks) {
      if (chunk.precededByGap !== undefined) {
        lines.push(`${chunk.precededByGap.durationSeconds} s gap before this chunk`);
      }
      const [series] = chunk.signals;
      if (series === undefined) continue;
      const exact = trimToWindow(header, series, 2, 12);
      lines.push(`${exact.sampleCount} samples from ${exact.startSeconds} s`);
    }
    expect(lines).toEqual(PRINTED.slice(3));
  });

  it('and the second run starts at 13 s, not at the 4 s the nominal grid would give it', async () => {
    const { recording, index } = await located();
    const signal = getSignal(recording.header, 'EEG Fpz-Cz');
    const chunks = await readWindow(
      { ...recording, index },
      { startSeconds: 2, durationSeconds: 12, signalIndices: [signal.index] },
    );
    const second = chunks[1];
    const series = second?.signals[0];
    if (series === undefined) throw new Error('the window did not split at the gap');
    expect(trimToWindow(recording.header, series, 2, 12).startSeconds).toBe(13);
    // Records 3, 4, 5 are the second run, so the nominal reading would say 3 s.
    expect(second?.records.start).toBe(3);
  });
});

describe('step 4: a single instant', () => {
  it('has no answer inside the gap, which is the value the page prints', async () => {
    const { index } = await located();
    expect(await index.locate(5)).toBeUndefined();
    expect(PAGE.replace(/\s+/g, ' ')).toContain('index.locate(5); // undefined — inside the gap');
  });

  it('and does have one on either side of it', async () => {
    const { index } = await located();
    expect((await index.locate(2.5))?.recordIndex).toBe(2);
    expect((await index.locate(13.5))?.recordIndex).toBe(3);
  });
});
