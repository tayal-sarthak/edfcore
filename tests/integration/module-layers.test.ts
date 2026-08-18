/**
 * Every module in `src/` says which layer it is in.
 *
 * `AGENTS.md` states the architecture as one rule — a module may only import from a lower layer —
 * and each file repeats its own position in the first line of its docblock, `Layer 0` through
 * `Layer 7`. Forty-eight of the fifty-two did. Four did not: `cli.ts`,
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

/**
 * And the imports respect them.
 *
 * A runtime import may go DOWN a layer or stay level; it may never go up. Level is ordinary —
 * there are 28 sibling imports inside layers 2, 3 and 7 — so "only from a lower layer" in
 * `AGENTS.md` is shorthand for "never from a higher one", which is the rule enforced here.
 *
 * `import type` is exempt, and that exemption is the architecture rather than a loophole:
 * `src/types.ts` opens with "Types only — this module emits no runtime code, so any layer may
 * import it without creating a dependency edge". Nothing is emitted, so nothing depends. Without
 * the exemption this check would report `types.ts` importing `diagnostics/codes.ts` as a
 * violation, which is exactly the edge that does not exist.
 *
 * Applied for the first time in 0.4.256 it found two, both real and both the same mistake:
 * `header/parse.ts` and `header/lookup.ts` at layer 2 calling `tal/ticks.ts`, which was labelled
 * layer 3 because it lives in `tal/`. It imports `constants.ts` and nothing else. A module's
 * layer is its dependencies, not its folder, so the fix was the number.
 */
describe('imports go down, or level, never up', () => {
  /** `from './x.js'` with the `type` keyword, or without it. */
  const IMPORTS = /^import\s+(type\s+)?[^;]*?from '(\.[^']+)'/gm;

  const EDGES = MODULES.flatMap(({ name, layer }) => {
    const source = readFileSync(new URL(`../../src/${name}`, import.meta.url), 'utf8');
    return [...source.matchAll(IMPORTS)].map((match) => {
      // `./x.js` and `../tal/x.js` resolve against the importer's directory; the emitted `.js`
      // specifier is the `.ts` file on disk.
      const dir = name.includes('/') ? `${name.slice(0, name.lastIndexOf('/'))}/` : '';
      const target = new URL(`${dir}${match[2] as string}`, 'file:///').pathname
        .slice(1)
        .replace(/\.js$/, '.ts');
      return { from: name, to: target, typeOnly: match[1] !== undefined, layer };
    });
  });

  const layerOf = (name: string) => MODULES.find((module) => module.name === name)?.layer;

  it('resolved the graph, so a passing run is not a vacuous one', () => {
    expect(EDGES.length).toBeGreaterThan(80);
    // Every edge names a module that exists — a path this resolver got wrong would otherwise be
    // skipped as "unknown layer" and quietly checked against nothing.
    const unresolved = EDGES.filter((edge) => layerOf(edge.to) === undefined).map(
      (edge) => `${edge.from} -> ${edge.to}`,
    );
    expect(unresolved).toEqual([]);
    expect(EDGES.some((edge) => edge.typeOnly)).toBe(true);
  });

  it('has no runtime import from a higher layer', () => {
    const upward = EDGES.filter(
      (edge) => !edge.typeOnly && (layerOf(edge.to) as number) > (edge.layer as number),
    ).map((edge) => `${edge.from} (L${edge.layer}) imports ${edge.to} (L${layerOf(edge.to)})`);
    expect(upward).toEqual([]);
  });
});

/**
 * And `AGENTS.md`'s summary of them names the layers that exist.
 *
 * That file used to sketch the architecture as six tiers — "`bytes`/`text` → `diagnostics` →
 * `header`/`decode`/`tal` → `time` → `io` → entry points" — while the declarations used eight, and
 * the sketch was wrong about the members of nearly every one: `bytes` is layer 0 and `text` is
 * layer 1, `header`, `decode` and `tal` are three different layers rather than one, and `io` spans
 * two. 0.4.256 reasoned from that sentence to correct a module's layer, which is a good argument
 * for the sentence being right.
 *
 * Only the layer NUMBERS are compared. Membership is prose, and prose that lists members is the
 * inventory problem this project keeps deleting — the declarations are the source of truth and
 * `AGENTS.md` now says so. What a summary can still get wrong without anyone noticing is the
 * shape: a tier added or removed and only written down in one of the two places.
 */
describe("AGENTS.md's summary of the layers", () => {
  const AGENTS = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8');

  /** The leading cell of each row of the `### The layers` table. */
  const SUMMARISED = (() => {
    const section = AGENTS.slice(AGENTS.indexOf('### The layers'));
    const table = section.slice(0, section.indexOf('\n\n', section.indexOf('|')));
    return new Set([...table.matchAll(/^\| (\d+) \| /gm)].map((row) => Number(row[1])));
  })();

  const DECLARED = new Set(
    MODULES.map((module) => module.layer).filter((layer): layer is number => layer !== undefined),
  );

  it('found the table, so a passing run is not a vacuous one', () => {
    expect(SUMMARISED.size).toBeGreaterThan(4);
    expect(DECLARED.size).toBeGreaterThan(4);
  });

  it('names every layer the source declares, and no layer it does not', () => {
    expect([...SUMMARISED].sort((a, b) => a - b)).toEqual([...DECLARED].sort((a, b) => a - b));
  });

  it('says how many, in the sentence above it', () => {
    // "in eight layers" — a number in prose, so it gets the same treatment as every other one.
    const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    const claimed = /The library, in (\w+) layers/.exec(AGENTS)?.[1];
    expect(claimed, 'no "in N layers" in AGENTS.md').toBeDefined();
    expect(words.indexOf(claimed as string)).toBe(DECLARED.size);
  });
});
