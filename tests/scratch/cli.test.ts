/**
 * Scratch probes for the CLI dimension. Throwaway.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { buildEdf, minimalEdf, minimalEdfPlus } from '../support/writer.js';

const exec = promisify(execFile);

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

/** Real subprocess against the built bin — the exit code a script actually observes. */
async function spawnCli(
  argv: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec(process.execPath, ['dist/cli.js', ...argv], {
      cwd: process.cwd(),
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

const dir = mkdtempSync(join(tmpdir(), 'edfcore-cli-'));
function onDisk(name: string, bytes: Uint8Array): string {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

const PLAIN = minimalEdf({ recordCount: 4, recordDurationSeconds: 1 });
const PLAIN_PATH = onDisk('plain.edf', PLAIN);

// ---------------------------------------------------------------------------
// A. bad-flag exit code
// ---------------------------------------------------------------------------

describe('A. bad flag exit code (docs: "2 bad usage — unknown command, missing file, bad flag")', () => {
  it('A1 --limit all', async () => {
    const r = await spawnCli(['header', PLAIN_PATH, '--limit', 'all']);
    console.log('A1 code=', r.code, 'stderr=', JSON.stringify(r.stderr));
    expect(r.code).toBe(2);
  });

  it('A2 --limit with no value at all', async () => {
    const r = await spawnCli(['header', PLAIN_PATH, '--limit']);
    console.log('A2 code=', r.code, 'stderr=', JSON.stringify(r.stderr));
    expect(r.code).toBe(2);
  });

  it('A3 --limit value that looks like a command', async () => {
    const r = await spawnCli(['--limit', 'events', PLAIN_PATH]);
    console.log('A3 code=', r.code, 'stderr=', JSON.stringify(r.stderr));
    expect(r.code).toBe(2);
  });

  it('A4 a genuinely unreadable file also exits 1 — indistinguishable from A1', async () => {
    const empty = onDisk('empty.edf', new Uint8Array(0));
    const r = await spawnCli(['header', empty]);
    console.log('A4 code=', r.code, 'stderr=', JSON.stringify(r.stderr.slice(0, 200)));
    expect(r.code).toBe(1);
  });

  it('A5 unknown command really is 2 (control)', async () => {
    const r = await spawnCli(['nonsense', PLAIN_PATH]);
    console.log('A5 code=', r.code);
    expect(r.code).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// B. --help
// ---------------------------------------------------------------------------

describe('B. --help', () => {
  it('B1 runCli has a --help branch; can parseArgs ever reach it?', () => {
    console.log('B1 parseArgs(["--help"]) =', JSON.stringify(parseArgs(['--help'])));
    expect(parseArgs(['--help']).command).toBe('--help');
  });

  it('B2 npx edfcore --help exit code', async () => {
    const r = await spawnCli(['--help']);
    console.log('B2 code=', r.code, 'stdout starts:', JSON.stringify(r.stdout.slice(0, 40)));
    expect(r.code).toBe(0);
  });

  it('B3 `help` (control)', async () => {
    const r = await spawnCli(['help']);
    console.log('B3 code=', r.code);
    expect(r.code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C. patient identification leaking without --patient
// ---------------------------------------------------------------------------

const NONCONFORMANT_PATIENT = minimalEdfPlus({
  recordCount: 4,
  recordDurationSeconds: 1,
  patientId: 'Haagse_Harry_MRN_0234567_born_02-MAY-1951',
});

describe('C. patient identification without --patient', () => {
  it('C1 header', async () => {
    const { out, code } = await invoke(['header', 'a.edf'], { 'a.edf': NONCONFORMANT_PATIENT });
    console.log('C1 code=', code);
    console.log('C1 OUT >>>\n' + out + '\n<<<');
    expect(out).not.toContain('Haagse_Harry');
  });

  it('C2 validate', async () => {
    const { out, code } = await invoke(['validate', 'a.edf'], { 'a.edf': NONCONFORMANT_PATIENT });
    console.log('C2 code=', code);
    console.log('C2 OUT >>>\n' + out + '\n<<<');
    expect(out).not.toContain('Haagse_Harry');
  });

  it('C3 json (control — documented to omit)', async () => {
    const { out } = await invoke(['json', 'a.edf'], { 'a.edf': NONCONFORMANT_PATIENT });
    expect(out).not.toContain('Haagse_Harry');
  });

  it('C4 signals (control)', async () => {
    const { out } = await invoke(['signals', 'a.edf'], { 'a.edf': NONCONFORMANT_PATIENT });
    expect(out).not.toContain('Haagse_Harry');
  });

  it('C5 recording identification (technician/investigation codes) in header', async () => {
    const named = minimalEdfPlus({
      recordCount: 2,
      recordingId: 'Startdate 02-MAR-2002 PSG-1234 Dr_Jane_Roe Sony',
      patientId: 'freetext',
    });
    const { out } = await invoke(['header', 'a.edf'], { 'a.edf': named });
    console.log('C5 OUT >>>\n' + out + '\n<<<');
    expect(out).not.toContain('Dr_Jane_Roe');
  });
});

// ---------------------------------------------------------------------------
// D. events --list onset vs readAnnotations
// ---------------------------------------------------------------------------

describe('D. events --list onset column', () => {
  it('D1 discontinuous file with a sub-second start offset', async () => {
    const disc = minimalEdfPlus({
      plus: 'D',
      recordCount: 6,
      recordDurationSeconds: 1,
      startOffsetSeconds: 0.5,
      recordOnsetSeconds: (i: number) => (i < 3 ? 0.5 + i : 0.5 + i + 5),
      annotationSignals: [
        {
          samplesPerRecord: 80,
          tals: (r: number) => [{ onset: r < 3 ? 0.5 + r : 0.5 + r + 5, texts: [`event ${r}`] }],
        },
      ],
    });
    const { out, code } = await invoke(['events', 'a.edf', '--list'], { 'a.edf': disc });
    console.log('D1 code=', code);
    console.log('D1 OUT >>>\n' + out + '\n<<<');

    const rec = await openEdf(byteSource(disc));
    const { annotations } = await readAnnotations(rec, {
      start: 0,
      count: rec.header.recordCount,
    });
    console.log(
      'D1 readAnnotations =',
      JSON.stringify(
        annotations.map((a) => ({
          t: a.text,
          first: a.onsetSecondsFromFirstRecord,
          hdr: a.onsetSecondsFromHeaderStart,
        })),
        null,
        1,
      ),
    );
    expect(annotations.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// E. --limit 0 and odd limits
// ---------------------------------------------------------------------------

describe('E. --limit edge values', () => {
  const many = minimalEdfPlus({
    recordCount: 6,
    recordDurationSeconds: 1,
    annotationSignals: [
      { samplesPerRecord: 60, tals: (r: number) => [{ onset: r, texts: [`event ${r}`] }] },
    ],
  });

  it('E1 --limit 0 on events --list', async () => {
    const { out, code } = await invoke(['events', 'a.edf', '--list', '--limit', '0'], {
      'a.edf': many,
    });
    console.log('E1 code=', code, 'OUT >>>\n' + out + '\n<<<');
    expect(code).toBe(0);
  });

  it('E2 repeated --limit', () => {
    console.log('E2', JSON.stringify(parseArgs(['events', 'a.edf', '--limit', '5', '--limit', '2'])));
  });

  it('E3 --limit consumes the next arg even if it is the file', () => {
    console.log('E3', JSON.stringify(parseArgs(['events', '--limit', '5', 'a.edf'])));
    console.log('E3b', JSON.stringify(parseArgs(['--limit', '5'])));
  });

  it('E4 negative limit', async () => {
    const r = await spawnCli(['events', PLAIN_PATH, '--limit', '-1']);
    console.log('E4 code=', r.code, 'stderr=', JSON.stringify(r.stderr));
  });

  it('E5 --limit 1e3 (Number accepts it)', () => {
    console.log('E5', JSON.stringify(parseArgs(['events', 'a.edf', '--limit', '1e3'])));
    console.log('E5b', JSON.stringify(parseArgs(['events', 'a.edf', '--limit', ' 5 '])));
    console.log('E5c', JSON.stringify(parseArgs(['events', 'a.edf', '--limit', '0x10'])));
    console.log('E5d', JSON.stringify(parseArgs(['events', 'a.edf', '--limit', ''])));
  });
});

// ---------------------------------------------------------------------------
// F. file named like a flag
// ---------------------------------------------------------------------------

describe('F. odd argv shapes', () => {
  it('F1 a file whose name starts with a dash', async () => {
    console.log('F1', JSON.stringify(parseArgs(['header', '-weird.edf'])));
    const r = await invoke(['header', '-weird.edf'], { '-weird.edf': PLAIN });
    console.log('F1 code=', r.code, 'err=', JSON.stringify(r.err.slice(0, 80)));
  });

  it('F2 extra positionals are ignored silently', async () => {
    const r = await invoke(['header', 'a.edf', 'b.edf'], { 'a.edf': PLAIN });
    console.log('F2 code=', r.code, 'parsed=', JSON.stringify(parseArgs(['header', 'a.edf', 'b.edf'])));
  });

  it('F3 --patient/--list accepted on commands that ignore them', async () => {
    const r = await invoke(['signals', 'a.edf', '--patient', '--list'], { 'a.edf': PLAIN });
    console.log('F3 code=', r.code);
  });
});

// ---------------------------------------------------------------------------
// G. degenerate files against every command
// ---------------------------------------------------------------------------

const CASES: Record<string, Uint8Array> = {
  zeroRecords: minimalEdf({ recordCount: 0, recordDurationSeconds: 1 }),
  zeroDuration: buildEdf({
    signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
    recordCount: 2,
    raw: { recordDuration: '0' },
  }),
  plusNoAnnotations: minimalEdf({ recordCount: 3 }),
  truncated: PLAIN.slice(0, PLAIN.length - 3),
  headerOnly: PLAIN.slice(0, 512),
  unknownCount: minimalEdfPlus({ recordCount: 4, raw: { recordCount: '-1' } }),
};

describe('G. degenerate files', () => {
  for (const [name, bytes] of Object.entries(CASES)) {
    for (const command of ['header', 'validate', 'events', 'gaps', 'signals', 'json']) {
      it(`G ${name} / ${command}`, async () => {
        let result: string;
        try {
          const r = await invoke([command, 'a.edf'], { 'a.edf': bytes });
          result = `code=${r.code} out=${JSON.stringify(r.out.slice(0, 400))}`;
        } catch (error) {
          result = `THREW ${(error as Error).name}: ${(error as Error).message.slice(0, 300)}`;
        }
        console.log(`G[${name}][${command}] ${result}`);
      });
    }
  }
});
