#!/usr/bin/env node
/**
 * `npx edfcore` — looking at a file without writing code.
 *
 * A separate entry point, never re-exported from the barrel, because it imports `node:fs` and
 * `node:process`. The universal entry must stay free of Node built-ins, and a test asserts it.
 *
 * This file is only the wiring. The decisions live in `cli-run.ts`, so they can be tested without
 * spawning a process against a build that may not exist yet.
 *
 * `main()` runs unconditionally rather than behind an `import.meta.url === process.argv[1]` guard.
 * That guard is a known trap for a bin: `npx` runs the command through a symlink, so the two paths
 * differ, the condition is false, and the CLI exits 0 having done nothing.
 */

// biome-ignore lint/suspicious/noTsIgnore: @ts-expect-error errors when unused — see node.ts.
// @ts-ignore 'node:fs/promises' has no declarations under `types: []`; its shape is below.
import * as nodeFsPromises from 'node:fs/promises';
// biome-ignore lint/suspicious/noTsIgnore: as above.
// @ts-ignore 'node:process' has no declarations under `types: []`; its shape is below.
import * as nodeProcess from 'node:process';
import { type CliIo, CliUsageError, parseArgs, runCli } from './cli-run.js';
import { isEdfError } from './errors.js';

interface NodeFs {
  readFile(path: string): Promise<Uint8Array>;
}
interface NodeProcess {
  readonly argv: readonly string[];
  exitCode: number | undefined;
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
}

const fs: NodeFs = nodeFsPromises as unknown as NodeFs;
const proc: NodeProcess =
  (nodeProcess as unknown as { default?: NodeProcess }).default ??
  (nodeProcess as unknown as NodeProcess);

const io: CliIo = {
  readFile: (path) => fs.readFile(path),
  out: (text) => {
    proc.stdout.write(text);
  },
  err: (text) => {
    proc.stderr.write(text);
  },
};

async function main(): Promise<void> {
  try {
    proc.exitCode = await runCli(parseArgs(proc.argv.slice(2)), io);
  } catch (error) {
    // An EdfError already says what is wrong, where, and what to do next; a stack trace over the
    // top of it would bury the one useful line.
    const message = isEdfError(error) || error instanceof Error ? error.message : String(error);
    proc.stderr.write(`edfcore: ${message}\n`);
    // 2 is the documented code for bad usage and 1 for a file that could not be read. Reporting
    // both as 1 makes a typo indistinguishable from a corrupt recording to the script that is
    // gating on it.
    proc.exitCode = error instanceof CliUsageError ? 2 : 1;
  }
}

// Not `await main()`: the package documents that no module in its graph uses top-level await,
// which is what keeps require() safe on Node >= 22.12. main() catches everything, so it cannot
// reject, and Node keeps the process alive until it settles.
void main();
