/**
 * The validation report summary.
 *
 * The decision worth testing is the ordering: a sweep over a damaged file can produce six figures
 * of diagnostics, and a wall of them buries the answer. Counts first, then codes by frequency,
 * then a capped sample.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfDiagnostic, ValidationReport } from '../../src/types.js';
import { formatValidationReport, validateRecording } from '../../src/validate.js';
import { minimalEdf } from '../support/writer.js';

function diagnostic(code: string, severity: 'error' | 'warning' | 'info'): EdfDiagnostic {
  return {
    code,
    severity,
    message: `${code} happened`,
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
  } as EdfDiagnostic;
}

function report(diagnostics: readonly EdfDiagnostic[]): ValidationReport {
  return {
    ok: !diagnostics.some((d) => d.severity === 'error'),
    diagnostics,
    recordsScanned: 12,
    bytesRead: 34_560,
    signalStats: [],
  };
}

describe('formatValidationReport', () => {
  it('leads with the verdict and the severity counts', () => {
    const text = formatValidationReport(
      report([diagnostic('A', 'warning'), diagnostic('B', 'warning'), diagnostic('C', 'info')]),
    );
    const [first] = text.split('\n');
    expect(first).toContain('PASS');
    // Plural where there are several and singular where there is one, on the same line — the
    // pairing is the check, because either alone reads fine until you see the other (0.4.421).
    expect(first).toContain('2 warnings');
    expect(first).toContain('1 info');
    expect(first).not.toContain('1 infos');
  });

  it('pluralises the severity counts the way it pluralises the records', () => {
    const many = formatValidationReport(
      report([diagnostic('A', 'error'), diagnostic('B', 'error'), diagnostic('C', 'info')]),
    ).split('\n');
    expect(many[0]).toContain('2 errors');
    expect(many[0]).toContain('1 info');
    expect(many[1]).toContain('scanned 12 records');

    // And the singular of both, which is the shape the old code got right by accident.
    const one = formatValidationReport({
      ...report([diagnostic('A', 'error')]),
      recordsScanned: 1,
    }).split('\n');
    expect(one[0]).toContain('1 error');
    expect(one[0]).not.toContain('1 errors');
    expect(one[1]).toContain('scanned 1 record,');
  });

  it('says FAIL when anything is an error', () => {
    const text = formatValidationReport(report([diagnostic('A', 'error')]));
    expect(text.split('\n')[0]).toContain('FAIL');
  });

  it('orders codes by how much of the file they affect', () => {
    // The code hitting most records is the one to look at first, whatever order it arrived in.
    const many = [
      diagnostic('RARE', 'warning'),
      ...Array.from({ length: 5 }, () => diagnostic('COMMON', 'warning')),
      diagnostic('MIDDLING', 'warning'),
      diagnostic('MIDDLING', 'warning'),
    ];
    const lines = formatValidationReport(report(many)).split('\n');
    const codeLines = lines.slice(lines.indexOf('by code:') + 1, lines.indexOf('by code:') + 4);
    expect(codeLines[0]).toContain('COMMON');
    expect(codeLines[1]).toContain('MIDDLING');
    expect(codeLines[2]).toContain('RARE');
  });

  it('caps the individual entries so the counts stay readable', () => {
    const many = Array.from({ length: 500 }, (_, i) => diagnostic(`CODE_${i % 3}`, 'warning'));
    const text = formatValidationReport(report(many), { maxItems: 5 });
    // The summary still reports all 500; only the detail is capped.
    expect(text).toContain('500 warning');
    expect(text.split('\n').length).toBeLessThan(60);
  });

  it('names signals when a header is supplied and numbers them when it is not', async () => {
    const recording = await openEdf(
      byteSource(
        minimalEdf({ recordCount: 4, signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 4 }] }),
      ),
    );
    const result = await validateRecording(recording, { scanSamples: true });
    expect(result.signalStats.length).toBeGreaterThan(0);

    expect(formatValidationReport(result, { header: recording.header })).toContain('EEG Fpz-Cz');
    expect(formatValidationReport(result)).toContain('signal 0');
  });

  it('reports a clean file without inventing a problem', () => {
    const text = formatValidationReport(report([]));
    expect(text).toContain('PASS');
    expect(text).toContain('no diagnostics');
    expect(text).not.toContain('by code:');
  });
});
