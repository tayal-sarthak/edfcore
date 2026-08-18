/**
 * Two ways a legal-looking header broke the safety invariant.
 *
 * The invariant, from tests/property/fuzz.test.ts: for any byte sequence, edfcore either parses
 * it or throws an `EdfError`. It never hangs, never allocates unboundedly, never returns `NaN`,
 * and never returns believable garbage.
 *
 * A long recording with a systematically damaged annotation section broke the first half — the
 * thrown value was a bare `RangeError` about the call stack. A declared span past the tick range
 * broke the second — no throw at all, and an index that looked complete and was wrong.
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { sampleAt } from '../../src/sample-locate.js';
import { resolveTimeWindow } from '../../src/time/window.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

/** A header writer independent of tests/support/writer.ts, so the geometry can be absurd. */
function edf(options: {
  records: number;
  recordDuration: string;
  plus: boolean;
  dataSamples?: number;
  annotationSamples?: number;
}): Uint8Array {
  const { records, recordDuration, plus } = options;
  const dataSamples = options.dataSamples ?? 2;
  const annotationSamples = plus ? (options.annotationSamples ?? 128) : 0;
  const signalCount = plus ? 2 : 1;
  const headerBytes = 256 * (signalCount + 1);
  const recordBytes = (dataSamples + annotationSamples) * 2;

  const out = new Uint8Array(headerBytes + records * recordBytes);
  const put = (text: string | number, offset: number, width: number): void => {
    const padded = String(text).padEnd(width, ' ');
    for (let i = 0; i < width; i += 1) out[offset + i] = padded.charCodeAt(i);
  };

  put('0', 0, 8);
  put('X X X X', 8, 80);
  put('Startdate X X X X', 88, 80);
  put('01.01.20', 168, 8);
  put('10.00.00', 176, 8);
  put(headerBytes, 184, 8);
  put(plus ? 'EDF+C' : '', 192, 44);
  put(records, 236, 8);
  put(recordDuration, 244, 8);
  put(signalCount, 252, 4);

  const labels = plus ? ['EEG Fpz-Cz', 'EDF Annotations'] : ['EEG Fpz-Cz'];
  const samples = plus ? [dataSamples, annotationSamples] : [dataSamples];
  const fields: Array<[number, (i: number) => string]> = [
    [16, (i) => labels[i] ?? ''],
    [80, (i) => (i === 0 ? 'AgAgCl' : '')],
    [8, (i) => (i === 0 ? 'uV' : '')],
    [8, (i) => (i === 0 ? '-500' : '-1')],
    [8, (i) => (i === 0 ? '500' : '1')],
    [8, () => '-32768'],
    [8, () => '32767'],
    [80, (i) => (i === 0 ? 'HP:0.1Hz' : '')],
    [8, (i) => String(samples[i] ?? 0)],
    [32, () => ''],
  ];
  let block = 256;
  for (const [width, value] of fields) {
    for (let i = 0; i < signalCount; i += 1) put(value(i), block + i * width, width);
    block += width * signalCount;
  }
  // The data section stays all zeros, so no record carries a timekeeping TAL.
  return out;
}

/**
 * Generous on purpose — see the note below. It exists to fail an infinite loop, not a slow
 * machine.
 */
const HANG_DETECTOR_MS = 300_000;

describe('a diagnostic per record does not blow the call stack', () => {
  // TIMEKEEPING_TAL_MISSING is deliberately per-record, so a long recording with a zeroed
  // annotation section reaches six figures honestly. push(...array) passes each element as a
  // call argument and V8 gives up at roughly 125,000 of them.
  // The trailing timeout is a HANG DETECTOR, not a performance budget, and the difference is the
  // whole reason it has been wrong twice. What these cases assert is that a diagnostic per record
  // does not blow the call stack; how long the sweep takes is not the property. A number chosen
  // to sit just above the observed duration therefore measures the machine rather than the code,
  // and reports a red build in something the test does not touch.
  //
  // It began at vitest's 5 s default, which the 200,000-record sweep landed a few hundred
  // milliseconds under on its own, so it tipped over whenever the rest of the suite ran beside
  // it. Raising it to 30 s fixed that and repeated the mistake at a larger number: the suite kept
  // growing — 2,074 tests now, one of which spawns a TypeScript compiler over 102 files — and on
  // a machine already busy with unrelated work this took 72 s and failed again (0.4.276).
  //
  // Five minutes is deliberately far above anything a working implementation can take. An
  // infinite loop still fails; a loaded laptop does not.
  for (const records of [130_000, 200_000]) {
    it(
      `validateRecording reports all ${records} diagnostics instead of throwing`,
      async () => {
        const recording = await openEdf(
          byteSource(edf({ records, recordDuration: '1', plus: true })),
        );

        const report = await validateRecording(recording);
        expect(report.diagnostics.length).toBeGreaterThanOrEqual(records);
      },
      HANG_DETECTOR_MS,
    );
  }

  it(
    'readAnnotations already handled it, and still does',
    async () => {
      // The same array is built through DiagnosticSink.report with no spread, which is why only
      // the sweep that exists for untrusted files crashed.
      const recording = await openEdf(
        byteSource(edf({ records: 130_000, recordDuration: '1', plus: true })),
      );
      const result = await readAnnotations(recording, {
        start: 0,
        count: recording.header.recordCount,
      });
      expect(result.diagnostics).toHaveLength(130_000);
    },
    HANG_DETECTOR_MS,
  );
});

describe('a declared span past the representable tick range is refused', () => {
  it('throws a typed EdfError naming the field, not a wrapped index', async () => {
    // Onsets live in a BigInt64Array, and assignment to one wraps rather than throwing. That
    // produced an index reporting coverage 'complete' with one segment per record, negative
    // gaps between them, and no diagnostic anywhere.
    const error = await openEdf(
      byteSource(edf({ records: 900, recordDuration: '1E30', plus: false })),
    )
      .then(() => undefined)
      .catch((thrown: unknown) => thrown);

    expect(isEdfError(error)).toBe(true);
    expect(error).toMatchObject({
      edfErrorKind: 'format',
      code: 'RECORDING_SPAN_UNREPRESENTABLE',
      field: 'recordDuration',
      byteOffset: 244,
    });
  });

  it('leaves an ordinary geometry alone', async () => {
    // The bound is over 29,000 years, so nothing a real recorder writes can reach it.
    const recording = await openEdf(
      byteSource(edf({ records: 10, recordDuration: '1', plus: false })),
    );
    const index = await buildRecordIndex(recording);
    expect(index.segments).toHaveLength(1);
    expect(await index.onsetTicks(3)).toBe(30_000_000n);
  });

  it('still accepts the legal zero record duration', async () => {
    // ZERO_RECORD_DURATION is a warning and a real sleep-staging file relies on it; a span of
    // zero must not trip the overflow check.
    const recording = await openEdf(
      byteSource(edf({ records: 4, recordDuration: '0', plus: false })),
    );
    expect(recording.header.recordDurationSeconds).toBe(0);
  });
});

/**
 * The third way, and the one that produced no error at all.
 *
 * `EdfTimeline` carried the span and the coverage only as float64 seconds, and every caller asked
 * the contiguity question of that pair. The exact tick counts existed — `buildTimelineFromProbes`
 * computes both in bigint — and were discarded at the return. Two different tick counts round to
 * one float once an ulp of the span exceeds a tick, so a real discontinuity vanished from the
 * comparison and the file read as contiguous. Fixed in 0.3.4 by returning `spanTicks` and
 * `coveredTicks` and comparing those.
 */
describe('a discontinuity too small to survive the conversion to seconds', () => {
  /** 1e9 s per record over 10 records: a span of 1e10 s, where one ulp is about 19 ticks. */
  function collidingFile(): Uint8Array {
    return buildEdf({
      plus: 'D',
      recordCount: 10,
      // The declared value is written raw: `recordDuration` is a free-form 8-byte ASCII field and
      // exponent notation fits in three bytes, which is the whole reason this file is reachable.
      recordDurationSeconds: 1,
      raw: { recordDuration: '1e9' },
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
      annotationSignals: [{ samplesPerRecord: 40 }],
      // Record 9 starts one 100 ns tick late. Every earlier record is exactly on the grid.
      recordOnsetSeconds: (i: number) =>
        i === 9 ? '+9000000000.0000001' : `+${(i * 1e9).toFixed(0)}`,
    });
  }

  it('is invisible in the seconds and visible in the ticks', async () => {
    const recording = await openEdf(byteSource(collidingFile()));
    // The premise. If this ever stops holding, the tests below stop testing anything.
    expect(recording.timeline.spanSeconds).toBe(recording.timeline.coveredSeconds);
    expect(recording.timeline.spanTicks).not.toBe(recording.timeline.coveredTicks);
    expect(recording.timeline.spanTicks - recording.timeline.coveredTicks).toBe(1n);
  });

  it('is a real gap, as a full scan confirms', async () => {
    const recording = await openEdf(byteSource(collidingFile()));
    const index = await buildRecordIndex(recording);
    expect(index.segments).toHaveLength(2);
    expect(index.gaps).toHaveLength(1);
  });

  it('makes resolveTimeWindow refuse instead of mapping the nominal grid', async () => {
    const recording = await openEdf(byteSource(collidingFile()));
    // A probed index cannot say where the records after the gap start, so the honest answer is a
    // refusal naming the next step. Before 0.3.4 this returned one range covering all 10 records.
    expect(() => resolveTimeWindow(recording.timeline, recording.index, 0, 1e10)).toThrow(
      RangeError,
    );
    // The seconds in that message print identically, so the ticks are stated too.
    expect(() => resolveTimeWindow(recording.timeline, recording.index, 0, 1e10)).toThrow(
      /ticks of 100 ns/,
    );
  });

  it('makes sampleAt agree with the scanned index instead of contradicting it', async () => {
    const recording = await openEdf(byteSource(collidingFile()));
    // t = 9e9 s falls in the gap: record 8 ended there and record 9 has not started. The scanned
    // index says so, and the probed one used to answer `record 9, sample 36` for the same instant.
    const scanned = { ...recording, index: await buildRecordIndex(recording) };
    expect(sampleAt(scanned, 0, 9e9)).toBeUndefined();
    expect(() => sampleAt(recording, 0, 9e9)).toThrow(/buildRecordIndex/);
  });
});
