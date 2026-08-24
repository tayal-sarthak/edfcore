/**
 * What the CLI does with a failure, as a PROCESS.
 *
 * Every other CLI test drives `runCli` through an injected `CliIo`, which is deliberate and is why
 * they run without a build. `cli.ts` is the shell around it — argv, the exit code, the real
 * streams, and the one `readFile` in the package that is not a `ByteSource` — and only
 * `cli-pipe.test.ts` reaches any of it, for EPIPE alone. Three promises in that file had nothing
 * checking them:
 *
 *  - A DIRECTORY is named as one. Node answers `fs.readFile` with `EISDIR: illegal operation on a
 *    directory, read` — an errno with no path in it and no move to make. `fileSource` was fixed for
 *    exactly this in 0.3.98 and the CLI, which reads the file itself, got the same fix in 0.4.178.
 *    `ENOENT` is deliberately left alone, because Node's own text already names the path.
 *  - The EXIT CODE distinguishes a typo from a bad file: 2 for usage, 1 for anything else.
 *    `documented-exit-codes.test.ts` pins the codes `runCli` returns; the mapping from a THROWN
 *    error to a code lives here instead, in a `catch` no injected `CliIo` can reach.
 *  - No stack trace. An `EdfError` already says what is wrong, where, and what to do next, and
 *    fifteen frames of Node internals over the top of it bury the one useful line.
 *
 * Spawning is the only way to run any of it, so this file skips when `dist/` is absent rather than
 * reporting a pass nobody earned — the same rule, and the same reason, as `cli-pipe.test.ts`.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildEdf } from '../support/writer.js';

const CLI = new URL('../../dist/cli.js', import.meta.url).pathname;
const built = existsSync(CLI);

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** `execFile` rejects on a non-zero exit, and a non-zero exit is what every case here wants. */
function edfcore(args: readonly string[]): Promise<Run> {
  return new Promise((resolve) => {
    execFile('node', [CLI, ...args], (error, stdout, stderr) => {
      const code = (error as { code?: number } | null)?.code ?? 0;
      resolve({ code, stdout, stderr });
    });
  });
}

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'edfcore-cli-'));
}

function goodFile(): string {
  const path = join(scratchDir(), 'night.edf');
  writeFileSync(
    path,
    buildEdf({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 4 }],
    }),
  );
  return path;
}

describe.skipIf(!built)('a path that is not a readable file', () => {
  it('names a directory as a directory, and says what to do', async () => {
    const { code, stderr } = await edfcore(['header', scratchDir()]);

    expect(stderr).toContain('is a directory, not a file');
    expect(stderr).toContain('Next: name the .edf or .bdf file inside it');
    // The raw errno is what this replaced; seeing it back means the translation was lost.
    expect(stderr).not.toContain('EISDIR');
    expect(code).toBe(1);
  });

  it('leaves ENOENT alone, because Node already names the path', async () => {
    const missing = join(scratchDir(), 'absent.edf');
    const { code, stderr } = await edfcore(['header', missing]);

    expect(stderr).toContain('ENOENT');
    expect(stderr).toContain(missing);
    expect(code).toBe(1);
  });
});

describe.skipIf(!built)('the exit code separates a typo from a bad file', () => {
  it('is 2 for a usage error thrown while parsing the arguments', async () => {
    // `--limit all` is refused by `parseArgs`, which throws a `CliUsageError` before any file is
    // touched. A script gating on the code must be able to tell that from a corrupt recording.
    const { code, stderr } = await edfcore(['--limit', 'all', 'header', goodFile()]);

    expect(code).toBe(2);
    expect(stderr).toContain('edfcore:');
  });

  it('is 1 for a file that could not be read', async () => {
    const { code } = await edfcore(['header', scratchDir()]);
    expect(code).toBe(1);
  });

  it('is 0 for the same file when nothing is wrong', async () => {
    // Non-vacuity: the two codes above are about the failures, not about the command always
    // failing under `execFile`.
    const { code, stdout } = await edfcore(['header', goodFile()]);
    expect(code).toBe(0);
    expect(stdout).toContain('EEG Fpz-Cz');
  });
});

describe.skipIf(!built)('a failure is one line, not a stack trace', () => {
  it.each([
    ['a directory', () => [scratchDir()]],
    ['a corrupt file', () => [truncated()]],
  ])('prints no frames for %s', async (_name, argv) => {
    const { stderr } = await edfcore(['header', ...argv()]);

    expect(stderr.startsWith('edfcore: ')).toBe(true);
    // A Node stack trace is a run of lines beginning `    at `. One is enough to bury the message.
    expect(stderr).not.toMatch(/\n\s+at /);
  });

  /** A header that ends part way through, which `parseHeader` refuses with an `EdfFormatError`. */
  function truncated(): string {
    const path = join(scratchDir(), 'cut.edf');
    const bytes = buildEdf({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 4 }],
    });
    writeFileSync(path, bytes.subarray(0, 200));
    return path;
  }
});
