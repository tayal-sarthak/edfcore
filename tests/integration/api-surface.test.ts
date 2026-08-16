/**
 * The README's "API surface" table, checked against the package it describes.
 *
 * A count written into prose is a claim that goes stale in silence. The documentation site footer
 * read "MIT licensed. Version 0.1.0." for the whole 0.2, 0.3 and 0.4 history because nothing swept
 * it (fixed in 0.4.26), and a table of five numbers is the same shape of claim with five times the
 * surface. So none of them is trusted: the exports are counted by importing the three entry
 * points, the codes by reading the disposition registry every known code must appear in, and the
 * commands by rendering the CLI's own `--help` — the text a user is told to run.
 *
 * The types are the one row that cannot be counted at runtime, since they are erased. They are
 * read from the `export type { … }` blocks of the three barrels instead, with comments stripped:
 * those blocks carry prose explaining individual re-exports, and a naive match counts the words
 * in it as type names.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { DIAGNOSTIC_DISPOSITIONS } from '../../src/diagnostics/codes.js';
import * as universal from '../../src/index.js';
import * as nodeEntry from '../../src/node.js';
import * as validateEntry from '../../src/validate.js';

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');

const README = read('../../README.md');

/** The `| label | value |` rows of the API surface table, by label. */
const ROWS: ReadonlyMap<string, string> = (() => {
  const section = README.slice(README.indexOf('\n## API surface'));
  const table = section.slice(0, section.indexOf('\nEvery number above'));
  const rows = new Map<string, string>();
  for (const match of table.matchAll(/^\| ([^|]+?) \| ([^|]+?) \|$/gm)) {
    rows.set((match[1] as string).trim(), (match[2] as string).trim());
  }
  return rows;
})();

/** The leading integer of a cell, so `3 — \`edfcore\`, …` reads as 3. */
function claimed(label: string): number {
  const cell = ROWS.get(label);
  expect(cell, `README has no "${label}" row`).toBeDefined();
  const digits = /^(\d+)/.exec(cell as string);
  expect(digits, `"${label}" row does not begin with a number`).not.toBeNull();
  return Number((digits as RegExpExecArray)[1]);
}

/**
 * Type names exported by a barrel, with comments removed first.
 *
 * Two shapes, because a barrel uses both. Re-export blocks are the common one, but `node.ts`
 * DECLARES `FileHandleLike` and exports it in place — and counting only the blocks missed it, so
 * the README said 64 public types where there are 65 (fixed in 0.4.222). A type is public because
 * it leaves the barrel, not because of which syntax it left by.
 */
function exportedTypes(source: string): ReadonlySet<string> {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const names = new Set<string>();
  for (const block of stripped.matchAll(/export type \{([^}]*)\} from/g)) {
    for (const entry of (block[1] as string).split(',')) {
      const name = entry.trim().split(' as ').pop()?.trim() ?? '';
      if (/^\w+$/.test(name)) names.add(name);
    }
  }
  for (const declared of stripped.matchAll(/export (?:interface (\w+)|type (\w+)\s*[=<])/g)) {
    const name = declared[1] ?? declared[2];
    if (name !== undefined) names.add(name);
  }
  return names;
}

describe('the README API surface table', () => {
  it('is present and parses', () => {
    // Without this, every assertion below would be vacuously true if the table were reworded away.
    expect(ROWS.size).toBe(5);
  });

  it('counts the entry points', () => {
    expect(claimed('Entry points')).toBe(3);
  });

  it('counts the functions, classes and constants', () => {
    const runtime =
      Object.keys(universal).length +
      Object.keys(nodeEntry).length +
      Object.keys(validateEntry).length;
    expect(claimed('Functions, classes and constants')).toBe(runtime);
  });

  it('counts the public types', () => {
    const distinct = new Set([
      ...exportedTypes(read('../../src/index.ts')),
      ...exportedTypes(read('../../src/node.ts')),
      ...exportedTypes(read('../../src/validate.ts')),
    ]);
    expect(claimed('Public types')).toBe(distinct.size);
  });

  it('counts the diagnostic codes', () => {
    expect(claimed('Diagnostic codes')).toBe(Object.keys(DIAGNOSTIC_DISPOSITIONS).length);
  });

  it('counts the CLI commands the help text offers', async () => {
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

    const commands = new Set([...out.matchAll(/^\s+npx edfcore (\w+) <file>/gm)].map((m) => m[1]));
    expect(claimed('CLI commands')).toBe(commands.size);
  });
});
