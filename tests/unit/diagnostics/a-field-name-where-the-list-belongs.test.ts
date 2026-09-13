/**
 * `redactFields` given the field name rather than a list of them.
 *
 * Every example in the package spells it `redactFields: ['patientId', 'recordingId']`, and the
 * mistake is one pair of brackets: `redactFields: 'patientId'`. A string is iterable, so the loop
 * that checks the names walked its CHARACTERS and refused with `options.redactFields names "p"` —
 * a value the caller never wrote, about a vocabulary that was never the problem.
 *
 * `assertRedactableFields`'s own docblock is about this option specifically: "the one option in
 * this package whose silent failure sends a person's name somewhere it should not go". It did not
 * fail silently — it refused, so nothing leaked — but a caller trying to withhold a patient name
 * was handed a message with no path from `"p"` back to the brackets they were missing.
 *
 * The vocabulary check underneath is unchanged. A misspelled name in a real list is still refused
 * exactly as it was, which is what 0.4.x built it for.
 */

import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../../src/diagnostics/format.js';
import { formatValidationReport } from '../../../src/format-report.js';
import type { EdfDiagnostic, ValidationReport } from '../../../src/types.js';

const DIAGNOSTICS = [] as unknown as readonly EdfDiagnostic[];
const REPORT = {
  ok: true,
  diagnostics: DIAGNOSTICS,
  recordsScanned: 0,
  bytesRead: 0,
  signalStats: [],
} as unknown as ValidationReport;

const format =
  (redactFields: unknown): (() => unknown) =>
  () =>
    (formatDiagnostics as unknown as (d: unknown, o: unknown) => unknown)(DIAGNOSTICS, {
      redactFields,
    });

describe('redactFields given a bare field name', () => {
  it('is refused as the string it is, not as its first character', () => {
    expect(format('patientId')).toThrow(
      /^options\.redactFields is the string "patientId", not a list of names\./,
    );
    expect(format('patientId')).not.toThrow(/names "p"/);
  });

  it('says why a string got that far, so the brackets are the obvious fix', () => {
    expect(format('patientId')).toThrow(/A string is iterable, so this walked its characters/);
    expect(format('patientId')).toThrow(
      /Next: pass redactFields: \['patientId', 'recordingId'\]\.$/,
    );
  });

  it('refuses it on the clean file too, which is the point of checking before rendering', () => {
    expect(() =>
      (formatValidationReport as unknown as (r: unknown, o: unknown) => unknown)(REPORT, {
        redactFields: 'patientId',
      }),
    ).toThrow(/not a list of names/);
  });

  it('names anything else that is not a list as itself', () => {
    expect(format(123)).toThrow(/options\.redactFields is 123, not a list of names/);
  });
});

describe('the vocabulary check underneath', () => {
  it('still refuses a misspelled name inside a real list', () => {
    expect(format(['patinet'])).toThrow(
      /options\.redactFields names "patinet", which is not a field any edfcore diagnostic reports/,
    );
  });

  it('still accepts the two that carry a person’s name, and an omitted option', () => {
    expect(format(['patientId', 'recordingId'])).not.toThrow();
    expect(format(undefined)).not.toThrow();
  });
});
