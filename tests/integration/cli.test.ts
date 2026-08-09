/**
 * The CLI.
 *
 * Exit codes are the part a script depends on, so they are what these assert hardest: 0 success,
 * 1 unreadable or failed validation, 2 bad usage. The output is checked for the facts it must
 * carry, not for its exact layout.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type CliIo, CliUsageError, parseArgs, runCli } from '../../src/cli-run.js';
import { buildEdf, minimalEdf, minimalEdfPlus } from '../support/writer.js';

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

  it('names the missing COMMAND when only a filename is given', async () => {
    // `parseArgs` puts the first non-flag argument in `command`, and the file check ran first —
    // so forgetting the subcommand reported "edfcore recording.edf: no file given", printing the
    // filename that WAS given as though it were the command, and blaming the argument that is not
    // missing. This is the commonest CLI slip after `--help`, which this project already had to
    // fix once (0.2.x) (fixed in 0.3.36).
    const { code, err } = await invoke(['recording.edf'], { 'recording.edf': PLAIN });
    expect(code).toBe(2);
    expect(err).toContain('unknown command "recording.edf"');
    expect(err).toContain('that looks like a file');
    expect(err).not.toContain('no file given');
  });

  it('still says "no file given" when a real command is missing its file', async () => {
    const { code, err } = await invoke(['header'], {});
    expect(code).toBe(2);
    expect(err).toContain('edfcore header: no file given');
  });

  it('names an unknown command that does not look like a file, without the hint', async () => {
    const { code, err } = await invoke(['nonsense', 'a.edf'], { 'a.edf': PLAIN });
    expect(code).toBe(2);
    expect(err).toContain('unknown command "nonsense"');
    expect(err).not.toContain('that looks like a file');
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
    // The column list is the contract for anything piping this into awk, so it is pinned here
    // rather than left to the docs — which described a different list until 0.2.42.
    for (const line of lines) expect(line.split('\t')).toHaveLength(6);
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
    // The kind is the fourth column, and a real gap says so.
    expect(out.split('\n').find((l) => l.startsWith('after segment 0'))).toMatch(/\tgap$/);
  });

  it('does not count an overlap as a gap, or print its duration as +-1s', async () => {
    // An overlap travels in `index.gaps` with a NEGATIVE duration (documented in 0.2.69). This
    // command called every entry a gap and prefixed a hardcoded `+`, so the output read
    // "2 gap(s)" with a line saying `+-1s` — and a sweep counting gaps counted overlaps too.
    //
    // Onsets 0,1,2,2,3,5: an overlap of 1 s and a gap of 1 s, which also cancel in net drift, so
    // this file opens with no diagnostic at all.
    const overlapping = minimalEdfPlus({
      plus: 'D',
      recordCount: 6,
      recordDurationSeconds: 1,
      recordOnsetSeconds: (i: number) => [0, 1, 2, 2, 3, 5][i] ?? 0,
    });
    const { code, out } = await invoke(['gaps', 'o.edf'], { 'o.edf': overlapping });
    expect(code).toBe(0);
    expect(out).toContain('1 gap(s) and 1 overlap(s)');
    expect(out).not.toContain('+-');

    const rows = out.split('\n').filter((line) => line.startsWith('after segment'));
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.split('\t')).toHaveLength(4);
    expect(rows[0]).toBe('after segment 0\t3s..2s\t-1s\toverlap');
    expect(rows[1]).toBe('after segment 1\t4s..5s\t1s\tgap');
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

  for (const command of ['header', 'validate'] as const) {
    it(`${command} withholds it when the field is padded with NULs, not spaces`, async () => {
      /*
       * `redactDiagnostic` substituted only spellings derived from `raw`, including `raw.trim()`.
       * But every identification diagnostic builds its message from `trimEdfField(raw)`, and
       * `trimEdfField` strips 0x20 AND 0x00 while `String.prototype.trim` strips whitespace but
       * NOT U+0000. On a NUL-padded field — which a large share of real writers emit — none of the
       * spellings matched, so the name went through verbatim while `raw:` and `actual:` said
       * `[redacted]`. Output that LOOKS redacted is worse than an obvious leak (fixed in 0.3.31).
       */
      const nulPadded = minimalEdfPlus({
        recordCount: 4,
        recordDurationSeconds: 1,
        raw: { patientId: NAME + String.fromCharCode(0).repeat(80 - NAME.length) },
      });
      const { out } = await invoke([command, 'a.edf'], { 'a.edf': nulPadded });

      expect(out).not.toContain('Haagse_Harry');
      expect(out).not.toContain('0234567');
      expect(out).toContain('PATIENT_ID_NONCONFORMANT');
      expect(out).toContain('[redacted]');
    });
  }

  it('withholds the patient birth date DATE_IMPLAUSIBLE prints', async () => {
    // A CONFORMANT identification field — no NUL padding, no grammar violation. The message
    // spells the date `2050-05-02` while the file writes `02-MAY-2050`, so no spelling derived
    // from `raw` could ever match it. `--patient` exists to withhold "a name and a birth date",
    // and this printed the birth date with the flag absent (fixed in 0.3.31).
    const bytes = minimalEdfPlus({
      recordCount: 4,
      recordDurationSeconds: 1,
      startDate: '01.01.00',
      patientId: 'MCH-0234567 F 02-MAY-2050 Haagse_Harry',
    });
    const { out } = await invoke(['validate', 'a.edf'], { 'a.edf': bytes });

    expect(out).toContain('DATE_IMPLAUSIBLE');
    expect(out).not.toContain('2050-05-02');
    expect(out).not.toContain('Haagse_Harry');
    // The rule and the recording's own start date are not patient data and stay readable.
    expect(out).toContain('2000-01-01');
  });

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

describe('bad usage is distinguishable from an unreadable file', () => {
  // The documented contract is 0 success, 1 unreadable or failed validation, 2 bad usage, and a CI
  // job gates on it without parsing output. Before 0.2.27 parseArgs threw a plain RangeError that
  // cli.ts caught with everything else and reported as 1.
  it('throws a typed usage error the shell can map to exit 2', () => {
    expect(() => parseArgs(['--limit', 'all', 'header', 'a.edf'])).toThrow(CliUsageError);
    expect(() => parseArgs(['--limit', 'all', 'header', 'a.edf'])).toThrow(RangeError);
  });

  it('refuses an unknown option instead of ignoring it', async () => {
    // A misspelled --patinet used to be dropped silently, so the command printed the output the
    // caller was trying to avoid and exited 0.
    expect(() => parseArgs(['header', 'a.edf', '--patinet'])).toThrow(CliUsageError);
    expect(() => parseArgs(['header', 'a.edf', '--patinet'])).toThrow(/unknown option/);
  });

  it('refuses extra files rather than checking one and reporting success', async () => {
    // `edfcore validate *.edf` expanded to five files used to validate the first, exit 0, and say
    // nothing about the other four — inside the CI gate the exit code exists for.
    expect(() => parseArgs(['validate', 'a.edf', 'b.edf', 'c.edf'])).toThrow(CliUsageError);
    expect(() => parseArgs(['validate', 'a.edf', 'b.edf', 'c.edf'])).toThrow(/expected one file/);
    // One file plus flags in any order is still fine.
    expect(parseArgs(['--patient', 'header', 'a.edf'])).toMatchObject({
      command: 'header',
      file: 'a.edf',
    });
  });
});

describe('--help', () => {
  it('exits 0 and prints usage', async () => {
    // parseArgs never puts a dash-prefixed argument in `command`, so runCli's `command === '--help'`
    // branch was unreachable and `edfcore --help` fell through to "no command" and exited 2 — on
    // the first thing most people type.
    for (const argv of [['--help'], ['-h'], ['help']]) {
      const { code, out } = await invoke(argv, {});
      expect(code, argv.join(' ')).toBe(0);
      expect(out).toContain('npx edfcore header');
    }
  });

  it('still exits 2 for no arguments at all', async () => {
    const { code, out } = await invoke([], {});
    expect(code).toBe(2);
    expect(out).toContain('npx edfcore header');
  });
});

describe('signals columns', () => {
  it('emits index, label, kind, rate, unit and samplesPerRecord, in that order', async () => {
    const file = minimalEdfPlus({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 25, physicalDimension: 'uV' }],
    });
    const { out } = await invoke(['signals', 'a.edf'], { 'a.edf': file });
    const [first] = out.trim().split('\n');
    expect(first?.split('\t')).toEqual(['0', 'EEG Fpz-Cz', 'data', '25', 'uV', '25']);
  });

  it('leaves the rate column empty for a legal zero record duration, and still gives the count', async () => {
    // sampleRateHz is derived and undefined when the record duration is zero — which a real
    // sleep-staging file relies on. samplesPerRecord is the one a script can always index by.
    const file = minimalEdfPlus({
      recordCount: 2,
      recordDurationSeconds: 0,
      signals: [{ label: 'Stage', samplesPerRecord: 3 }],
    });
    const { out } = await invoke(['signals', 'a.edf'], { 'a.edf': file });
    const columns = out.trim().split('\n')[0]?.split('\t');
    expect(columns?.[3]).toBe('');
    expect(columns?.[5]).toBe('3');
  });
});

describe('the usage text lists every flag the parser accepts', () => {
  /**
   * `--help` has always been printed beside its `-h`, and `--version` was printed alone even
   * though `parseArgs` has accepted `-v` for as long as it has accepted `--version`. A flag that
   * works and is not in `--help` is one nobody can find and nobody can rely on (fixed in 0.3.52).
   *
   * Derived from the source, so a new flag fails this until it is documented.
   */
  const SOURCE = readFileSync(new URL('../../src/cli-run.ts', import.meta.url), 'utf8');

  /** Every dash-prefixed literal `parseArgs` compares against. */
  function acceptedFlags(): readonly string[] {
    const body = SOURCE.slice(SOURCE.indexOf('export function parseArgs'));
    const end = body.indexOf('\nexport ', 1);
    const scope = end === -1 ? body : body.slice(0, end);
    return [...new Set([...scope.matchAll(/=== '(-{1,2}[a-z-]+)'/g)].map((m) => m[1] as string))];
  }

  /** The `Options` block of the usage banner. */
  const usageStart = SOURCE.indexOf('const USAGE');
  const usage = SOURCE.slice(usageStart, SOURCE.indexOf('`;', usageStart));

  it('finds the flags and the usage text', () => {
    // Without this, a regex that matched nothing would make the assertion below vacuous.
    expect(acceptedFlags()).toContain('--limit');
    expect(usage).toContain('Options');
    // And the token test really is stricter than a substring test.
    expect('--version').toContain('-v');
    expect('--version').not.toMatch(/(^|[\s,])-v([\s,]|$)/m);
  });

  it.each(acceptedFlags().map((flag) => ({ flag })))('documents $flag', ({ flag }) => {
    // As a whole token. `toContain('-v')` is satisfied by the `-v` inside `--version`, which is
    // exactly the flag that was undocumented, so a substring test would pass on the bug.
    expect(usage).toMatch(new RegExp(`(^|[\\s,])${flag}([\\s,]|$)`, 'm'));
  });
});

describe('gaps and validate agree about an overlapping file', () => {
  /**
   * `gaps` carried a comment saying `edfcore validate` "is the gate, and it already exits 1 on an
   * overlap through RECORD_ONSET_SPACING_VIOLATION". That code is a `warning` — deliberately; it is
   * in the warning table on `diagnostics.md` — so `report.ok` stays true, `validate` prints `PASS`
   * and exits 0 on the same file `gaps` has just printed an overlap for (fixed in 0.3.91).
   *
   * The behaviour is unchanged; this pins what the two commands actually do, so the claim cannot
   * drift back without a failing test.
   */
  const OVERLAPPING = buildEdf({
    plus: 'D',
    recordCount: 6,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 2 }],
    annotationSignals: [{ samplesPerRecord: 30 }],
    // Monotonic onsets, but records 3..5 start before record 2 ends.
    recordOnsetSeconds: (r: number) => (r < 3 ? r : r - 0.2),
  });

  it('gaps reports the overlap and exits 0', async () => {
    const { code, out } = await invoke(['gaps', 'f.edf'], { 'f.edf': OVERLAPPING });
    expect(code).toBe(0);
    expect(out).toContain('overlap');
  });

  it('validate passes it, so gaps must not call validate the gate for this', async () => {
    const { code, out } = await invoke(['validate', 'f.edf'], { 'f.edf': OVERLAPPING });
    expect(code).toBe(0);
    expect(out).toContain('PASS');

    const source = readFileSync(new URL('../../src/cli-run.ts', import.meta.url), 'utf8');
    const claim =
      /`edfcore validate` is the gate,\s*\n?\s*\/\/ and it already exits 1 on an overlap/;
    expect(source).not.toMatch(claim);
  });
});

describe('header reports what the probe found, not only the header fields', () => {
  /**
   * `openEdf` reads record 0 and the last record and records what it learned on
   * `recording.timeline.diagnostics` — a read `edfcore header` has already paid for. The command
   * printed only `header.diagnostics`, so an EDF+C file with a real hole came back as
   * "1 diagnostic(s): 1 info" with no mention of `DISCONTINUITY_IN_CONTINUOUS_FILE`, while
   * `edfcore gaps` on the same bytes reported a 20-second gap (fixed in 0.3.94).
   */
  const LYING = buildEdf({
    plus: 'C', // declares itself CONTINUOUS
    recordCount: 6,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
    annotationSignals: [{ samplesPerRecord: 30 }],
    recordOnsetSeconds: (r: number) => (r < 3 ? r : r + 20),
  });

  it('surfaces DISCONTINUITY_IN_CONTINUOUS_FILE, which gaps also reports', async () => {
    const header = await invoke(['header', 'f.edf'], { 'f.edf': LYING });
    expect(header.code).toBe(0);
    expect(header.out).toContain('DISCONTINUITY_IN_CONTINUOUS_FILE');

    // The other command's answer about the same file, so the two are checked against each other.
    const gaps = await invoke(['gaps', 'f.edf'], { 'f.edf': LYING });
    expect(gaps.out).toContain('1 gap(s)');
  });

  it('says nothing extra when the probes found nothing', async () => {
    const clean = minimalEdfPlus({ recordCount: 4, recordDurationSeconds: 1 });
    const { out } = await invoke(['header', 'f.edf'], { 'f.edf': clean });
    expect(out).not.toContain('From the record probes');
  });
});
