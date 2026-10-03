/**
 * `edfcore` with no arguments, and the channel it wrote its usage to.
 *
 * Three branches in `runCli` print the same `USAGE` text, and until 0.6.280 they did not agree about
 * where it goes. An unknown command and a missing file both write to `io.err` and exit 2. No command
 * at all wrote to `io.out` — and exited 2.
 *
 * The distinction is the one `--help` makes three lines above it: help is an ANSWER, so it goes to
 * stdout and exits 0. No command is bad usage, so it is a diagnostic, and `cli.md` says what stdout
 * is for here — every command "prints to stdout, and returns an exit code a script can branch on".
 *
 * What it cost is ordinary shell use. `edfcore > out.txt` with the command forgotten wrote the usage
 * into the file and showed the user an empty terminal, which reads as a command that worked. And
 * `edfcore json "$f" | jq .` with the command forgotten fed jq the help screen instead of failing on
 * an empty input — the pipeline this CLI documents itself for.
 *
 * The exit code was always right, which is what kept it quiet: a script branching on the code behaved
 * correctly, and only a human or a pipe reading the stream saw the wrong thing.
 */

import { describe, expect, it } from 'vitest';
import { parseArgs, runCli } from '../../src/cli-run.js';

async function invoke(argv: readonly string[]): Promise<{
  code: number;
  out: string;
  err: string;
}> {
  let out = '';
  let err = '';
  const code = await runCli(parseArgs(argv), {
    readFile: () => Promise.reject(new Error('no file should be read')),
    out: (text: string) => {
      out += text;
    },
    err: (text: string) => {
      err += text;
    },
  });
  return { code, out, err };
}

const USAGE_MARKER = 'npx edfcore header';

describe('no arguments at all', () => {
  it('writes the usage to stderr', async () => {
    const { err } = await invoke([]);
    expect(err).toContain(USAGE_MARKER);
  });

  it('writes nothing to stdout, so a pipeline gets no data', async () => {
    const { out } = await invoke([]);
    expect(out).toBe('');
  });

  it('still exits 2, which is what a script branches on', async () => {
    expect((await invoke([])).code).toBe(2);
  });
});

describe('the three branches that print the usage', () => {
  it('agree: every exit-2 path writes it to stderr and nothing to stdout', async () => {
    const paths: ReadonlyArray<readonly [string, readonly string[]]> = [
      ['no command', []],
      ['an unknown command', ['frobnicate', 'a.edf']],
      ['a missing file', ['header']],
    ];
    for (const [name, argv] of paths) {
      const { code, out, err } = await invoke(argv);
      expect(code, name).toBe(2);
      expect(err, name).toContain(USAGE_MARKER);
      expect(out, name).toBe('');
    }
  });
});

describe('help, which is an answer rather than a failure', () => {
  it('keeps stdout and exit 0', async () => {
    for (const argv of [['--help'], ['-h'], ['help']]) {
      const { code, out, err } = await invoke(argv);
      expect(code, argv[0]).toBe(0);
      expect(out, argv[0]).toContain(USAGE_MARKER);
      expect(err, argv[0]).toBe('');
    }
  });
});

describe('--version, which is also an answer', () => {
  it('keeps stdout and exit 0, with no usage text on it', async () => {
    const { code, out, err } = await invoke(['--version']);
    expect(code).toBe(0);
    expect(out).not.toContain(USAGE_MARKER);
    expect(err).toBe('');
  });
});
