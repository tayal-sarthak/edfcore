/**
 * edfcore never writes to the console.
 *
 * The README says it twice — "nothing is written to the console", and the survey table that
 * explains why this library exists lists what every other EDF package on npm does instead:
 * "`console.warn` and `null`, or bare thrown strings". `AGENTS.md` repeats it. Diagnostics are
 * values on the result precisely so that reporting them is the caller's decision, and a library
 * that logs takes that decision away: it pollutes a consumer's stdout, breaks anything parsing it,
 * and on a header diagnostic it puts a patient's name into whatever collects the logs.
 *
 * Nothing checked it. One `console.warn` left in during debugging would ship, and the only way to
 * find it is to be the person whose output it lands in.
 *
 * Both halves are here because neither is enough. The static sweep catches a call on a path no
 * test happens to take; running the library catches one reached through something the sweep
 * cannot see — a bundler shim, `globalThis.console`, a method aliased into a local. The trap
 * covers every method the console object has rather than a list, so `console.table` is caught the
 * same as `console.log`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import { formatHeader } from '../../src/format-header.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readWindow } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { patchBytes } from '../support/corrupt.js';
import { minimalEdfPlus } from '../support/writer.js';

const SRC = new URL('../../src/', import.meta.url);

/** Comments describe what other libraries do; only code counts. */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const SOURCES: ReadonlyArray<{ readonly name: string; readonly text: string }> = (function walk(
  dir: URL,
  prefix: string,
  into: Array<{ name: string; text: string }>,
) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) walk(child, `${prefix}${entry.name}/`, into);
    else if (entry.name.endsWith('.ts')) {
      into.push({
        name: `${prefix}${entry.name}`,
        text: withoutComments(readFileSync(child, 'utf8')),
      });
    }
  }
  return into;
})(SRC, '', []);

describe('no source file names the console', () => {
  it('read the tree, so a passing run is not a vacuous one', () => {
    expect(SOURCES.length).toBeGreaterThan(40);
    // The README's survey table quotes `console.warn` as what the alternatives do, and that
    // sentence lives in a comment in more than one place — stripping them is load-bearing.
    expect(SOURCES.some(({ text }) => text.includes('console'))).toBe(false);
  });

  it('leaves no call in any module, including the bin', () => {
    const noisy = SOURCES.filter(({ text }) => /\bconsole\s*\./.test(text)).map(({ name }) => name);
    expect(noisy, 'modules that write to the console').toEqual([]);
  });
});

describe('and nothing writes to it when the library runs', () => {
  /** Every method the console object has, replaced by a recorder. */
  async function underTrap(run: () => Promise<void>): Promise<readonly string[]> {
    const calls: string[] = [];
    const original = new Map<string, unknown>();
    const target = console as unknown as Record<string, unknown>;
    for (const key of Object.keys(target)) {
      if (typeof target[key] !== 'function') continue;
      original.set(key, target[key]);
      target[key] = (...args: unknown[]) => {
        calls.push(`console.${key}(${args.map((one) => String(one)).join(', ')})`);
      };
    }
    try {
      await run();
    } finally {
      for (const [key, value] of original) target[key] = value;
    }
    return calls;
  }

  it('traps every method, so the check is not a list of the obvious ones', async () => {
    // Proves the trap itself works before anything is asserted through it.
    const calls = await underTrap(async () => {
      console.warn('probe');
      console.debug('probe');
    });
    expect(calls).toEqual(['console.warn(probe)', 'console.debug(probe)']);
  });

  it('stays silent over a good file and a damaged one', async () => {
    const good = minimalEdfPlus({ recordCount: 8, recordDurationSeconds: 1 });
    // Damaged on purpose: the diagnostics path is where a `console.warn` would be tempting.
    const damaged = patchBytes(good, 184, new Uint8Array([0x39, 0x39, 0x39]));

    const calls = await underTrap(async () => {
      for (const bytes of [good, damaged]) {
        try {
          const recording = await openEdf(byteSource(bytes));
          formatHeader(recording.header);
          formatDiagnostics(recording.header.diagnostics);
          await readWindow(recording, {
            signalIndices: recording.header.dataSignalIndices,
            startSeconds: 0,
            durationSeconds: 2,
          });
          await readAnnotations(recording, { start: 0, count: recording.header.recordCount });
          await buildRecordIndex(recording);
          await validateRecording(recording);
        } catch {
          // A damaged file may refuse; refusing quietly is the behaviour under test.
        }
        await inspectEdf(byteSource(bytes));
      }
    });

    expect(calls, 'edfcore wrote to the console').toEqual([]);
  });
});
