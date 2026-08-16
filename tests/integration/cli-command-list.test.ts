/**
 * The commands `--help` offers are exactly the commands the CLI will dispatch.
 *
 * `cli-run.ts` writes the list twice: once as prose in `USAGE`, and once as the `COMMANDS` set that
 * decides whether a word is refused before the file is even opened. They fail in opposite
 * directions and neither is loud. A command in `COMMANDS` but not `USAGE` works and is
 * undocumented — nothing would ever tell a user it exists. A command in `USAGE` but not `COMMANDS`
 * is advertised and then refused as unrecognised, which reads as a broken install.
 *
 * `api-surface.test.ts` counts the commands in `--help` and compares that number to the table in
 * the README, so it pins how many there are and not which. Six of one set and six of the other
 * passes it while naming different things.
 *
 * The `COMMANDS` side is read out of the source because the set is module-private, and exporting it
 * to be testable would widen the public surface for the benefit of a test — `public-api.test.ts`
 * exists to stop exactly that.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type CliIo, CliUsageError, parseArgs, runCli } from '../../src/cli-run.js';

const SOURCE = readFileSync(new URL('../../src/cli-run.ts', import.meta.url), 'utf8');

/** The command words the rendered help text offers. */
async function helpCommands(): Promise<readonly string[]> {
  let out = '';
  const io: CliIo = {
    readFile: () => Promise.reject(new Error('--help reads no file')),
    out: (text) => {
      out += text;
    },
    err: () => {},
  };
  const code = await runCli(parseArgs(['--help']), io);
  expect(code).toBe(0);
  return [...out.matchAll(/^\s+npx edfcore (\w+) <file>/gm)].map((m) => m[1] as string);
}

/** The members of the `COMMANDS` set, read as text. */
function dispatchCommands(): readonly string[] {
  const start = SOURCE.indexOf('const COMMANDS');
  const open = SOURCE.indexOf('[', start);
  const close = SOURCE.indexOf(']', open);
  return [...SOURCE.slice(open, close).matchAll(/'(\w+)'/g)].map((m) => m[1] as string);
}

describe('the CLI command list', () => {
  it('found both copies, so a passing run is not a vacuous one', async () => {
    expect((await helpCommands()).length).toBeGreaterThan(1);
    expect(dispatchCommands()).toContain('header');
  });

  it('offers in --help exactly what it will dispatch', async () => {
    expect([...(await helpCommands())].sort()).toEqual([...dispatchCommands()].sort());
  });

  it('accepts every command it offers', async () => {
    // The other direction, at runtime. An unreadable file makes `runCli` throw rather than return,
    // and `cli.ts` maps only `CliUsageError` to exit 2 — so the read failing is a pass here, and
    // the one outcome that is not is the command being rejected as a word the CLI does not know.
    for (const command of await helpCommands()) {
      const io: CliIo = {
        readFile: () => Promise.reject(new Error('ENOENT: no such file or directory')),
        out: () => {},
        err: () => {},
      };
      const outcome = await runCli(parseArgs([command, 'absent.edf']), io).catch(
        (error: unknown) => error,
      );
      expect(
        outcome,
        `${command} is offered by --help but refused as bad usage`,
      ).not.toBeInstanceOf(CliUsageError);
    }
  });
});
