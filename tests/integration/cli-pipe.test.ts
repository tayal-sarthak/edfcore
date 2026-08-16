/**
 * The CLI as a PROCESS, piped into something that stops reading.
 *
 * Every other CLI test drives `runCli` through an injected `CliIo`, which is deliberate and is why
 * they run without a build. It also means nothing in `cli.ts` — the process shell that owns argv,
 * the exit code and the real streams — was covered by anything, and that is where
 * `edfcore signals big.edf | head -1` died: stdout closed mid-write, no `error` listener existed,
 * and Node rethrew EPIPE as an uncaught exception (fixed in 0.4.175).
 *
 * Spawning is the only way to reach that code, so this file is the exception to the rule the other
 * one states. It runs against `dist/`, which `npm run check` rebuilds immediately before the tests;
 * a bare `npm test` with no build is the one case where it could see a stale binary, so it skips
 * outright when `dist/cli.js` is absent rather than reporting a pass nobody earned.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { buildEdf } from '../support/writer.js';

const run = promisify(execFile);
const CLI = new URL('../../dist/cli.js', import.meta.url).pathname;
const built = existsSync(CLI);

/** Wide enough that the writes cannot all land in the pipe buffer before the reader exits. */
function manySignalFile(): string {
  const bytes = buildEdf({
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: Array.from({ length: 300 }, (_, i) => ({
      label: `EEG C${i}`,
      samplesPerRecord: 2,
    })),
  });
  const path = join(mkdtempSync(join(tmpdir(), 'edfcore-pipe-')), 'wide.edf');
  writeFileSync(path, bytes);
  return path;
}

describe.skipIf(!built || process.platform === 'win32')('output piped to a reader that exits', () => {
  it('says nothing on stderr when the pipe closes early', async () => {
    const file = manySignalFile();
    // `head -1` closes the pipe after one line. The shell is what makes this a real pipe.
    const { stdout, stderr } = await run('/bin/sh', [
      '-c',
      `node ${JSON.stringify(CLI)} signals ${JSON.stringify(file)} | head -1`,
    ]);

    expect(stderr).toBe('');
    expect(stdout.trim().split('\t')[1]).toBe('EEG C0');
  });

  it('still writes every line when the reader stays', async () => {
    // The other half: swallowing EPIPE must not swallow output nobody refused.
    const file = manySignalFile();
    const { stdout } = await run('/bin/sh', [
      '-c',
      `node ${JSON.stringify(CLI)} signals ${JSON.stringify(file)} | wc -l`,
    ]);
    expect(Number(stdout.trim())).toBe(300);
  });
});
