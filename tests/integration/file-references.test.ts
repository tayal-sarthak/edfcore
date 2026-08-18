/**
 * Every file this repository names in a comment is a file that is there.
 *
 * Docblocks here point at each other constantly — `header/parse.ts` owns validation order,
 * `tal/ticks.ts` owns the tick conversion, `public-api.test.ts` pins the barrel — and 324 of those
 * references are written as backticked paths. They are the repository explaining itself, and they
 * rot the moment a file moves, silently: nothing reads a comment.
 *
 * It is not a hypothetical rot. `CHANGELOG.md` became `docs/CHANGELOG.md` at v0.4.1 and
 * `scripts/release.mjs` still carries a note about which spelling to use for which tag, and
 * 0.4.264 renamed a test file when its rule outgrew its name. The `src/` half is worse than a
 * stale comment, because `removeComments: false` copies those docblocks into `dist/*.d.ts`, so a
 * dangling path ships to every consumer as hover text.
 *
 * Retired names are deliberately not written down here, including in this docblock. A comment
 * naming a file that no longer exists is the thing being caught, so quoting one as an example
 * would make this file its own first failure — which is how the first run of it went.
 *
 * A reference resolves if it matches any path in the tree by suffix, so `codes.ts` finds
 * `src/diagnostics/codes.ts` and `content.config.ts` finds it under `website/src/`. That is
 * deliberately generous: the claim being checked is "this names something real", not "this is
 * written relative to here".
 *
 * `dist/` is the one exemption. It is the build output, described in several places and never
 * committed, so `dist/index.d.ts` names a real thing that a checkout does not contain.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.astro', 'scratch', 'files']);

/** Every path in the working tree, and every suffix of it. */
const RESOLVABLE: ReadonlySet<string> = (() => {
  const suffixes = new Set<string>();
  const walk = (dir: URL, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, dir), `${full}/`);
        continue;
      }
      const parts = full.split('/');
      for (let i = 0; i < parts.length; i++) suffixes.add(parts.slice(i).join('/'));
    }
  };
  walk(ROOT, '');
  return suffixes;
})();

/** The files whose comments are swept: everything this repository wrote, minus the site. */
const SOURCES: ReadonlyArray<{ readonly name: string; readonly text: string }> = (() => {
  const found: Array<{ name: string; text: string }> = [];
  const walk = (dir: URL, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
        continue;
      }
      if (!/\.(ts|mjs)$/.test(entry.name)) continue;
      found.push({
        name: `${prefix}${entry.name}`,
        text: readFileSync(new URL(`${prefix}${entry.name}`, ROOT), 'utf8'),
      });
    }
  };
  for (const dir of ['src', 'tests', 'scripts', 'config']) {
    walk(new URL(`${dir}/`, ROOT), `${dir}/`);
  }
  for (const markdown of ['README.md', 'AGENTS.md', 'tests/README.md']) {
    found.push({ name: markdown, text: readFileSync(new URL(markdown, ROOT), 'utf8') });
  }
  return found;
})();

interface Reference {
  readonly from: string;
  readonly path: string;
}

/** Backticked paths with a file extension this repository actually uses. */
const REFERENCES: readonly Reference[] = SOURCES.flatMap(({ name, text }) =>
  [...text.matchAll(/`([A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:ts|mjs|md|json|yml|astro))`/g)]
    .map((match) => ({ from: name, path: match[1] as string }))
    // The build output: named on purpose, absent from a checkout on purpose.
    .filter(({ path }) => !path.startsWith('dist/')),
);

describe('the references were collected', () => {
  it('found enough of them that a passing run is not a vacuous one', () => {
    expect(REFERENCES.length).toBeGreaterThan(250);
    expect(SOURCES.length).toBeGreaterThan(80);
    expect(RESOLVABLE.size).toBeGreaterThan(200);
  });

  it('can tell a real path from one that is gone', () => {
    expect(RESOLVABLE.has('src/tal/ticks.ts')).toBe(true);
    // By suffix, which is how a comment naming a bare filename resolves.
    expect(RESOLVABLE.has('tal/ticks.ts')).toBe(true);
    expect(RESOLVABLE.has('ticks.ts')).toBe(true);
    // The move that motivated this: the changelog resolves at its current path, and a bare
    // `CHANGELOG.md` still resolves by suffix, which is what makes the generous rule generous.
    expect(RESOLVABLE.has('docs/CHANGELOG.md')).toBe(true);
    expect(RESOLVABLE.has('CHANGELOG.md')).toBe(true);
    expect(RESOLVABLE.has('no-such-module.ts')).toBe(false);
  });
});

describe('every named file exists', () => {
  it('leaves no reference pointing at nothing', () => {
    const dangling = REFERENCES.filter(({ path }) => !RESOLVABLE.has(path)).map(
      ({ from, path }) => `${from} -> ${path}`,
    );
    expect(dangling, 'backticked paths naming a file that is not in the tree').toEqual([]);
  });
});
