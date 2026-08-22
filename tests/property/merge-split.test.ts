/**
 * Reading a stretch in pieces and joining them is reading it whole.
 *
 * That is the promise `mergeChunks` exists to make, and it is what lets a caller bound memory
 * without changing an answer: read a twelve-hour recording a minute at a time, merge what you
 * need, and the samples are the samples. `merge-chunks.test.ts` demonstrates it on one split of
 * one file — two adjacent reads of a six-second recording — and every check around it is about a
 * merge that must be REFUSED. The thing that has to hold for every split of every file was shown
 * for one.
 *
 * The gap matters because the failure is silent and arithmetic. A merge that dropped the first
 * sample of each piece, or double-counted a boundary record, returns an array of exactly the
 * length a caller expects, holding real samples from the real file, shifted. Nothing downstream
 * can tell: the timestamps are computed from the record range, which is right, and the values are
 * plausible because they came from the recording. It surfaces as an event marked half a second
 * late, weeks later, in someone else's analysis.
 *
 * So: any recording, any number of channels, split at arbitrary record boundaries into any number
 * of pieces, merged, must equal one read of the whole range — sample for sample, and in the
 * accounting too. `records`, `byteLength` and the chunk's own start in ticks are all quantities a
 * caller reads off the result, and a merge that got the samples right and the bookkeeping wrong
 * would be worse than one that failed.
 *
 * `readRecords` is used rather than `readWindow`, deliberately: this is about joining pieces, and
 * a record range is the only way to name a piece exactly. Time windows are `window-cost`'s
 * subject.
 *
 * The seed is constant, so a failure is reproducible from the terminal output alone.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mergeChunks } from '../../src/chunks.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import type { EdfChunk } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const SEED = 0x2b41;

interface Shape {
  readonly counts: readonly number[];
  readonly recordCount: number;
  readonly recordDurationSeconds: number;
}

const shape = fc.record({
  counts: fc.array(fc.integer({ min: 1, max: 32 }), { minLength: 1, maxLength: 4 }),
  recordCount: fc.integer({ min: 2, max: 24 }),
  recordDurationSeconds: fc.constantFrom(0.5, 1, 2),
});

const build = (of: Shape): Uint8Array =>
  buildEdf({
    recordCount: of.recordCount,
    recordDurationSeconds: of.recordDurationSeconds,
    signals: of.counts.map((samplesPerRecord, index) => ({
      label: `C${index}`,
      samplesPerRecord,
      // A ramp keyed on BOTH indices, so a piece pasted at the wrong offset is visible rather
      // than plausible: the default ramp repeats per record and would hide a shift by one record.
      sample: (recordIndex: number, sampleIndex: number) =>
        ((recordIndex * 97 + sampleIndex * 13 + index * 7) % 4001) - 2000,
    })),
  });

/** `count` split into `pieces` adjacent runs, each at least one record long. */
const splits = (count: number, pieces: number): readonly number[] => {
  const sizes: number[] = [];
  let left = count;
  for (let piece = pieces; piece > 1; piece -= 1) {
    const take = Math.max(1, Math.floor(left / piece));
    sizes.push(take);
    left -= take;
  }
  sizes.push(left);
  return sizes;
};

describe('a read split into pieces and joined again', () => {
  it('is the read it was split from, sample for sample', async () => {
    await fc.assert(
      fc.asyncProperty(shape, fc.integer({ min: 2, max: 8 }), async (of, pieces) => {
        const recording = await openEdf(byteSource(build(of)));
        const signalIndices = [...recording.header.dataSignalIndices];
        const total = recording.header.recordCount;
        fc.pre(pieces <= total);

        const whole = await readRecords(recording, {
          records: { start: 0, count: total },
          signalIndices,
        });

        const parts: EdfChunk[] = [];
        let start = 0;
        for (const size of splits(total, pieces)) {
          parts.push(await readRecords(recording, { records: { start, count: size }, signalIndices }));
          start += size;
        }
        const merged = mergeChunks(parts);

        expect(merged.signals).toHaveLength(whole.signals.length);
        for (let at = 0; at < whole.signals.length; at += 1) {
          expect(merged.signals[at]?.signalIndex).toBe(whole.signals[at]?.signalIndex);
          expect([...(merged.signals[at]?.digital ?? [])]).toEqual([
            ...(whole.signals[at]?.digital ?? []),
          ]);
        }
      }),
      { seed: SEED, numRuns: 60 },
    );
  });

  it('is the read it was split from in its bookkeeping too', async () => {
    await fc.assert(
      fc.asyncProperty(shape, fc.integer({ min: 2, max: 8 }), async (of, pieces) => {
        const recording = await openEdf(byteSource(build(of)));
        const signalIndices = [...recording.header.dataSignalIndices];
        const total = recording.header.recordCount;
        fc.pre(pieces <= total);

        const whole = await readRecords(recording, {
          records: { start: 0, count: total },
          signalIndices,
        });

        const parts: EdfChunk[] = [];
        let start = 0;
        for (const size of splits(total, pieces)) {
          parts.push(await readRecords(recording, { records: { start, count: size }, signalIndices }));
          start += size;
        }
        const merged = mergeChunks(parts);

        expect(merged.records).toEqual(whole.records);
        // Summed, not recomputed: the merged chunk accounts for every byte its pieces paid for,
        // and reading in pieces costs the same bytes as reading once.
        expect(merged.byteLength).toBe(whole.byteLength);
        expect(merged.startTicks).toBe(whole.startTicks);
        expect(merged.startSeconds).toBe(whole.startSeconds);
      }),
      { seed: SEED, numRuns: 60 },
    );
  });

  it('is an identity for a single piece, so the common case costs no allocation', async () => {
    await fc.assert(
      fc.asyncProperty(shape, async (of) => {
        const recording = await openEdf(byteSource(build(of)));
        const chunk = await readRecords(recording, {
          records: { start: 0, count: recording.header.recordCount },
          signalIndices: [...recording.header.dataSignalIndices],
        });
        expect(mergeChunks([chunk])).toBe(chunk);
      }),
      { seed: SEED, numRuns: 40 },
    );
  });
});
