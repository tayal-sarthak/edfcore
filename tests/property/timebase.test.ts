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
 * NOT COVERED HERE, deliberately and temporarily: `sampleIndexAt`, `sampleStartTicks` and
 * `sampleStartSeconds`. Running this invariant against them is what found the fifth instance —
 * `sampleStartSeconds(signal, 12, d)` answers 3 s for a sample that starts at 10 s on this fixture
 * — but they take `(signal, seconds, recordDurationTicks)` and no index, so they CANNOT see a gap
 * from their arguments. That is a signature problem rather than an arithmetic one, and the fix is
 * a separate decision; see the changelog. Adding them to this file is the last step of that fix,
 * and this paragraph is what stops the file reading as complete before then.
 */

import { describe, expect, it } from 'vitest';
import { filterAnnotationsByTime } from '../../src/annotations-query.js';
import { TICKS_PER_SECOND } from '../../src/constants.js';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex, gapAt, segmentAt } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfRecording } from '../../src/types.js';
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
