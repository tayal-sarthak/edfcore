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
  readonly stdout: {
    write(text: string): unknown;
    on(event: string, listener: (error: { code?: string }) => void): unknown;
  };
  readonly stderr: { write(text: string): unknown };
}

const fs: NodeFs = nodeFsPromises as unknown as NodeFs;
const proc: NodeProcess =
  (nodeProcess as unknown as { default?: NodeProcess }).default ??
  (nodeProcess as unknown as NodeProcess);

/*
 * A closed pipe is not an error, and Node treats it as one.
 *
 * `edfcore signals big.edf | head -1` closes stdout while the CLI is still writing. The write
 * fails with EPIPE, nothing is listening for `error` on the stream, and Node's default is to
 * rethrow it as an uncaught exception — so a command documented "for grep and awk" answered a
 * perfectly ordinary shell idiom with a kilobyte of stack trace on stderr. `head`, `less`,
 * `grep -m1` and a `jq` that exits early all do this.
 *
 * Swallowed rather than reported: the consumer got what it asked for and stopped listening, which
 * is what it is entitled to do. The remaining writes are dropped by the same handler, since the
 * stream stays broken (fixed in 0.4.175).
 */
proc.stdout.on('error', (error) => {
  if (error?.code !== 'EPIPE') throw error;
});

const io: CliIo = {
  /*
   * A directory reaches `fs.readFile` and comes back as a raw `EISDIR: illegal operation on a
   * directory, read` — an errno with no path in it and nothing to do next. `fileSource` was fixed
   * for exactly this in 0.3.98, but the CLI reads the whole file itself rather than going through
   * that adapter, so it never got the fix. `ENOENT` is left alone: Node's own text already names
   * the path and says what is wrong (fixed in 0.4.178).
   */
  readFile: async (path) => {
    try {
      return await fs.readFile(path);
    } catch (error) {
      if ((error as { code?: string } | null)?.code !== 'EISDIR') throw error;
      throw new Error(
        `${JSON.stringify(path)} is a directory, not a file. Next: name the .edf or .bdf ` +
          'file inside it.',
      );
    }
  },
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
