/**
 * `time/window.ts` — seconds to records (`resolveTimeWindow`), and records to samples
 * (`trimToWindow`).
 *
 * Two design promises are pinned here.
 *
 * `resolveTimeWindow` is PURE, so the cost of a window is auditable before a byte is read. The
 * fake index below throws from `onsetTicks()` and `locate()`: if resolving a window ever needed
 * I/O, these tests would fail rather than quietly get slower. The ranges it returns are
 * RECORD-ALIGNED and therefore usually WIDER than the window asked for — a record is the
 * smallest unit the file can be read by — and there is one range per contiguous run, which is
 * why `readWindow` always returns an ARRAY of chunks. That shape is structural (DESIGN "Gap
 * policy"): if a single-chunk shape existed for continuous files, consumers would write against
 * it and misbehave on EDF+D.
 *
 * `trimToWindow` is the calculation the library exists to get right. The sample boundary is
 * decided by integer bigint arithmetic on `(record, sampleWithinRecord)` — `round(t *
 * sampleRateHz)` appears nowhere — and the tests below construct cases where the two DISAGREE
 * and assert edfcore picks the integer-exact answer.
 */

import { describe, expect, it } from 'vitest';
import { EdfChannelNotFoundError } from '../../../src/errors.js';
import { parseHeader } from '../../../src/header/parse.js';
import { byteSource } from '../../../src/io/bytes.js';
import { buildRecordIndex } from '../../../src/record-index.js';
import { openEdf, readRecords, readWindow } from '../../../src/recording.js';
import { resolveTimeWindow, trimToWindow } from '../../../src/time/window.js';
import type {
  EdfChunkSignal,
  EdfHeader,
  EdfRecordIndex,
  EdfSegment,
  EdfTimeline,
  RecordRange,
} from '../../../src/types.js';
import { buildEdf, minimalEdf } from '../../support/writer.js';

/** 100 ns ticks per second, spelled out so the tests do not import the constant they pin. */
const SECOND = 10_000_000n;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function headerOf(bytes: Uint8Array): EdfHeader {
  return parseHeader(bytes, bytes.length);
}

function timelineOf(options: {
  recordCount: number;
  recordDurationSeconds: number;
  spanSeconds?: number;
}): EdfTimeline {
  const covered = options.recordCount * options.recordDurationSeconds;
  const span = options.spanSeconds ?? covered;
  // The ticks are what `resolveTimeWindow` compares; the seconds are carried alongside so the
  // fixture stays readable. Built from the same two numbers, so a fixture cannot make the two
  // pairs disagree with each other by accident.
  const toTicks = (seconds: number): bigint => BigInt(Math.round(seconds * Number(SECOND)));
  return {
    recordCount: options.recordCount,
    recordDurationSeconds: options.recordDurationSeconds,
    startOffsetSeconds: 0,
    startOffsetTicks: 0n,
    spanSeconds: span,
    spanTicks: toTicks(span),
    coveredSeconds: covered,
    coveredTicks: toTicks(covered),
    diagnostics: [],
  };
}

/**
 * An index that answers no question requiring I/O. `resolveTimeWindow` is documented as pure, so
 * reaching for an onset here is a test failure, not a slow path.
 */
function indexOf(
  recordCount: number,
  segments?: readonly EdfSegment[],
  gaps?: readonly EdfGapShape[],
): EdfRecordIndex {
  return {
    coverage: segments === undefined ? 'probed' : 'complete',
    recordCount,
    segments,
    gaps,
    onsetTicks(): Promise<bigint> {
      throw new Error('resolveTimeWindow() must not read record onsets');
    },
    locate(): Promise<undefined> {
      throw new Error('resolveTimeWindow() must not locate');
    },
  };
}

type EdfGapShape = NonNullable<EdfRecordIndex['gaps']>[number];

function segmentOf(
  index: number,
  records: RecordRange,
  startTicks: bigint,
  recordDurationTicks: bigint,
): EdfSegment {
  const durationTicks = BigInt(records.count) * recordDurationTicks;
  return {
    index,
    records,
    startSeconds: Number(startTicks) / 1e7,
    startTicks,
    durationSeconds: Number(durationTicks) / 1e7,
    endSeconds: Number(startTicks + durationTicks) / 1e7,
  };
}

function chunkSignalOf(options: {
  signalIndex?: number;
  sampleCount: number;
  firstSampleIndex?: number;
  startSeconds: number;
  outOfDigitalRangeCount?: number;
  digital?: Int32Array;
}): EdfChunkSignal {
  const digital = options.digital ?? Int32Array.from({ length: options.sampleCount }, (_, i) => i);
  return {
    signalIndex: options.signalIndex ?? 0,
    sampleCount: options.sampleCount,
    digital,
    firstSampleIndex: options.firstSampleIndex ?? 0,
    startSeconds: options.startSeconds,
    outOfDigitalRangeCount: options.outOfDigitalRangeCount ?? 0,
  };
}

/** What a consumer would write without this library. Kept here to be contradicted. */
function naiveFirstSample(startSeconds: number, sampleRateHz: number): number {
  return Math.round(startSeconds * sampleRateHz);
}

// ---------------------------------------------------------------------------
// resolveTimeWindow
// ---------------------------------------------------------------------------

describe('resolveTimeWindow on a contiguous file', () => {
  const timeline = timelineOf({ recordCount: 10, recordDurationSeconds: 1 });
  const index = indexOf(10);

  const cases: ReadonlyArray<{
    name: string;
    startSeconds: number;
    durationSeconds: number;
    expected: readonly RecordRange[];
  }> = [
    {
      name: 'widens a window that starts inside a record to the whole record',
      startSeconds: 2.5,
      durationSeconds: 1,
      expected: [{ start: 2, count: 2 }], // [2, 4) s covers the requested [2.5, 3.5).
    },
    {
      name: 'returns exactly the records a record-aligned window needs, and no more',
      startSeconds: 2,
      durationSeconds: 2,
      expected: [{ start: 2, count: 2 }],
    },
    {
      name: 'treats the window as half-open, so a bound on a record edge adds no record',
      startSeconds: 0,
      durationSeconds: 3,
      expected: [{ start: 0, count: 3 }],
    },
    {
      name: 'clamps a window that starts before the recording',
      startSeconds: -5,
      durationSeconds: 6,
      expected: [{ start: 0, count: 1 }],
    },
    {
      name: 'clamps a window that runs past the end of the recording',
      startSeconds: 9.5,
      durationSeconds: 5,
      expected: [{ start: 9, count: 1 }],
    },
    {
      name: 'returns nothing for a window entirely after the recording',
      startSeconds: 10,
      durationSeconds: 1,
      expected: [],
    },
    {
      name: 'returns nothing for a window entirely before the recording',
      startSeconds: -5,
      durationSeconds: 5,
      expected: [],
    },
    {
      name: 'returns nothing for a zero-length window, which contains no time',
      startSeconds: 3,
      durationSeconds: 0,
      expected: [],
    },
    {
      name: 'returns nothing for a negative duration rather than reversing it',
      startSeconds: 3,
      durationSeconds: -2,
      expected: [],
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(
        resolveTimeWindow(timeline, index, testCase.startSeconds, testCase.durationSeconds),
      ).toEqual(testCase.expected);
    });
  }

  it('handles a fractional record duration without drifting', () => {
    // 0.4 s records: the window [1.0, 1.5) lives inside records 2 and 3, which span [0.8, 1.6).
    const fractional = timelineOf({ recordCount: 10, recordDurationSeconds: 0.4 });

    expect(resolveTimeWindow(fractional, indexOf(10), 1, 0.5)).toEqual([{ start: 2, count: 2 }]);
  });

  it('returns nothing when the file has no records', () => {
    expect(
      resolveTimeWindow(
        timelineOf({ recordCount: 0, recordDurationSeconds: 1 }),
        indexOf(0),
        0,
        10,
      ),
    ).toEqual([]);
  });

  it('puts every zero-duration record at one instant', () => {
    // recordDuration = 0 is legal; the records occupy the single instant t = 0.
    const zero = timelineOf({ recordCount: 3, recordDurationSeconds: 0 });

    expect(resolveTimeWindow(zero, indexOf(3), 0, 1)).toEqual([{ start: 0, count: 3 }]);
    expect(resolveTimeWindow(zero, indexOf(3), 1, 1)).toEqual([]);
  });
});

describe('resolveTimeWindow across a gap', () => {
  // A complete index: records 0-3 at [0, 4) s, then a gap, then records 4-7 at [100, 104) s.
  const segments = [
    segmentOf(0, { start: 0, count: 4 }, 0n, SECOND),
    segmentOf(1, { start: 4, count: 4 }, 100n * SECOND, SECOND),
  ];
  const gaps: EdfGapShape[] = [
    {
      beforeSegmentIndex: 0,
      afterSegmentIndex: 1,
      startSeconds: 4,
      endSeconds: 100,
      durationSeconds: 96,
    },
  ];
  const timeline = timelineOf({ recordCount: 8, recordDurationSeconds: 1, spanSeconds: 104 });
  const index = indexOf(8, segments, gaps);

  it('returns an EMPTY ARRAY for a window entirely inside the gap', () => {
    // Not a zero-filled chunk, and not a throw. There is no data there, and edfcore never
    // invents any: `readWindow` returns [] for exactly this window.
    expect(resolveTimeWindow(timeline, index, 50, 10)).toEqual([]);
  });

  it('returns one range per contiguous run for a window spanning the gap', () => {
    // [3, 103) s touches the tail of segment 0 and the head of segment 1. Two ranges, never one
    // range covering the gap records that do not exist.
    expect(resolveTimeWindow(timeline, index, 3, 100)).toEqual([
      { start: 3, count: 1 },
      { start: 4, count: 3 },
    ]);
  });

  it('returns a single range when the window falls inside one segment', () => {
    expect(resolveTimeWindow(timeline, index, 101, 1)).toEqual([{ start: 5, count: 1 }]);
  });

  it('refuses to guess on a discontinuous file whose index is only probed', () => {
    // span != covered says there is at least one gap, and a probed index knows where neither the
    // gap nor the records after it start. A RangeError, not an EdfError: the file is fine.
    const probed = indexOf(8);

    expect(() => resolveTimeWindow(timeline, probed, 3, 100)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// trimToWindow — the exact-arithmetic headline
// ---------------------------------------------------------------------------

describe('trimToWindow uses exact integer arithmetic, not round(t * sampleRateHz)', () => {
  // 3 samples per 1 s record: the rate is 3 Hz and a sample is 1/3 s, which no float represents.
  const header = headerOf(
    buildEdf({
      signals: [{ label: 'Fp1', samplesPerRecord: 3 }],
      recordCount: 3,
      recordDurationSeconds: 1,
    }),
  );
  const wholeChunk = chunkSignalOf({ sampleCount: 9, startSeconds: 0 });

  it('picks the first sample AT OR AFTER the window start, where rounding picks one before', () => {
    // Samples sit at 0, 1/3, 2/3, 1, ... The window [0.4, 0.8) contains only sample 2 (0.667 s).
    // round(0.4 * 3) = 1, which is 0.333 s — a sample OUTSIDE the window the caller asked for.
    const trimmed = trimToWindow(header, wholeChunk, 0.4, 0.4);

    expect(naiveFirstSample(0.4, 3)).toBe(1);
    expect(trimmed.firstSampleIndex).toBe(2);
    expect(trimmed.firstSampleIndex).not.toBe(naiveFirstSample(0.4, 3));
    expect(trimmed.sampleCount).toBe(1);
    expect(Array.from(trimmed.digital)).toEqual([2]);
    expect(trimmed.startSeconds).toBeCloseTo(2 / 3, 9);
  });

  it('excludes a sample landing exactly on the window end, and includes one on the start', () => {
    // Half-open [start, start + duration): sample 3 sits at exactly 1.0 s.
    expect(trimToWindow(header, wholeChunk, 0.4, 0.6).sampleCount).toBe(1); // [0.4, 1.0)
    expect(Array.from(trimToWindow(header, wholeChunk, 1, 1).digital)).toEqual([3, 4, 5]);
  });

  it('is exact where the sample rate itself is not representable (256 samples / 3 s)', () => {
    // 256/3 Hz is a real recording geometry and is the example the module's own comment names.
    const rateHeader = headerOf(
      buildEdf({
        signals: [{ label: 'Fp1', samplesPerRecord: 256 }],
        recordCount: 2,
        recordDurationSeconds: 3,
      }),
    );
    const chunk = chunkSignalOf({ sampleCount: 512, startSeconds: 0 });

    const trimmed = trimToWindow(rateHeader, chunk, 1, 1);

    // Sample 85 is at 85*3/256 = 0.99609 s — before the window. Sample 86 is the first inside.
    expect(naiveFirstSample(1, 256 / 3)).toBe(85);
    expect(trimmed.firstSampleIndex).toBe(86);
    expect(trimmed.sampleCount).toBe(85); // samples 86..170 inclusive
    expect(trimmed.startSeconds).toBe(1.0078125); // 86 * 3/256, exactly
  });

  it('keeps the per-signal grid when the chunk does not start at record 0', () => {
    const rateHeader = headerOf(
      buildEdf({
        signals: [{ label: 'Fp1', samplesPerRecord: 256 }],
        recordCount: 3,
        recordDurationSeconds: 3,
      }),
    );
    // Record 1 alone: 256 samples, starting at 3 s and at sample 256 of the signal's own grid.
    const chunk = chunkSignalOf({ sampleCount: 256, firstSampleIndex: 256, startSeconds: 3 });

    const trimmed = trimToWindow(rateHeader, chunk, 4, 1);

    expect(trimmed.firstSampleIndex).toBe(256 + 86);
    expect(trimmed.sampleCount).toBe(85);
    expect(trimmed.startSeconds).toBe(4.0078125);
  });
});

describe('trimToWindow returns a view, corrected and clamped', () => {
  const header = headerOf(
    buildEdf({
      signals: [{ label: 'Fp1', samplesPerRecord: 3 }],
      recordCount: 3,
      recordDurationSeconds: 1,
    }),
  );

  it('returns a SUBARRAY of the input, allocating nothing', () => {
    const chunk = chunkSignalOf({ sampleCount: 9, startSeconds: 0 });

    const trimmed = trimToWindow(header, chunk, 1, 1);

    expect(trimmed.digital.buffer).toBe(chunk.digital.buffer);
    expect(trimmed.digital.byteOffset).toBe(chunk.digital.byteOffset + 3 * 4);
    expect(trimmed.digital).toHaveLength(3);
    // Sharing memory is the point: the view is the same storage, not a copy of it.
    trimmed.digital[0] = -7;
    expect(chunk.digital[3]).toBe(-7);
  });

  it('corrects firstSampleIndex, startSeconds and sampleCount together', () => {
    // Records 1-2 of the file: 6 samples starting at 1 s and at sample 3 of the signal's grid.
    const chunk = chunkSignalOf({ sampleCount: 6, firstSampleIndex: 3, startSeconds: 1 });

    const trimmed = trimToWindow(header, chunk, 2, 1);

    expect(trimmed.firstSampleIndex).toBe(6);
    expect(trimmed.startSeconds).toBe(2);
    expect(trimmed.sampleCount).toBe(3);
    expect(trimmed.sampleCount).toBe(trimmed.digital.length);
    expect(trimmed.signalIndex).toBe(chunk.signalIndex);
  });

  it('clamps rather than throwing when the window only partly overlaps the chunk', () => {
    const chunk = chunkSignalOf({ sampleCount: 9, startSeconds: 0 });

    const overhangingStart = trimToWindow(header, chunk, -1, 2); // [-1, 1)
    expect(overhangingStart.firstSampleIndex).toBe(0);
    expect(Array.from(overhangingStart.digital)).toEqual([0, 1, 2]);

    const overhangingEnd = trimToWindow(header, chunk, 2, 60); // runs past the chunk
    expect(overhangingEnd.firstSampleIndex).toBe(6);
    expect(Array.from(overhangingEnd.digital)).toEqual([6, 7, 8]);
  });

  it('yields an empty result, not an error, when the window misses the chunk entirely', () => {
    const chunk = chunkSignalOf({ sampleCount: 3, firstSampleIndex: 3, startSeconds: 1 });

    const after = trimToWindow(header, chunk, 5, 1);
    expect(after.sampleCount).toBe(0);
    expect(after.digital).toHaveLength(0);

    const before = trimToWindow(header, chunk, 0, 0.5);
    expect(before.sampleCount).toBe(0);
    expect(before.digital).toHaveLength(0);
  });

  it('keeps every sample when the window covers the whole chunk', () => {
    const chunk = chunkSignalOf({ sampleCount: 9, startSeconds: 0 });

    const trimmed = trimToWindow(header, chunk, 0, 3);

    expect(trimmed.sampleCount).toBe(9);
    expect(trimmed.firstSampleIndex).toBe(0);
    expect(trimmed.startSeconds).toBe(0);
  });

  it('re-counts out-of-range samples only when narrowing can have dropped one', () => {
    // 40000 is outside the declared 16-bit digital range and is trimmed away here.
    const digital = Int32Array.from([40000, 1, 2, 3, 4, 5, 6, 7, 8]);
    const chunk = chunkSignalOf({
      sampleCount: 9,
      startSeconds: 0,
      digital,
      outOfDigitalRangeCount: 1,
    });

    expect(trimToWindow(header, chunk, 1, 1).outOfDigitalRangeCount).toBe(0);
    expect(trimToWindow(header, chunk, 0, 3).outOfDigitalRangeCount).toBe(1);
  });

  it('holds every sample at the chunk start when the record duration is zero', () => {
    // recordDuration = 0 is legal, and no sample advances in time, so the chunk is wholly
    // inside the window or wholly outside it.
    const zeroHeader = headerOf(
      buildEdf({
        signals: [{ label: 'Fp1', samplesPerRecord: 3 }],
        recordCount: 2,
        recordDurationSeconds: 0,
      }),
    );
    const chunk = chunkSignalOf({ sampleCount: 6, startSeconds: 0 });

    expect(trimToWindow(zeroHeader, chunk, 0, 1).sampleCount).toBe(6);
    expect(trimToWindow(zeroHeader, chunk, 1, 1).sampleCount).toBe(0);
  });

  it('refuses a chunk signal the header does not describe', () => {
    const chunk = chunkSignalOf({ signalIndex: 9, sampleCount: 3, startSeconds: 0 });

    expect(() => trimToWindow(header, chunk, 0, 1)).toThrow(EdfChannelNotFoundError);
  });
});

describe('trimToWindow is per-signal, because samplesPerRecord differs', () => {
  // Two signals on the same records: 3 samples/record and 8 samples/record.
  const header = headerOf(
    buildEdf({
      signals: [
        { label: 'Slow', samplesPerRecord: 3 },
        { label: 'Fast', samplesPerRecord: 8 },
      ],
      recordCount: 2,
      recordDurationSeconds: 1,
    }),
  );

  it('gives each signal the count its own grid implies for the SAME window', () => {
    const slow = chunkSignalOf({ signalIndex: 0, sampleCount: 6, startSeconds: 0 });
    const fast = chunkSignalOf({ signalIndex: 1, sampleCount: 16, startSeconds: 0 });

    const trimmedSlow = trimToWindow(header, slow, 0.4, 0.5); // [0.4, 0.9)
    const trimmedFast = trimToWindow(header, fast, 0.4, 0.5);

    // Slow: samples at 0, 1/3, 2/3, 1 — only sample 2 (0.667 s) is inside.
    expect(trimmedSlow.firstSampleIndex).toBe(2);
    expect(trimmedSlow.sampleCount).toBe(1);
    // Fast: samples every 0.125 s — samples 4..7 (0.5, 0.625, 0.75, 0.875 s) are inside.
    expect(trimmedFast.firstSampleIndex).toBe(4);
    expect(trimmedFast.sampleCount).toBe(4);

    expect(trimmedSlow.sampleCount).not.toBe(trimmedFast.sampleCount);
    // And both differ from what rounding through the derived rate would have picked.
    expect(naiveFirstSample(0.4, 3)).toBe(1);
    expect(naiveFirstSample(0.4, 8)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Composition with the chunks readWindow actually produces
// ---------------------------------------------------------------------------

describe('the window functions against real chunks', () => {
  it('trims a chunk read from a file, on the chunk shape readRecords returns', async () => {
    const bytes = minimalEdf({
      signals: [{ label: 'Fp1', samplesPerRecord: 3, sample: (r, i) => r * 3 + i }],
      recordCount: 3,
      recordDurationSeconds: 1,
    });
    const recording = await openEdf(byteSource(bytes));

    const chunk = await readRecords(recording, {
      records: { start: 0, count: 3 },
      signalIndices: [0],
    });
    const chunkSignal = chunk.signals[0];
    if (chunkSignal === undefined) throw new Error('expected one chunk signal');

    expect(chunkSignal.sampleCount).toBe(9);
    const trimmed = trimToWindow(recording.header, chunkSignal, 0.4, 0.4);

    expect(trimmed.firstSampleIndex).toBe(2);
    expect(Array.from(trimmed.digital)).toEqual([2]);
  });

  it('returns [] for a window inside a gap and one chunk per run across it', async () => {
    // An EDF+D file: records 0-1 at [0, 2) s, records 2-3 at [100, 102) s.
    const bytes = buildEdf({
      plus: 'D',
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
      annotationSignals: [{ samplesPerRecord: 30 }],
      recordCount: 4,
      recordDurationSeconds: 1,
      recordOnsetSeconds: (r) => (r < 2 ? r : r + 98),
    });
    const opened = await openEdf(byteSource(bytes));
    const index = await buildRecordIndex(opened);
    const recording = { ...opened, index };

    expect(index.segments?.map((segment) => segment.records)).toEqual([
      { start: 0, count: 2 },
      { start: 2, count: 2 },
    ]);

    // Inside the gap: an empty array, never a zero-filled chunk.
    await expect(
      readWindow(recording, { startSeconds: 50, durationSeconds: 10, signalIndices: [0] }),
    ).resolves.toEqual([]);

    // Spanning the gap: one chunk per contiguous run. `readWindow` always returns an array, so
    // this code path is the same one a continuous file takes.
    const chunks = await readWindow(recording, {
      startSeconds: 1.5,
      durationSeconds: 99,
      signalIndices: [0],
    });

    expect(chunks.map((chunk) => chunk.records)).toEqual([
      { start: 1, count: 1 },
      { start: 2, count: 1 },
    ]);
    expect(chunks[1]?.startSeconds).toBe(100);
    expect(chunks[1]?.precededByGap?.durationSeconds).toBe(98);
  });
});
