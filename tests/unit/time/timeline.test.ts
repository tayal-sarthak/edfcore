/**
 * `time/timeline.ts` — what a set of probed record onsets means.
 *
 * The three promises pinned here, all from DESIGN sections 3, 6 and "Contiguity checking,
 * stated precisely":
 *
 * 1. `spanSeconds` (last record end - first record start, gaps INCLUDED) and `coveredSeconds`
 *    (sum of the record durations) are computed independently, so their being equal is the
 *    statement "contiguous, as far as two reads can tell". Both directions are asserted.
 * 2. A file claiming EDF+C whose last onset misses `onset[0] + (n-1)*D` gets
 *    `DISCONTINUITY_IN_CONTINUOUS_FILE`; the same onsets under EDF+D are legal and silent.
 * 3. Onsets that go backwards are FATAL — `TIMELINE_NOT_MONOTONIC` throws with or without
 *    `strict`, because every time-based answer for such a file would be invented.
 */

import { describe, expect, it } from 'vitest';
import { EdfFormatError } from '../../../src/errors.js';
import { parseHeader } from '../../../src/header/parse.js';
import { byteSource } from '../../../src/io/bytes.js';
import { openEdf } from '../../../src/recording.js';
import {
  assertMonotonicOnsetArray,
  assertMonotonicOnsets,
  buildTimelineFromProbes,
  type RecordOnsetProbe,
} from '../../../src/time/timeline.js';
import type { EdfDiagnostic, EdfHeader, EdfTimeline } from '../../../src/types.js';
import { buildEdf, minimalEdf, minimalEdfPlus } from '../../support/writer.js';

/** 100 ns ticks per second, spelled out here so the tests do not import the constant they pin. */
const SECOND = 10_000_000n;

function headerOf(bytes: Uint8Array): EdfHeader {
  // parseHeader ignores anything past 256*(ns+1), so the whole file is a legal argument.
  return parseHeader(bytes, bytes.length);
}

async function timelineOf(bytes: Uint8Array): Promise<EdfTimeline> {
  const recording = await openEdf(byteSource(bytes));
  return recording.timeline;
}

function codesOf(diagnostics: readonly EdfDiagnostic[]): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw, but it returned');
}

async function captureAsyncError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to reject, but it resolved');
}

function expectFormatError(error: unknown, code: string): EdfFormatError {
  expect(error).toBeInstanceOf(EdfFormatError);
  const formatError = error as EdfFormatError;
  expect(formatError.code).toBe(code);
  return formatError;
}

function probes(onsetSeconds: readonly number[], startRecord = 0): RecordOnsetProbe[] {
  return onsetSeconds.map((seconds, position) => ({
    recordIndex: startRecord + position,
    onsetTicks: BigInt(Math.round(seconds * 1e7)),
  }));
}

/** An `EdfDiagnostic` literal: every field is present-or-undefined, never absent. */
function diagnostic(code: string): EdfDiagnostic {
  return {
    code,
    severity: 'warning',
    message: 'synthesised by a test',
    field: undefined,
    byteOffset: undefined,
    byteLength: undefined,
    rawBytes: undefined,
    raw: undefined,
    expected: undefined,
    actual: undefined,
    signalIndex: undefined,
    recordIndex: undefined,
    specReference: undefined,
  };
}

describe('spanSeconds against coveredSeconds', () => {
  // The identity is the whole point of computing the two separately, so it is asserted in both
  // directions: equal for a contiguous file, different for one with a real gap.

  it('are equal on a contiguous EDF+C file, which is what "contiguous" is allowed to mean', async () => {
    const timeline = await timelineOf(minimalEdfPlus({ recordCount: 5 }));

    expect(timeline.recordCount).toBe(5);
    expect(timeline.coveredSeconds).toBe(5);
    expect(timeline.spanSeconds).toBe(5);
    expect(timeline.spanSeconds).toBe(timeline.coveredSeconds);
    expect(codesOf(timeline.diagnostics)).toEqual([]);
  });

  it('are equal on a plain EDF file, whose onsets are arithmetic rather than stored', async () => {
    // No annotation signal means no timekeeping TAL exists to read: record r starts at
    // r * recordDuration by definition, and buildTimeline probes zero records.
    const timeline = await timelineOf(minimalEdf({ recordCount: 4 }));

    expect(timeline.spanSeconds).toBe(4);
    expect(timeline.coveredSeconds).toBe(4);
    expect(timeline.startOffsetSeconds).toBe(0);
  });

  it('differ by exactly the gap on an EDF+D file', async () => {
    // Two records, a 60 s gap, two more records: span reaches over the gap, covered does not.
    const bytes = buildEdf({
      plus: 'D',
      signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
      annotationSignals: [{ samplesPerRecord: 30 }],
      recordCount: 4,
      recordDurationSeconds: 1,
      recordOnsetSeconds: (r) => (r < 2 ? r : r + 60),
    });

    const timeline = await timelineOf(bytes);

    expect(timeline.coveredSeconds).toBe(4);
    expect(timeline.spanSeconds).toBe(64); // onset[3] = 63, plus one record duration.
    expect(timeline.spanSeconds).not.toBe(timeline.coveredSeconds);
    expect(timeline.spanSeconds - timeline.coveredSeconds).toBe(60);
  });

  it('are both zero for a file with no data records', () => {
    const header = headerOf(minimalEdf({ recordCount: 0 }));
    const timeline = buildTimelineFromProbes({ header, probes: [] });

    expect(timeline.recordCount).toBe(0);
    expect(timeline.spanSeconds).toBe(0);
    expect(timeline.coveredSeconds).toBe(0);
    expect(timeline.startOffsetTicks).toBe(0n);
  });
});

describe('startOffsetSeconds', () => {
  // EDF+ 2.2.1: record 0's timekeeping onset is "+0.X" with 0 <= X < 1, and X IS the recording's
  // sub-second start. Anything outside [0, 1) means the writer encoded something else there.
  const singleRecordHeader = headerOf(minimalEdfPlus({ recordCount: 1 }));

  const offsetCases = [
    { name: 'a zero offset is the ordinary case', ticks: 0n, seconds: 0, reported: false },
    {
      name: 'half a second is inside the legal range',
      ticks: 5_000_000n,
      seconds: 0.5,
      reported: false,
    },
    {
      name: 'the last representable tick below one second is still legal',
      ticks: 9_999_999n,
      seconds: 0.9999999,
      reported: false,
    },
    {
      name: 'exactly one second is out of range: the whole second belongs in starttime',
      ticks: SECOND,
      seconds: 1,
      reported: true,
    },
    {
      name: 'a negative offset is out of range',
      ticks: -1n,
      seconds: -1e-7,
      reported: true,
    },
  ] as const;

  for (const offsetCase of offsetCases) {
    it(offsetCase.name, () => {
      const timeline = buildTimelineFromProbes({
        header: singleRecordHeader,
        probes: [{ recordIndex: 0, onsetTicks: offsetCase.ticks }],
      });

      // Used as written either way — the value is still that record's start, and edfcore does
      // not clamp a file's number into the range the file should have used.
      expect(timeline.startOffsetTicks).toBe(offsetCase.ticks);
      expect(timeline.startOffsetSeconds).toBeCloseTo(offsetCase.seconds, 9);
      expect(codesOf(timeline.diagnostics).includes('START_OFFSET_OUT_OF_RANGE')).toBe(
        offsetCase.reported,
      );
    });
  }

  it('reports START_OFFSET_OUT_OF_RANGE exactly once for a file whose record 0 starts 1.5 s in', async () => {
    const timeline = await timelineOf(
      buildEdf({
        plus: 'C',
        signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
        annotationSignals: [{ samplesPerRecord: 30 }],
        recordCount: 1,
        recordDurationSeconds: 1,
        startOffsetSeconds: 1.5,
      }),
    );

    // decodeAnnotations already reported it for the record-0 probe; the timeline folds that in
    // rather than emitting a second copy of the same fact.
    expect(codesOf(timeline.diagnostics)).toEqual(['START_OFFSET_OUT_OF_RANGE']);
    expect(timeline.startOffsetSeconds).toBe(1.5);
    expect(timeline.startOffsetTicks).toBe(15_000_000n);
  });

  it('does not repeat a START_OFFSET_OUT_OF_RANGE the probe diagnostics already carry', () => {
    const timeline = buildTimelineFromProbes({
      header: singleRecordHeader,
      probes: [{ recordIndex: 0, onsetTicks: 3n * SECOND }],
      probeDiagnostics: [diagnostic('START_OFFSET_OUT_OF_RANGE')],
    });

    expect(codesOf(timeline.diagnostics)).toEqual(['START_OFFSET_OUT_OF_RANGE']);
  });

  it('is a warning, not a refusal: the timeline is still derived', () => {
    const timeline = buildTimelineFromProbes({
      header: singleRecordHeader,
      probes: [{ recordIndex: 0, onsetTicks: 3n * SECOND }],
    });

    expect(timeline.diagnostics[0]?.severity).toBe('warning');
    expect(timeline.spanSeconds).toBe(1);
    expect(timeline.coveredSeconds).toBe(1);
  });
});

describe('contiguity, from the two probes openEdf pays for', () => {
  /** EDF+C onsets 0, 1, 2, 3.5 — the last record starts half a second late. */
  const driftingOnsets = (r: number): number => (r === 3 ? 3.5 : r);

  function fourRecordFile(plus: 'C' | 'D', onsets: (r: number) => number): Uint8Array {
    return buildEdf({
      plus,
      signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
      annotationSignals: [{ samplesPerRecord: 30 }],
      recordCount: 4,
      recordDurationSeconds: 1,
      recordOnsetSeconds: onsets,
    });
  }

  it('emits DISCONTINUITY_IN_CONTINUOUS_FILE when an EDF+C last onset misses the arithmetic', async () => {
    // EDF+ 2.2.1 / DESIGN "Contiguity checking": in a continuous file every onset is
    // startOffset + recordIndex * recordDuration, so onset[n-1] != onset[0] + (n-1)*D is a
    // discontinuity however small.
    const timeline = await timelineOf(fourRecordFile('C', driftingOnsets));

    expect(codesOf(timeline.diagnostics)).toContain('DISCONTINUITY_IN_CONTINUOUS_FILE');
    expect(timeline.spanSeconds).toBe(4.5);
    expect(timeline.coveredSeconds).toBe(4);
  });

  it('stays silent on the same onsets when the file admits to being EDF+D', async () => {
    // A discontinuous file is allowed to spread its records out; that is what EDF+D is for.
    const timeline = await timelineOf(fourRecordFile('D', driftingOnsets));

    expect(codesOf(timeline.diagnostics)).toEqual([]);
    expect(timeline.spanSeconds).toBe(4.5);
    expect(timeline.coveredSeconds).toBe(4);
  });

  it('emits RECORD_ONSET_SPACING_VIOLATION when an EDF+D file pulls its records together', async () => {
    // Onsets 0, 1, 2, 2.5 with a 1 s record: record 3 starts before record 2 ends. A gap is
    // legal in EDF+D; an overlap never is.
    const timeline = await timelineOf(fourRecordFile('D', (r) => (r === 3 ? 2.5 : r)));

    expect(codesOf(timeline.diagnostics)).toEqual(['RECORD_ONSET_SPACING_VIOLATION']);
    expect(timeline.spanSeconds).toBe(3.5);
    expect(timeline.coveredSeconds).toBe(4);
  });

  it('throws the discontinuity under strict instead of collecting it', () => {
    const header = headerOf(fourRecordFile('C', driftingOnsets));
    const input = {
      header,
      probes: [
        { recordIndex: 0, onsetTicks: 0n },
        { recordIndex: 3, onsetTicks: (35n * SECOND) / 10n },
      ],
    };

    expectFormatError(
      captureError(() => buildTimelineFromProbes(input, { strict: true })),
      'DISCONTINUITY_IN_CONTINUOUS_FILE',
    );
    // Without strict the same fact is a value on the result: one diagnostic, no throw.
    expect(codesOf(buildTimelineFromProbes(input).diagnostics)).toEqual([
      'DISCONTINUITY_IN_CONTINUOUS_FILE',
    ]);
  });

  it('cannot see a gap that an overlap cancels exactly — the documented two-probe limit', async () => {
    // Onsets 0, 2, 2, 3 with a 1 s record: a 1 s gap after record 0 and a 1 s overlap after
    // record 1, so the two ends land exactly where a contiguous file would put them. Two probes
    // detect any NET drift and nothing more; DESIGN says so, and only buildRecordIndex() /
    // validateRecording(), which read every onset, can see this file's shape.
    const timeline = await timelineOf(fourRecordFile('C', (r) => [0, 2, 2, 3][r] ?? r));

    expect(codesOf(timeline.diagnostics)).toEqual([]);
    expect(timeline.spanSeconds).toBe(4);
    expect(timeline.coveredSeconds).toBe(4);
  });
});

describe('monotonicity is fatal', () => {
  const header = headerOf(minimalEdfPlus({ recordCount: 4 }));

  it('accepts equal onsets, which a zero-duration record makes legal', () => {
    expect(() =>
      assertMonotonicOnsets({ recordIndex: 0, onsetTicks: 5n }, { recordIndex: 1, onsetTicks: 5n }),
    ).not.toThrow();
  });

  it('throws TIMELINE_NOT_MONOTONIC on a backwards pair', () => {
    const error = captureError(() =>
      assertMonotonicOnsets(
        { recordIndex: 2, onsetTicks: 3n * SECOND },
        { recordIndex: 3, onsetTicks: 1n * SECOND },
      ),
    );

    const formatError = expectFormatError(error, 'TIMELINE_NOT_MONOTONIC');
    expect(formatError.edfErrorKind).toBe('format');
    expect(formatError.recordIndex).toBe(3);
    expect(formatError.diagnostic?.severity).toBe('error');
  });

  it('throws without strict, because a fatal code is not a strictness setting', () => {
    const input = {
      header,
      probes: [
        { recordIndex: 0, onsetTicks: 0n },
        { recordIndex: 3, onsetTicks: -5n * SECOND },
      ],
    };

    expectFormatError(
      captureError(() => buildTimelineFromProbes(input)),
      'TIMELINE_NOT_MONOTONIC',
    );
    expectFormatError(
      captureError(() => buildTimelineFromProbes(input, { strict: false })),
      'TIMELINE_NOT_MONOTONIC',
    );
  });

  it('names the record in the file, not the position in the array', () => {
    // A scan that starts at record 10 must not report "record 1".
    const error = captureError(() => assertMonotonicOnsetArray([0n, 2n * SECOND, 1n * SECOND], 10));

    const formatError = expectFormatError(error, 'TIMELINE_NOT_MONOTONIC');
    expect(formatError.recordIndex).toBe(12);
  });

  it('rejects opening a file whose last record starts before its first', async () => {
    const bytes = buildEdf({
      plus: 'D',
      signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
      annotationSignals: [{ samplesPerRecord: 30 }],
      recordCount: 4,
      recordDurationSeconds: 1,
      recordOnsetSeconds: (r) => (r === 3 ? -5 : r),
    });

    const error = await captureAsyncError(() => openEdf(byteSource(bytes)));

    expectFormatError(error, 'TIMELINE_NOT_MONOTONIC');
  });
});

describe('the probe array must describe the whole file', () => {
  // A RangeError, never an EdfFormatError: nothing here is the file's fault.
  const header = headerOf(minimalEdfPlus({ recordCount: 4 }));

  /*
   * `says` is the point of this table, not decoration.
   *
   * `assertProbeShape` refuses three different things and every case here asserted only
   * `RangeError`, so a case proved nothing about the guard it was named after — it proved that
   * SOME guard refused it. The out-of-order case was the one that drifted: its probes ran
   * 0, 3, 1, whose LAST entry is record 1 rather than record 3, so it was refused by the
   * ends-of-the-file check two guards earlier and the ordering loop never ran once in the suite.
   * Deleting that loop outright left every test here green.
   */
  const badProbeCases = [
    {
      name: 'no probes at all for a file that has records',
      probes: [] as RecordOnsetProbe[],
      says: 'received no onset probes for a file with 4 data records',
    },
    {
      name: 'the first probe is not record 0',
      probes: probes([1, 3], 1),
      says: 'received probes for records 1..2',
    },
    {
      name: 'the last probe is not the last record',
      probes: [
        { recordIndex: 0, onsetTicks: 0n },
        { recordIndex: 2, onsetTicks: 2n * SECOND },
      ],
      says: 'received probes for records 0..2',
    },
    {
      // Both ends are right, so nothing before the ordering loop has anything to say about it,
      // and the onsets rise throughout so the monotonicity check that runs next cannot either.
      name: 'the probes are out of order between the two ends',
      probes: [
        { recordIndex: 0, onsetTicks: 0n },
        { recordIndex: 2, onsetTicks: 1n * SECOND },
        { recordIndex: 1, onsetTicks: 2n * SECOND },
        { recordIndex: 3, onsetTicks: 3n * SECOND },
      ],
      says: 'received probes out of order: record 1 follows record 2',
    },
  ];

  for (const badCase of badProbeCases) {
    it(`refuses ${badCase.name}`, () => {
      const error = captureError(() => buildTimelineFromProbes({ header, probes: badCase.probes }));

      expect(error).toBeInstanceOf(RangeError);
      expect(error).not.toBeInstanceOf(EdfFormatError);
      expect((error as RangeError).message).toContain(badCase.says);
    });
  }

  it('accepts an intermediate probe that IS in order, so the loop refuses only disorder', () => {
    // The same four probes sorted. `assertProbeShape` documents intermediate probes as optional
    // rather than unwelcome, and without this the ordering loop could refuse every array of
    // three or more and still pass the case above.
    const timeline = buildTimelineFromProbes({
      header,
      probes: [
        { recordIndex: 0, onsetTicks: 0n },
        { recordIndex: 1, onsetTicks: 1n * SECOND },
        { recordIndex: 2, onsetTicks: 2n * SECOND },
        { recordIndex: 3, onsetTicks: 3n * SECOND },
      ],
    });
    expect(timeline.recordCount).toBe(4);
  });

  it('refuses probes for a file with no records', () => {
    const emptyHeader = headerOf(minimalEdf({ recordCount: 0 }));

    expect(() =>
      buildTimelineFromProbes({
        header: emptyHeader,
        probes: [{ recordIndex: 0, onsetTicks: 0n }],
      }),
    ).toThrow(/received 1 onset probes for a file with no data records/);
  });
});
