/**
 * The layer table in `AGENTS.md` names the modules that are actually at each layer.
 *
 * `module-layers.test.ts` already checks the two things that matter most: every module declares a
 * layer, and no runtime import goes up one. It also checks that the table names every layer the
 * source declares. What it does not check is the CONTENTS of each row — which modules the table
 * puts where.
 *
 * AGENTS.md says of that table: "the table below is a summary of it, not a second definition". A
 * summary that disagrees with its source is still wrong, and this one is easy to disagree with,
 * because two of its rows split one directory: layer 5 is `io/` "the `ByteSource` adapters" and
 * layer 6 carves `io/read.ts` back out. `tal/` is split the same way across layers 1 and 3, and
 * the prose underneath calls that out as the point of the rule — "a module's layer is its
 * dependencies, not its folder".
 *
 * So a directory named in a row claims everything under it EXCEPT what another row names by file.
 * Row 7 names nothing at all — "entry points, and the pure helpers over them" — which turns into
 * the closure that makes this check tight: every module no row claims has to be at layer 7.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const AGENTS = readFileSync(new URL('AGENTS.md', ROOT), 'utf8');

/** Every module under `src/`, keyed by path relative to it, with the layer it declares. */
const DECLARED: ReadonlyMap<string, number> = (() => {
  const found = new Map<string, number>();
  const walk = (directory: URL, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith('.ts')) {
        const source = readFileSync(new URL(entry.name, directory), 'utf8');
        const layer = /\bLayer ([0-7])\b/.exec(source.slice(0, 600));
        if (layer !== null) found.set(`${prefix}${entry.name}`, Number(layer[1]));
      }
    }
  };
  walk(new URL('src/', ROOT), '');
  return found;
})();

/** The `| N | … |` rows of the layer table, with the backticked names in each. */
const ROWS: ReadonlyMap<number, readonly string[]> = (() => {
  const at = AGENTS.indexOf('| Layer | What is in it |');
  if (at === -1) throw new Error('AGENTS.md no longer tabulates the layers');
  const rows = new Map<number, readonly string[]>();
  for (const line of AGENTS.slice(at).split('\n')) {
    if (!line.startsWith('|')) break;
    const cells = line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    const layer = Number(cells[0]);
    if (!Number.isInteger(layer)) continue;
    // Only a path is a claim. Row 5 reads "`io/` — the `ByteSource` adapters", and `ByteSource`
    // is the type the adapters implement rather than a module the row is placing.
    rows.set(
      layer,
      [...(cells[1] ?? '').matchAll(/`([^`]+)`/g)]
        .map(([, name = '']) => name)
        .filter((name) => name.endsWith('/') || name.endsWith('.ts')),
    );
  }
  return rows;
})();

/** The row that claims `module`, or undefined when none names it. */
function claimedBy(module: string): number | undefined {
  // An explicit file wins over a directory, which is what lets layer 6 carve `io/read.ts` out of
  // layer 5's `io/`.
  for (const [layer, names] of ROWS) {
    if (names.includes(module)) return layer;
  }
  for (const [layer, names] of ROWS) {
    if (names.some((name) => name.endsWith('/') && module.startsWith(name))) return layer;
  }
  return undefined;
}

describe('the layer table', () => {
  it('found the modules and the rows, so a passing run is not a vacuous one', () => {
    expect(DECLARED.size).toBeGreaterThan(30);
    expect(ROWS.size).toBe(8);
    expect([...ROWS.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('puts every module it names at the layer that module declares', () => {
    const wrong: string[] = [];
    for (const [module, layer] of DECLARED) {
      const claimed = claimedBy(module);
      if (claimed !== undefined && claimed !== layer) {
        wrong.push(`${module}: declares ${layer}, table says ${claimed}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('names nothing that is not there', () => {
    // A row naming a file that has been renamed or removed is the other direction of the same rot.
    const missing: string[] = [];
    for (const [layer, names] of ROWS) {
      for (const name of names) {
        if (name.endsWith('/')) {
          if (![...DECLARED.keys()].some((module) => module.startsWith(name))) {
            missing.push(`layer ${layer}: ${name}`);
          }
        } else if (!DECLARED.has(name)) {
          missing.push(`layer ${layer}: ${name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('leaves only layer 7 unnamed, which is the row that describes rather than lists', () => {
    // "entry points, and the pure helpers over them" — no backticks in that row, so the closure is
    // what checks it: anything the table does not claim has to be at the top.
    expect(ROWS.get(7)).toEqual([]);
    const unclaimed = [...DECLARED].filter(([module]) => claimedBy(module) === undefined);
    expect(unclaimed.length).toBeGreaterThan(0);
    for (const [module, layer] of unclaimed) expect(layer, module).toBe(7);
  });

  it('splits the two directories the prose says are split', () => {
    // `tal/ticks.ts` at layer 1 with the rest of `tal/` at 3, and `io/read.ts` at 6 with the
    // adapters at 5. Both are the point of the rule rather than exceptions to it.
    expect(AGENTS.replace(/\s+/g, ' ')).toContain(
      "A module's layer is its dependencies, not its folder",
    );
    expect(DECLARED.get('tal/ticks.ts')).toBe(1);
    expect(DECLARED.get('tal/grammar.ts')).toBe(3);
    expect(DECLARED.get('io/read.ts')).toBe(6);
    expect(DECLARED.get('io/bytes.ts')).toBe(5);
  });
});
