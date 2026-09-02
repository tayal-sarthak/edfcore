/**
 * `mergeChunks`.
 *
 * The interesting assertions are the refusals. Merging is trivial when it is legal; the value of
 * the function is that it stops when it is not, because concatenating across a gap produces an
 * array that looks perfectly ordinary and dates every sample after the join wrongly.
 *
 * The merged samples are checked against a read of the same window from a CONTINUOUS file, so the
 * expectation comes from the file rather than from another call to the code under test.
 */

import { describe, expect, it } from 'vitest';
import { mergeChunks } from '../../src/chunks.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { assertMonotonicOnsetArray } from '../../src/time/timeline.js';
import { trimToWindow } from '../../src/time/window.js';
import type { EdfChunk, EdfRecording } from '../../src/types.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const SAMPLES_PER_RECORD = 8;
const RECORDS = 6;

/** Value at absolute sample `i`, identical in both files so the two reads are comparable. */
const sample = (i: number): number => ((i * 313) % 4001) - 2000;

function file(options: { discontinuous: boolean }): Uint8Array {
  return minimalEdfPlus({
    plus: options.discontinuous ? 'D' : 'C',
    recordCount: RECORDS,
    recordDurationSeconds: 1,
    // Three records, a five-second hole, three more.
    ...(options.discontinuous
      ? { recordOnsetSeconds: (i: number): number => (i < 3 ? i : i + 5) }
      : {}),
    signals: [
      {
        label: 'Fp1',
        samplesPerRecord: SAMPLES_PER_RECORD,
        physicalMinimum: -2000,
        physicalMaximum: 2000,
        digitalMinimum: -32768,
        digitalMaximum: 32767,
        sample: (record: number, index: number) => sample(record * SAMPLES_PER_RECORD + index),
      },
    ],
  });
}

async function open(discontinuous: boolean): Promise<EdfRecording> {
  const recording = await openEdf(byteSource(file({ discontinuous })));
  // A window on an EDF+D file needs a scanned index — a probed one cannot locate the records
  // after a gap. `EdfRecording` is a plain struct, so the completed index is adopted by rebuild.
  if (!discontinuous) return recording;
  return { ...recording, index: await buildRecordIndex(recording) };
}

async function wholeFile(discontinuous: boolean): Promise<readonly EdfChunk[]> {
  const edf = await open(discontinuous);
  return readWindow(edf, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: edf.timeline.spanSeconds,
  });
}

describe('mergeChunks joins what is joinable', () => {
  it('returns the single chunk of a continuous read untouched', async () => {
    const chunks = await wholeFile(false);
    expect(chunks).toHaveLength(1);
    // Identity, not a copy: the common case must not cost an allocation.
    expect(mergeChunks(chunks)).toBe(chunks[0]);
  });

  it("joins chunks split only by the read, reproducing the file's samples in order", async () => {
    const edf = await open(false);
    // Two adjacent reads of the same continuous file: legal to merge, and the result must equal
    // one read of the whole thing.
    const first = await readWindow(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 2,
    });
    const second = await readWindow(edf, {
      signalIndices: [0],
      startSeconds: 2,
      durationSeconds: 4,
    });

    const merged = mergeChunks([...first, ...second]);
    expect(merged.records).toEqual({ start: 0, count: RECORDS });
    expect(merged.startSeconds).toBe(0);
    expect(merged.durationSeconds).toBe(RECORDS);

    const signal = merged.signals[0];
    expect(signal?.sampleCount).toBe(RECORDS * SAMPLES_PER_RECORD);
    expect(signal?.firstSampleIndex).toBe(0);
    // Against the file, not against another merge.
    const expected = Array.from({ length: RECORDS * SAMPLES_PER_RECORD }, (_, i) => sample(i));
    expect(Array.from(signal?.digital ?? [])).toEqual(expected);
  });

  it('sums the bytes read and keeps the gap that precedes the whole run', async () => {
    const edf = await open(true);
    // Two reads inside the SECOND run of an EDF+D file, so the merge is legal — the gap is before
    // the pair, not between them. What must survive is that the run itself follows a gap.
    const head = await readWindow(edf, { signalIndices: [0], startSeconds: 8, durationSeconds: 2 });
    const tail = await readWindow(edf, {
      signalIndices: [0],
      startSeconds: 10,
      durationSeconds: 1,
    });
    expect(head).toHaveLength(1);
    expect(tail).toHaveLength(1);
    expect(head[0]?.precededByGap?.durationSeconds).toBe(5);
    expect(tail[0]?.precededByGap).toBeUndefined();

    const merged = mergeChunks([...head, ...tail]);
    expect(merged.records).toEqual({ start: 3, count: 3 });
    expect(merged.precededByGap?.durationSeconds).toBe(5);
    expect(merged.byteLength).toBe((head[0]?.byteLength ?? 0) + (tail[0]?.byteLength ?? 0));
    expect(merged.signals[0]?.sampleCount).toBe(3 * SAMPLES_PER_RECORD);
    // The samples are the file's records 3-5, unaffected by the gap that precedes them.
    expect(Array.from(merged.signals[0]?.digital ?? [])).toEqual(
      Array.from({ length: 3 * SAMPLES_PER_RECORD }, (_, i) => sample(3 * SAMPLES_PER_RECORD + i)),
    );
  });
});

describe('mergeChunks refuses what is not', () => {
  it('refuses to concatenate across a gap', async () => {
    const chunks = await wholeFile(true);
    expect(chunks.length).toBeGreaterThan(1);
    expect(() => mergeChunks(chunks)).toThrow(RangeError);
    // The message has to name the cost, or the caller just reaches for a manual concat.
    expect(() => mergeChunks(chunks)).toThrow(/gap of 5 s/);
  });

  it('refuses chunks that are out of order or not adjacent', async () => {
    const edf = await open(false);
    const [a] = await readWindow(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 2,
    });
    const [c] = await readWindow(edf, {
      signalIndices: [0],
      startSeconds: 4,
      durationSeconds: 2,
    });
    if (a === undefined || c === undefined) throw new Error('setup failed');

    // Records 0-1 then 4-5: adjacent in the array, two records apart in the file.
    expect(() => mergeChunks([a, c])).toThrow(/must be adjacent/);
    expect(() => mergeChunks([c, a])).toThrow(RangeError);
  });

  it('refuses a chunk that has already been trimmed', async () => {
    const edf = await open(false);
    const [a] = await readWindow(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 3,
    });
    const [b] = await readWindow(edf, {
      signalIndices: [0],
      startSeconds: 3,
      durationSeconds: 3,
    });
    if (a === undefined || b === undefined) throw new Error('setup failed');

    // Trimming `a` to its first half drops the samples between it and `b`. The records still look
    // adjacent — this is exactly the case the record check cannot see.
    const trimmedSignal = trimToWindow(edf.header, a.signals[0] as never, 0, 1.5);
    const trimmed: EdfChunk = { ...a, signals: [trimmedSignal] };
    expect(trimmed.records.start + trimmed.records.count).toBe(b.records.start);
    expect(() => mergeChunks([trimmed, b])).toThrow(/trimmed chunk/);
  });

  it('refuses chunks read with different signals', async () => {
    const edf = await open(false);
    const [a] = await readWindow(edf, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 3,
    });
    const [b] = await readWindow(edf, {
      signalIndices: [0],
      startSeconds: 3,
      durationSeconds: 3,
    });
    if (a === undefined || b === undefined) throw new Error('setup failed');

    expect(() => mergeChunks([{ ...b, signals: [] }, a])).toThrow(RangeError);
    expect(() => mergeChunks([a, { ...b, signals: [] }])).toThrow(/same signal selection/);
  });

  it('refuses an empty array rather than inventing an empty chunk', () => {
    // `readWindow` returns [] for a window past the end, and [] has no start, no records and no
    // signals. Fabricating a chunk shaped like one would be a lie about what was read.
    expect(() => mergeChunks([])).toThrow(/nothing to merge/);
  });
});

describe('mergeChunks refuses a gap the index never looked for', () => {
  it('catches a discontinuity from the chunks own clocks, with no index at all', async () => {
    // `openEdf` returns a PROBED index, and `readRecords` reads by record number without ever
    // consulting the timeline — so this is the one path that reaches mergeChunks with a real gap
    // and `precededByGap: undefined` on every chunk. Before 0.2.19 the refusal was keyed on that
    // field alone and this merge succeeded, concatenating samples five seconds apart.
    const recording = await openEdf(byteSource(file({ discontinuous: true })));
    expect(recording.index.coverage).toBe('probed');

    const before = await readRecords(recording, {
      signalIndices: [0],
      records: { start: 0, count: 3 },
    });
    const after = await readRecords(recording, {
      signalIndices: [0],
      records: { start: 3, count: 3 },
    });

    // The evidence was in hand the whole time: each chunk decoded its own onset from its own
    // bytes, and they are five seconds further apart than three one-second records.
    expect(before.precededByGap).toBeUndefined();
    expect(after.precededByGap).toBeUndefined();
    expect(before.startSeconds).toBe(0);
    expect(after.startSeconds).toBe(8);
    expect(after.records.start).toBe(before.records.start + before.records.count);

    expect(() => mergeChunks([before, after])).toThrow(RangeError);
    expect(() => mergeChunks([before, after])).toThrow(/discontinuity of 5 s/);
  });

  it('still merges two reads of a genuinely contiguous file', async () => {
    // The new check must not refuse the case the helper exists for.
    const recording = await openEdf(byteSource(file({ discontinuous: false })));
    const before = await readRecords(recording, {
      signalIndices: [0],
      records: { start: 0, count: 3 },
    });
    const after = await readRecords(recording, {
      signalIndices: [0],
      records: { start: 3, count: 3 },
    });

    const merged = mergeChunks([before, after]);
    expect(merged.records).toEqual({ start: 0, count: RECORDS });
    expect(Array.from(merged.signals[0]?.digital ?? [])).toEqual(
      Array.from({ length: RECORDS * SAMPLES_PER_RECORD }, (_, i) => sample(i)),
    );
  });

  it('reports the gap by its duration, not by which check happened to fire', async () => {
    // An indexed read still gets the precededByGap message, which names the indexed gap. Both
    // paths must refuse; only the wording differs.
    const indexed = await open(true);
    const chunks = await wholeFile(true);
    expect(indexed.index.coverage).toBe('complete');
    expect(() => mergeChunks(chunks)).toThrow(/gap of 5 s/);
  });
});

describe('the joinability check reads the ticks off the chunks', () => {
  // Until 0.3.7 it rounded them back out of the seconds — `secondsToTicks(startSeconds, 'seconds')` plus
  // `secondsToTicks(durationSeconds, 'seconds')`, two independent roundings added together. The comment
  // bounded that round trip at "any recording shorter than ~28.5 years", which is where 10^7
  // ticks per second passes 2^53, and the library accepts declared spans three orders of
  // magnitude past it. A single lost tick produced a refusal naming a discontinuity of 1e-7 s
  // between chunks that are genuinely adjacent.
  it('carries an exact tick counterpart for every second on a chunk', async () => {
    const recording = await openEdf(
      byteSource(minimalEdfPlus({ recordCount: 6, recordDurationSeconds: 1 })),
    );
    const chunk = await readRecords(recording, {
      records: { start: 2, count: 3 },
      signalIndices: [0],
    });
    expect(chunk.startTicks).toBe(20_000_000n);
    expect(chunk.durationTicks).toBe(30_000_000n);
    expect(chunk.startSeconds).toBe(Number(chunk.startTicks) / 1e7);
    expect(chunk.durationSeconds).toBe(Number(chunk.durationTicks) / 1e7);
    expect(chunk.signals[0]?.startTicks).toBe(chunk.startTicks);
  });

  it("lets trimToWindow measure from the chunk's own start rather than a rounded one", async () => {
    // 3 s records with 256 samples: a real geometry, and one where a sample starts every
    // 117187.5 ticks — so a trimmed signal's start lands exactly halfway between two ticks. The
    // old code reconstructed that start with `secondsToTicks`, which rounds to the NEAREST tick,
    // moving the grid origin a half tick from where the samples actually are. `startTicks` is the
    // tick the sample starts in, floored, and is carried rather than re-derived.
    const bytes = buildEdf({
      recordCount: 4,
      recordDurationSeconds: 3,
      signals: [{ label: 'Fp1', samplesPerRecord: 256 }],
    });
    const recording = await openEdf(byteSource(bytes));
    const chunk = await readRecords(recording, {
      records: { start: 0, count: 4 },
      signalIndices: [0],
    });
    const signal = chunk.signals[0];
    if (signal === undefined) throw new Error('setup failed');

    // A window starting at 0.03 s takes sample 3 first, and sample 3 starts at
    // 3 * 30000000 / 256 = 351562.5 ticks — exactly between two ticks.
    const once = trimToWindow(recording.header, signal, 0.03, 6);
    expect(once.firstSampleIndex).toBe(3);
    // Floored: the tick the sample is already running in. The seconds keep the other half.
    expect(once.startTicks).toBe(351_562n);
    expect(once.startSeconds).toBe(0.03515625);
    // What the old code would have recovered instead — the grid origin every later boundary is
    // measured from, one tick past where the sample actually starts.
    expect(BigInt(Math.round(once.startSeconds * 1e7))).toBe(351_563n);
  });

  it('still refuses two chunks that are record-adjacent but a tick apart in time', async () => {
    // The check the round trip existed to make, and it still makes it.
    const recording = await openEdf(
      byteSource(minimalEdfPlus({ recordCount: 4, recordDurationSeconds: 1 })),
    );
    const first = await readRecords(recording, {
      records: { start: 0, count: 2 },
      signalIndices: [0],
    });
    const second = await readRecords(recording, {
      records: { start: 2, count: 2 },
      signalIndices: [0],
    });
    const shifted = { ...second, startTicks: second.startTicks + 1n };
    expect(() => mergeChunks([first, shifted])).toThrow(/discontinuity/);
  });
});

describe('mergeChunks does not call an overlap a gap', () => {
  /**
   * An overlap travels in `index.gaps` with a NEGATIVE duration (0.2.69), so it reaches
   * `chunk.precededByGap` too. A hardcoded gap reading produced "preceded by a gap of -0.2 s" —
   * a gap of negative duration — and the consequence clause inverted what an overlap does: across
   * a gap two samples are seconds APART; across an overlap they cover the SAME time, so
   * concatenating stores it twice rather than skipping it.
   *
   * 0.3.3 stated the partition; 0.3.33's own headline was "the two places that still said it was"
   * and enumerated exactly two. This file was a third, and contained no mention of an overlap at
   * all (fixed in 0.3.41).
   */
  async function overlapping() {
    const bytes = minimalEdfPlus({
      plus: 'D',
      recordCount: 6,
      recordDurationSeconds: 1,
      recordOnsetSeconds: (r: number) => (r < 3 ? r : r - 0.2),
    });
    const opened = await openEdf(byteSource(bytes));
    return { ...opened, index: await buildRecordIndex(opened) };
  }

  it('names it an overlap, with a positive magnitude', async () => {
    const recording = await overlapping();
    // A negative gap on an array that IS monotonic. `assertMonotonicOnsetArray` accepts it —
    // monotonicity is `onset[r] >= onset[r - 1]`, and an overlap satisfies that — so `segments.ts`
    // saying "a gap can then only have a non-negative duration" was never true (fixed in 0.3.82).
    expect(recording.index.gaps?.[0]?.durationTicks).toBe(-2_000_000n);
    expect(() =>
      assertMonotonicOnsetArray(
        (recording.index.segments ?? []).map((segment) => segment.startTicks),
      ),
    ).not.toThrow();

    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 10,
    });
    expect(chunks).toHaveLength(2);

    const error = (() => {
      try {
        mergeChunks(chunks);
        return undefined;
      } catch (e) {
        return e as Error;
      }
    })();

    expect(error?.message).toContain('preceded by an overlap of 0.2 s');
    expect(error?.message).toContain('both claim that time');
    // A gap of negative duration is not a thing, and the gap consequence is the wrong one.
    expect(error?.message).not.toContain('gap of -0.2');
    expect(error?.message).not.toContain('seconds apart');
    // Still refused: the check is right either way.
    expect(error).toBeInstanceOf(RangeError);
  });

  it('says so on the tick path too, which is the one a probed index reaches', async () => {
    // The branch above needs `precededByGap`, and a PROBED index reports no gaps at all — so after
    // a bare `openEdf` it is `undefined` and the exact-tick comparison is what fires instead. That
    // path said "a discontinuity of -0.2 s ... this is a gap in TIME", naming the wrong thing
    // twice, forty lines below the branch 0.3.41 taught the difference to (fixed in 0.3.59).
    const bytes = buildEdf({
      plus: 'D',
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 2 }],
      annotationSignals: [{ samplesPerRecord: 30 }],
      recordOnsetSeconds: (r: number) => (r < 3 ? r : 2.8),
    });
    const recording = await openEdf(byteSource(bytes));
    const before = await readRecords(recording, {
      records: { start: 0, count: 3 },
      signalIndices: [0],
    });
    const after = await readRecords(recording, {
      records: { start: 3, count: 1 },
      signalIndices: [0],
    });
    // The precondition: this is the tick path, not the gap path.
    expect(before.precededByGap).toBeUndefined();
    expect(after.precededByGap).toBeUndefined();

    const error = (() => {
      try {
        mergeChunks([before, after]);
        return undefined;
      } catch (e) {
        return e as Error;
      }
    })();

    expect(error).toBeInstanceOf(RangeError);
    expect(error?.message).toContain('an overlap of 0.2 s');
    expect(error?.message).toContain('both claim that time');
    expect(error?.message).not.toContain('-0.2');
    expect(error?.message).not.toContain('gap in TIME');
  });

  it('still calls a real hole a gap', async () => {
    const bytes = minimalEdfPlus({
      plus: 'D',
      recordCount: 6,
      recordDurationSeconds: 1,
      recordOnsetSeconds: (r: number) => (r < 3 ? r : r + 10),
    });
    const opened = await openEdf(byteSource(bytes));
    const recording = { ...opened, index: await buildRecordIndex(opened) };
    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 30,
    });
    const error = (() => {
      try {
        mergeChunks(chunks);
        return undefined;
      } catch (e) {
        return e as Error;
      }
    })();
    expect(error?.message).toContain('preceded by a gap of 10 s');
    expect(error?.message).toContain('seconds apart');
  });
});
