/**
 * `formatDiagnostics(diagnostics, ['patientId', 'recordingId'])`, and the name it printed.
 *
 * `redactFields` is the one option in these formatters whose VALUE is an array, so the list a
 * caller holds is exactly what gets written where the options go. An array is an object, so the
 * guard looking for one let it through; the array has no `redactFields` of its own, so nothing was
 * redacted and the identification bytes were printed in full.
 *
 * That is the single outcome the option exists to prevent, and its own docblock says why: "for an
 * identification field those bytes are a person's name and birth date, and a diagnostic about them
 * is not rare — a writer that packs the name into one token is non-conformant, which is exactly the
 * file someone runs a tool on and pastes the output of". It adds: "withholding `header.patient`
 * while the diagnostic below it spells the same string out is not withholding it at all."
 *
 * The bare STRING spelling was already refused by name. The array — the shape the option actually
 * takes — was not. 0.6.245 closed the same hole in the read and parse options; this is the family
 * where it costs a person's name rather than a default.
 *
 * `formatValidationReport` forwards the option, and `formatHeader` has its own copy of the guard,
 * so all four refuse it now.
 */

import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import { formatAnnotations } from '../../src/format-annotations.js';
import { formatHeader } from '../../src/format-header.js';
import { formatValidationReport } from '../../src/format-report.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import type { EdfDiagnostic, EdfRecording, ValidationReport } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { setHeaderField } from '../support/corrupt.js';
import { buildEdf } from '../support/writer.js';

/** One token where EDF+ wants four, so the field is non-conformant and gets a diagnostic. */
const NAME = 'Haagse_Harry_born_1951';
const REDACT = ['patientId', 'recordingId'];

const FILE = setHeaderField(
  buildEdf({
    format: 'EDF',
    plus: 'C',
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
    annotationSignals: [
      { samplesPerRecord: 60, tals: (r) => [{ onset: r + 0.25, texts: [`e${r}`] }] },
    ],
  }),
  'patientId',
  NAME.padEnd(80),
);

async function fixture(): Promise<{
  recording: EdfRecording;
  diagnostics: readonly EdfDiagnostic[];
  report: ValidationReport;
  annotations: Awaited<ReturnType<typeof readAnnotations>>['annotations'];
}> {
  const recording = await openEdf(byteSource(FILE));
  return {
    recording,
    diagnostics: recording.header.diagnostics,
    report: await validateRecording(recording),
    annotations: (await readAnnotations(recording, { start: 0, count: 2 })).annotations,
  };
}

const refusal = (call: () => unknown): Error => {
  let thrown: Error | undefined;
  try {
    call();
  } catch (error) {
    thrown = error as Error;
  }
  expect(thrown, 'nothing was refused').toBeDefined();
  return thrown as Error;
};

describe('the name this used to print', () => {
  it('is really in the diagnostic, which is what makes the option necessary', async () => {
    const { diagnostics } = await fixture();
    expect(formatDiagnostics(diagnostics)).toContain(NAME);
  });

  it('is withheld when the option is passed on an object', async () => {
    const { diagnostics } = await fixture();
    expect(formatDiagnostics(diagnostics, { redactFields: REDACT })).not.toContain(NAME);
  });

  it('is no longer printed when the list is passed alone — the call is refused', async () => {
    const { diagnostics } = await fixture();
    const thrown = refusal(() => formatDiagnostics(diagnostics, REDACT as never));
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown.message).not.toContain(NAME);
  });

  it('is no longer printed through the report, which forwards the option', async () => {
    const { report } = await fixture();
    const thrown = refusal(() => formatValidationReport(report, REDACT as never));
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown.message).not.toContain(NAME);
  });
});

describe('every formatter that takes options', () => {
  it('refuses an array and says what belongs on the object', async () => {
    const { diagnostics, report, annotations, recording } = await fixture();
    for (const call of [
      () => formatDiagnostics(diagnostics, REDACT as never),
      () => formatValidationReport(report, REDACT as never),
      () => formatAnnotations(annotations, REDACT as never),
      () => formatHeader(recording.header, REDACT as never),
    ]) {
      const thrown = refusal(call);
      expect(thrown.message).toContain('the options are an array');
      expect(thrown.message).toContain('fields on the options rather than entries in a list');
      expect(thrown.message).toContain('Next: pass them on an object');
    }
  });

  it('still formats with a real options object', async () => {
    const { diagnostics, report, annotations, recording } = await fixture();
    expect(formatDiagnostics(diagnostics, { maxItems: 1 })).toBeTypeOf('string');
    expect(formatValidationReport(report, { maxItems: 1 })).toBeTypeOf('string');
    expect(formatAnnotations(annotations, { maxItems: 1 })).toBeTypeOf('string');
    expect(formatHeader(recording.header, { includePatientId: true })).toContain(NAME);
  });

  it('still formats with no options at all', async () => {
    const { diagnostics, report, annotations, recording } = await fixture();
    expect(formatDiagnostics(diagnostics)).toBeTypeOf('string');
    expect(formatValidationReport(report)).toBeTypeOf('string');
    expect(formatAnnotations(annotations)).toBeTypeOf('string');
    expect(formatHeader(recording.header)).toBeTypeOf('string');
  });
});

describe('the spelling that was already refused', () => {
  it('keeps its own sentence', async () => {
    const { diagnostics } = await fixture();
    const thrown = refusal(() => formatDiagnostics(diagnostics, 'patientId' as never));
    expect(thrown.message).toContain('not an object — maxItems is a field on one');
  });

  it('and so does a bare number', async () => {
    const { annotations } = await fixture();
    const thrown = refusal(() => formatAnnotations(annotations, 20 as never));
    expect(thrown.message).toContain('not an object — maxItems is a field on one');
  });
});
