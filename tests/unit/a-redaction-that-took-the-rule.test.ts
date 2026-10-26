/**
 * Redaction removes the value, and a one-letter value is also a letter of the rule.
 *
 * `redactDiagnostic` substitutes every spelling of a withheld field out of the message — quoted and
 * bare — and its docblock says what must survive: "Substitution is done on the value, never on the
 * code or the rule". A field of `X` broke that. `X` is EDF+'s own mark for an unknown subfield and
 * a common one-subfield patient identification, and the bare spelling matched the grammar the
 * message quotes, so the line read "[redacted] for anything unknown": the one part that says what
 * a conforming field looks like, redacted for a value that identifies nobody.
 *
 * The quoted spelling is still removed, so the line still says the value was withheld.
 */

import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import { parseHeader } from '../../src/index.js';
import { minimalEdfPlus } from '../support/writer.js';

const report = (patientId: string): string => {
  const bytes = minimalEdfPlus({ patientId });
  const header = parseHeader(bytes, bytes.byteLength);
  const withheld = header.diagnostics.filter((d) => d.field === 'patientId');
  expect(withheld.length).toBeGreaterThan(0);
  return formatDiagnostics(withheld, { redactFields: ['patientId'] });
};

describe('a withheld one-letter identification', () => {
  it('keeps the rule it is a letter of', () => {
    const out = report('X');
    expect(out).toContain('X for anything unknown');
    expect(out).not.toContain('[redacted] for anything unknown');
  });

  it('still withholds the value itself', () => {
    const out = report('X');
    expect(out).not.toContain('"X"');
    expect(out).toContain('is [redacted]');
  });

  it('keeps the sex and date grammar when the letter is M', () => {
    // On the message itself: the `expected:` line beneath it is never substituted, so it would
    // show the grammar intact whatever happened to the sentence above it.
    const out = report('M');
    expect(out).toContain('sex written F or M,');
    expect(out).not.toContain('[redacted][redacted]');
    expect(out).not.toContain('"M"');
  });
});
