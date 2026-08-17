/**
 * Every module in `src/` says which layer it is in.
 *
 * `AGENTS.md` states the architecture as one rule — "layered strictly: `bytes`/`text` →
 * `diagnostics` → `header`/`decode`/`tal` → `time` → `io` → entry points. A module may only import
 * from a lower layer" — and each file repeats its own position in the first line of its docblock,
 * `Layer 0` through `Layer 7`. Forty-eight of the fifty-two did. Four did not: `cli.ts`,
 * `cli-run.ts`, `diagnostics/summary.ts` and `format-report.ts` had no layer at all, so the one
 * architectural invariant this project has was stated everywhere except where it was inconvenient,
 * and nothing noticed because nothing read the declarations (0.4.255).
 *
 * This is the census half — that the declaration exists and parses. Whether the imports respect it
 * is the check below it, and that one needs these numbers to be complete before it can mean
 * anything: a module with no layer is a module no direction check can constrain.
 *
 * `removeComments: false` puts every one of these docblocks in the shipped `.d.ts`, so a layer
 * here is also what an editor shows on hover.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** `Layer 3.` on the first prose line of a module docblock. */
const LAYER = /^ \* Layer (\d+)[.,]/m;

interface Module {
  readonly name: string;
  readonly layer: number | undefined;
}

const MODULES: readonly Module[] = (function walk(dir: URL, prefix: string, into: Module[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) walk(child, `${prefix}${entry.name}/`, into);
    else if (entry.name.endsWith('.ts')) {
      const declared = LAYER.exec(readFileSync(child, 'utf8'));
      into.push({
        name: `${prefix}${entry.name}`,
        layer: declared === null ? undefined : Number(declared[1]),
      });
    }
  }
  return into;
})(new URL('../../src/', import.meta.url), '', []);

describe('the source tree was read', () => {
  it('found the modules, so a passing run is not a vacuous one', () => {
    expect(MODULES.length).toBeGreaterThan(40);
    expect(MODULES.map((module) => module.name)).toContain('index.ts');
  });

  it('can tell a declaration from its absence', () => {
    // The regex is anchored to the docblock's own line shape, not to the word anywhere in a file.
    expect(LAYER.exec(' * Layer 3. Sole owner of…')?.[1]).toBe('3');
    expect(LAYER.exec('// Layer 3 of the format')).toBeNull();
    expect(LAYER.exec(' * The layer above this one')).toBeNull();
  });
});

describe('every module declares its layer', () => {
  it('leaves none undeclared', () => {
    const silent = MODULES.filter((module) => module.layer === undefined).map(({ name }) => name);
    expect(silent, 'modules whose docblock does not open with "Layer N."').toEqual([]);
  });

  it('declares one the architecture has', () => {
    // 0 through 7, the range AGENTS.md describes. A "Layer 9" would be a typo or a new tier
    // nobody wrote down, and both are worth failing on.
    const outside = MODULES.filter(
      (module) => module.layer !== undefined && (module.layer < 0 || module.layer > 7),
    ).map(({ name, layer }) => `${name}: Layer ${layer}`);
    expect(outside).toEqual([]);
  });

  it('puts the barrels at the top and the leaves at the bottom', () => {
    // Not vacuous: the numbers have to mean something, and these three are the fixed points.
    const layerOf = (name: string) => MODULES.find((module) => module.name === name)?.layer;
    expect(layerOf('constants.ts')).toBe(0);
    expect(layerOf('index.ts')).toBe(7);
    expect(layerOf('node.ts')).toBe(7);
  });
});
