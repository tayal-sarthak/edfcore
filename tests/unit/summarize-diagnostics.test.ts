/**
 * summarizeDiagnostics.
 *
 * Two things here are decisions rather than arithmetic, and both are asserted: `worst` is by
 * severity rank rather than by the order the list happened to arrive in, and it is `undefined`
 * rather than `'info'` for an empty list.
 *
 * The counts themselves are checked against a real header's diagnostics, not against a
 * hand-written list, so the shape being summarised is the shape edfcore actually produces.
 */

import { describe, expect, it } from 'vitest';
import { summarizeDiagnostics } from '../../src/diagnostics/summary.js';
import { parseHeader } from '../../src/header/parse.js';
import type { EdfDiagnostic, EdfSeverity } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

function diagnostic(code: string, severity: EdfSeverity): EdfDiagnostic {
  return { code, severity, message: `${code} happened` } as EdfDiagnostic;
}

describe('worst is by severity, not by arrival', () => {
  it('reports error over warning and info regardless of order', () => {
    const trailing = [
      diagnostic('A', 'info'),
      diagnostic('B', 'warning'),
      diagnostic('C', 'error'),
    ];
    const leading = [...trailing].reverse();
    expect(summarizeDiagnostics(trailing).worst).toBe('error');
    expect(summarizeDiagnostics(leading).worst).toBe('error');
  });

  it('reports warning over info', () => {
    expect(summarizeDiagnostics([diagnostic('A', 'info'), diagnostic('B', 'warning')]).worst).toBe(
      'warning',
    );
  });

  it('is undefined for an empty list, not info', () => {
    // 'info' would claim a note exists when none does, and `worst !== undefined` is the natural
    // spelling of "anything to report at all".
    const summary = summarizeDiagnostics([]);
    expect(summary.worst).toBeUndefined();
    expect(summary).toMatchObject({ total: 0, errors: 0, warnings: 0, infos: 0 });
    expect(summary.byCode).toEqual([]);
  });
});

describe('byCode', () => {
  it('is ordered by count, most frequent first', () => {
    const summary = summarizeDiagnostics([
      diagnostic('RARE', 'info'),
      diagnostic('COMMON', 'warning'),
      diagnostic('COMMON', 'warning'),
      diagnostic('COMMON', 'warning'),
      diagnostic('SOMETIMES', 'error'),
      diagnostic('SOMETIMES', 'error'),
    ]);
    expect(summary.byCode.map((entry) => entry.code)).toEqual(['COMMON', 'SOMETIMES', 'RARE']);
    expect(summary.byCode[0]).toEqual({ code: 'COMMON', severity: 'warning', count: 3 });
  });

  it('keeps first-seen order for equal counts, so the output is deterministic', () => {
    const summary = summarizeDiagnostics([
      diagnostic('FIRST', 'info'),
      diagnostic('SECOND', 'info'),
      diagnostic('THIRD', 'info'),
    ]);
    expect(summary.byCode.map((entry) => entry.code)).toEqual(['FIRST', 'SECOND', 'THIRD']);
  });
});

describe('against a real header', () => {
  it('counts what parseHeader reported, severities included', () => {
    // An inverted physical range is legal and reported at info; a signal that cannot be scaled is
    // reported at error while the file still parses. One file, two severities.
    const bytes = buildEdf({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [
        { label: 'Inv', samplesPerRecord: 4, physicalMinimum: 500, physicalMaximum: -500 },
        { label: 'Flat', samplesPerRecord: 4, physicalMinimum: 7, physicalMaximum: 7 },
      ],
    });
    const header = parseHeader(bytes, bytes.byteLength);
    const summary = summarizeDiagnostics(header.diagnostics);

    expect(summary.total).toBe(header.diagnostics.length);
    expect(summary.errors + summary.warnings + summary.infos).toBe(summary.total);
    expect(summary.byCode.reduce((sum, entry) => sum + entry.count, 0)).toBe(summary.total);

    // The header parsed and every signal is readable, yet the summary reports an error: a
    // `deferred` code has error severity, and gating a read on `errors > 0` throws away good data.
    expect(summary.errors).toBeGreaterThan(0);
    expect(header.signals[1]?.scale).toBeUndefined();
    expect(header.signals[0]?.scale).toBeDefined();
  });
});
