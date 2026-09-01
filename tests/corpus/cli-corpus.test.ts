/**
 * The CLI against real files.
 *
 * `tests/integration/cli.test.ts` drives every command, and every fixture it uses is a few hundred
 * bytes written by this project. That checks the decisions — exit codes, flags, output shape — and
 * it cannot check what a command does when pointed at 48 MB of clinical recording or at a scoring
 * file with 154 events and a record duration of zero.
 *
 * The exit code is what a CI job gates on without parsing output, so it is what these assert
 * hardest. `edfcore validate` returning 0 on a real conformant recording is the claim that makes
 * the command usable as a gate at all; a validator that fails real files is worse than none.
 *
 * Skips without the corpus. `npm run corpus:fetch`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';

const FILES = join(dirname(fileURLToPath(import.meta.url)), 'files');
const PSG = 'SC4001E0-PSG.edf';
const HYPNOGRAM = 'SC4001EC-Hypnogram.edf';

const has = (name: string): boolean => existsSync(join(FILES, name));
const maybe = (name: string) => (has(name) ? it : it.skip);

async function run(argv: readonly string[]) {
  let out = '';
  let err = '';
  const io: CliIo = {
    readFile: async (path) => new Uint8Array(readFileSync(join(FILES, path))),
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  };
  const code = await runCli(parseArgs(argv), io);
  return { code, out, err };
}

describe('a 22-hour clinical recording', () => {
  maybe(PSG)(
    'validates clean, and exits 0 so a CI gate passes it',
    async () => {
      // The claim that makes `edfcore validate` usable: a real, conformant recording from a real
      // sleep lab must not be reported as a problem. A validator that fails real files is worse
      // than no validator, because it teaches people to ignore it.
      const { code, out } = await run(['validate', PSG]);
      expect(code).toBe(0);
      expect(out).toMatch(/^PASS/);
      expect(out).toContain('2650 records');
    },
    120_000,
  );

  maybe(PSG)('summarises the header without printing patient identification', async () => {
    const { code, out } = await run(['header', PSG]);
    expect(code).toBe(0);
    // Plain EDF, not EDF+: this file carries an `Event marker` DATA channel rather than an
    // annotations channel, which is how sleep-edfx splits signals from scoring. Worth asserting
    // rather than assuming — the sibling hypnogram is the EDF+ half of the same recording.
    expect(out).toContain('EDF · 7 signals');
    expect(out).toContain('EEG Fpz-Cz');
    // The file's identification fields are blank, so this asserts the SHAPE rather than a name:
    // no raw identification bytes reach the output, redacted or otherwise, without --patient.
    expect(out).not.toContain('[redacted]');
  });

  maybe(PSG)('lists every signal with its authoritative sample count', async () => {
    const { code, out } = await run(['signals', PSG]);
    expect(code).toBe(0);
    const lines = out.trim().split('\n');
    expect(lines).toHaveLength(7);
    for (const line of lines) expect(line.split('\t')).toHaveLength(6);

    const eeg = lines.find((l) => l.includes('EEG Fpz-Cz'))?.split('\t');
    expect(eeg?.[3]).toBe('100'); // rate
    expect(eeg?.[4]).toBe('uV'); // unit
    expect(eeg?.[5]).toBe('3000'); // samplesPerRecord — 100 Hz over a 30 s record
  });

  maybe(PSG)(
    'reports no gaps in a continuous recording, after a full scan',
    async () => {
      const { code, out } = await run(['gaps', PSG]);
      expect(code).toBe(0);
      expect(out).toContain('no gaps in 2650 records');
    },
    120_000,
  );
});

describe('a real scoring file', () => {
  maybe(HYPNOGRAM)('counts 154 sleep stages by their text', async () => {
    const { code, out } = await run(['events', HYPNOGRAM]);
    expect(code).toBe(0);
    expect(out).toContain('154 annotations');
    // Counted by text, most frequent first — the first thing worth knowing about a scoring file.
    expect(out).toMatch(/Sleep stage/);
  });

  maybe(HYPNOGRAM)('lists them with onsets on the recording axis', async () => {
    const { code, out } = await run(['events', HYPNOGRAM, '--list', '--limit', '3']);
    expect(code).toBe(0);
    const lines = out
      .trim()
      .split('\n')
      .filter((l) => l.includes('\t'));
    expect(lines).toHaveLength(3);

    // The night starts awake at t = 0 and the first epoch is long; both come from the file.
    const first = lines[0]?.split('\t');
    expect(first?.[0]).toBe('0');
    expect(first?.[2]).toContain('Sleep stage');
    expect(out).toContain('... 151 more');
  });

  maybe(HYPNOGRAM)('emits JSON for a file with no signals at all', async () => {
    // A scoring file has zero data signals and a record duration of zero. Every command has to
    // survive that rather than dividing by it.
    const { code, out } = await run(['json', HYPNOGRAM]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out) as { variant: string; signals: unknown[] };
    expect(parsed.variant).toMatch(/^EDF/);
    expect(Array.isArray(parsed.signals)).toBe(true);
  });
});
