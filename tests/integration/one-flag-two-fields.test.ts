/**
 * `--patient` means both identification fields, in every command that prints either.
 *
 * The rule is `cli-run.ts`'s own, written above the helper that implements it: withholding the
 * identification line from `formatHeader` is not enough, because a diagnostic names the raw bytes
 * as written and a non-conformant identification field gets its whole content printed underneath —
 * "so the two must be gated together, by the same flag, in every command that prints either".
 *
 * `json` printed one of them. `header --patient` shows a `recording` line beside the `patient`
 * line; `json --patient` showed `patient` alone, so the same flag meant two different things two
 * commands apart, and the field carrying the technician code, the equipment code and the only
 * unambiguous startdate was unreachable from the machine-readable output. That direction is the
 * safe one — nothing leaked — which is why nothing found it.
 *
 * The check runs both ways over a file whose identification fields are populated AND
 * non-conformant, so every command has a diagnostic quoting them as well as a field holding them.
 * Without the flag neither string appears anywhere in any command's output; with it, the two
 * commands that report identification report both fields.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { setHeaderField } from '../support/corrupt.js';
import { buildEdf } from '../support/writer.js';

/** Names nothing else in the file spells, so a hit is unambiguous. */
const NAME = 'Kowalczyk';
const TECHNICIAN = 'Okonkwo';

/**
 * Both identification fields populated and neither following the EDF+ subfield grammar, so each
 * earns a diagnostic that quotes it. That is the file the rule was written for.
 */
const IDENTIFIED = setHeaderField(
  setHeaderField(
    buildEdf({
      plus: 'C',
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 4 }],
      annotationSignals: [{ samplesPerRecord: 40 }],
    }),
    'patientId',
    `${NAME}-MRN1234`,
  ),
  'recordingId',
  `${TECHNICIAN}-HOSP1-NihonKohden`,
);

/** Every command, so a seventh has to be added here to pass. */
const COMMANDS = ['header', 'validate', 'events', 'gaps', 'signals', 'json'] as const;

async function output(command: string, argv: readonly string[]): Promise<string> {
  const chunks: string[] = [];
  const io: CliIo = {
    out: (text) => chunks.push(text),
    err: (text) => chunks.push(text),
    readFile: async () => IDENTIFIED,
  };
  await runCli(parseArgs([command, ...argv, 'a.edf']), io);
  return chunks.join('');
}

describe('the file this is checked against', () => {
  it('holds both names and earns a diagnostic quoting each, so nothing here is vacuous', async () => {
    const shown = await output('header', ['--patient']);
    expect(shown).toContain(NAME);
    expect(shown).toContain(TECHNICIAN);
    // The diagnostics block, not just the two identification lines: that is what makes the
    // withholding hard, and it is the half 0.3.2 fixed in five outputs and missed in two.
    expect(shown).toMatch(/NON_CONFORMANT_PATIENT_ID|PATIENT_ID/);
  });

  it('names the six commands the CLI has', () => {
    expect(COMMANDS).toHaveLength(6);
  });
});

describe.each(COMMANDS)('%s without the flag', (command) => {
  it('prints neither identification field', async () => {
    const shown = await output(command, []);
    expect({ command, name: shown.includes(NAME) }).toEqual({ command, name: false });
    expect({ command, technician: shown.includes(TECHNICIAN) }).toEqual({
      command,
      technician: false,
    });
  });
});

describe('with the flag', () => {
  it('header shows both, which is where the rule was already followed', async () => {
    const shown = await output('header', ['--patient']);
    expect(shown).toContain(`patient      ${NAME}-MRN1234`);
    expect(shown).toContain(`recording    ${TECHNICIAN}-HOSP1-NihonKohden`);
  });

  it('json shows both, which until 0.6.7 was one', async () => {
    const document = JSON.parse(await output('json', ['--patient'])) as Record<string, unknown>;
    expect(document.patient).toBe(`${NAME}-MRN1234`);
    expect(document.recording).toBe(`${TECHNICIAN}-HOSP1-NihonKohden`);
  });

  it('json shows neither without it, so the gate is the flag and not the shape', async () => {
    const document = JSON.parse(await output('json', [])) as Record<string, unknown>;
    expect(document).not.toHaveProperty('patient');
    expect(document).not.toHaveProperty('recording');
  });

  it('validate stops redacting the diagnostics that quote them', async () => {
    const shown = await output('validate', ['--patient']);
    expect(shown).toContain(NAME);
    expect(shown).not.toContain('[redacted]');
  });
});
