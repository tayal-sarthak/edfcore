/**
 * The CLI's output is a function of the file.
 *
 * `diagnostics.md` says of the formatter underneath it that "the output is deterministic (no
 * locale-sensitive formatting, no ANSI escapes unless you ask), so it's safe to snapshot in a
 * test", and `validation.md` says the same of the report. 0.5.26 checked that for the library. The
 * CLI is a second surface over those formatters with joins, sorts, caps and column padding of its
 * own, and the claim that matters for it is the one a script depends on: run it twice on the same
 * bytes and you get the same bytes back.
 *
 * That is the property `edfcore signals big.edf | sort | diff -` is built on, and the one that
 * makes `edfcore json` usable in a build. It is easy to lose in ways no single-run test would see —
 * a `Map` iterated where a `Set` was meant, a sort that is not total, a count formatted from a
 * float — and each of those produces output that is right most of the time.
 *
 * So every command runs twice over every shape in the matrix, and the exit code and the full text
 * of both streams must be identical: sixty pairs over ten files. The counts are asserted too, so a
 * run where the CLI printed nothing at all could not pass.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { AWKWARD } from '../support/awkward-files.js';

/** The six file commands the usage text lists. `--help` and `--version` take no file. */
const COMMANDS = ['header', 'validate', 'events', 'signals', 'gaps', 'json'] as const;

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function invoke(command: string, bytes: Uint8Array): Promise<Run> {
  let out = '';
  let err = '';
  const io: CliIo = {
    readFile: () => Promise.resolve(bytes),
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  };
  const code = await runCli(parseArgs([command, 'x.edf']), io);
  return { code, out, err };
}

describe('every command over every shape', () => {
  it('prints the same bytes the second time', async () => {
    let pairs = 0;
    let printed = 0;
    for (const file of AWKWARD) {
      for (const command of COMMANDS) {
        const where = `${command} on ${file.name}`;
        const first = await invoke(command, file.bytes);
        const second = await invoke(command, file.bytes);
        expect(second.code, where).toBe(first.code);
        expect(second.out, where).toBe(first.out);
        expect(second.err, where).toBe(first.err);
        pairs += 1;
        printed += first.out.length;
      }
    }
    expect(pairs).toBe(AWKWARD.length * COMMANDS.length);
    expect(pairs).toBeGreaterThanOrEqual(60);
    // And it really printed: sixty pairs of empty strings would satisfy the equality above.
    expect(printed).toBeGreaterThan(20_000);
  });

  it('and the same bytes for a second recording opened over a copy of the file', async () => {
    // The stronger form: the output is a function of the bytes rather than stable per process.
    for (const file of AWKWARD) {
      for (const command of COMMANDS) {
        const where = `${command} on ${file.name}`;
        const first = await invoke(command, file.bytes);
        const second = await invoke(command, Uint8Array.from(file.bytes));
        expect(second.out, where).toBe(first.out);
        expect(second.code, where).toBe(first.code);
      }
    }
  });

  it('reached more than one exit code across the matrix, so the comparison is not of one outcome', async () => {
    const codes = new Set<number>();
    for (const file of AWKWARD) {
      for (const command of COMMANDS) codes.add((await invoke(command, file.bytes)).code);
    }
    expect(codes.size).toBeGreaterThan(1);
    for (const code of codes) expect([0, 1, 2]).toContain(code);
  });
});
