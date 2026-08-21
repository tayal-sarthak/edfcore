/**
 * The two ways to read the same records return the same samples.
 *
 * `readWindow` resolves a time window to record ranges and reads them; `readRecords` is handed the
 * record range directly. The page calls the first "a variation on" the second, and every worked
 * example in the documentation uses whichever is more convenient — so a caller who computes a
 * range with `resolveTimeWindow` and reads it with `readRecords` must get exactly what `readWindow`
 * would have given them for the same window.
 *
 * Nothing said so. Each has thorough tests of its own, and they share a decoder, but the layer
 * above the decoder is separate: `readWindow` resolves and splits, `readRecords` validates a range
 * it was given. A divergence there is not a decode bug — the samples would be individually correct
 * and attached to the wrong records — which is the failure mode this package treats as the worst
 * kind, because nothing about the numbers looks wrong.
 *
 * Over arbitrary geometries rather than a fixture, because the interesting cases are the awkward
 * ones: a window shorter than a record, one that starts mid-record, one that runs off the end.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { resolveTimeWindow } from '../../src/time/window.js';
import { buildEdf } from '../support/writer.js';

/** Reproducible, and printed by fast-check on a failure. */
const SEED = 0x2ead5;

const shape = fc.record({
  counts: fc.array(fc.integer({ min: 1, max: 32 }), { minLength: 1, maxLength: 4 }),
  recordCount: fc.integer({ min: 1, max: 24 }),
  recordDurationSeconds: fc.constantFrom(0.5, 1, 2),
});

const build = (of: {
  counts: readonly number[];
  recordCount: number;
  recordDurationSeconds: number;
}) =>
  buildEdf({
    recordCount: of.recordCount,
    recordDurationSeconds: of.recordDurationSeconds,
    signals: of.counts.map((samplesPerRecord, index) => ({
      label: `C${index}`,
      samplesPerRecord,
      // Every sample distinct across the whole file, so a value identifies its own position and a
      // chunk attached to the wrong records cannot pass by coincidence.
      sample: (record: number, at: number) => ((record * 97 + at * 7 + index * 13) % 4001) - 2000,
    })),
  });

describe('a window and the records it resolves to', () => {
  it('return the same samples, signal for signal', async () => {
    await fc.assert(
      fc.asyncProperty(
        shape,
        fc.double({ min: 0, max: 40, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.1, max: 20, noNaN: true, noDefaultInfinity: true }),
        async (of, startSeconds, durationSeconds) => {
          const recording = await openEdf(byteSource(build(of)));
          const signalIndices = [...recording.header.dataSignalIndices];

          const chunks = await readWindow(recording, {
            startSeconds,
            durationSeconds,
            signalIndices,
          });
          const ranges = resolveTimeWindow(
            recording.timeline,
            recording.index,
            startSeconds,
            durationSeconds,
          );

          // The window resolves to exactly the runs the read returned.
          expect(chunks.map((chunk) => chunk.records)).toEqual([...ranges]);

          for (const [at, range] of ranges.entries()) {
            const direct = await readRecords(recording, { records: range, signalIndices });
            const windowed = chunks[at];
            expect(direct.byteLength).toBe(windowed?.byteLength);
            expect(direct.byteOffset).toBe(windowed?.byteOffset);
            expect(direct.startTicks).toBe(windowed?.startTicks);
            direct.signals.forEach((signal, index) => {
              expect(signal.signalIndex).toBe(windowed?.signals[index]?.signalIndex);
              expect([...signal.digital]).toEqual([...(windowed?.signals[index]?.digital ?? [])]);
            });
          }
        },
      ),
      { seed: SEED, numRuns: 120 },
    );
  });

  it('places every sample where the file put it, not merely in the right order', async () => {
    // The failure this rules out: individually correct samples attached to the wrong records. The
    // generator makes each sample a function of its own position, so the value is checkable
    // against where the chunk says it came from.
    await fc.assert(
      fc.asyncProperty(
        shape,
        fc.double({ min: 0, max: 40, noNaN: true, noDefaultInfinity: true }),
        async (of, startSeconds) => {
          const recording = await openEdf(byteSource(build(of)));
          const chunks = await readWindow(recording, {
            startSeconds,
            durationSeconds: 3,
            signalIndices: [...recording.header.dataSignalIndices],
          });
          fc.pre(chunks.length > 0);

          for (const chunk of chunks) {
            chunk.signals.forEach((signal, index) => {
              const perRecord = of.counts[index] ?? 0;
              for (let sample = 0; sample < signal.digital.length; sample += 1) {
                const record = chunk.records.start + Math.floor(sample / perRecord);
                const within = sample % perRecord;
                expect(signal.digital[sample]).toBe(
                  ((record * 97 + within * 7 + index * 13) % 4001) - 2000,
                );
              }
            });
          }
        },
      ),
      { seed: SEED, numRuns: 120 },
    );
  });
});
