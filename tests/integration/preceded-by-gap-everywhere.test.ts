/**
 * `precededByGap` names what precedes the chunk, however the chunk was asked for.
 *
 * The field carries a rule that is stated in three places and tested in one. `chunks.ts` says it is
 * `undefined` "in two different situations: no gap, and nobody looked". `stream.ts` says a streamed
 * chunk carries "the same `precededByGap` a `readWindow` chunk would". `biosemi.ts` states the
 * sharpest form of it, for triggers: the gap "precedes the RUN, not whichever sample the window
 * happened to admit first, which could be a whole record later" — a rule narrowed in 0.3.67 after
 * 0.3.92 had written down a wider one.
 *
 * `discontinuous.test.ts` checks it on `readWindow`. Four entry points produce chunks, and the field
 * is computed from the index rather than from the read — so what it says has to be the same
 * whichever of the four asked, and for the same records.
 *
 * One file with a twenty-second hole after record 4, and every way of naming the records around it:
 * `readRecords` by number, `readWindow` by time, `streamRecords` in pieces smaller than the run,
 * and `readEnvelope`. The gap appears on exactly one chunk in each — the one whose first record is
 * record 5 — and on none of the others, including the chunk that starts at record 6, which is
 * inside the run and after it, and the chunk that starts at record 4, which spans the hole by
 * record number and is not preceded by it.
 *
 * And the other of the two situations: on a probed index the same read gives `undefined`, which is
 * "nobody looked" rather than "no gap" — the distinction `chunks.ts` exists to keep, and the reason
 * its refusal is keyed on the clock instead.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const GAP_SECONDS = 20;
const FIRST_AFTER = 5;

const BYTES = buildEdf({
  plus: 'D',
  recordCount: 9,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (record) => (record < FIRST_AFTER ? record : record + GAP_SECONDS),
  signals: [{ label: 'Fp1', samplesPerRecord: 16 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const gapOf = (chunk: {
  precededByGap?: { durationSeconds: number } | undefined;
}): number | undefined => chunk.precededByGap?.durationSeconds;

async function located(): Promise<EdfRecording> {
  const recording = await openEdf(byteSource(BYTES));
  return { ...recording, index: await buildRecordIndex(recording) };
}

describe('the file', () => {
  it('has one hole, where the fixture puts it', async () => {
    const recording = await located();
    expect(recording.index.gaps).toHaveLength(1);
    expect(recording.index.gaps?.[0]?.durationSeconds).toBe(GAP_SECONDS);
    expect(recording.index.gaps?.[0]?.afterSegmentIndex).toBe(1);
  });
});

describe('asked for by record number', () => {
  it.each([
    ['the first records of the run after it', FIRST_AFTER, 2, GAP_SECONDS],
    ['the whole run after it', FIRST_AFTER, 4, GAP_SECONDS],
    ['records inside that run but not at its start', FIRST_AFTER + 1, 2, undefined],
    ['records spanning the hole by number', FIRST_AFTER - 1, 2, undefined],
    ['records before it', 0, 3, undefined],
  ] as const)('reports %s', async (_name, start, count, expected) => {
    const recording = await located();
    const chunk = await readRecords(recording, {
      records: { start, count },
      signalIndices: [0],
    });
    expect(gapOf(chunk)).toBe(expected);
  });
});

describe('asked for by time, in pieces, or as an envelope', () => {
  it('puts it on the same one chunk in all three', async () => {
    const recording = await located();
    const selection = { startSeconds: 0, durationSeconds: 40, signalIndices: [0] } as const;

    const windows = await readWindow(recording, selection);
    expect(windows.map((chunk) => [chunk.records.start, gapOf(chunk)])).toEqual([
      [0, undefined],
      [FIRST_AFTER, GAP_SECONDS],
    ]);

    const envelopes = await readEnvelope(recording, { ...selection, buckets: 4 });
    expect(envelopes.map((chunk) => [chunk.records.start, gapOf(chunk)])).toEqual([
      [0, undefined],
      [FIRST_AFTER, GAP_SECONDS],
    ]);

    // Chunked smaller than the run, so the run is split and only its first piece may carry it.
    const streamed: Array<[number, number | undefined]> = [];
    for await (const chunk of streamRecords(recording, { ...selection, chunkRecords: 2 })) {
      streamed.push([chunk.records.start, gapOf(chunk)]);
    }
    expect(streamed).toEqual([
      [0, undefined],
      [2, undefined],
      [4, undefined],
      [FIRST_AFTER, GAP_SECONDS],
      [FIRST_AFTER + 2, undefined],
    ]);
  });

  it('and never on more than one chunk of a single call', async () => {
    const recording = await located();
    for (const chunkRecords of [1, 2, 3, 9]) {
      const carrying: number[] = [];
      for await (const chunk of streamRecords(recording, {
        startSeconds: 0,
        durationSeconds: 40,
        signalIndices: [0],
        chunkRecords,
      })) {
        if (gapOf(chunk) !== undefined) carrying.push(chunk.records.start);
      }
      expect(carrying, `chunkRecords ${chunkRecords}`).toEqual([FIRST_AFTER]);
    }
  });
});

describe('the other reason it can be undefined', () => {
  it('is that nobody looked, which a probed index cannot tell you apart from no gap', async () => {
    const probed = await openEdf(byteSource(BYTES));
    expect(probed.index.coverage).toBe('probed');
    expect(probed.index.gaps).toBeUndefined();

    const chunk = await readRecords(probed, {
      records: { start: FIRST_AFTER, count: 2 },
      signalIndices: [0],
    });
    expect(gapOf(chunk)).toBeUndefined();

    // The same records, on a scanned index, do carry it — so the `undefined` above is about the
    // index and not about the file.
    const scanned = await located();
    const again = await readRecords(scanned, {
      records: { start: FIRST_AFTER, count: 2 },
      signalIndices: [0],
    });
    expect(gapOf(again)).toBe(GAP_SECONDS);
    // And the samples are the same either way: only the field about structure differs.
    expect([...(chunk.signals[0]?.digital ?? [])]).toEqual([...(again.signals[0]?.digital ?? [])]);
  });
});
