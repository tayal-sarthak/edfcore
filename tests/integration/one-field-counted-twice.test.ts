/**
 * One malformed identification field, counted as two warnings.
 *
 * `validateRecording` builds its list by spreading `header.diagnostics`, `validateHeader(header)`
 * and the timeline's together. The first two overlap: `validateHeader` re-derives
 * `PATIENT_ID_NONCONFORMANT` and `RECORDING_ID_NONCONFORMANT` because it has to stand alone for a
 * caller who holds only a header, and the parser already reported them.
 *
 * So one bad patient field produced a verdict line reading "2 warnings", a `by code:` block reading
 * `2 PATIENT_ID_NONCONFORMANT`, the block printed twice, and a `summarizeDiagnostics` total one
 * higher than the number of things wrong with the file.
 *
 * The two codes that overlap are the identification fields, which is to say the two a reader is
 * likeliest to be looking at — and the only two whose text a caller may have asked to redact.
 *
 * `inspectEdf` reports them once. So the two published ways of asking what is wrong with a file
 * disagreed about how many things there were, which is the divergence `scalingError` was written to
 * stop: "the two published entry points answered ... with different codes for one signal".
 *
 * Matched on code, field, signal and offset rather than on code alone. A code can legitimately fire
 * more than once — `TIMEKEEPING_TAL_NONCONFORMANT` is reported per record on purpose, because "each
 * one names a different annotation that was lost" — and `time/timeline.ts` keeps its own
 * `priorDiagnostics.some(...)` test for the same reason.
 */

import { describe, expect, it } from 'vitest';
import { summarizeDiagnostics } from '../../src/diagnostics/summary.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfDiagnostic } from '../../src/types.js';
import { formatValidationReport, validateHeader, validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

/** Both identification fields malformed, so both overlapping codes fire. */
const MESSY = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 2,
  recordDurationSeconds: 1,
  patientId: 'Ada Lovelace',
  recordingId: 'not a startdate line',
  signals: [{ label: 'EEG Fp1', samplesPerRecord: 4 }],
  annotationSignals: [{ samplesPerRecord: 16 }],
});

const counted = (diagnostics: readonly EdfDiagnostic[], code: string): number =>
  diagnostics.filter((diagnostic) => diagnostic.code === code).length;

const OVERLAPPING = ['PATIENT_ID_NONCONFORMANT', 'RECORDING_ID_NONCONFORMANT'] as const;

describe('the two codes both halves derive', () => {
  it('are still reported by each half on its own', async () => {
    const recording = await openEdf(byteSource(MESSY));
    for (const code of OVERLAPPING) {
      expect(counted(recording.header.diagnostics, code), `header ${code}`).toBe(1);
      expect(counted(validateHeader(recording.header), code), `validateHeader ${code}`).toBe(1);
    }
  });

  it('appear once in the report, not twice', async () => {
    const recording = await openEdf(byteSource(MESSY));
    const report = await validateRecording(recording, { scanSamples: true });
    for (const code of OVERLAPPING) {
      expect(counted(report.diagnostics, code), code).toBe(1);
    }
  });

  it('are counted once by the summary the report is printed from', async () => {
    const recording = await openEdf(byteSource(MESSY));
    const report = await validateRecording(recording, { scanSamples: true });
    const summary = summarizeDiagnostics(report.diagnostics);
    for (const code of OVERLAPPING) {
      const row = summary.byCode.find((entry) => entry.code === code);
      expect(row?.count, code).toBe(1);
    }
    expect(summary.total).toBe(report.diagnostics.length);
  });

  it('are printed once, and counted once in the verdict line', async () => {
    const recording = await openEdf(byteSource(MESSY));
    const report = await validateRecording(recording, { scanSamples: true });
    const text = formatValidationReport(report);
    for (const code of OVERLAPPING) {
      // Once in the `by code:` block and once as its own block.
      expect((text.match(new RegExp(code, 'g')) ?? []).length, code).toBe(2);
    }
    expect(text).toContain('2 warnings');
  });
});

describe('the other published way of asking', () => {
  it('agrees with the report about how many things are wrong', async () => {
    const recording = await openEdf(byteSource(MESSY));
    const report = await validateRecording(recording, { scanSamples: true });
    const inspection = await inspectEdf(byteSource(MESSY));
    for (const code of OVERLAPPING) {
      expect(counted(inspection.diagnostics, code), code).toBe(counted(report.diagnostics, code));
    }
  });
});

describe('what de-duplication must not swallow', () => {
  it('keeps every code the header did not already report', async () => {
    const recording = await openEdf(byteSource(MESSY));
    const report = await validateRecording(recording, { scanSamples: true });
    const codes = new Set(report.diagnostics.map((diagnostic) => diagnostic.code));
    for (const code of validateHeader(recording.header).map((d) => d.code)) {
      expect(codes.has(code), code).toBe(true);
    }
  });

  it('keeps a second diagnostic of the same code on a different signal', async () => {
    const two = buildEdf({
      format: 'EDF',
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [
        { label: 'ECG', samplesPerRecord: 4 },
        { label: 'PLETHWAVE', samplesPerRecord: 4 },
      ],
    });
    const recording = await openEdf(byteSource(two));
    const report = await validateRecording(recording, { scanSamples: true });
    expect(counted(report.diagnostics, 'LABEL_CONVENTION_NONCONFORMANT')).toBe(2);
    const signals = report.diagnostics
      .filter((d) => d.code === 'LABEL_CONVENTION_NONCONFORMANT')
      .map((d) => d.signalIndex);
    expect(signals).toEqual([0, 1]);
  });
});
