/**
 * The published `bin` runs as a program, which is the one thing `npx edfcore` needs and nothing
 * here has ever exercised.
 *
 * `cli.test.ts` and the rest drive `runCli` through an injected `CliIo`, deliberately, so they
 * need no build. `cli-pipe.test.ts` does spawn the built file — but always as `node dist/cli.js`,
 * naming the interpreter itself. Between them they cover every line of the program and none of
 * the mechanism that starts it: the `#!/usr/bin/env node` on line 1, which is what the kernel
 * reads when npm links `dist/cli.js` onto a user's PATH.
 *
 * Delete that line and every test in this repository still passes. `npm run build` succeeds,
 * `verify:tarball` confirms the bin target is in the tarball, `node dist/cli.js header f.edf`
 * works exactly as before — and `npx edfcore header f.edf` fails on the first line of JavaScript
 * with a shell syntax error, because the shell it was handed to is not a JavaScript engine. The
 * first command the README prints is the one that breaks.
 *
 * So the built file is given the executable bit npm's tarball carries for a bin, and run with no
 * interpreter named. That is the load path a user gets, and it is the only way to check the
 * shebang rather than the file's first line: a CRLF ending, a leading blank line, or a BOM in
 * front of it each leave the text intact and the program unloadable. It is run in place rather
 * than copied out, because `dist/cli.js` imports its siblings by relative path — a copy on its
 * own is a program with no `cli-run.js` next to it.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const MANIFEST = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8')) as {
  bin: Record<string, string>;
};
const BIN = fileURLToPath(new URL(MANIFEST.bin.edfcore ?? '', ROOT));
const SHEBANG = '#!/usr/bin/env node';

describe('the source the bin is built from', () => {
  it('opens with the shebang, on the first line and nothing before it', () => {
    const source = readFileSync(new URL('src/cli.ts', ROOT), 'utf8');
    // Byte 0. A BOM or a blank line ahead of it is invisible in an editor and fatal to the loader.
    expect(source.startsWith(`${SHEBANG}\n`)).toBe(true);
    // And exactly once: a second one further down is a comment, not a second entry point.
    expect(source.split(SHEBANG)).toHaveLength(2);
  });
});

/**
 * `npm run check` builds immediately before the tests, so `dist/` is there in CI and after any
 * ordinary run. A bare `npm test` on a fresh checkout is the one case where it is not, and this
 * skips rather than reporting a pass nobody earned — the rule `cli-pipe.test.ts` already follows.
 */
describe.skipIf(!existsSync(BIN) || process.platform === 'win32')('the built bin', () => {
  it('is what package.json points at, and it carries the shebang too', () => {
    expect(MANIFEST.bin.edfcore).toBe('./dist/cli.js');
    expect(readFileSync(BIN, 'utf8').startsWith(`${SHEBANG}\n`)).toBe(true);
  });

  it('runs with no interpreter named, the way npm installs it', () => {
    // `tsc` emits 0644 and npm's tarball carries a bin at 0755, so the bit is set here rather
    // than assumed. Everything after that is the kernel reading line 1.
    chmodSync(BIN, 0o755);
    // stdin is closed and there is a timeout, because the failure this is here to catch does not
    // look like an error: a file with no shebang is handed to `/bin/sh`, which reads JavaScript
    // as shell and can sit waiting on input rather than exiting. Without both, a deleted shebang
    // hangs the suite instead of failing it.
    const out = execFileSync(BIN, ['--help'], {
      encoding: 'utf8',
      timeout: 20_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(out).toContain('edfcore');
    expect(out).toContain('header');
  });

  it('exits 0 for that help, so a shell script can rely on it', () => {
    chmodSync(BIN, 0o755);
    const status = execFileSync(
      '/bin/sh',
      ['-c', `${JSON.stringify(BIN)} --help >/dev/null; echo $?`],
      { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(status.trim()).toBe('0');
  });
});
