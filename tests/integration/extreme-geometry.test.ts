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
import { validateRecording } from '../../src/validate.js';

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

describe('a diagnostic per record does not blow the call stack', () => {
  // TIMEKEEPING_TAL_MISSING is deliberately per-record, so a long recording with a zeroed
  // annotation section reaches six figures honestly. push(...array) passes each element as a
  // call argument and V8 gives up at roughly 125,000 of them.
  for (const records of [130_000, 200_000]) {
    it(`validateRecording reports all ${records} diagnostics instead of throwing`, async () => {
      const recording = await openEdf(
        byteSource(edf({ records, recordDuration: '1', plus: true })),
      );

      const report = await validateRecording(recording);
      expect(report.diagnostics.length).toBeGreaterThanOrEqual(records);
    });
  }

  it('readAnnotations already handled it, and still does', async () => {
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
  });
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
