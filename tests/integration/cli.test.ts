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

describe('--version', () => {
  it('prints the version and exits 0 with no command', async () => {
    // A bare --version has no command, so it must not fall through to usage and exit 2.
    const { code, out } = await invoke(['--version'], {});
    expect(code).toBe(0);
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('accepts -v', async () => {
    expect((await invoke(['-v'], {})).code).toBe(0);
  });
});

describe('signals', () => {
  it('emits one tab-separated line per signal', async () => {
    const { code, out } = await invoke(['signals', 'a.edf'], { 'a.edf': PLUS });
    expect(code).toBe(0);
    const lines = out.trim().split('\n');
    expect(lines.every((l) => l.includes('\t'))).toBe(true);
    // Every signal, annotations channel included: this is the raw listing.
    expect(lines).toHaveLength(
      (
        await invoke(['json', 'a.edf'], { 'a.edf': PLUS }).then(
          (r) => (JSON.parse(r.out) as { signals: unknown[] }).signals,
        )
      ).length,
    );
  });
});

describe('gaps', () => {
  it('says so plainly when a file is contiguous', async () => {
    const { code, out } = await invoke(['gaps', 'a.edf'], { 'a.edf': PLUS });
    expect(code).toBe(0);
    expect(out).toContain('no gaps');
  });

  it('lists the discontinuities of an EDF+D file', async () => {
    const discontinuous = minimalEdfPlus({
      plus: 'D',
      recordCount: 6,
      recordDurationSeconds: 1,
      recordOnsetSeconds: (i: number) => (i < 3 ? i : i + 5),
    });
    const { code, out } = await invoke(['gaps', 'd.edf'], { 'd.edf': discontinuous });
    expect(code).toBe(0);
    expect(out).toContain('1 gap(s)');
    expect(out).toContain('after segment 0');
  });
});

describe('events --list', () => {
  it('lists one tab-separated event per line, on the recording timebase', async () => {
    const scored = minimalEdfPlus({
      recordCount: 4,
      recordDurationSeconds: 1,
      annotationSignals: [
        {
          samplesPerRecord: 60,
          tals: (r: number) => [{ onset: r, duration: 1, texts: [`Sleep stage ${r}`] }],
        },
      ],
    });
    const { code, out } = await invoke(['events', 'a.edf', '--list'], { 'a.edf': scored });
    expect(code).toBe(0);

    const lines = out
      .trim()
      .split('\n')
      .filter((line) => line.includes('\t'));
    expect(lines).toHaveLength(4);
    expect(lines[0]?.split('\t').slice(0, 3)).toEqual(['0', '1', 'Sleep stage 0']);
    expect(lines[3]?.split('\t')[0]).toBe('3');
    // Counting mode is still the default — --list opts in, it does not replace.
    const counted = await invoke(['events', 'a.edf'], { 'a.edf': scored });
    expect(counted.out).not.toMatch(/\t/);
  });

  it('says how many it withheld rather than truncating in silence', async () => {
    const many = minimalEdfPlus({
      recordCount: 6,
      recordDurationSeconds: 1,
      annotationSignals: [
        { samplesPerRecord: 60, tals: (r: number) => [{ onset: r, texts: [`event ${r}`] }] },
      ],
    });
    const { out } = await invoke(['events', 'a.edf', '--list', '--limit', '2'], { 'a.edf': many });
    expect(out).toContain('6 annotation(s)');
    expect(out.split('\n').filter((line) => line.includes('\t'))).toHaveLength(2);
    expect(out).toContain('... 4 more');
  });
});

describe('patient identification and the diagnostics that quote it', () => {
  // EDF+ wants four space-separated subfields. A writer that packs the name into one token is
  // non-conformant — and a file that behaves oddly is exactly the one someone runs this on and
  // pastes the output of. The diagnostic names the raw bytes as written, by design, so before
  // 0.2.26 `header` printed the whole identification string three times and `validate` six,
  // with no --patient anywhere on the command line.
  const NAME = 'Haagse_Harry_MRN_0234567_born_02-MAY-1951';
  const NONCONFORMANT = minimalEdfPlus({
    recordCount: 4,
    recordDurationSeconds: 1,
    patientId: NAME,
  });

  for (const command of ['header', 'validate'] as const) {
    it(`${command} withholds it from the diagnostics too, not only from the summary`, async () => {
      const { code, out } = await invoke([command, 'a.edf'], { 'a.edf': NONCONFORMANT });
      expect(code).toBe(0);
      expect(out).not.toContain(NAME);
      expect(out).not.toContain('Haagse_Harry');
      // Withheld, not suppressed: the report still says what is wrong and where.
      expect(out).toContain('PATIENT_ID_NONCONFORMANT');
      expect(out).toContain('[redacted]');
    });

    it(`${command} still prints it in full when --patient is passed`, async () => {
      const { out } = await invoke([command, 'a.edf', '--patient'], { 'a.edf': NONCONFORMANT });
      expect(out).toContain(NAME);
      expect(out).not.toContain('[redacted]');
    });
  }

  it('withholds a non-conformant recording identification on the same flag', async () => {
    // The recording ID carries technician and investigation codes, which identify people too.
    const recordingId = 'NotAStartdate_TECH_J_SMITH_ROOM_4';
    const file = minimalEdfPlus({ recordCount: 2, recordingId });
    const { out } = await invoke(['header', 'a.edf'], { 'a.edf': file });
    expect(out).not.toContain('J_SMITH');
    expect(out).toContain('RECORDING_ID_NONCONFORMANT');
  });

  it('leaves diagnostics about every other field untouched', async () => {
    // Redaction is per field. A signal-label or numeric-field diagnostic must keep its raw bytes,
    // because that is what makes it actionable and none of it identifies anyone.
    const odd = minimalEdfPlus({
      recordCount: 2,
      signals: [{ label: 'Fp1', samplesPerRecord: 4, physicalDimension: 'Filtered' }],
    });
    const { out } = await invoke(['header', 'a.edf'], { 'a.edf': odd });
    expect(out).toContain('Filtered');
  });
});
