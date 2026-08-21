/**
 * Every version this repository cites is a version it released.
 *
 * The codebase explains itself in release numbers. Docblocks say "fixed in 0.3.56" and "corrected
 * in 0.4.342", the documentation pages date every behaviour they describe, and the changelog
 * cross-references itself constantly. There are several hundred such citations, and nothing has
 * ever checked one.
 *
 * They rot in two directions and both are silent. A transposed digit points a reader at nothing,
 * and a citation written while a version was still being cut can name a number that
 * never shipped, which is the same failure the fourteen changelog holes were (0.4.307). Neither is
 * visible to a compiler, a linter or a human skimming a diff, because a wrong version number looks
 * exactly like a right one. No example of a wrong one is written here, for the reason
 * `file-references.test.ts` gives about the same trap: a docblock illustrating the defect would be
 * this file's own first failure, which is how the first run of it went.
 *
 * The hard part is telling a version from everything else shaped like one. This file is full of
 * EDF header fields — `02.08.51` is a startdate and `23.59.60` a starttime — spec clauses like
 * `EDF+ specification 2.1.1`, and runtime floors like Node `22.12.0`. A scan for three
 * dot-separated numbers reports forty-five of those and no real defects.
 *
 * `0.` with no leading zero separates them exactly: edfcore is a 0.x package, and every
 * lookalike here has either a padded first field (`02.`, `09.`) or a major that is not zero. So the
 * pattern is the narrow one, and the count of citations found is asserted so it cannot quietly
 * stop matching.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

/** Where the repository explains itself. `tests/scratch/` is gitignored throwaway work. */
const ROOTS = [
  'src',
  'tests/integration',
  'tests/unit',
  'tests/io',
  'tests/property',
  'tests/types',
  'tests/support',
  'website/src/content/docs',
  'scripts',
] as const;

const LOOSE_FILES = ['README.md', 'AGENTS.md', 'tests/README.md'] as const;

function filesUnder(relative: string): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(new URL(`${directory}/`, ROOT), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'scratch' || entry.name === 'files') continue;
        walk(`${directory}/${entry.name}`);
      } else if (/\.(ts|mjs|md|mdx|py)$/.test(entry.name)) {
        found.push(`${directory}/${entry.name}`);
      }
    }
  };
  walk(relative);
  return found;
}

const FILES = [...ROOTS.flatMap(filesUnder), ...LOOSE_FILES];

/**
 * A citation of an edfcore release.
 *
 * `\b0\.` and not `\b0\d*\.`: a padded startdate like `02.08.51` has a first field of two digits
 * and does not match, which is what keeps every EDF date and clock field out of this.
 */
const CITATION = /\b0\.\d+\.\d+\b/g;

const RELEASED: ReadonlySet<string> = new Set(
  [...read('docs/CHANGELOG.md').matchAll(/^## (0\.\d+\.\d+)$/gm)].map(
    ([, version = '']) => version,
  ),
);

const CURRENT = (JSON.parse(read('package.json')) as { version: string }).version;

const compare = (a: string, b: string): number => {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let at = 0; at < 3; at += 1) {
    if ((left[at] ?? 0) !== (right[at] ?? 0)) return (left[at] ?? 0) - (right[at] ?? 0);
  }
  return 0;
};

interface Citation {
  readonly file: string;
  readonly version: string;
}

const CITATIONS: readonly Citation[] = FILES.flatMap((file) =>
  [...read(file).matchAll(CITATION)].map(([version]) => ({ file, version })),
);

describe('the version numbers this repository cites', () => {
  it('found a substantial number of them, across the tree', () => {
    // Several hundred today. A collapse means the pattern stopped matching, which would leave this
    // passing while checking nothing.
    expect(CITATIONS.length).toBeGreaterThan(200);
    expect(new Set(CITATIONS.map((entry) => entry.file)).size).toBeGreaterThan(40);
    expect(RELEASED.size).toBeGreaterThan(200);
  });

  it('matches no EDF date or clock field, which is what most of this tree contains', () => {
    // The forty-five lookalikes a looser pattern reports. Asserted directly so the narrowing is
    // a stated property rather than a lucky regex.
    for (const lookalike of ['02.08.51', '23.59.60', '00.00.00', '31.02.99', '09.30.15']) {
      expect(lookalike.match(CITATION), lookalike).toBeNull();
    }
    // And neither a spec clause nor a Node floor, whose majors are not zero.
    for (const other of ['2.1.1', '2.2.4', '22.12.0', '24.4.0']) {
      expect(other.match(CITATION), other).toBeNull();
    }
  });

  it('cites only versions the changelog records', () => {
    const dangling = CITATIONS.filter((entry) => !RELEASED.has(entry.version));
    expect(dangling.map((entry) => `${entry.version} in ${entry.file}`)).toEqual([]);
  });

  it('cites no version ahead of the one on disk', () => {
    // A citation written while a version is still being cut names a number that has not shipped —
    // the same failure the fourteen changelog holes were.
    const ahead = CITATIONS.filter((entry) => compare(entry.version, CURRENT) > 0);
    expect(ahead.map((entry) => `${entry.version} in ${entry.file}`)).toEqual([]);
  });
});
