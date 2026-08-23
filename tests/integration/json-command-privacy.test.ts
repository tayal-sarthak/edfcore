/**
 * What `edfcore json` puts in a file you are about to pipe somewhere.
 *
 * The obvious thing to do with this command's output is pipe it: into `jq`, into a manifest, into
 * a ticket, into a spreadsheet a directory sweep produced. That is the whole reason the command
 * exists, and it is why identification is opt-in here exactly as it is in `formatHeader`.
 *
 * `cli.test.ts` covers `--patient` on `header` and `validate`, where the defence is redaction —
 * `[redacted]` in place of a value. `json` defends differently: the key is not there at all. That
 * matters for the consumer this command has, because a JSON object carrying a redacted patient is
 * a record that a patient field existed and was withheld, and a machine reading the output would
 * have to tell the two shapes apart.
 *
 * The diagnostics are the second half, and the quieter one. They are reduced to `code` and
 * `severity` — no message, no raw, no actual — so identification cannot arrive through a
 * diagnostic that happened to quote the field it was complaining about. Every identification
 * diagnostic does quote it: that is what `redactDiagnostic` exists to undo on the other two
 * commands. Here there is nothing to undo, and the way that is achieved is an object literal
 * naming two properties, which is one careless spread away from carrying all of them.
 *
 * `trimEdfField` rather than `String.prototype.trim` is the third. `.trim()` strips whitespace and
 * not U+0000, so on the NUL-padded identification fields a large share of real writers emit, the
 * padding survives — and `JSON.stringify` escapes each one into a six-character sequence inside
 * the value, which is both unreadable and a disclosure of the field's exact width.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { buildEdf } from '../support/writer.js';

const NAME = 'Jane_Q_Public';
const MRN = 'MRN9931';
const PATIENT = `${MRN} F 02-MAY-1951 ${NAME}`;

/** The escape `JSON.stringify` produces for a NUL, written as an escape so none is in this file. */
const ESCAPED_NUL = '\\u0000';

/** EDF+ whose patient field is NUL-padded, the way a large share of real writers emit it. */
const FILE = buildEdf({
  plus: 'C',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 30 }],
  raw: { patientId: PATIENT + '\u0000'.repeat(80 - PATIENT.length) },
});

async function jsonOf(
  argv: readonly string[],
): Promise<{ text: string; parsed: Record<string, unknown> }> {
  let text = '';
  const io: CliIo = {
    readFile: () => Promise.resolve(FILE),
    out: (chunk) => {
      text += chunk;
    },
    err: () => undefined,
  };
  await runCli(parseArgs(argv), io);
  return { text, parsed: JSON.parse(text) as Record<string, unknown> };
}

describe('without --patient', () => {
  it('has no patient key at all, rather than a redacted one', async () => {
    const { parsed } = await jsonOf(['json', 'night.edf']);
    // Absent, not null and not "[redacted]": a machine reading this should not have to tell
    // "there was no patient field" from "there was one and it was withheld".
    expect('patient' in parsed).toBe(false);
  });

  it('carries no spelling of the identification anywhere in the output', async () => {
    const { text } = await jsonOf(['json', 'night.edf']);
    for (const secret of [NAME, MRN, '02-MAY-1951', '1951-05-02']) {
      expect(text, `${secret} reached the output`).not.toContain(secret);
    }
  });

  it('still says everything the command is for', async () => {
    const { parsed } = await jsonOf(['json', 'night.edf']);
    expect(parsed.variant).toBe('EDF+C');
    expect(parsed.recordCount).toBe(2);
    expect(Array.isArray(parsed.signals)).toBe(true);
  });
});

describe('the diagnostics it prints', () => {
  it('carry a code and a severity and nothing else', async () => {
    const { parsed } = await jsonOf(['json', 'night.edf']);
    const diagnostics = parsed.diagnostics as ReadonlyArray<Record<string, unknown>>;
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of diagnostics) {
      // Named rather than counted: a spread would add every field at once, and the two that
      // matter are the ones quoting the file.
      expect(Object.keys(diagnostic).sort()).toEqual(['code', 'severity']);
    }
  });

  it('cannot carry identification through a message that quoted it', async () => {
    const { text } = await jsonOf(['json', 'night.edf']);
    // Every identification diagnostic quotes the field it complains about. There is no message
    // here to quote it in.
    expect(text).not.toContain('"message"');
    expect(text).not.toContain('"raw"');
    expect(text).not.toContain('"actual"');
  });
});

describe('with --patient', () => {
  it('prints the field, because that is what the flag is', async () => {
    const { parsed } = await jsonOf(['json', 'night.edf', '--patient']);
    expect(parsed.patient).toBe(PATIENT);
  });

  it('prints it without the padding the file put around it', async () => {
    const { text, parsed } = await jsonOf(['json', 'night.edf', '--patient']);
    // `.trim()` leaves U+0000 in place, and `JSON.stringify` turns each one into an escape —
    // sixty of them here, which is unreadable and discloses the field's exact width.
    expect(text).not.toContain(ESCAPED_NUL);
    expect(String(parsed.patient)).toHaveLength(PATIENT.length);
  });
});
