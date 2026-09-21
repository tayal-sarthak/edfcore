/**
 * `edfcore/validate`, which had no argument checks at all.
 *
 * `edfcore` refuses a wrong source, selection, recording, signal, matcher and list by name;
 * `edfcore/node` checks the size it is handed. The third entry point checked nothing, and it is the
 * one whose whole subject is telling a caller precisely what is wrong with what they gave it.
 *
 * `formatValidationReport` showed it worst, and only after 0.6.107. Its refusal came from
 * `summarizeDiagnostics` and carried that helper's advice — "Next: pass header.diagnostics, or the
 * diagnostics on the chunk or the report you have" — so a caller who passed `report.diagnostics`,
 * which is the obvious thing to reach for, was told to pass exactly what they had just passed
 * (fixed in 0.6.113).
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfHeader, EdfRecording, ValidationReport } from '../../src/types.js';
import { formatValidationReport, validateHeader, validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

const BYTES = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = () => openEdf(byteSource(BYTES));

/** The cast a JavaScript caller does not need to write. */
const loosely = <T>(value: unknown) => value as T;

async function refusal(run: () => unknown): Promise<string> {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the argument was accepted');
}

describe('formatValidationReport', () => {
  it('no longer tells a caller who passed the diagnostics to pass the diagnostics', async () => {
    const report = await validateRecording(await opened());
    const message = await refusal(() =>
      formatValidationReport(loosely<ValidationReport>(report.diagnostics)),
    );
    expect(message).toContain('formatValidationReport(): that is not a validation report');
    expect(message).not.toContain('Next: pass header.diagnostics');
  });

  it('says why the whole report is needed', async () => {
    const report = await validateRecording(await opened());
    const message = await refusal(() =>
      formatValidationReport(loosely<ValidationReport>(report.diagnostics)),
    );
    expect(message).toContain('Next: pass what validateRecording(recording) resolved to');
    expect(message).toContain('the verdict, the counts and the bytes read all come off the report');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['the recording', 'recording'],
    ['the header', 'header'],
  ])('refuses %s', async (_described, given) => {
    const recording = await opened();
    const value = given === 'recording' ? recording : given === 'header' ? recording.header : given;
    expect(await refusal(() => formatValidationReport(loosely<ValidationReport>(value)))).toContain(
      'that is not a validation report',
    );
  });

  it('still formats a real report', async () => {
    const report = await validateRecording(await opened());
    expect(formatValidationReport(report)).toContain('scanned 4 records');
  });
});

describe('validateHeader', () => {
  it('names the recording rather than leaking dataSignalIndices', async () => {
    const recording = await opened();
    const message = await refusal(() => validateHeader(loosely<EdfHeader>(recording)));
    expect(message).toContain('validateHeader(): that is not a header — it has no signals');
    expect(message).not.toContain('is not iterable');
  });

  it('names the sibling that does take a recording', async () => {
    const recording = await opened();
    expect(await refusal(() => validateHeader(loosely<EdfHeader>(recording)))).toContain(
      'validateRecording(recording)',
    );
  });

  it('still checks a real header', async () => {
    const recording = await opened();
    expect(Array.isArray(validateHeader(recording.header))).toBe(true);
  });
});

describe('validateRecording', () => {
  it('names the header as a header, and says why it is not enough', async () => {
    const recording = await opened();
    const message = await refusal(() => validateRecording(loosely<EdfRecording>(recording.header)));
    expect(message).toContain('validateRecording(): that is a header');
    expect(message).toContain('this sweep reads the records too');
    expect(message).toContain('validateHeader(header)');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
  ])('refuses %s', async (_described, given) => {
    const message = await refusal(() => validateRecording(loosely<EdfRecording>(given)));
    expect(message).toContain('the recording is not the object openEdf() returns');
  });

  it('refuses a pending open by naming the keyword', async () => {
    // Not the sentence above: `openEdf(source)` is async, so a pending Promise IS what it returns,
    // and the recording is what that Promise resolves to (0.6.231 for the reading calls, 0.6.232
    // here).
    const value = opened();
    const message = await refusal(() => validateRecording(loosely<EdfRecording>(value)));
    expect(message).toContain('the recording is a pending Promise');
    expect(message).toContain('the recording is what it resolves to');
    expect(message).toContain('await openEdf(source)');
    await value;
  });

  it('still sweeps a real recording', async () => {
    expect((await validateRecording(await opened())).recordsScanned).toBe(4);
  });
});
