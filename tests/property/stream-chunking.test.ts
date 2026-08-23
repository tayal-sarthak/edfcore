/**
 * The chunk size is a memory bound, not an answer.
 *
 * `streamRecords` exists so a caller can walk a twelve-hour recording without holding it, and
 * `chunkRecords` is the only knob: records held at once, defaulting to 256. Everything a caller
 * gets back has to be independent of it. `stream.test.ts` demonstrates that for chosen sizes on
 * one file; the sizes that break this kind of code are the ones nobody chooses — one record at a
 * time, a chunk larger than the file, a chunk that divides the range exactly, a chunk that leaves
 * one record over.
 *
 * The failure is not a crash. A boundary handled one record short returns every sample from the
 * right file in the right order with one missing at each seam, and a caller concatenating the
 * chunks gets an array whose length is plausible and whose timestamps — computed from each chunk's
 * own record range — are all correct. It shows up as a recording that is quietly a few seconds
 * short.
 *
 * `api-helpers.md` states three properties beyond the samples, and each is checked here against
 * every chunk size rather than one: chunks arrive in time order, never span a gap, and carry the
 * same `precededByGap` a `readWindow` chunk does. The gap one is the reason the chunking is not
 * simply "every `n` records" — a run that ends mid-chunk has to end the chunk — so a discontinuous
 * file is generated deliberately, not as an afterthought.
 *
 * The seed is constant, so a failure is reproducible from the terminal output alone.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfChunk, EdfRecording } from '../../src/types.js';
import { minimalEdfPlus } from '../support/writer.js';

const SEED = 0x5f3a;

interface Shape {
  readonly recordCount: number;
  readonly recordDurationSeconds: number;
  readonly gapAfter: number | undefined;
}

const shape = fc.record({
  recordCount: fc.integer({ min: 2, max: 16 }),
  recordDurationSeconds: fc.constantFrom(0.5, 1, 2),
  // `undefined` is a contiguous file; a number puts a three-second hole after that record.
  gapAfter: fc.option(fc.integer({ min: 1, max: 14 }), { nil: undefined }),
});

/**
 * A recording with a COMPLETE index on it.
 *
 * A discontinuous file refuses a time window from a probed index, and rightly — two probes cannot
 * see a gap in the middle, so mapping a window from them would be a guess. `discontinuous.md`
 * tells a caller to scan and read the result back onto the recording, and that is what a caller
 * streaming such a file has to do.
 */
async function open(of: Shape): Promise<EdfRecording> {
  const gapAfter =
    of.gapAfter !== undefined && of.gapAfter < of.recordCount ? of.gapAfter : undefined;
  const recording = await openEdf(
    byteSource(
      minimalEdfPlus({
        plus: gapAfter === undefined ? 'C' : 'D',
        recordCount: of.recordCount,
        recordDurationSeconds: of.recordDurationSeconds,
        signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
        annotationSignals: [{ samplesPerRecord: 30 }],
        recordOnsetSeconds: (at: number) =>
          at * of.recordDurationSeconds + (gapAfter !== undefined && at >= gapAfter ? 3 : 0),
      }),
    ),
  );
  return { ...recording, index: await buildRecordIndex(recording) };
}

const collect = async (
  recording: EdfRecording,
  chunkRecords: number,
): Promise<readonly EdfChunk[]> => {
  const chunks: EdfChunk[] = [];
  for await (const chunk of streamRecords(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 1000,
    chunkRecords,
  })) {
    chunks.push(chunk);
  }
  return chunks;
};

const samplesOf = (chunks: readonly EdfChunk[]): readonly number[] =>
  chunks.flatMap((chunk) => [...(chunk.signals[0]?.digital ?? [])]);

describe('streaming a window', () => {
  it('yields the samples one read of it yields, at any chunk size', async () => {
    await fc.assert(
      fc.asyncProperty(shape, fc.integer({ min: 1, max: 20 }), async (of, chunkRecords) => {
        const recording = await open(of);
        const whole = await readWindow(recording, {
          signalIndices: [0],
          startSeconds: 0,
          durationSeconds: 1000,
        });
        const streamed = await collect(recording, chunkRecords);
        expect(samplesOf(streamed), `chunkRecords ${chunkRecords}`).toEqual(samplesOf(whole));
      }),
      { seed: SEED, numRuns: 90 },
    );
  });

  it('covers every record exactly once, in order', async () => {
    await fc.assert(
      fc.asyncProperty(shape, fc.integer({ min: 1, max: 20 }), async (of, chunkRecords) => {
        const chunks = await collect(await open(of), chunkRecords);
        const covered: number[] = [];
        for (const chunk of chunks) {
          for (let at = 0; at < chunk.records.count; at += 1)
            covered.push(chunk.records.start + at);
        }
        expect(covered).toEqual([...covered].sort((a, b) => a - b));
        expect(new Set(covered).size).toBe(covered.length);
      }),
      { seed: SEED, numRuns: 90 },
    );
  });

  it('never holds more than it was told to', async () => {
    await fc.assert(
      fc.asyncProperty(shape, fc.integer({ min: 1, max: 20 }), async (of, chunkRecords) => {
        for (const chunk of await collect(await open(of), chunkRecords)) {
          expect(chunk.records.count).toBeLessThanOrEqual(chunkRecords);
          // And no empty chunk: a yielded chunk is always something to work on.
          expect(chunk.records.count).toBeGreaterThan(0);
        }
      }),
      { seed: SEED, numRuns: 90 },
    );
  });
});

describe('and the three things the page promises about the chunks', () => {
  it('keeps them in time order', async () => {
    await fc.assert(
      fc.asyncProperty(shape, fc.integer({ min: 1, max: 20 }), async (of, chunkRecords) => {
        const chunks = await collect(await open(of), chunkRecords);
        for (let at = 1; at < chunks.length; at += 1) {
          const previous = chunks[at - 1] as EdfChunk;
          const next = chunks[at] as EdfChunk;
          expect(next.startTicks).toBeGreaterThanOrEqual(previous.startTicks);
        }
      }),
      { seed: SEED, numRuns: 90 },
    );
  });

  it('never lets one span a gap', async () => {
    await fc.assert(
      fc.asyncProperty(shape, fc.integer({ min: 1, max: 20 }), async (of, chunkRecords) => {
        const recording = await open(of);
        const duration = recording.header.recordDurationTicks;
        for (const chunk of await collect(recording, chunkRecords)) {
          // Contiguous within a chunk: its span is exactly its records, with nothing skipped.
          expect(chunk.durationTicks).toBe(BigInt(chunk.records.count) * duration);
        }
      }),
      { seed: SEED, numRuns: 90 },
    );
  });

  it('marks a gap where a single read of the window marks one', async () => {
    await fc.assert(
      fc.asyncProperty(shape, fc.integer({ min: 1, max: 20 }), async (of, chunkRecords) => {
        const recording = await open(of);
        const whole = await readWindow(recording, {
          signalIndices: [0],
          startSeconds: 0,
          durationSeconds: 1000,
        });
        const streamed = await collect(recording, chunkRecords);
        // Every record a single read called gap-preceded is gap-preceded when streamed too,
        // whatever size the chunks happened to be.
        // `precededByGap` carries the gap itself, not a flag: present means there was one.
        const marked = (chunks: readonly EdfChunk[]): readonly number[] =>
          chunks
            .filter((chunk) => chunk.precededByGap !== undefined)
            .map((chunk) => chunk.records.start);
        expect(marked(streamed)).toEqual(marked(whole));
      }),
      { seed: SEED, numRuns: 90 },
    );
  });
});
