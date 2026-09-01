/**
 * A `redactFields` name edfcore does not recognise is refused, not ignored.
 *
 * Redaction is matched by exact string against `diagnostic.field`, so `'patientID'`, `'patient'`
 * and `'patient_id'` each withheld nothing and said nothing about it. The caller had asked for the
 * one thing in this package whose failure discloses a person's name — a diagnostic quotes the
 * bytes it is complaining about, by design, and for an identification field those bytes are the
 * name and the date of birth — and got a report with the name in it that looked like a report with
 * the name taken out.
 *
 * `parseArgs` refuses a misspelled `--patinet` for the same reason and says so in a comment beside
 * the guard: a flag that silently does nothing prints the output the caller was trying to avoid.
 * The CLI is safe either way because it passes the pair as a literal; a library caller spells the
 * name themselves.
 *
 * The vocabulary is closed, and this file is what keeps it that way. It is rebuilt here out of
 * `src/` — every `field: '…'` literal, plus the two header layout maps that
 * `field: context.field` passes through — and compared against what `formatDiagnostics` accepts.
 * A diagnostic that starts naming a new field fails here until the set knows about it, which is
 * the failure to have: the alternative is a caller asking to redact a real field and being told
 * it does not exist.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HEADER_FIELDS, SIGNAL_FIELD_WIDTHS } from '../../src/constants.js';
import { createDiagnostic } from '../../src/diagnostics/collector.js';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import { formatValidationReport } from '../../src/format-report.js';
import type { EdfDiagnostic, ValidationReport } from '../../src/types.js';

const SRC = new URL('../../src/', import.meta.url);

/** Every `field: 'name'` written as a literal anywhere under `src/`. */
function literalFieldNames(): ReadonlySet<string> {
  const found = new Set<string>();
  const walk = (directory: URL): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, directory));
      } else if (entry.name.endsWith('.ts')) {
        const source = readFileSync(new URL(entry.name, directory), 'utf8');
        for (const match of source.matchAll(/\bfield: '([A-Za-z][A-Za-z0-9]*)'/g)) {
          const name = match[1];
          if (name !== undefined) found.add(name);
        }
      }
    }
  };
  walk(SRC);
  return found;
}

/**
 * The whole vocabulary, from the three places a `field` value can come from: the fixed header
 * layout, the per-signal layout, and the diagnostics that name something neither map has an entry
 * for.
 */
function vocabularyFromSource(): readonly string[] {
  return [
    ...new Set([
      ...Object.keys(HEADER_FIELDS),
      ...Object.keys(SIGNAL_FIELD_WIDTHS),
      ...literalFieldNames(),
    ]),
  ].sort();
}

const named = (field: string, raw: string): EdfDiagnostic =>
  createDiagnostic({
    code: 'NON_CONFORMANT_PATIENT_ID',
    message: `the field says ${JSON.stringify(raw)}`,
    field,
    raw,
  });

const report = (diagnostics: readonly EdfDiagnostic[]): ValidationReport => ({
  ok: false,
  diagnostics,
  recordsScanned: 1,
  bytesRead: 0,
  signalStats: [],
});

/** Does `formatDiagnostics` accept this name at all? */
function accepted(field: string): boolean {
  try {
    formatDiagnostics([], { redactFields: [field] });
    return true;
  } catch {
    return false;
  }
}

describe('the vocabulary', () => {
  it('is rebuilt from src/, so a passing run is not a vacuous one', () => {
    const vocabulary = vocabularyFromSource();
    expect(vocabulary.length).toBeGreaterThan(15);
    expect(vocabulary).toContain('patientId');
    expect(vocabulary).toContain('recordingId');
    expect(literalFieldNames().size).toBeGreaterThan(10);
  });

  it('is exactly what formatDiagnostics accepts — no more and no fewer', () => {
    for (const field of vocabularyFromSource()) {
      expect({ field, accepted: accepted(field) }).toEqual({ field, accepted: true });
    }
  });

  it('names the three that no header layout map covers', () => {
    // A diagnostic can be about the header block as a whole, about the data-record region, or
    // about the record size the geometry implies. None of those is a field with an offset.
    for (const field of ['dataRecords', 'header', 'recordByteLength']) {
      expect(accepted(field)).toBe(true);
      expect(Object.keys(HEADER_FIELDS)).not.toContain(field);
      expect(Object.keys(SIGNAL_FIELD_WIDTHS)).not.toContain(field);
    }
  });
});

describe('a name outside it', () => {
  // The spellings someone actually types. Each redacted nothing and reported nothing.
  const NEAR_MISSES = ['patientID', 'patient', 'patient_id', 'PatientId', 'patientName', ''];

  it.each(NEAR_MISSES)('refuses %j rather than withholding nothing', (field) => {
    expect(() => formatDiagnostics([], { redactFields: [field] })).toThrow(RangeError);
    expect(() => formatDiagnostics([], { redactFields: [field] })).toThrow(
      /is not a field any edfcore diagnostic reports/,
    );
  });

  it('says what to pass instead, and ends with a Next: clause', () => {
    let message = '';
    try {
      formatDiagnostics([], { redactFields: ['patientID'] });
    } catch (error) {
      message = String((error as Error).message);
    }
    expect(message).toContain('Next: ');
    expect(message).toContain('patientId');
    expect(message).toContain('recordingId');
  });

  it('is refused on an empty list too, which is where it costs nothing to learn', () => {
    // The typo is a property of the call, not of the file. Finding it on the first clean file is
    // the whole point; finding it on the file that has a problem is finding it too late.
    expect(() => formatDiagnostics([], { redactFields: ['patientID'] })).toThrow(RangeError);
  });

  it('is refused through formatValidationReport, which forwards the option', () => {
    expect(() => formatValidationReport(report([]), { redactFields: ['patientID'] })).toThrow(
      RangeError,
    );
  });
});

describe('what the guard must not have broken', () => {
  const leaky = named('patientId', 'Doe Jane 1980-01-01');

  it('still redacts the name for the spelling that was always right', () => {
    const out = formatDiagnostics([leaky], { redactFields: ['patientId'] });
    expect(out).not.toContain('Doe Jane');
    expect(out).toContain('[redacted]');
  });

  it('still prints it when no redaction was asked for, which is the default', () => {
    expect(formatDiagnostics([leaky])).toContain('Doe Jane');
    expect(formatDiagnostics([leaky], { redactFields: [] })).toContain('Doe Jane');
  });

  it('accepts the pair the CLI passes, so no command can be broken by this', () => {
    expect(() =>
      formatDiagnostics([leaky], { redactFields: ['patientId', 'recordingId'] }),
    ).not.toThrow();
  });

  it('leaves a diagnostic about another field alone', () => {
    const other = named('label', 'Fp1');
    expect(formatDiagnostics([other], { redactFields: ['patientId'] })).toContain('Fp1');
  });
});
