/**
 * `sampleAt` and `sampleStartTicksOf` are one axis, seen from both ends.
 *
 * `api-helpers.md` states the rule as an agreement between four things: "`sampleAt`,
 * `sampleStartTicksOf`, a window bound and `readTriggers` all name the same sample." 0.3.32 settled
 * that after `readTriggers` disagreed with the other three, and 0.3.56 moved a window bound onto it
 * after the same mismatch was found there. Both fixes were made against examples.
 *
 * `sample-grid-roundtrip.test.ts` covers the pure pair, `gridSampleStartTicks` and its inverse,
 * which take a SIGNAL and know nothing about gaps. These two take the RECORDING, which is the
 * difference that matters: on a discontinuous file the sample's true instant is not
 * `index * duration / samplesPerRecord`, and inverting it means finding the segment first. That is
 * the pair a viewer uses — a cursor position in and a sample index out — and the round trip was
 * only ever checked at chosen points.
 *
 * The property is that the trip closes for every sample of the file, on geometries where the
 * sample interval is not a whole number of ticks and on a file with a hole in it. Both are the
 * cases where an implementation that reached for `round(t * sampleRateHz)` would drift, and both
 * are ordinary: 256 samples in a one-second record is the commonest EEG geometry there is.
 *
 * The seed is constant, so a failure is reproducible from the terminal output alone.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { sampleAt, sampleStartSecondsOf, sampleStartTicksOf } from '../../src/sample-locate.js';
import { ticksToSeconds } from '../../src/tal/ticks.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const SEED = 0x51ce;

/** Geometries whose sample interval is and is not a whole number of ticks. */
const GEOMETRIES = [
  { recordDurationSeconds: 1, samplesPerRecord: 256 },
  { recordDurationSeconds: 3, samplesPerRecord: 256 },
  { recordDurationSeconds: 0.29, samplesPerRecord: 128 },
  { recordDurationSeconds: 2, samplesPerRecord: 5 },
] as const;

const RECORDS = 6;

async function fileFor(geometry: (typeof GEOMETRIES)[number], gap: boolean): Promise<EdfRecording> {
  const bytes = buildEdf({
    plus: gap ? 'D' : 'C',
    recordCount: RECORDS,
    recordDurationSeconds: geometry.recordDurationSeconds,
    signals: [{ label: 'Fp1', samplesPerRecord: geometry.samplesPerRecord }],
    annotationSignals: [{ samplesPerRecord: 40 }],
    recordOnsetSeconds: (record: number) =>
      gap && record >= 3
        ? record * geometry.recordDurationSeconds + 10
        : record * geometry.recordDurationSeconds,
  });
  const recording = await openEdf(byteSource(bytes));
  return gap ? { ...recording, index: await buildRecordIndex(recording) } : recording;
}

describe('the instant a sample starts, located again', () => {
  it.each(GEOMETRIES)(
    'names the same sample on a contiguous file at $samplesPerRecord per $recordDurationSeconds s',
    async (geometry) => {
      const recording = await fileFor(geometry, false);
      const total = RECORDS * geometry.samplesPerRecord;

      fc.assert(
        fc.property(fc.nat({ max: total - 1 }), (sampleIndex) => {
          const seconds = sampleStartSecondsOf(recording, 0, sampleIndex);
          expect(sampleAt(recording, 0, seconds)?.sampleIndex).toBe(sampleIndex);
        }),
        { seed: SEED, numRuns: 200 },
      );
    },
  );

  it.each(GEOMETRIES)(
    'names the same sample across a gap at $samplesPerRecord per $recordDurationSeconds s',
    async (geometry) => {
      // The half the pure grid pair cannot express: after a hole, a sample's instant is not its
      // index times the interval, and inverting it means finding the segment first.
      const recording = await fileFor(geometry, true);
      const total = RECORDS * geometry.samplesPerRecord;

      fc.assert(
        fc.property(fc.nat({ max: total - 1 }), (sampleIndex) => {
          const seconds = sampleStartSecondsOf(recording, 0, sampleIndex);
          expect(sampleAt(recording, 0, seconds)?.sampleIndex).toBe(sampleIndex);
        }),
        { seed: SEED, numRuns: 200 },
      );
    },
  );

  it('agrees in ticks as well as in seconds, which is the axis to compare on', async () => {
    // A round trip through seconds could pass on rounding luck. The ticks are exact, and they are
    // what every other comparison in the library is made on.
    const recording = await fileFor(GEOMETRIES[2], true);
    const total = RECORDS * GEOMETRIES[2].samplesPerRecord;

    fc.assert(
      fc.property(fc.nat({ max: total - 1 }), (sampleIndex) => {
        const ticks = sampleStartTicksOf(recording, 0, sampleIndex);
        expect(sampleAt(recording, 0, ticksToSeconds(ticks))?.sampleIndex).toBe(sampleIndex);
      }),
      { seed: SEED, numRuns: 300 },
    );
  });
});

describe('the gap the second block relies on', () => {
  it('is really there, so those runs are not the contiguous case again', async () => {
    // Non-vacuity: without a scanned index and a real hole, both blocks would be one test written
    // twice.
    const recording = await fileFor(GEOMETRIES[0], true);
    expect(recording.index.coverage).toBe('complete');
    expect(recording.index.gaps).toHaveLength(1);
    expect(recording.index.gaps?.[0]?.durationSeconds).toBe(10);

    // And a sample after the hole really is ten seconds later than the nominal grid says.
    const afterTheGap = 3 * GEOMETRIES[0].samplesPerRecord;
    expect(sampleStartSecondsOf(recording, 0, afterTheGap)).toBe(13);
  });
});
