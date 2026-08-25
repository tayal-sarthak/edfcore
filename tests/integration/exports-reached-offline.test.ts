/**
 * Every published export is reached by the suite that runs on a fresh clone.
 *
 * `tests/corpus/` skips when `corpus/files/` is empty, which is right — the files are 59 MB of
 * other people's recordings and are not redistributed — and it means those tests do not run on a
 * clone, do not run in CI unless the corpus is fetched, and do not run for a contributor who has
 * not asked for them. `coverage.test.ts` exists because a skipped test and a passing one look the
 * same in a summary line.
 *
 * The same reasoning applies one level up. An export whose only appearance in the suite is inside
 * `tests/corpus/` is an export nothing verifies on an ordinary run: it can be renamed, or removed
 * from a barrel, or left broken, and the run a contributor actually does stays green. That is not
 * hypothetical for this package — `whole-api.test.ts` calls essentially the whole barrel and is
 * one of the files that skips.
 *
 * So the check is import-level and deliberately coarse: every runtime name the three entry points
 * publish is imported by at least one test outside `tests/corpus/`. `tests/scratch/` is excluded
 * for the reason 0.4.479 established — it is gitignored, so anything in it satisfies this on the
 * machine that wrote it and nowhere else.
 *
 * What this does NOT claim: that the export is CALLED, or called meaningfully. An import is a
 * floor, and the floor is the part that can be checked structurally. `api-surface.test.ts` owns
 * the count, `public-api.test.ts` owns the shapes, and the behaviour of each is owned by whichever
 * file tests it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as universal from '../../src/index.js';
import * as nodeEntry from '../../src/node.js';
import * as validateEntry from '../../src/validate.js';

const TESTS = new URL('../', import.meta.url);

/** Skipped for two different reasons, both of which come to "it may not be there". */
const NOT_ON_A_FRESH_CLONE = new Set(['corpus', 'scratch']);

const PUBLISHED: readonly string[] = [
  ...Object.keys(universal),
  ...Object.keys(nodeEntry),
  ...Object.keys(validateEntry),
];

/** Every `.ts` under `tests/` that a fresh clone runs. */
function offlineTestFiles(): readonly string[] {
  const found: string[] = [];
  const walk = (dir: URL, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (NOT_ON_A_FRESH_CLONE.has(entry.name)) continue;
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
        continue;
      }
      if (entry.name.endsWith('.ts')) found.push(`${prefix}${entry.name}`);
    }
  };
  walk(TESTS, '');
  return found;
}

/** Named bindings imported from anywhere under `src/`, with `as` aliases resolved to the source. */
const IMPORTED: ReadonlySet<string> = (() => {
  const names = new Set<string>();
  for (const file of offlineTestFiles()) {
    const text = readFileSync(new URL(file, TESTS), 'utf8');
    for (const match of text.matchAll(
      /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']*src[^']*)'/g,
    )) {
      for (const part of (match[1] as string).split(',')) {
        const binding = part
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
          ?.trim();
        if (binding !== undefined && binding !== '') names.add(binding);
      }
    }
  }
  return names;
})();

describe('the scan', () => {
  it('read the suite a fresh clone runs, and left out the two that may be absent', () => {
    const files = offlineTestFiles();
    expect(files.length).toBeGreaterThan(150);
    expect(files.some((name) => name.startsWith('corpus/'))).toBe(false);
    expect(files.some((name) => name.startsWith('scratch/'))).toBe(false);
    // And the corpus really is a directory it chose to skip, not one that happens to be missing.
    expect(readdirSync(TESTS).includes('corpus')).toBe(true);
  });

  it('found enough imports that a passing run is not a vacuous one', () => {
    expect(IMPORTED.size).toBeGreaterThan(100);
    // A name that exists, so a scanner returning an empty set fails here rather than below.
    expect(IMPORTED.has('openEdf')).toBe(true);
  });
});

describe('every published export', () => {
  it('is imported by a test that runs without the corpus', () => {
    const unreached = PUBLISHED.filter((name) => !IMPORTED.has(name)).sort();
    expect(unreached).toEqual([]);
  });

  it('was counted, so the list under test is the whole surface', () => {
    // The number `api-surface.test.ts` owns. Restated here only to catch a barrel that stopped
    // re-exporting half of itself, which would make the check above pass by having nothing to do.
    expect(PUBLISHED.length).toBeGreaterThan(70);
    expect(new Set(PUBLISHED).size).toBe(PUBLISHED.length);
  });
});
