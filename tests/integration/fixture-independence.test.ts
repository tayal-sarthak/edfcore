/**
 * Nothing in `tests/support/` depends on `src/` at runtime.
 *
 * This is the claim the whole suite rests on, and `tests/README.md` states it twice: "`writer.ts`
 * is deliberately written from the format specification and imports nothing from `src/`. A reader
 * and a writer that share a misunderstanding agree with each other and are wrong together; keeping
 * them independent is what makes the round-trip and property tests worth running."
 *
 * Ninety test files build their fixtures with that writer. If it took `EDF_HEADER_BLOCK_BYTES`
 * from `src/constants.ts` — which looks exactly like sensible de-duplication, and is one line —
 * then a wrong constant would produce fixtures shaped to match the wrong reader, and two thousand
 * tests would pass on a broken package while proving only that edfcore agrees with itself. That
 * is the one failure mode a test suite cannot detect from the inside, and until now nothing
 * stopped it.
 *
 * `import type` is exempt, on the same reasoning the layer check uses: a type-only import emits no
 * code, so it cannot carry a value into a fixture. `spy-source.ts` takes `ByteSource` and
 * `ReadOptions` that way — it has to name the interface it wraps, and naming a shape is not
 * sharing an understanding of the bytes.
 *
 * Walked transitively, because independence one import deep is not independence: a helper that
 * imports the writer and a `src/` constant would launder exactly what this forbids.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SUPPORT = new URL('../support/', import.meta.url);

/** `from '…'` and `import('…')`, with the `type` keyword captured when present. */
const IMPORTS = /(?:^import\s+(type\s+)?[^;]*?from|import\()\s*'([^']+)'/gm;

interface Edge {
  readonly from: string;
  readonly specifier: string;
  readonly typeOnly: boolean;
}

function edgesOf(name: string): readonly Edge[] {
  const source = readFileSync(new URL(name, SUPPORT), 'utf8');
  return [...source.matchAll(IMPORTS)].map((match) => ({
    from: name,
    specifier: match[2] as string,
    typeOnly: match[1] !== undefined,
  }));
}

const SUPPORT_FILES: readonly string[] = readdirSync(SUPPORT).filter((name) =>
  /\.(ts|mjs)$/.test(name),
);

/** Every edge out of `tests/support/`, following support-to-support imports as it goes. */
const EDGES: readonly Edge[] = (() => {
  const seen = new Set<string>();
  const found: Edge[] = [];
  const visit = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const edge of edgesOf(name)) {
      found.push(edge);
      // A sibling in this directory is followed, so laundering through one is not a way out.
      const sibling = edge.specifier.replace(/^\.\//, '').replace(/\.js$/, '.ts');
      if (SUPPORT_FILES.includes(sibling)) visit(sibling);
    }
  };
  for (const name of SUPPORT_FILES) visit(name);
  return found;
})();

const intoSrc = (specifier: string): boolean => /(^|\/)src\//.test(specifier);

describe('the support directory was read', () => {
  it('found the files and their imports, so a passing run is not vacuous', () => {
    expect(SUPPORT_FILES).toContain('writer.ts');
    expect(SUPPORT_FILES).toContain('corrupt.ts');
    expect(EDGES.length).toBeGreaterThan(0);
    // The type-only exemption is not theoretical: something here uses it today.
    expect(EDGES.some((edge) => edge.typeOnly && intoSrc(edge.specifier))).toBe(true);
  });

  it('can tell an import into src from one that is not', () => {
    expect(intoSrc('../../src/constants.js')).toBe(true);
    expect(intoSrc('./writer.js')).toBe(false);
    expect(intoSrc('node:crypto')).toBe(false);
  });

  it('is depended on widely enough for the claim to matter', () => {
    // If almost nothing used the writer, its independence would be a curiosity rather than the
    // reason the round-trip and property tests mean anything.
    const users = (function walk(dir: URL, count: number): number {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'scratch') continue;
        if (entry.isDirectory()) {
          count = walk(new URL(`${entry.name}/`, dir), count);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        if (readFileSync(new URL(entry.name, dir), 'utf8').includes('support/writer.js')) count++;
      }
      return count;
    })(new URL('../', import.meta.url), 0);
    expect(users).toBeGreaterThan(50);
  });
});

describe('the fixture tools stand on their own', () => {
  it('takes no runtime import from src, at any depth', () => {
    const dependent = EDGES.filter((edge) => !edge.typeOnly && intoSrc(edge.specifier)).map(
      (edge) => `${edge.from} imports ${edge.specifier}`,
    );
    expect(
      dependent,
      'tests/support may not take a value from src — a fixture built with the reader proves nothing',
    ).toEqual([]);
  });

  it('leaves writer.ts and corrupt.ts importing nothing at all', () => {
    // Stronger than the rule above, and true today: neither takes anything from anywhere. Worth
    // pinning separately, because these two are the ones the README's argument is about.
    expect(edgesOf('writer.ts')).toEqual([]);
    expect(edgesOf('corrupt.ts')).toEqual([]);
  });
});
