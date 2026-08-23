/**
 * A patient's date of birth, redacted out of a message that never quotes the field.
 *
 * `--patient` is off by default, and the promise on the README's first screen is that
 * identification is withheld unless you ask for it. `redactDiagnostic` keeps that promise by
 * substituting the field's value out of the message by text — the raw string is known exactly, and
 * both its padded and trimmed spellings are removed.
 *
 * `DATE_IMPLAUSIBLE` is the diagnostic that defeats every spelling of it. The field says
 * `02-MAY-2050`; the message says `2050-05-02`, because it is comparing two dates and prints them
 * both in one form. No substring of the raw field appears in that sentence. The value is redacted
 * anyway, from `actual` — which carries whatever the message chose to print, and is computed
 * before it is itself replaced.
 *
 * It is also the case with the widest reach. The other identification diagnostics fire on a
 * malformed field, so a conformant file never produces them; this one fires on a perfectly
 * conformant patient field whose only fault is a year the header's two-digit rule resolved into
 * the future — which is what a recording made before 1985 or after 2084 looks like, and there are
 * plenty of both. A clinical file with nothing wrong with it, printed by a command that was asked
 * to withhold the patient, and a date of birth in the output.
 *
 * The other half is what must SURVIVE. Substitution is on the value, never on the code or the
 * rule, so the diagnostic still identifies the problem: the code, the byte offset, the field name
 * and the spec clause are all still there, and so is the recording's start date, which is not
 * patient identification and is half of what makes the message actionable.
 *
 * `cli.test.ts` covers the flag and the NUL-padding leak of 0.3.31. This is the derived-value
 * path, which no spelling of the field can reach.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { formatValidationReport } from '../../src/format-report.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfDiagnostic } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

const BIRTH_DATE_AS_WRITTEN = '02-MAY-2050';
const BIRTH_DATE_AS_PRINTED = '2050-05-02';
const NAME = 'Jane_Q_Public';
const MRN = 'MRN9931';

/** Conformant EDF+ identification, and a birth date the two-digit year rule puts in the future. */
const FILE = buildEdf({
  plus: 'C',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 30 }],
  patientId: `${MRN} F ${BIRTH_DATE_AS_WRITTEN} ${NAME}`,
});

const REDACTED_FIELDS = ['patientId', 'recordingId'] as const;

async function report(): Promise<{ text: (redact: boolean) => string; found: EdfDiagnostic }> {
  const recording = await openEdf(byteSource(FILE));
  const validation = await validateRecording(recording);
  const found = validation.diagnostics.find((one) => one.code === 'DATE_IMPLAUSIBLE');
  if (found === undefined) throw new Error('the fixture no longer produces DATE_IMPLAUSIBLE');
  return {
    found,
    text: (redact) =>
      formatValidationReport(validation, {
        header: recording.header,
        ...(redact ? { redactFields: [...REDACTED_FIELDS] } : {}),
      }),
  };
}

describe('the diagnostic this is about', () => {
  it('prints the birth date in a form the field does not contain', async () => {
    const { found } = await report();
    expect(found.field).toBe('patientId');
    // The premise. If the message ever started quoting the field, the derived-value path would
    // stop being the thing under test and this would pass for the wrong reason.
    expect(found.message).toContain(BIRTH_DATE_AS_PRINTED);
    expect(found.message).not.toContain(BIRTH_DATE_AS_WRITTEN);
    expect(found.actual).toBe(BIRTH_DATE_AS_PRINTED);
  });
});

describe('with identification withheld', () => {
  it('leaves no spelling of the birth date anywhere in the report', async () => {
    const text = (await report()).text(true);
    expect(text).not.toContain(BIRTH_DATE_AS_PRINTED);
    expect(text).not.toContain(BIRTH_DATE_AS_WRITTEN);
    expect(text).toContain('[redacted]');
  });

  it('leaves no name and no record number either', async () => {
    const text = (await report()).text(true);
    expect(text).not.toContain(NAME);
    expect(text).not.toContain(MRN);
  });

  it('keeps everything that identifies the problem rather than the patient', async () => {
    const text = (await report()).text(true);
    // The code, the location and the rule: a reader can still act on this, and a reader who
    // needs the value can re-run with --patient.
    expect(text).toContain('DATE_IMPLAUSIBLE');
    expect(text).toContain('byte offset 8');
    expect(text).toContain('patientId');
    expect(text).toContain('EDF+ additional specification 3');
    // And the recording's own start date, which is not identification and is half the comparison.
    expect(text).toContain('2020-01-01');
  });

  it('does not redact a field nobody asked to withhold', async () => {
    // The `startDate` diagnostic beside it quotes the header field verbatim and must keep doing so.
    const text = (await report()).text(true);
    expect(text).toContain('DATE_CLIPPED_TO_1985_2084');
    expect(text).toContain('"01.01.20"');
  });
});

describe('with identification asked for', () => {
  it('prints the birth date, because that is what the flag is', async () => {
    const text = (await report()).text(false);
    expect(text).toContain(BIRTH_DATE_AS_PRINTED);
    expect(text).not.toContain('[redacted]');
  });
});

describe('through the command a clinician actually runs', () => {
  const output = async (argv: readonly string[]): Promise<string> => {
    let printed = '';
    const io: CliIo = {
      readFile: () => Promise.resolve(FILE),
      out: (text) => {
        printed += text;
      },
      err: () => undefined,
    };
    await runCli(parseArgs(argv), io);
    return printed;
  };

  it('withholds it by default', async () => {
    const printed = await output(['validate', 'night.edf']);
    expect(printed).not.toContain(BIRTH_DATE_AS_PRINTED);
    expect(printed).not.toContain(NAME);
  });

  it('prints it when asked', async () => {
    expect(await output(['validate', 'night.edf', '--patient'])).toContain(BIRTH_DATE_AS_PRINTED);
  });
});
