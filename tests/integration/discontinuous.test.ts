/**
 * EDF+D, done honestly.
 *
 * The fixture is MSLT-shaped: five short nap opportunities, each an hour apart, in one file.
 * That is the layout every clinical sleep lab produces and the one every other JS EDF reader
 * silently flattens — they map seconds to records as `floor(t / recordDuration)`, which is only
 * true for a contiguous recording, and on this file it returns samples from the wrong nap with
 * no error and no warning.
 *
 * edfcore's answer is structural rather than behavioural (DESIGN "Segments before indexing"):
 *
 * - `openEdf` never scans, so `index.coverage` is `'probed'` and `index.segments` / `index.gaps`
 *   are `undefined`. NOTHING on the recording reads as "continuous" before it has been checked —
 *   a `null` timeline would be worse than a throw, because `?.length > 1` reads as "no gaps".
 * - A probed index REFUSES to map seconds to records rather than guessing, and the refusal names
 *   `buildRecordIndex()` as the fix.
 * - After `buildRecordIndex()` the segments and gaps materialise, a window inside a gap returns
 *   `[]`, and a window spanning a gap returns one chunk per contiguous run with `precededByGap`
 *   set on the later ones. Nothing is ever gap-filled.
 */

import { describe, expect, it } from 'vitest';
import {
  buildRecordIndex,
  byteSource,
  type EdfRecording,
  isEdfError,
  openEdf,
  readRecords,
  readWindow,
} from '../../src/index.js';
import { buildEdf } from '../support/writer.js';

const SEGMENT_COUNT = 5;
const RECORDS_PER_SEGMENT = 4;
/** One hour between nap opportunities: the gaps dwarf the data, as they do in a real MSLT. */
const SEGMENT_INTERVAL_SECONDS = 3600;
const RECORD_DURATION_SECONDS = 1;
const RECORD_COUNT = SEGMENT_COUNT * RECORDS_PER_SEGMENT;
const SAMPLES_PER_RECORD = 8;

/** 100 ns ticks per second, spelled out so this file does not import the constant it uses. */
const TICKS_PER_SECOND = 10_000_000n;

function segmentStartSeconds(segmentIndex: number): number {
  return segmentIndex * SEGMENT_INTERVAL_SECONDS;
}

/** Record r's true start: contiguous inside a nap, an hour away from the next one. */
function recordOnsetSeconds(recordIndex: number): number {
  const segment = Math.floor(recordIndex / RECORDS_PER_SEGMENT);
  const within = recordIndex % RECORDS_PER_SEGMENT;
  return segmentStartSeconds(segment) + within * RECORD_DURATION_SECONDS;
}

const MSLT_BYTES = buildEdf({
  plus: 'D',
  recordCount: RECORD_COUNT,
  recordDurationSeconds: RECORD_DURATION_SECONDS,
  signals: [
    {
      label: 'EEG C3-A2',
      samplesPerRecord: SAMPLES_PER_RECORD,
      sample: (recordIndex, sampleIndex) => recordIndex * 100 + sampleIndex,
    },
  ],
  annotationSignals: [{ samplesPerRecord: 30 }],
  recordOnsetSeconds,
});

function defined<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}

async function openMslt(): Promise<EdfRecording> {
  return openEdf(byteSource(MSLT_BYTES));
}

async function indexedMslt(): Promise<EdfRecording> {
  const recording = await openMslt();
  const index = await buildRecordIndex(recording);
  // `EdfRecording` is a plain struct, so a completed index is adopted by rebuilding one.
  return { ...recording, index };
}

// ---------------------------------------------------------------------------
// What `openEdf` knows, and what it refuses to claim
// ---------------------------------------------------------------------------

describe('opening an EDF+D file', () => {
  it('reads the variant and the discontinuity marker without scanning', async () => {
    const { header, timeline } = await openMslt();

    expect(header.variant).toBe('EDF+D');
    expect(header.continuity).toBe('discontinuous');
    expect(header.recordCount).toBe(RECORD_COUNT);
    expect(header.annotationSignalIndices).toEqual([1]);

    // Two probes, record 0 and the last record: span is last-end minus first-start, coverage is
    // the sum of the record durations, and they are computed independently so that their being
    // DIFFERENT is a real statement about the file (DESIGN "Contiguity checking").
    expect(timeline.recordCount).toBe(RECORD_COUNT);
    expect(timeline.startOffsetSeconds).toBe(0);
    expect(timeline.coveredSeconds).toBe(RECORD_COUNT * RECORD_DURATION_SECONDS);
    expect(timeline.spanSeconds).toBe(
      recordOnsetSeconds(RECORD_COUNT - 1) + RECORD_DURATION_SECONDS,
    );
    expect(timeline.spanSeconds).not.toBe(timeline.coveredSeconds);

    // A conformant EDF+D is not a defect: spreading records out is exactly what the marker is
    // for, so the two probes produce no diagnostic at all.
    expect(timeline.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'DISCONTINUITY_IN_CONTINUOUS_FILE',
    );
    expect(timeline.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'RECORD_ONSET_SPACING_VIOLATION',
    );
  });

  it('never lets an unchecked recording read as continuous', async () => {
    const recording = await openMslt();

    expect(recording.index.coverage).toBe('probed');
    // Present as keys, undefined as values: "nobody has looked", not "there are none".
    expect('segments' in recording.index).toBe(true);
    expect('gaps' in recording.index).toBe(true);
    expect(recording.index.segments).toBeUndefined();
    expect(recording.index.gaps).toBeUndefined();

    // And there is no `recording.segments` / `recording.gaps` at all, because a null timeline on
    // the recording is the silent-continuity trap this design refuses (DESIGN "Segments before
    // indexing").
    expect('segments' in recording).toBe(false);
    expect('gaps' in recording).toBe(false);
    expect('continuous' in recording).toBe(false);
    expect('continuous' in recording.index).toBe(false);
    expect('continuous' in recording.timeline).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The refusal
// ---------------------------------------------------------------------------

describe('a probed index asked to map seconds to records', () => {
  it('refuses rather than guessing, and names buildRecordIndex as the fix', async () => {
    const recording = await openMslt();

    // Guessing here is precisely what produces a silently wrong timeline in every other JS EDF
    // library: `floor(t / recordDuration)` is only correct for a contiguous file, and on this
    // one it hands back samples from a different nap with no error and no warning. The records
    // a window maps to depend on onsets nobody has read, so edfcore will not invent them.
    const attempt = readWindow(recording, {
      startSeconds: 0,
      durationSeconds: 10,
      signalIndices: [0],
    });

    await expect(attempt).rejects.toBeInstanceOf(RangeError);
    await expect(attempt).rejects.toThrow(/buildRecordIndex/);
    // Not an EdfError: the file is fine, the call was made against an index that has not been
    // built yet.
    await attempt.then(
      () => {
        throw new Error('readWindow must not resolve on a probed discontinuous index');
      },
      (error: unknown) => {
        expect(isEdfError(error)).toBe(false);
        expect(String((error as Error).message)).toContain('gap');
      },
    );
  });

  it('still reads records the caller named, because those cannot surprise anyone', async () => {
    const recording = await openMslt();

    // Records 3 and 4 straddle the first gap. The caller asked for them by index, so the chunk
    // is returned — and its durationSeconds is the SPAN it covers, not the time it holds.
    const chunk = await readRecords(recording, {
      records: { start: 3, count: 2 },
      signalIndices: [0],
    });

    expect(chunk.records).toEqual({ start: 3, count: 2 });
    expect(chunk.startSeconds).toBe(recordOnsetSeconds(3));
    expect(chunk.durationSeconds).toBe(
      recordOnsetSeconds(4) + RECORD_DURATION_SECONDS - recordOnsetSeconds(3),
    );
    // A probed index does not know where the gaps are, and says so with `undefined` rather than
    // with a claim that there is none.
    expect(chunk.precededByGap).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// After `buildRecordIndex`
// ---------------------------------------------------------------------------

describe('a complete index over the MSLT file', () => {
  it('promotes coverage and materialises the segments and gaps', async () => {
    const { index } = await indexedMslt();

    expect(index.coverage).toBe('complete');
    expect(index.recordCount).toBe(RECORD_COUNT);

    const segments = defined(index.segments, 'segments once coverage is complete');
    const gaps = defined(index.gaps, 'gaps once coverage is complete');
    expect(segments).toHaveLength(SEGMENT_COUNT);
    // One gap per adjacent pair of segments.
    expect(gaps).toHaveLength(SEGMENT_COUNT - 1);

    expect(segments.map((segment) => segment.records)).toEqual([
      { start: 0, count: 4 },
      { start: 4, count: 4 },
      { start: 8, count: 4 },
      { start: 12, count: 4 },
      { start: 16, count: 4 },
    ]);
    expect(segments.map((segment) => segment.startSeconds)).toEqual([0, 3600, 7200, 10800, 14400]);
    expect(segments.map((segment) => segment.durationSeconds)).toEqual([4, 4, 4, 4, 4]);
    expect(segments.map((segment) => segment.endSeconds)).toEqual([4, 3604, 7204, 10804, 14404]);
    // Exact ticks, not floats: DESIGN "Time comparison".
    expect(segments.map((segment) => segment.startTicks)).toEqual([
      0n,
      3600n * TICKS_PER_SECOND,
      7200n * TICKS_PER_SECOND,
      10800n * TICKS_PER_SECOND,
      14400n * TICKS_PER_SECOND,
    ]);

    expect(gaps.map((gap) => [gap.beforeSegmentIndex, gap.afterSegmentIndex])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
    // A gap starts where the previous segment ends and ends where the next one starts.
    expect(gaps.map((gap) => gap.startSeconds)).toEqual([4, 3604, 7204, 10804]);
    expect(gaps.map((gap) => gap.endSeconds)).toEqual([3600, 7200, 10800, 14400]);
    expect(gaps.map((gap) => gap.durationSeconds)).toEqual([3596, 3596, 3596, 3596]);
  });

  it('locates a time inside a nap and returns undefined inside a gap', async () => {
    const { index } = await indexedMslt();

    await expect(index.locate(0)).resolves.toEqual({
      recordIndex: 0,
      recordStartSeconds: 0,
      recordStartTicks: 0n,
      offsetInRecordSeconds: 0,
      offsetInRecordTicks: 0n,
    });
    await expect(index.locate(3600.5)).resolves.toEqual({
      recordIndex: 4,
      recordStartSeconds: 3600,
      recordStartTicks: 36_000_000_000n,
      offsetInRecordSeconds: 0.5,
      offsetInRecordTicks: 5_000_000n,
    });
    // Inside the first gap, and after the last record: no record covers either instant.
    await expect(index.locate(100)).resolves.toBeUndefined();
    await expect(index.locate(20_000)).resolves.toBeUndefined();
  });

  it('returns [] for a window entirely inside a gap, and fills nothing in', async () => {
    const recording = await indexedMslt();

    const chunks = await readWindow(recording, {
      startSeconds: 100,
      durationSeconds: 600,
      signalIndices: [0],
    });

    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks).toEqual([]);
    // There is no gap-fill and no gap-fill option: an empty array means "no data exists here",
    // never "the read failed" and never "here are some zeros" (DESIGN "Gap policy").
  });

  it('returns one chunk per contiguous run across a gap, with precededByGap on the later one', async () => {
    const recording = await indexedMslt();
    const gaps = defined(recording.index.gaps, 'gaps');

    // From 2 s into the first nap to 2 s into the second, an hour later.
    const chunks = await readWindow(recording, {
      startSeconds: 2,
      durationSeconds: SEGMENT_INTERVAL_SECONDS,
      signalIndices: [0],
    });

    expect(chunks).toHaveLength(2);
    const first = defined(chunks[0], 'the first chunk');
    const second = defined(chunks[1], 'the second chunk');

    expect(first.records).toEqual({ start: 2, count: 2 });
    expect(second.records).toEqual({ start: 4, count: 2 });

    // The chunk start is the record's TRUE start, read from its timekeeping TAL — not the
    // nominal `records.start * recordDuration` a gap would have invalidated.
    expect(first.startSeconds).toBe(2);
    expect(second.startSeconds).toBe(SEGMENT_INTERVAL_SECONDS);
    expect(second.startSeconds).not.toBe(second.records.start * RECORD_DURATION_SECONDS);

    expect(first.precededByGap).toBeUndefined();
    expect(second.precededByGap).toEqual(defined(gaps[0], 'the first gap'));

    // The samples are the ones those records actually hold, on both sides of the gap.
    const firstSignal = defined(first.signals[0], 'the first chunk signal');
    const secondSignal = defined(second.signals[0], 'the second chunk signal');
    expect(firstSignal.sampleCount).toBe(2 * SAMPLES_PER_RECORD);
    expect(Array.from(firstSignal.digital.slice(0, 3))).toEqual([200, 201, 202]);
    expect(Array.from(secondSignal.digital.slice(0, 3))).toEqual([400, 401, 402]);
    // Per-signal sample grids stay continuous in INDEX even where time is not.
    expect(firstSignal.firstSampleIndex).toBe(2 * SAMPLES_PER_RECORD);
    expect(secondSignal.firstSampleIndex).toBe(4 * SAMPLES_PER_RECORD);
  });

  it('reads a window inside one nap as a single chunk', async () => {
    const recording = await indexedMslt();

    const chunks = await readWindow(recording, {
      startSeconds: 7201,
      durationSeconds: 2,
      signalIndices: [0],
    });

    expect(chunks).toHaveLength(1);
    const chunk = defined(chunks[0], 'the only chunk');
    expect(chunk.records).toEqual({ start: 9, count: 2 });
    expect(chunk.startSeconds).toBe(7201);
    expect(chunk.durationSeconds).toBe(2);
    expect(chunk.precededByGap).toBeUndefined();
  });
});
