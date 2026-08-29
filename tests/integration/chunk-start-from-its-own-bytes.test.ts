/**
 * A chunk's start comes from its own bytes, so a probed index cannot make it wrong.
 *
 * `api-reading.md` says it in one clause — "that makes `startSeconds` trustworthy on an EDF+D file
 * even when the index is only probed" — and `chunks.ts` says why it matters: `mergeChunks` refuses
 * two chunks a gap apart by comparing their own `startSeconds`, because "the evidence was in hand
 * the whole time". Before 0.2.19 that refusal was keyed on `precededByGap`, which a probed index
 * reports as `undefined` for everything, so two chunks a minute apart on an EDF+D file joined
 * silently.
 *
 * The claim is worth checking because the cheap answer is available and wrong. `openEdf` reads two
 * records; every record between them has a nominal position — `start + r * recordDuration` — that
 * a reader can compute without touching the file, and on a contiguous file it is right. On an
 * EDF+D file it is wrong by the size of every gap before it, which is exactly the number nobody
 * notices: the samples are fine, the record numbers are fine, and only the clock has moved.
 *
 * So the fixture puts a seven-second hole after record 3 and asks for a chunk on each side of it,
 * through an index that has never looked. Three things are asserted about the far chunk: it does
 * not report the nominal position, it reports the true one, and it reports the same value the
 * scanned index would — which is what "trustworthy" has to mean if it means anything.
 *
 * What this does NOT check: `precededByGap`, which a probed index genuinely cannot fill in and
 * which is `undefined` here on purpose. That is the field 0.2.19 stopped relying on.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readRecords } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

const RECORD_COUNT = 8;
const GAP_AFTER = 3;
const GAP_SECONDS = 7;

/** Records 0-3 at 0..3 s, records 4-7 at 11..14 s: a seven-second hole in the middle. */
const BYTES = buildEdf({
  format: 'EDF',
  plus: 'D',
  recordCount: RECORD_COUNT,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (r) => (r <= GAP_AFTER ? r : r + GAP_SECONDS),
  signals: [{ label: 'Fp1', samplesPerRecord: 4, sample: (r, k) => r * 10 + k }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const AFTER = { start: GAP_AFTER + 1, count: 2 } as const;
const BEFORE = { start: 0, count: 2 } as const;

describe('a probed index', () => {
  it('has looked at two records and says so', async () => {
    const recording = await openEdf(byteSource(BYTES));
    expect(recording.index.coverage).toBe('probed');
    // It cannot enumerate the segmentation, which is the whole reason the chunk has to carry its
    // own clock.
    expect(recording.index.segments).toBeUndefined();
    expect(recording.index.gaps).toBeUndefined();
  });
});

describe('a chunk read past a gap through that index', () => {
  it('does not report the nominal position, which is the cheap wrong answer', async () => {
    const recording = await openEdf(byteSource(BYTES));
    const chunk = await readRecords(recording, { records: AFTER, signalIndices: [0] });
    // `start + r * recordDuration` from record 0 — right on a contiguous file, and short by the
    // gap here. Asserting it is NOT that is what makes the next assertion mean something.
    expect(chunk.startSeconds).not.toBe(AFTER.start);
  });

  it('reports the onset the file writes into that record', async () => {
    const recording = await openEdf(byteSource(BYTES));
    const chunk = await readRecords(recording, { records: AFTER, signalIndices: [0] });
    expect(chunk.startSeconds).toBe(AFTER.start + GAP_SECONDS);
    // Ticks, not the float beside them: two tick counts can round to the same second.
    expect(chunk.startTicks).toBe(BigInt(AFTER.start + GAP_SECONDS) * 10_000_000n);
  });

  it('reports what a scanned index reports, which is what trustworthy has to mean', async () => {
    const opened = await openEdf(byteSource(BYTES));
    const scanned = { ...opened, index: await buildRecordIndex(opened) };
    expect(scanned.index.coverage).toBe('complete');

    const probedChunk = await readRecords(opened, { records: AFTER, signalIndices: [0] });
    const scannedChunk = await readRecords(scanned, { records: AFTER, signalIndices: [0] });
    expect(probedChunk.startTicks).toBe(scannedChunk.startTicks);
    expect(probedChunk.startSeconds).toBe(scannedChunk.startSeconds);

    // And the scanned index's own segmentation agrees about where that record sits.
    const secondSegment = scanned.index.segments?.[1];
    expect(secondSegment?.records.start).toBe(GAP_AFTER + 1);
    expect(secondSegment?.startTicks).toBe(probedChunk.startTicks);
  });

  it('leaves precededByGap undefined, which is the field a probed index cannot fill', async () => {
    // Not an oversight: the chunk knows its own clock and not what came before it. 0.2.19 moved
    // the merge refusal off this field for exactly that reason.
    const recording = await openEdf(byteSource(BYTES));
    const chunk = await readRecords(recording, { records: AFTER, signalIndices: [0] });
    expect(chunk.precededByGap).toBeUndefined();
  });
});

describe('a chunk read before the gap', () => {
  it('reports the nominal position, because there it is also the true one', async () => {
    const recording = await openEdf(byteSource(BYTES));
    const chunk = await readRecords(recording, { records: BEFORE, signalIndices: [0] });
    expect(chunk.startSeconds).toBe(0);
    // The two answers coincide here, which is why a reader who tested only this half would
    // conclude the nominal grid was fine.
    expect(chunk.startSeconds).toBe(BEFORE.start);
  });

  it('carries the same samples either side, so the difference is the clock and nothing else', async () => {
    const recording = await openEdf(byteSource(BYTES));
    const before = await readRecords(recording, { records: BEFORE, signalIndices: [0] });
    const after = await readRecords(recording, { records: AFTER, signalIndices: [0] });
    expect(Array.from(before.signals[0]?.digital ?? [])).toEqual([0, 1, 2, 3, 10, 11, 12, 13]);
    expect(Array.from(after.signals[0]?.digital ?? [])).toEqual([40, 41, 42, 43, 50, 51, 52, 53]);
  });
});
