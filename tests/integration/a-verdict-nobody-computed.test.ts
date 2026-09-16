/**
 * An INSPECTION handed to the printer for a validation report.
 *
 * `inspectEdf` and `validateRecording` are the two sweeps this package exports and the two commands
 * the CLI wraps, so the printer for one is what a caller reaches for while holding the other. They
 * are also deliberately alike: both resolve to an object whose first field is `ok` and whose last is
 * a diagnostics array, because that is what a caller branches on either way.
 *
 * 0.6.113 gave `formatValidationReport` a guard for a wrong argument, and it tests exactly those two
 * fields — the two an inspection also has. `bytesRead` is a third. So an inspection walked past it
 * and the printer rendered its own first two lines out of a report that is not one:
 *
 *     PASS — 1 info
 *     scanned undefined records, read 768 bytes
 *
 * `PASS` is a VERDICT, and `ok` on an inspection means the header parsed rather than the file
 * conformed — an inspection reads the header and stops, so nothing about the records was checked to
 * pass. `scanned undefined records` is the same statement made about the work: none was done.
 *
 * Then it died on `report.signalStats.length` with V8's `Cannot read properties of undefined`, which
 * is the failure the 0.6.113 guard exists to remove — reached through the guard, on the one wrong
 * argument the API's own symmetry hands a caller.
 *
 * `recordsScanned` is what the fix tests, not `signalStats`: it is the first of the two a reader
 * watches go wrong, and it names what an inspection did not do.
 */

import { describe, expect, it } from 'vitest';
import { formatValidationReport } from '../../src/format-report.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

describe('the inspection an inspectEdf() call resolved to', () => {
  it('carries the two fields the report guard tests, and a third', async () => {
    const inspection = await inspectEdf(byteSource(FILE));
    expect(typeof inspection.ok).toBe('boolean');
    expect(Array.isArray(inspection.diagnostics)).toBe(true);
    expect(typeof inspection.bytesRead).toBe('number');
    // The two it does not have are the two this printer counts with.
    const loosely = inspection as unknown as Record<string, unknown>;
    expect(loosely.recordsScanned).toBeUndefined();
    expect(loosely.signalStats).toBeUndefined();
  });

  it('is refused as an inspection rather than crashing on a field it lacks', async () => {
    const inspection = await inspectEdf(byteSource(FILE));
    let thrown: Error | undefined;
    try {
      formatValidationReport(inspection as never);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown, 'the inspection was printed as a report').toBeDefined();
    // Not a TypeError from V8: a caller mistake in this package is a RangeError with a next step.
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain('that is an inspection');
    expect(thrown?.message).toContain('Next:');
  });

  it('is never told PASS, which is a verdict this call did not compute', async () => {
    const inspection = await inspectEdf(byteSource(FILE));
    // The header of this file parses, so `ok` is true — which is precisely what made the old
    // first line read `PASS` for a sweep that read no record.
    expect(inspection.ok).toBe(true);
    expect(() => formatValidationReport(inspection as never)).toThrow(/inspection/);
  });

  it('is refused for a file whose header did not parse either', async () => {
    const truncated = await inspectEdf(byteSource(FILE.subarray(0, 200)));
    expect(truncated.ok).toBe(false);
    expect(() => formatValidationReport(truncated as never)).toThrow(/that is an inspection/);
  });
});

describe('the report a validateRecording() call resolved to', () => {
  it('still prints, with the counts an inspection has no answer for', async () => {
    const recording = await openEdf(byteSource(FILE));
    const text = formatValidationReport(await validateRecording(recording));
    expect(text).toMatch(/^(PASS|FAIL) —/);
    // The two lines the inspection rendered wrong, and only those: a diagnostic's own prose may
    // legitimately say `undefined` about a field of the file.
    expect(text.split('\n')[1]).toBe('scanned 6 records, read 576 bytes');
  });

  it('still names the diagnostics list separately, which 0.6.113 added', async () => {
    const recording = await openEdf(byteSource(FILE));
    const report = await validateRecording(recording);
    expect(() => formatValidationReport(report.diagnostics as never)).toThrow(
      /that is not a validation report/,
    );
  });
});
