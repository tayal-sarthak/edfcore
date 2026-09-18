/**
 * `mergeChunks` given chunks from two different recordings.
 *
 * Everything this function checks is about time and record numbers, and a second recording can
 * satisfy all of it exactly. Two files with the same record duration, read at adjacent record
 * ranges, pass the gap test, the record-adjacency test, the tick-contiguity test and the per-signal
 * sample test. What came back was one array holding half of one recording and half of another, with
 * `records` and `durationSeconds` claiming a single run.
 *
 * That is worse than the gap this function exists to refuse — its docblock argues that concatenating
 * across five minutes is unacceptable because "nothing in the result says so" — and it was reported
 * even less.
 *
 * `byteOffset` and `byteLength` are the two fields that know where the samples came from. Within one
 * recording they are fixed by the record range — `headerByteLength + start * recordByteLength` and
 * `count * recordByteLength` — so record-adjacent chunks are byte-adjacent too, at every chunk size
 * and after a merge. When they are not, the two were read from files whose header or record sizes
 * differ, and no arrangement of records makes that one file.
 *
 * It does not catch two files of IDENTICAL geometry, and nothing on `EdfChunk` could: no field
 * identifies a recording. That pair is pinned below as still accepted, so the limit is a recorded
 * fact rather than an assumption.
 */

import { describe, expect, it } from 'vitest';
import { mergeChunks } from '../../src/chunks.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import type { EdfChunk } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const common = {
  format: 'EDF',
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 1,
  annotationSignals: [{ samplesPerRecord: 60 }],
} as const;

const NARROW = buildEdf({ ...common, signals: [{ label: 'Fp1', samplesPerRecord: 8 }] });
/** A second channel, so both the header and every record are wider. */
const WIDE = buildEdf({
  ...common,
  signals: [
    { label: 'Q1', samplesPerRecord: 8 },
    { label: 'Q2', samplesPerRecord: 8 },
  ],
});
/** A different file with the SAME geometry, which nothing on a chunk can tell apart. */
const TWIN = buildEdf({ ...common, signals: [{ label: 'Zz1', samplesPerRecord: 8 }] });

const chunkOf = async (bytes: Uint8Array, start: number, count: number): Promise<EdfChunk> =>
  readRecords(await openEdf(byteSource(bytes)), {
    signalIndices: [0],
    records: { start, count },
  });

describe('chunks of one recording', () => {
  it('are byte-adjacent whenever they are record-adjacent, at every chunk size', async () => {
    for (const size of [1, 2, 3, 6]) {
      const parts: EdfChunk[] = [];
      for (let start = 0; start < 6; start += size) {
        parts.push(await chunkOf(NARROW, start, Math.min(size, 6 - start)));
      }
      for (let i = 1; i < parts.length; i += 1) {
        const previous = parts[i - 1] as EdfChunk;
        expect(previous.byteOffset + previous.byteLength, `size ${size}`).toBe(
          (parts[i] as EdfChunk).byteOffset,
        );
      }
      expect(mergeChunks(parts).records).toEqual({ start: 0, count: 6 });
    }
  });

  it('still merge after a merge, so the check survives its own output', async () => {
    const a = await chunkOf(NARROW, 0, 2);
    const b = await chunkOf(NARROW, 2, 2);
    const c = await chunkOf(NARROW, 4, 2);
    expect(mergeChunks([mergeChunks([a, b]), c]).records).toEqual({ start: 0, count: 6 });
  });

  it('still merge what readWindow returned', async () => {
    const recording = await openEdf(byteSource(NARROW));
    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 6,
    });
    expect(mergeChunks(chunks).records.count).toBe(6);
  });
});

describe('chunks of two recordings', () => {
  it('are refused when the files differ in shape', async () => {
    const mine = await chunkOf(NARROW, 0, 2);
    const theirs = await chunkOf(WIDE, 2, 2);
    // Record-adjacent, and contiguous in time: everything else this checks is satisfied.
    expect(theirs.records.start).toBe(mine.records.start + mine.records.count);
    expect(theirs.startTicks).toBe(mine.startTicks + mine.durationTicks);

    let thrown: Error | undefined;
    try {
      mergeChunks([mine, theirs]);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown, 'two recordings were joined into one array').toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain('different recordings');
    expect(thrown?.message).toContain('Next:');
  });

  it('name the bytes rather than the records, which were adjacent', async () => {
    const mine = await chunkOf(NARROW, 0, 2);
    const theirs = await chunkOf(WIDE, 2, 2);
    expect(() => mergeChunks([mine, theirs])).toThrow(/begins at byte/);
    expect(() => mergeChunks([mine, theirs])).toThrow(/ends at/);
  });

  it('are still joined when the two files have identical geometry, which no field can tell apart', async () => {
    const mine = await chunkOf(NARROW, 0, 2);
    const twin = await chunkOf(TWIN, 2, 2);
    // Recorded, not endorsed: nothing on an EdfChunk identifies the recording it came from, so this
    // pair stays indistinguishable and the guard above does not claim to catch it.
    expect(mergeChunks([mine, twin]).records).toEqual({ start: 0, count: 4 });
  });
});

describe('the refusals that were already there', () => {
  it('still name a gap before the bytes are looked at', async () => {
    const recording = await openEdf(byteSource(NARROW));
    const a = await readRecords(recording, { signalIndices: [0], records: { start: 0, count: 2 } });
    const c = await readRecords(recording, { signalIndices: [0], records: { start: 4, count: 2 } });
    expect(() => mergeChunks([a, c])).toThrow(/Chunks must be adjacent and in order/);
  });
});
