/**
 * The CLI.
 *
 * Exit codes are the part a script depends on, so they are what these assert hardest: 0 success,
 * 1 unreadable or failed validation, 2 bad usage. The output is checked for the facts it must
 * carry, not for its exact layout.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { minimalEdf, minimalEdfPlus } from '../support/writer.js';

interface Captured {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function invoke(
  argv: readonly string[],
  files: Record<string, Uint8Array>,
): Promise<Captured> {
  let out = '';
  let err = '';
  const io: CliIo = {
    readFile: async (path) => {
      const file = files[path];
      if (file === undefined) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      return file;
    },
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

const PLAIN = minimalEdf({ recordCount: 4, recordDurationSeconds: 1 });
const PLUS = minimalEdfPlus({ recordCount: 4, recordDurationSeconds: 1 });

describe('parseArgs', () => {
  it('reads the command, the file and the flags in any order', () => {
    expect(parseArgs(['header', 'a.edf', '--patient'])).toMatchObject({
      command: 'header',
      file: 'a.edf',
      patient: true,
    });
    expect(parseArgs(['--limit', '5', 'validate', 'b.edf'])).toMatchObject({
      command: 'validate',
      file: 'b.edf',
      limit: 5,
    });
  });

  it('refuses a non-numeric limit instead of silently uncapping the output', () => {
    // Number('all') is NaN, and a NaN cap would print everything — the opposite of the request.
    expect(() => parseArgs(['--limit', 'all', 'header', 'a.edf'])).toThrow(RangeError);
  });
});

describe('exit codes', () => {
  it('exits 2 with usage when no command is given', async () => {
    const { code, out } = await invoke([], {});
    expect(code).toBe(2);
    expect(out).toContain('npx edfcore header');
  });

  it('exits 0 for an explicit help request', async () => {
    expect((await invoke(['help'], {})).code).toBe(0);
  });

  it('exits 2 for an unknown command and for a missing file argument', async () => {
    expect((await invoke(['nonsense', 'a.edf'], {})).code).toBe(2);
    expect((await invoke(['header'], {})).code).toBe(2);
  });

  it('exits 0 when a file reads cleanly', async () => {
    expect((await invoke(['header', 'a.edf'], { 'a.edf': PLAIN })).code).toBe(0);
  });
});

describe('header', () => {
  it('prints the shape of the file and withholds patient identification', async () => {
    const named = minimalEdf({ patientId: 'MCH-0234567 F 02-MAY-1951 Haagse_Harry' });
    const withheld = await invoke(['header', 'a.edf'], { 'a.edf': named });
    expect(withheld.out).not.toContain('Haagse_Harry');

    const asked = await invoke(['header', 'a.edf', '--patient'], { 'a.edf': named });
    expect(asked.out).toContain('Haagse_Harry');
  });
});

describe('events', () => {
  it('counts annotations by text', async () => {
    const { code, out } = await invoke(['events', 'a.edf'], { 'a.edf': PLUS });
    expect(code).toBe(0);
    expect(out).toMatch(/annotation\(s\)|no annotations/);
  });

  it('says so plainly when a file has none', async () => {
    const { out } = await invoke(['events', 'a.edf'], { 'a.edf': PLAIN });
    expect(out).toContain('no annotations');
  });
});

describe('json', () => {
  it('emits parseable JSON with no patient field by default', async () => {
    const { code, out } = await invoke(['json', 'a.edf'], { 'a.edf': PLAIN });
    expect(code).toBe(0);
    const parsed = JSON.parse(out) as { variant: string; patient?: string; signals: unknown[] };
    expect(parsed.variant).toBe('EDF');
    expect(parsed.patient).toBeUndefined();
    expect(parsed.signals.length).toBeGreaterThan(0);
  });
});

describe('validate', () => {
  it('exits 0 and reports a verdict for a conforming file', async () => {
    const { code, out } = await invoke(['validate', 'a.edf'], { 'a.edf': PLAIN });
    expect(code).toBe(0);
    expect(out).toMatch(/^(PASS|FAIL)/);
  });
});
