/**
 * Redaction removes; it never adds.
 *
 * `redactDiagnostic` replaces the value of a withheld field wherever it appears — in `message`, in
 * `raw` and in `actual` — and `redact-derived-value.test.ts` covers the removing half on the
 * diagnostic that defeats every spelling of it. The other half is what happens to a diagnostic
 * that had nothing there in the first place, and it had never been asked.
 *
 * Both substitutions are conditional for a reason. `raw: '[redacted]'` on a diagnostic that never
 * carried the bytes says a value was withheld, and `formatDiagnostics` then prints a `raw:` line
 * under it — so a reader auditing a report for what the tool held back sees evidence of patient
 * text on a diagnostic that had none. That is the failure mode 0.3.31 names from the other
 * direction: output that LOOKS redacted is worse than an obvious leak, and output that looks
 * redacted where nothing was withheld is the same mistake with the sign flipped.
 *
 * The diagnostics here are written out rather than provoked from a file. `formatDiagnostics` is
 * public and takes any `EdfDiagnostic[]`, every parser-built diagnostic on an identification field
 * happens to carry both fields, and the contract being pinned is the function's, not one file's.
 */

import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import type { EdfDiagnostic } from '../../src/types.js';

const WITHHELD = { redactFields: ['patientId'] };

/** Every field present-or-undefined, which is what the interface declares. */
function diagnosticWith(over: Partial<EdfDiagnostic>): EdfDiagnostic {
  return {
    code: 'PATIENT_ID_NONCONFORMANT',
    severity: 'warning',
    message: 'local patient identification is "Jane_Q_Public", which is not the EDF+ grammar.',
    field: 'patientId',
    byteOffset: 8,
    byteLength: 80,
    rawBytes: undefined,
    raw: undefined,
    expected: 'X X X X',
    actual: undefined,
    signalIndex: undefined,
    recordIndex: undefined,
    specReference: 'EDF+ additional specification 3',
    ...over,
  };
}

describe('a withheld field that had a value', () => {
  const full = diagnosticWith({ raw: 'Jane_Q_Public'.padEnd(80), actual: 'Jane_Q_Public' });

  it('loses it from the message, from raw and from actual', () => {
    const out = formatDiagnostics([full], WITHHELD);

    expect(out).not.toContain('Jane_Q_Public');
    expect(out).toContain('raw: "[redacted]"');
    expect(out).toContain('actual: [redacted]');
  });

  it('keeps the rule, which is not a value', () => {
    // `expected` is the grammar the field should have followed. Substituting it would remove the
    // one part of the line that says what to do.
    expect(formatDiagnostics([full], WITHHELD)).toContain('expected: X X X X');
  });
});

describe('a withheld field that had none', () => {
  it('does not gain a raw line', () => {
    const out = formatDiagnostics([diagnosticWith({})], WITHHELD);

    expect(out).not.toContain('raw:');
    expect(out).not.toContain('actual:');
    // And it is still reported: redaction is about the value, never about the finding.
    expect(out).toContain('[PATIENT_ID_NONCONFORMANT]');
    expect(out).toContain('at byte offset 8');
  });

  it('redacts only the half that was there', () => {
    const rawOnly = diagnosticWith({ raw: 'Jane_Q_Public'.padEnd(80) });
    const actualOnly = diagnosticWith({ actual: 'Jane_Q_Public' });

    const fromRaw = formatDiagnostics([rawOnly], WITHHELD);
    expect(fromRaw).toContain('raw: "[redacted]"');
    expect(fromRaw).not.toContain('actual:');

    const fromActual = formatDiagnostics([actualOnly], WITHHELD);
    expect(fromActual).toContain('actual: [redacted]');
    expect(fromActual).not.toContain('raw:');
  });

  it('still removes the value from the message, which is where it leaked', () => {
    // `actual` alone is enough to redact the message, and that is the whole point of reading it:
    // the substitution is by text, and a diagnostic with no `raw` has no other spelling to use.
    const actualOnly = diagnosticWith({ actual: 'Jane_Q_Public' });
    expect(formatDiagnostics([actualOnly], WITHHELD)).not.toContain('Jane_Q_Public');
  });
});

describe('a field nobody asked to withhold', () => {
  it('is printed as it stands', () => {
    const full = diagnosticWith({ raw: 'Jane_Q_Public'.padEnd(80), actual: 'Jane_Q_Public' });
    const out = formatDiagnostics([full], { redactFields: ['recordingId'] });

    expect(out).toContain('Jane_Q_Public');
    expect(out).not.toContain('[redacted]');
  });
});
