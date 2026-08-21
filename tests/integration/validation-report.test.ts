/**
 * What a `ValidationReport` promises, on `validation.md`.
 *
 * `ok` is the field a caller branches on, and the page is careful that it means less than it looks
 * like: "It is not a claim that the file is conformant, and a false `ok` is not a claim that the
 * file is unreadable." It is exactly "no diagnostic has severity `error`", and the page names the
 * four codes that reach a report at that severity — all scaling ones, each meaning one signal has
 * no defined conversion to physical units while `decodeDigital` on it keeps working.
 *
 * The sentence after them is the one worth pinning hardest: "The always-fatal codes never reach a
 * report at all, because a file carrying one of them cannot be opened. The single exception is
 * `TIMELINE_NOT_MONOTONIC`, which the sweep throws rather than reports." An always-fatal code
 * appearing in a report would mean a file that could not be opened had been validated, which is
 * incoherent rather than merely wrong.
 *
 * And `signalStats` has a shape a caller indexes by: one entry per DATA signal, in
 * `dataSignalIndices` order. Annotation channels are excluded because their bytes are text, so an
 * off-by-one there gives every channel its neighbour's statistics.
 */

import { describe, expect, it } from 'vitest';
import { dispositionOf } from '../../src/diagnostics/codes.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const FLAT = (DOCS_PAGES.get('validation.md') ?? '').replace(/\s+/g, ' ');

/** The four codes the page says are the error-severity ones that survive to a report. */
const SURVIVING = (() => {
  const sentence =
    /the error-severity codes that survive to a report are the scaling ones \(([^)]+)\)/.exec(FLAT);
  if (sentence === null) throw new Error('validation.md no longer names the surviving codes');
  return [...(sentence[1] ?? '').matchAll(/`([A-Z_]+)`/g)].map(([, code = '']) => code);
})();

const CLEAN = minimalEdfPlus({
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fpz-Cz', samplesPerRecord: 8 },
    { label: 'Resp oro-nasal', samplesPerRecord: 4 },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

/** One signal with no usable scale, which is how an `error` reaches a report. */
const DEGENERATE = buildEdf({
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 8 },
    { label: 'D', samplesPerRecord: 8, digitalMinimum: 0, digitalMaximum: 0 },
  ],
});

describe('ok, and what it does not claim', () => {
  it('names four surviving codes, all of them scaling ones', () => {
    expect(SURVIVING).toHaveLength(4);
    for (const code of SURVIVING) expect(dispositionOf(code), code).not.toBe('fatal');
  });

  it('is exactly "no diagnostic has severity error"', async () => {
    for (const bytes of [CLEAN, DEGENERATE]) {
      const recording = await openEdf(byteSource(bytes));
      const report = await validateRecording(recording, { scanSamples: true });
      expect(report.ok).toBe(!report.diagnostics.some((entry) => entry.severity === 'error'));
    }
  });

  it('goes false for a signal with no scale, and stays readable', async () => {
    const recording = await openEdf(byteSource(DEGENERATE));
    const report = await validateRecording(recording, { scanSamples: true });
    expect(report.ok).toBe(false);
    const errors = report.diagnostics.filter((entry) => entry.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    for (const entry of errors) expect(SURVIVING, entry.code).toContain(entry.code);
    // "a false `ok` is not a claim that the file is unreadable" — the other signal is fine.
    expect(recording.header.signals[0]?.scale).toBeDefined();
    expect(recording.header.signals[1]?.scale).toBeUndefined();
  });

  it('carries no always-fatal code, which could not have been opened', async () => {
    // The incoherent case: a report about a file that cannot exist as a recording.
    for (const bytes of [CLEAN, DEGENERATE]) {
      const recording = await openEdf(byteSource(bytes));
      const report = await validateRecording(recording, { scanSamples: true });
      for (const entry of report.diagnostics) {
        expect(dispositionOf(entry.code), entry.code).not.toBe('fatal');
      }
    }
  });

  it('throws the one exception rather than reporting it', async () => {
    // "The single exception is `TIMELINE_NOT_MONOTONIC`, which the sweep throws rather than
    //  reports."
    expect(FLAT).toContain('which the sweep throws rather than reports');
    const backwards = minimalEdfPlus({
      plus: 'D',
      recordCount: 6,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
      annotationSignals: [{ samplesPerRecord: 40 }],
      recordOnsetSeconds: (record) => (record === 2 ? 0 : record * 10),
    });
    const recording = await openEdf(byteSource(backwards));
    await expect(validateRecording(recording)).rejects.toThrow();
  });
});

describe('signalStats', () => {
  it('is empty unless scanSamples was asked for', async () => {
    const recording = await openEdf(byteSource(CLEAN));
    expect((await validateRecording(recording)).signalStats).toEqual([]);
    expect((await validateRecording(recording, { scanSamples: true })).signalStats).not.toEqual([]);
  });

  it('has one entry per data signal, in dataSignalIndices order', async () => {
    // Annotation channels are excluded because their bytes are text, so an off-by-one here gives
    // every channel its neighbour's statistics.
    const recording = await openEdf(byteSource(CLEAN));
    const report = await validateRecording(recording, { scanSamples: true });
    expect(report.signalStats.map((entry) => entry.signalIndex)).toEqual([
      ...recording.header.dataSignalIndices,
    ]);
    for (const entry of report.signalStats) {
      expect(recording.header.signals[entry.signalIndex]?.kind).toBe('data');
    }
  });

  it('reports zeroes rather than infinities for a signal with no samples', async () => {
    // "`observedDigitalMin` and `observedDigitalMax` are both reported as `0` in that case rather
    //  than as infinities, so the struct stays numeric; `sampleCount === 0` is what tells you it's
    //  empty." An `-Infinity` maximum is what an unseeded reduce produces and it is a number a
    //  caller would plot.
    expect(FLAT).toContain('rather than as infinities, so the struct stays numeric');
    const empty = buildEdf({
      recordCount: 0,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
    });
    const recording = await openEdf(byteSource(empty));
    const report = await validateRecording(recording, { scanSamples: true });
    const stats = report.signalStats[0];
    expect(stats?.sampleCount).toBe(0);
    expect(stats?.observedDigitalMin).toBe(0);
    expect(stats?.observedDigitalMax).toBe(0);
    expect(Number.isFinite(stats?.observedDigitalMin ?? Number.NaN)).toBe(true);
    expect(Number.isFinite(stats?.observedDigitalMax ?? Number.NaN)).toBe(true);
  });

  it('reports the observed extremes of a signal that has samples', async () => {
    const spread = buildEdf({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [
        {
          label: 'Fp1',
          samplesPerRecord: 4,
          sample: (record, index) => (record === 0 ? ([-500, -50, 50, 500][index] ?? 0) : 0),
        },
      ],
    });
    const recording = await openEdf(byteSource(spread));
    const report = await validateRecording(recording, { scanSamples: true });
    const stats = report.signalStats[0];
    expect(stats?.observedDigitalMin).toBe(-500);
    expect(stats?.observedDigitalMax).toBe(500);
    expect(stats?.sampleCount).toBe(8);
  });
});
