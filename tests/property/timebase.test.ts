/**
 * One recording, one axis.
 *
 * `t = 0` is the start of record 0, and record `r` begins at the onset the FILE states — not at
 * `r * recordDuration`. On a contiguous file those are the same number, which is why the
 * difference kept escaping: every fixture without a gap agrees with both rules.
 *
 * This repository has shipped four separate fixes for one defect wearing different clothes:
 *
 * - 0.1.4  a record with no timekeeping TAL derived its onset from zero rather than from the
 *          recording's start, so the scan chunk size changed the segments.
 * - 0.2.10 `filterAnnotationsByTime` compared against the header axis while every read used the
 *          record-0 axis, so events landed in the neighbouring window.
 * - 0.2.18 `readTriggers` timed events as `sampleIndex * recordDuration / samplesPerRecord`, so a
 *          stimulus latched at 10 s was reported at 2 s.
 * - 0.2.19 `mergeChunks` could not see a gap because it asked the index instead of the clock.
 *
 * Four instances is a pattern, not a coincidence, and fixing them one at a time has not stopped
 * the fifth. So this file does not test a function: it tests the INVARIANT, across every public
 * function that reports or accepts a time, against one fixture whose true onsets are known
 * independently. A new time-returning function that does not appear here is the next instance.
 *
 * The expected onsets come from `trueOnsetSeconds` below, which is the same arithmetic the fixture
 * writer is given — never from another edfcore call.
 *
 * `gridSampleIndexAt`, `gridSampleStartTicks` and `gridSampleStartSeconds` are covered too, but they are the
 * one family that is NOT on this axis, and the last section pins that as a stated contract rather
 * than leaving it to be rediscovered. They receive a signal, a number and a record duration — no
 * index, no timeline — so a gap is not in their arguments and no arithmetic inside them could find
 * it. They measure the signal's own sample grid, which equals elapsed time exactly when the
 * recording is contiguous.
 */

import { describe, expect, it } from 'vitest';
import { filterAnnotationsByTime } from '../../src/annotations-query.js';
import { TICKS_PER_SECOND } from '../../src/constants.js';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex, contiguityOf, gapAt, segmentAt } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import {
  gridSampleIndexAt,
  gridSampleStartSeconds,
  gridSampleStartTicks,
} from '../../src/sample-grid.js';
import { sampleAt, sampleStartSecondsOf, sampleStartTicksOf } from '../../src/sample-locate.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfRecording } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

const RECORDS = 6;
const SAMPLES_PER_RECORD = 4;
const GAP_SECONDS = 7;

/**
 * The truth, stated once. Records 0-2 run 0,1,2; then a 7 s hole; records 3-5 run 10,11,12.
 *
 * This is elapsed recording time — the axis every assertion below uses — and it is what the
 * fixture writer is handed, so nothing here is derived from edfcore's own answer.
 */
function trueOnsetSeconds(recordIndex: number): number {
  return recordIndex < 3 ? recordIndex : recordIndex + GAP_SECONDS;
}

const SPAN_SECONDS = trueOnsetSeconds(RECORDS - 1) + 1;

/** Sample `i` of the whole channel, so a value identifies the record it came from. */
const sampleValue = (record: number, index: number): number => record * 100 + index;

function discontinuousFile(): Uint8Array {
  return buildEdf({
    plus: 'D',
    recordCount: RECORDS,
    recordDurationSeconds: 1,
    recordOnsetSeconds: trueOnsetSeconds,
    signals: [
      {
        label: 'Fp1',
        samplesPerRecord: SAMPLES_PER_RECORD,
        physicalMinimum: -1000,
        physicalMaximum: 1000,
        digitalMinimum: -32768,
        digitalMaximum: 32767,
        sample: sampleValue,
      },
    ],
    annotationSignals: [
      {
        samplesPerRecord: 60,
        // One marker per record, written at that record's own true onset. Its onset on disk is
        // therefore `trueOnsetSeconds(r)`, and every query must agree.
        tals: (r: number) => [{ onset: trueOnsetSeconds(r), texts: [`mark${r}`] }],
      },
    ],
  });
}

async function scanned(): Promise<EdfRecording> {
  const recording = await openEdf(byteSource(discontinuousFile()));
  return { ...recording, index: await buildRecordIndex(recording) };
}

/** Every record's true start, in exact ticks. */
function trueOnsetTicks(recordIndex: number): bigint {
  return BigInt(trueOnsetSeconds(recordIndex)) * TICKS_PER_SECOND;
}

describe('the fixture really is discontinuous', () => {
  it('states onsets that differ from the nominal grid past the gap', async () => {
    // Without this the whole file would pass vacuously on a contiguous recording, which is exactly
    // how four separate defects survived their own test suites.
    const recording = await scanned();
    expect(recording.index.coverage).toBe('complete');
    expect(recording.index.gaps).toHaveLength(1);
    expect(trueOnsetSeconds(3)).not.toBe(3);
    expect(recording.timeline.spanSeconds).toBe(SPAN_SECONDS);
    expect(recording.timeline.coveredSeconds).toBe(RECORDS);
  });
});

describe('every function that reports a record start agrees with the file', () => {
  it('index.onsetTicks', async () => {
    const recording = await scanned();
    for (let r = 0; r < RECORDS; r += 1) {
      expect(await recording.index.onsetTicks(r), `record ${r}`).toBe(trueOnsetTicks(r));
    }
  });

  it('index.segments', async () => {
    const recording = await scanned();
    for (const segment of recording.index.segments ?? []) {
      expect(segment.startSeconds).toBe(trueOnsetSeconds(segment.records.start));
      expect(segment.startTicks).toBe(trueOnsetTicks(segment.records.start));
      // A segment is contiguous by construction, so its end is its start plus its record count.
      expect(segment.endSeconds).toBe(segment.startSeconds + segment.records.count);
    }
  });

  it('index.locate', async () => {
    const recording = await scanned();
    for (let r = 0; r < RECORDS; r += 1) {
      const located = await recording.index.locate(trueOnsetSeconds(r) + 0.5);
      expect(located?.recordIndex, `record ${r}`).toBe(r);
      expect(located?.recordStartSeconds).toBe(trueOnsetSeconds(r));
    }
  });

  it('readRecords', async () => {
    const recording = await scanned();
    for (let r = 0; r < RECORDS; r += 1) {
      const chunk = await readRecords(recording, {
        signalIndices: [0],
        records: { start: r, count: 1 },
      });
      expect(chunk.startSeconds, `record ${r}`).toBe(trueOnsetSeconds(r));
      expect(chunk.signals[0]?.startSeconds).toBe(trueOnsetSeconds(r));
      // And the samples really are that record's, so the time is attached to the right bytes.
      expect(chunk.signals[0]?.digital[0]).toBe(sampleValue(r, 0));
    }
  });

  it('readWindow', async () => {
    const recording = await scanned();
    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: SPAN_SECONDS,
    });
    expect(chunks.map((c) => c.startSeconds)).toEqual([trueOnsetSeconds(0), trueOnsetSeconds(3)]);
    expect(chunks[1]?.precededByGap?.durationSeconds).toBe(GAP_SECONDS);
  });

  it('streamRecords', async () => {
    const recording = await scanned();
    const starts: number[] = [];
    for await (const chunk of streamRecords(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: SPAN_SECONDS,
      chunkRecords: 1,
    })) {
      starts.push(chunk.startSeconds);
    }
    expect(starts).toEqual([0, 1, 2, 3, 4, 5].map(trueOnsetSeconds));
  });

  it('readEnvelope', async () => {
    const recording = await scanned();
    const chunks = await readEnvelope(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: SPAN_SECONDS,
      buckets: 4,
    });
    expect(chunks.map((c) => c.startSeconds)).toEqual([trueOnsetSeconds(0), trueOnsetSeconds(3)]);
    expect(chunks.map((c) => c.signals[0]?.startSeconds)).toEqual([
      trueOnsetSeconds(0),
      trueOnsetSeconds(3),
    ]);
  });

  it('readEnvelopeAtResolution', async () => {
    const recording = await scanned();
    const chunks = await readEnvelopeAtResolution(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: SPAN_SECONDS,
      secondsPerBucket: 1,
    });
    expect(chunks.map((c) => c.startSeconds)).toEqual([trueOnsetSeconds(0), trueOnsetSeconds(3)]);
  });

  it('segmentAt and gapAt', async () => {
    const recording = await scanned();
    for (let r = 0; r < RECORDS; r += 1) {
      const at = trueOnsetSeconds(r);
      expect(segmentAt(recording.index, at)?.records.start, `record ${r}`).toBe(r < 3 ? 0 : 3);
      expect(gapAt(recording.index, at)).toBeUndefined();
    }
    // And the hole itself belongs to the gap, not to a segment.
    expect(segmentAt(recording.index, 5)).toBeUndefined();
    expect(gapAt(recording.index, 5)?.durationSeconds).toBe(GAP_SECONDS);
  });
});

describe('annotations sit on the same axis as the records that carry them', () => {
  it('reports each marker at its own record start', async () => {
    const recording = await scanned();
    const { annotations } = await readAnnotations(recording, { start: 0, count: RECORDS });
    const marks = annotations.filter((a) => a.text.startsWith('mark'));
    expect(marks).toHaveLength(RECORDS);

    for (const mark of marks) {
      const r = Number(mark.text.slice(4));
      expect(mark.onsetTicksFromFirstRecord, mark.text).toBe(trueOnsetTicks(r));
      expect(mark.onsetSecondsFromFirstRecord).toBe(trueOnsetSeconds(r));
    }
  });

  it('puts each marker in the window that reads its own record', async () => {
    // The pair `readWindow` + `filterAnnotationsByTime` answers "the events in the window I just
    // read". 0.2.10 was the two disagreeing; this asserts they cannot again.
    const recording = await scanned();
    const { annotations } = await readAnnotations(recording, { start: 0, count: RECORDS });

    for (let r = 0; r < RECORDS; r += 1) {
      const startSeconds = trueOnsetSeconds(r);
      const chunks = await readWindow(recording, {
        signalIndices: [0],
        startSeconds,
        durationSeconds: 1,
      });
      expect(
        chunks.map((c) => c.records.start),
        `record ${r}`,
      ).toEqual([r]);

      const inWindow = filterAnnotationsByTime(annotations, { startSeconds, durationSeconds: 1 });
      expect(
        inWindow.map((a) => a.text),
        `record ${r}`,
      ).toEqual([`mark${r}`]);
    }
  });

  it('places no annotation inside the gap', async () => {
    const recording = await scanned();
    const { annotations } = await readAnnotations(recording, { start: 0, count: RECORDS });
    const gap = (recording.index.gaps ?? [])[0];
    if (gap === undefined) throw new Error('setup failed');

    expect(
      filterAnnotationsByTime(annotations, {
        startSeconds: gap.startSeconds,
        durationSeconds: gap.durationSeconds,
      }),
    ).toEqual([]);
  });
});

describe('a sub-second start offset does not shift the axis either', () => {
  // The other half of the pattern. Record 0's timekeeping TAL may carry a fraction in [0, 1); the
  // header holds the whole seconds. `t = 0` is still the start of record 0, so every reported time
  // must be unchanged by the offset — only the HEADER-relative fields move.
  const OFFSET = 0.25;

  async function offsetRecording(): Promise<EdfRecording> {
    return openEdf(
      byteSource(
        buildEdf({
          plus: 'C',
          recordCount: 4,
          recordDurationSeconds: 1,
          startOffsetSeconds: OFFSET,
          signals: [{ label: 'Fp1', samplesPerRecord: SAMPLES_PER_RECORD, sample: sampleValue }],
          annotationSignals: [
            {
              samplesPerRecord: 60,
              // On disk at header time r + OFFSET, i.e. recording time r.
              tals: (r: number) => [{ onset: r + OFFSET, texts: [`mark${r}`] }],
            },
          ],
        }),
      ),
    );
  }

  it('keeps record starts at whole seconds on the recording axis', async () => {
    const recording = await offsetRecording();
    expect(recording.timeline.startOffsetSeconds).toBe(OFFSET);
    for (let r = 0; r < 4; r += 1) {
      const chunk = await readRecords(recording, {
        signalIndices: [0],
        records: { start: r, count: 1 },
      });
      expect(chunk.startSeconds, `record ${r}`).toBe(r);
    }
  });

  it('keeps annotations on the recording axis, with the header axis offset from it', async () => {
    const recording = await offsetRecording();
    const { annotations } = await readAnnotations(recording, { start: 0, count: 4 });
    const marks = annotations.filter((a) => a.text.startsWith('mark'));

    for (const mark of marks) {
      const r = Number(mark.text.slice(4));
      expect(mark.onsetSecondsFromFirstRecord, mark.text).toBe(r);
      expect(mark.onsetSecondsFromHeaderStart).toBe(r + OFFSET);
      // Both exact forms, and their difference is exactly the offset.
      expect(mark.onsetTicks - mark.onsetTicksFromFirstRecord).toBe(
        BigInt(Math.round(OFFSET * Number(TICKS_PER_SECOND))),
      );
    }
  });

  it('answers a window query on the recording axis', async () => {
    const recording = await offsetRecording();
    const { annotations } = await readAnnotations(recording, { start: 0, count: 4 });
    for (let r = 0; r < 4; r += 1) {
      expect(
        filterAnnotationsByTime(annotations, { startSeconds: r, durationSeconds: 1 }).map(
          (a) => a.text,
        ),
        `record ${r}`,
      ).toEqual([`mark${r}`]);
    }
  });
});

describe('a partial record range answers the same as a whole-file one', () => {
  // The pairing the docs encourage is `readAnnotations(recording, chunk.records)` beside a
  // `readWindow` — `readAnnotations` requires an explicit range precisely so nobody scans a whole
  // file by accident. Before 0.2.28 the rebasing origin was only resolved when the range started
  // at record 0: a partial range had to derive it from an observed onset, which only works while
  // the records in between are contiguous, so on an EDF+D file it came out outside [0, 1) and the
  // rebasing switched off. The same annotation then read one way whole-file and another partial.
  const OFFSET = 0.25;

  async function offsetGapRecording(): Promise<EdfRecording> {
    const bytes = buildEdf({
      plus: 'D',
      recordCount: RECORDS,
      recordDurationSeconds: 1,
      startOffsetSeconds: OFFSET,
      recordOnsetSeconds: (r: number) => trueOnsetSeconds(r) + OFFSET,
      signals: [{ label: 'Fp1', samplesPerRecord: SAMPLES_PER_RECORD, sample: sampleValue }],
      annotationSignals: [
        {
          samplesPerRecord: 60,
          tals: (r: number) => [{ onset: trueOnsetSeconds(r) + OFFSET, texts: [`mark${r}`] }],
        },
      ],
    });
    const recording = await openEdf(byteSource(bytes));
    return { ...recording, index: await buildRecordIndex(recording) };
  }

  const marks = (result: {
    annotations: readonly { text: string; onsetTicksFromFirstRecord: bigint }[];
  }) =>
    result.annotations
      .filter((a) => a.text.startsWith('mark'))
      .map((a) => [a.text, a.onsetTicksFromFirstRecord] as const);

  it('reports one annotation at one time, whichever range decoded it', async () => {
    const recording = await offsetGapRecording();
    const whole = marks(await readAnnotations(recording, { start: 0, count: RECORDS }));
    const tail = marks(await readAnnotations(recording, { start: 3, count: 3 }));

    // Every mark must carry its own record's true onset, from either decode.
    for (const [text, ticks] of whole) {
      expect(ticks, `${text} whole-file`).toBe(trueOnsetTicks(Number(text.slice(4))));
    }
    for (const [text, ticks] of tail) {
      expect(ticks, `${text} partial`).toBe(trueOnsetTicks(Number(text.slice(4))));
    }
    // And the two decodes agree with each other on the overlap.
    expect(tail).toEqual(whole.slice(3));
  });

  it('agrees with the record start readWindow reports for the same records', async () => {
    const recording = await offsetGapRecording();
    for (let r = 3; r < RECORDS; r += 1) {
      const chunk = await readRecords(recording, {
        signalIndices: [0],
        records: { start: r, count: 1 },
      });
      const partial = marks(await readAnnotations(recording, { start: r, count: 1 }));
      expect(chunk.startSeconds, `record ${r}`).toBe(trueOnsetSeconds(r));
      expect(partial[0]?.[1], `record ${r}`).toBe(trueOnsetTicks(r));
    }
  });
});

describe('the sample grid is the signal own grid, not the recording clock', () => {
  // The fifth instance the invariant above found — and the one that cannot be fixed by arithmetic.
  // These three take (signal, value, recordDurationTicks): no index, no timeline, so a gap is not
  // in their arguments. What is pinned here is the CONTRACT, so the difference is a documented
  // property rather than something the next reader rediscovers the hard way.
  async function signalAndDuration(edf: EdfRecording) {
    const signal = edf.header.signals[0];
    if (signal === undefined) throw new Error('setup failed');
    return { signal, durationTicks: edf.header.recordDurationTicks };
  }

  it('agrees with the recording axis on a contiguous file, exactly', async () => {
    // The common case — every plain EDF and EDF+C — where the two ideas coincide and these
    // functions are the right tool.
    const edf = await openEdf(
      byteSource(
        buildEdf({
          plus: 'C',
          recordCount: 4,
          recordDurationSeconds: 1,
          signals: [{ label: 'Fp1', samplesPerRecord: SAMPLES_PER_RECORD, sample: sampleValue }],
          annotationSignals: [{ samplesPerRecord: 40 }],
        }),
      ),
    );
    const { signal, durationTicks } = await signalAndDuration(edf);

    for (let r = 0; r < 4; r += 1) {
      const chunk = await readRecords(edf, {
        signalIndices: [0],
        records: { start: r, count: 1 },
      });
      const firstSample = chunk.signals[0]?.firstSampleIndex ?? -1;
      expect(gridSampleStartSeconds(signal, firstSample, durationTicks), `record ${r}`).toBe(
        chunk.startSeconds,
      );
      expect(gridSampleIndexAt(signal, chunk.startSeconds, durationTicks).recordIndex).toBe(r);
    }
  });

  it('measures the sample grid, not the clock, once the file has a gap', async () => {
    // Record 3 holds samples 12..15 and truly starts at 10 s. The sample grid says 3 s, because on
    // the grid it IS the twelfth sample. Both numbers are correct about different things; this
    // asserts which one you get, so nobody has to find out from a plot.
    const edf = await scanned();
    const { signal, durationTicks } = await signalAndDuration(edf);
    const firstSampleOfRecord3 = 3 * SAMPLES_PER_RECORD;

    expect(gridSampleStartSeconds(signal, firstSampleOfRecord3, durationTicks)).toBe(3);
    expect(trueOnsetSeconds(3)).toBe(10);

    // The recording axis is available, from the index, and it is the one every read uses.
    const located = await edf.index.locate(trueOnsetSeconds(3));
    expect(located?.recordIndex).toBe(3);
    const chunk = await readRecords(edf, {
      signalIndices: [0],
      records: { start: 3, count: 1 },
    });
    expect(chunk.signals[0]?.firstSampleIndex).toBe(firstSampleOfRecord3);
    expect(chunk.startSeconds).toBe(trueOnsetSeconds(3));
  });

  it('answers past the end of the file rather than bounding, having no record count', async () => {
    // `gridSampleIndexAt(signal, 10, d)` names record 10 of a six-record file. It is given no record
    // count, so it cannot refuse; `segmentAt` is what answers whether an instant has data.
    const edf = await scanned();
    const { signal, durationTicks } = await signalAndDuration(edf);

    expect(gridSampleIndexAt(signal, 10, durationTicks).recordIndex).toBe(10);
    expect(edf.header.recordCount).toBe(RECORDS);
    // And the function that CAN answer, does.
    expect(segmentAt(edf.index, 10)?.records.start).toBe(3);
    expect(segmentAt(edf.index, 5)).toBeUndefined();
  });
});

describe('the recording-aware sample functions are on the recording axis', () => {
  // The pair added in 0.2.61, and the point of them: they take the RECORDING, so a gap is in their
  // arguments and they can answer what the grid functions structurally cannot.

  it('agrees with the grid functions exactly on a contiguous file', async () => {
    // The common case must not diverge, or the new pair would be a second answer rather than a
    // better one.
    const edf = await openEdf(
      byteSource(
        buildEdf({
          plus: 'C',
          recordCount: 4,
          recordDurationSeconds: 1,
          signals: [{ label: 'Fp1', samplesPerRecord: SAMPLES_PER_RECORD, sample: sampleValue }],
          annotationSignals: [{ samplesPerRecord: 40 }],
        }),
      ),
    );
    const signal = edf.header.signals[0];
    if (signal === undefined) throw new Error('setup failed');
    const durationTicks = edf.header.recordDurationTicks;

    for (let index = 0; index < 4 * SAMPLES_PER_RECORD; index += 1) {
      expect(sampleStartTicksOf(edf, 0, index), `sample ${index}`).toBe(
        gridSampleStartTicks(signal, index, durationTicks),
      );
    }
    for (let tenths = 0; tenths < 40; tenths += 1) {
      const seconds = tenths / 10;
      expect(sampleAt(edf, 0, seconds)?.sampleIndex, `${seconds}s`).toBe(
        gridSampleIndexAt(signal, seconds, durationTicks).sampleIndex,
      );
    }
  });

  it('places a post-gap sample at its true time, where the grid function cannot', async () => {
    // Record 3 holds samples 12..15 and truly begins at 10 s. The grid says 3 s, because on the
    // grid it IS the twelfth sample; both are correct about different things and only one of them
    // is the recording's clock.
    const edf = await scanned();
    const signal = edf.header.signals[0];
    if (signal === undefined) throw new Error('setup failed');
    const first = 3 * SAMPLES_PER_RECORD;

    expect(sampleStartSecondsOf(edf, 0, first)).toBe(trueOnsetSeconds(3));
    expect(sampleStartTicksOf(edf, 0, first)).toBe(trueOnsetTicks(3));
    // The grid function still answers on the grid, unchanged.
    expect(gridSampleStartSeconds(signal, first, edf.header.recordDurationTicks)).toBe(3);
  });

  it('says an instant inside a gap has no sample at all', async () => {
    // The answer `gridSampleIndexAt` cannot express: given only a signal and a record duration it
    // always returns an index, even one past the end of the file.
    const edf = await scanned();
    const signal = edf.header.signals[0];
    if (signal === undefined) throw new Error('setup failed');

    expect(sampleAt(edf, 0, 5)).toBeUndefined();
    expect(gapAt(edf.index, 5)).toBeDefined();
    // Whereas the grid function names a record that does not exist in this file.
    expect(gridSampleIndexAt(signal, 5, edf.header.recordDurationTicks).recordIndex).toBe(5);
    expect(edf.header.recordCount).toBe(RECORDS);
  });

  it('bounds its answer by the file, before and after', async () => {
    const edf = await scanned();
    expect(sampleAt(edf, 0, -1)).toBeUndefined();
    expect(sampleAt(edf, 0, 100)).toBeUndefined();
    expect(sampleAt(edf, 0, trueOnsetSeconds(RECORDS - 1) + 0.5)).toBeDefined();
  });

  it('round-trips: the sample at a sample start is that sample', async () => {
    // The invariant tying the pair together, across the gap.
    const edf = await scanned();
    for (let index = 0; index < RECORDS * SAMPLES_PER_RECORD; index += 1) {
      const seconds = sampleStartSecondsOf(edf, 0, index);
      expect(sampleAt(edf, 0, seconds)?.sampleIndex, `sample ${index} at ${seconds}s`).toBe(index);
    }
  });

  it('refuses rather than guessing when the index was never scanned', async () => {
    // Same rule as `segmentAt`: a probed index has read record 0 and the last record, so it cannot
    // say where a post-gap record starts, and inventing an answer is the defect this whole area
    // exists to avoid.
    const probed = await openEdf(byteSource(discontinuousFile()));
    expect(probed.index.coverage).toBe('probed');
    expect(() => sampleStartTicksOf(probed, 0, 12)).toThrow(/buildRecordIndex/);
    expect(() => sampleAt(probed, 0, 10)).toThrow(/buildRecordIndex/);
  });
});

describe('a file whose gaps and overlaps cancel in net', () => {
  // The shape edfcore's own docs name three times as the reason two probes are not a proof of
  // contiguity: a gap that an overlap elsewhere cancels exactly leaves `spanSeconds` equal to
  // `coveredSeconds`, so the file opens with NO diagnostic and the net-drift check says
  // "contiguous". Only a scanned index can tell.
  const ONSETS = [0, 1, 2, 2, 3, 5];

  async function cancelling(): Promise<EdfRecording> {
    const bytes = buildEdf({
      plus: 'D',
      recordCount: 6,
      recordDurationSeconds: 1,
      recordOnsetSeconds: (r: number) => ONSETS[r] as number,
      signals: [{ label: 'Fp1', samplesPerRecord: SAMPLES_PER_RECORD, sample: sampleValue }],
      annotationSignals: [{ samplesPerRecord: 60 }],
    });
    const recording = await openEdf(byteSource(bytes));
    return { ...recording, index: await buildRecordIndex(recording) };
  }

  it('really does hide its gap from the net-drift check', async () => {
    // Without this the assertions below would pass for the wrong reason.
    const edf = await cancelling();
    expect(edf.timeline.spanSeconds).toBe(edf.timeline.coveredSeconds);
    expect(edf.timeline.diagnostics).toEqual([]);
    expect(contiguityOf(edf.index)).toBe('discontinuous');
    expect(edf.index.gaps?.length).toBeGreaterThan(0);
  });

  it('locates a sample from the SCANNED index, not from net drift', async () => {
    // The seventh instance of this project's recurring defect, and the first one I introduced:
    // `sampleAt` asked the net-drift check before looking at the index, so it took the nominal
    // branch while a complete index sat on the same object reporting two gaps.
    const edf = await cancelling();
    const chunks = await readWindow(edf, {
      signalIndices: [0],
      startSeconds: 3.5,
      durationSeconds: 0.25,
    });
    const truth = (chunks[0]?.signals[0]?.firstSampleIndex ?? -1) + 2;
    expect(sampleAt(edf, 0, 3.5)?.sampleIndex).toBe(truth);
  });

  it('reports no sample inside the hole, as every other function does', async () => {
    const edf = await cancelling();
    expect(gapAt(edf.index, 4.5)).toBeDefined();
    expect(segmentAt(edf.index, 4.5)).toBeUndefined();
    expect(await edf.index.locate(4.5)).toBeUndefined();
    expect(sampleAt(edf, 0, 4.5)).toBeUndefined();
  });

  it('never names a record or sample the file does not have', async () => {
    // A float within half a tick of a segment end is inside the segment for `segmentAt`, which
    // compares float seconds, and at its end for the tick arithmetic that follows. Unbounded, that
    // walked into the next segment or off the end of the file.
    const edf = await cancelling();
    for (const seconds of [2.9999999, 2.99999995, 2.99999999, 3, 5.99999999, 6]) {
      const located = sampleAt(edf, 0, seconds);
      if (located === undefined) continue;
      expect(located.recordIndex, `${seconds}s`).toBeLessThan(edf.header.recordCount);
      expect(located.sampleIndex, `${seconds}s`).toBeLessThan(
        edf.header.recordCount * SAMPLES_PER_RECORD,
      );
    }
  });

  it('refuses a sample index the file does not have', async () => {
    // Past the end used to fall through to the nominal grid and come back EARLIER than the last
    // real sample: on this file sample 24 reported a time before sample 23.
    const edf = await cancelling();
    const total = edf.header.recordCount * SAMPLES_PER_RECORD;
    expect(() => sampleStartTicksOf(edf, 0, total)).toThrow(RangeError);
    expect(() => sampleStartTicksOf(edf, 0, -1)).toThrow(RangeError);
    expect(sampleStartTicksOf(edf, 0, total - 1)).toBeGreaterThan(0n);
  });

  it('cannot round-trip where two records cover the same instant, and that is the file', async () => {
    // Records 2 and 3 both begin at 2 s, so segments [0,3) and [2,4) overlap and the instant 2.5 s
    // is covered by TWO samples. No function can return both, so the round-trip pinned in 0.2.60
    // — "the sample at a sample's start is that sample, for every sample" — is false here. That
    // claim was too strong: it holds for files whose records do not overlap, which is every file
    // in the rest of this suite.
    const edf = await cancelling();
    expect(ONSETS[2]).toBe(ONSETS[3]);

    const overlapping = [8, 9, 10, 11].filter((index) => {
      const seconds = sampleStartSecondsOf(edf, 0, index);
      return sampleAt(edf, 0, seconds)?.sampleIndex !== index;
    });
    // Every sample of record 2 is shadowed by record 3, which starts at the same instant.
    expect(overlapping).toEqual([8, 9, 10, 11]);
  });
});

describe('an overlap is a negative gap, and that is how it is reported', () => {
  // Nothing invents a new shape for an overlap: `EdfGap.durationSeconds` simply goes negative,
  // and `validateRecording` turns that into RECORD_ONSET_SPACING_VIOLATION. Worth pinning,
  // because a caller summing gap durations to get "time lost" gets the right answer only if they
  // know a negative one is possible.
  const ONSETS = [0, 1, 2, 2, 3, 5];

  async function overlapping(): Promise<EdfRecording> {
    const bytes = buildEdf({
      plus: 'D',
      recordCount: 6,
      recordDurationSeconds: 1,
      recordOnsetSeconds: (r: number) => ONSETS[r] as number,
      signals: [{ label: 'Fp1', samplesPerRecord: SAMPLES_PER_RECORD, sample: sampleValue }],
      annotationSignals: [{ samplesPerRecord: 60 }],
    });
    const recording = await openEdf(byteSource(bytes));
    return { ...recording, index: await buildRecordIndex(recording) };
  }

  it('reports the overlap as a negative gap duration', async () => {
    const edf = await overlapping();
    expect(edf.index.gaps?.map((g) => g.durationSeconds)).toEqual([-1, 1]);
  });

  it('is reported by validateRecording, which is where a scan can see it', async () => {
    const edf = await overlapping();
    const report = await validateRecording(edf);
    expect(report.diagnostics.map((d) => d.code)).toContain('RECORD_ONSET_SPACING_VIOLATION');
  });

  it('is invisible to a probed index, which is expected rather than a defect', async () => {
    // Two probes see net drift, and this file's gap and overlap cancel exactly. edfcore's docs
    // say three times that this is why a probed index is not a proof of contiguity; this is that
    // sentence as a test.
    const bytes = buildEdf({
      plus: 'D',
      recordCount: 6,
      recordDurationSeconds: 1,
      recordOnsetSeconds: (r: number) => ONSETS[r] as number,
      signals: [{ label: 'Fp1', samplesPerRecord: SAMPLES_PER_RECORD }],
      annotationSignals: [{ samplesPerRecord: 60 }],
    });
    const probed = await openEdf(byteSource(bytes));
    expect(probed.timeline.diagnostics).toEqual([]);
    expect(contiguityOf(probed.index)).toBe('unknown');
  });

  it('makes segmentAt answer from one of the overlapping segments, not both', async () => {
    // Where two segments cover an instant there is no single right answer, and `segmentAt`
    // binary-searches, so it returns one of them. Pinned so the behaviour is a stated limit
    // rather than something rediscovered.
    const edf = await overlapping();
    const found = segmentAt(edf.index, 2.5);
    const covering = (edf.index.segments ?? []).filter(
      (s) => 2.5 >= s.startSeconds && 2.5 < s.endSeconds,
    );
    expect(covering.length).toBe(2);
    expect(covering).toContain(found);
  });
});
