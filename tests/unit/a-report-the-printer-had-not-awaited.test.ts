/**
 * `formatValidationReport(validateRecording(recording))` — advice that quotes the call back.
 *
 * `validateRecording` is async, and this guard's next step reads "pass what
 * validateRecording(recording) resolved to, in whole". So a reader who wrote
 * `formatValidationReport(validateRecording(recording))` was shown the expression they had just
 * written and told to pass what it resolves to, with no word for the difference between the two.
 *
 * 0.6.215 named that shape for the index guard — "a reader who takes the advice and forgets the
 * `await` gets the same sentence back, pointing at the same call" — and 0.6.234 for the source
 * adapter. This is the third.
 *
 * It is also the likelier of the two mistakes this guard catches. The sweep and the printer are
 * written on consecutive lines, and only one of them is awaited; the other shape it refuses,
 * `report.diagnostics`, is the one 0.6.113 was fixed for.
 *
 * Everything else about the refusal is unchanged, including the inspection branch below it.
 */

import { describe, expect, it } from 'vitest';
import { formatValidationReport } from '../../src/format-report.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecording, ValidationReport } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

const refusal = async (call: () => unknown): Promise<Error> => {
  const thrown = await Promise.resolve()
    .then(call)
    .then(
      () => undefined,
      (error: unknown) => error as Error,
    );
  expect(thrown, 'nothing was refused').toBeDefined();
  return thrown as Error;
};

describe('a report that had not arrived', () => {
  it('no longer answers with the call the reader just made', async () => {
    const recording = await opened();
    const pending = validateRecording(recording);
    const thrown = await refusal(() => formatValidationReport(pending as never));
    expect(thrown.message).not.toContain('pass what validateRecording(recording) resolved to');
    await pending;
  });

  it('names the pending Promise and the keyword', async () => {
    const recording = await opened();
    const pending = validateRecording(recording);
    const thrown = await refusal(() => formatValidationReport(pending as never));
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown.message).toContain('that is a pending Promise, not a validation report');
    expect(thrown.message).toContain('await validateRecording(recording)');
    expect(thrown.message).toContain('it resolves to the report this prints');
    await pending;
  });

  it('prints once it has been awaited', async () => {
    const recording = await opened();
    const report = await validateRecording(recording);
    expect(formatValidationReport(report)).toContain('PASS');
  });
});

describe('the mistake 0.6.113 was fixed for', () => {
  it('still gets its own sentence', async () => {
    const recording = await opened();
    const report: ValidationReport = await validateRecording(recording);
    const thrown = await refusal(() => formatValidationReport(report.diagnostics as never));
    expect(thrown.message).toContain('that is not a validation report');
    expect(thrown.message).toContain('pass what validateRecording(recording) resolved to');
    expect(thrown.message).toContain('not off its diagnostics');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 5],
    ['an empty object', {}],
  ])('keeps the sentence for %s', async (_shape, given) => {
    const thrown = await refusal(() => formatValidationReport(given as never));
    expect(thrown.message).toContain('that is not a validation report');
    expect(thrown.message).not.toContain('pending Promise');
  });
});

describe('the inspection branch below it', () => {
  it('still names an inspection as one', async () => {
    const inspection = await inspectEdf(byteSource(FILE));
    const thrown = await refusal(() => formatValidationReport(inspection as never));
    expect(thrown.message).toContain('Next:');
    expect(thrown.message).not.toContain('pending Promise');
  });

  it('is reached at all, so the Promise branch did not swallow it', async () => {
    const inspection = await inspectEdf(byteSource(FILE));
    expect(typeof (inspection as { then?: unknown }).then).not.toBe('function');
    expect(typeof inspection.ok).toBe('boolean');
  });
});
