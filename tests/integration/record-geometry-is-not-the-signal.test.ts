/**
 * The same recording, cut into records four different ways.
 *
 * "The record is the unit of I/O, never the channel" is a heading in `design-decisions.md` and the
 * premise of `concepts.md`. The corollary is the thing a caller has to believe and nothing checked:
 * the record geometry is a property of how the file was WRITTEN, and it decides the cost and the
 * shape of a read while deciding nothing about the signal.
 *
 * A writer with 128 samples at 16 Hz may store them as 8 records of 16 samples at one second each,
 * or 16 of 8 at half a second, or 2 of 64 at four seconds. Those are four different files: the
 * records are a different size, there are a different number of them, and `recordByteLength` runs
 * from 96 to 208 bytes. They are the same recording.
 *
 * All four are built here and compared. The sample stream over the whole file is identical, and so
 * are `sampleRateHz`, `signal.sampleCount` and `timeline.spanSeconds` — none of which is stored,
 * all of which are derived from the geometry that differs.
 *
 * The part that makes this worth a test rather than a paragraph is the window. Asking for
 * `[1.25, 3.75)` — which lands inside a record in all four — returns four DIFFERENT chunks: record
 * 1 plus 3 in one file, record 0 plus 1 in another, because a read is record-aligned and the
 * records are not the same size. `trimToWindow` then gives the same 40 samples starting at 1.25 s
 * in every one of them. That is the whole architecture in one comparison: the chunk is the I/O and
 * the trim is the answer.
 */

import { describe, expect, it } from 'vitest';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { trimToWindow } from '../../src/time/window.js';
import { buildEdf } from '../support/writer.js';

/** 128 samples at 16 Hz, whatever the record geometry. */
const TOTAL_SAMPLES = 128;
const RATE_HZ = 16;
const SPAN_SECONDS = 8;

/** A ramp over the whole recording, so a sample's value names its position in the stream. */
const wave = (position: number): number => ((position * 13) % 257) - 128;

interface Geometry {
  readonly recordCount: number;
  readonly samplesPerRecord: number;
  readonly recordDurationSeconds: number;
}

const GEOMETRIES: readonly Geometry[] = [
  { recordCount: 8, samplesPerRecord: 16, recordDurationSeconds: 1 },
  { recordCount: 16, samplesPerRecord: 8, recordDurationSeconds: 0.5 },
  { recordCount: 4, samplesPerRecord: 32, recordDurationSeconds: 2 },
  { recordCount: 2, samplesPerRecord: 64, recordDurationSeconds: 4 },
];

function fileFor({ recordCount, samplesPerRecord, recordDurationSeconds }: Geometry): Uint8Array {
  return buildEdf({
    plus: 'C',
    recordCount,
    recordDurationSeconds,
    signals: [
      {
        label: 'Fp1',
        samplesPerRecord,
        sample: (record, index) => wave(record * samplesPerRecord + index),
      },
    ],
    annotationSignals: [{ samplesPerRecord: 40 }],
  });
}

describe('the four files really are four files', () => {
  it('differ in record size, record count and record duration', async () => {
    const seen = new Set<string>();
    for (const geometry of GEOMETRIES) {
      const recording = await openEdf(byteSource(fileFor(geometry)));
      seen.add(
        [
          recording.header.recordByteLength,
          recording.header.recordCount,
          recording.header.recordDurationSeconds,
        ].join('/'),
      );
    }
    expect(seen.size).toBe(GEOMETRIES.length);
  });
});

describe('and are one recording', () => {
  it('carries the same sample stream in all four', async () => {
    const streams = new Set<string>();
    for (const geometry of GEOMETRIES) {
      const recording = await openEdf(byteSource(fileFor(geometry)));
      const chunk = await readRecords(recording, {
        records: { start: 0, count: geometry.recordCount },
        signalIndices: [0],
      });
      const series = chunk.signals[0];
      if (series === undefined) throw new Error('one signal was asked for and none came back');
      expect(series.sampleCount).toBe(TOTAL_SAMPLES);
      streams.add([...series.digital.subarray(0, series.sampleCount)].join(','));
    }
    expect(streams.size).toBe(1);
    // The stream really varies, so four identical constants is not the pass.
    expect(new Set([...(streams.values().next().value ?? '').split(',')]).size).toBeGreaterThan(
      100,
    );
  });

  it('derives the same rate, sample count and span from four different geometries', async () => {
    for (const geometry of GEOMETRIES) {
      const recording = await openEdf(byteSource(fileFor(geometry)));
      const signal = getSignal(recording.header, 'Fp1');
      const where = `${geometry.recordCount}x${geometry.samplesPerRecord}`;
      expect(signal.sampleRateHz, where).toBe(RATE_HZ);
      expect(signal.sampleCount, where).toBe(TOTAL_SAMPLES);
      expect(recording.timeline.spanSeconds, where).toBe(SPAN_SECONDS);
      expect(recording.timeline.coveredSeconds, where).toBe(SPAN_SECONDS);
    }
  });
});

describe('a window that lands inside a record', () => {
  const START = 1.25;
  const DURATION = 2.5;

  it('is answered by four different record ranges, because a read is record-aligned', async () => {
    const extents = new Set<string>();
    for (const geometry of GEOMETRIES) {
      const recording = await openEdf(byteSource(fileFor(geometry)));
      const [chunk] = await readWindow(recording, {
        startSeconds: START,
        durationSeconds: DURATION,
        signalIndices: [0],
      });
      expect(chunk).toBeDefined();
      extents.add(`${chunk?.records.start}+${chunk?.records.count}@${chunk?.startSeconds}`);
    }
    expect(extents.size).toBe(GEOMETRIES.length);
  });

  it('and trims to the same samples in every one of them', async () => {
    const trimmed = new Set<string>();
    for (const geometry of GEOMETRIES) {
      const recording = await openEdf(byteSource(fileFor(geometry)));
      const [chunk] = await readWindow(recording, {
        startSeconds: START,
        durationSeconds: DURATION,
        signalIndices: [0],
      });
      const series = chunk?.signals[0];
      if (series === undefined) throw new Error('the window returned no signal');
      const exact = trimToWindow(recording.header, series, START, DURATION);
      trimmed.add(
        `${exact.sampleCount}@${exact.startSeconds}:${[...exact.digital.subarray(0, exact.sampleCount)].join(',')}`,
      );
    }
    expect(trimmed.size).toBe(1);
    // 2.5 s at 16 Hz, starting at the first sample at or after 1.25 s.
    expect([...trimmed][0]).toMatch(/^40@1\.25:/);
  });
});
