/**
 * `readWindow` and `readRecords` are one read, reached two ways.
 *
 * They are the two selections the API offers — name a time, or name records — and on a contiguous
 * file a window that lands on record boundaries selects exactly the records a caller would have
 * named. So the two calls must produce the same bytes, the same sample counts, the same start and
 * the same `byteOffset`. Nothing compared them.
 *
 * That is the failure mode this project has hit repeatedly and describes in `whole-api.test.ts`:
 * "a function can be individually correct and still disagree with its neighbour — six releases of
 * this project were exactly that". Each call has its own tests; the pair had none.
 *
 * The window is derived from the records rather than typed, over arbitrary starts and counts and
 * three geometries, two with a record duration that is not a whole number of seconds. `readWindow`
 * resolves through `resolveTimeWindow` and `readRecords` does not, so the two arrive at the same
 * range by different arithmetic — which is the only reason the comparison is worth making.
 *
 * The seed is constant, so a failure is reproducible from the terminal output alone.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const SEED = 0x77ab;

const GEOMETRIES = [
  { recordDurationSeconds: 1, samplesPerRecord: 32 },
  { recordDurationSeconds: 0.25, samplesPerRecord: 8 },
  { recordDurationSeconds: 2.5, samplesPerRecord: 10 },
] as const;

const RECORDS = 12;

async function fileFor(geometry: (typeof GEOMETRIES)[number]): Promise<EdfRecording> {
  return openEdf(
    byteSource(
      buildEdf({
        recordCount: RECORDS,
        recordDurationSeconds: geometry.recordDurationSeconds,
        signals: [
          { label: 'Fp1', samplesPerRecord: geometry.samplesPerRecord },
          { label: 'Fp2', samplesPerRecord: geometry.samplesPerRecord * 2 },
        ],
      }),
    ),
  );
}

describe('a window on the record grid', () => {
  it.each(GEOMETRIES)(
    'reads what naming the records reads, at $recordDurationSeconds s a record',
    async (geometry) => {
      const recording = await fileFor(geometry);
      const duration = recording.header.recordDurationSeconds;

      await fc.assert(
        fc.asyncProperty(
          fc.nat({ max: RECORDS - 1 }),
          fc.integer({ min: 1, max: RECORDS }),
          async (start, size) => {
            const count = Math.min(size, RECORDS - start);
            const signalIndices = [0, 1];

            const byRecords = await readRecords(recording, {
              records: { start, count },
              signalIndices,
            });
            const chunks = await readWindow(recording, {
              startSeconds: start * duration,
              durationSeconds: count * duration,
              signalIndices,
            });

            // One contiguous run, because the file is contiguous.
            expect(chunks).toHaveLength(1);
            const byWindow = chunks[0];
            if (byWindow === undefined) throw new Error('no chunk');

            expect(byWindow.records).toEqual(byRecords.records);
            expect(byWindow.byteOffset).toBe(byRecords.byteOffset);
            expect(byWindow.byteLength).toBe(byRecords.byteLength);
            expect(byWindow.startTicks).toBe(byRecords.startTicks);
            expect(byWindow.signals.map((one) => one.sampleCount)).toEqual(
              byRecords.signals.map((one) => one.sampleCount),
            );
            for (const [index, series] of byWindow.signals.entries()) {
              expect(Array.from(series.digital)).toEqual(
                Array.from(byRecords.signals[index]?.digital ?? []),
              );
            }
          },
        ),
        { seed: SEED, numRuns: 40 },
      );
    },
  );

  it('is not the same call twice, which is what makes the agreement worth checking', async () => {
    // `readWindow` resolves a time to a range and returns an ARRAY; `readRecords` takes the range
    // and returns one chunk. Without this the property above could be comparing an alias.
    const recording = await fileFor(GEOMETRIES[0]);
    const chunks = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: 1,
      signalIndices: [0],
    });
    expect(Array.isArray(chunks)).toBe(true);

    const one = await readRecords(recording, {
      records: { start: 0, count: 1 },
      signalIndices: [0],
    });
    expect(Array.isArray(one)).toBe(false);
    expect(one.records).toEqual({ start: 0, count: 1 });
  });

  it('disagrees the moment the window is not record-aligned, as it must', async () => {
    // The agreement is about aligned windows. Half a record in, `readWindow` still returns the
    // whole record — a record is the unit the file can be read by — so the two calls name the same
    // records while the window does not.
    const recording = await fileFor(GEOMETRIES[0]);
    const chunks = await readWindow(recording, {
      startSeconds: 0.5,
      durationSeconds: 1,
      signalIndices: [0],
    });
    expect(chunks[0]?.records).toEqual({ start: 0, count: 2 });
  });
});
