/**
 * Every documentation page is named by a test that is about that page.
 *
 * `docs-coverage.test.ts` sweeps all of them for exported names and `doc-snippets-compile.test.ts`
 * compiles every fence, but a generic sweep says nothing about whether a page's own claims — its
 * tables, its worked numbers, its refusals — have ever been executed. Until recently several pages
 * had no test that named them at all: `edf-format.md` and `physical-values.md` were the first two
 * found that way, and `migrating-to-0-3.md`, `api-validate.md` and `quick-start.md` the next three.
 * Each turned out to be carrying claims worth checking, and one of them was carrying a wrong one.
 *
 * All twenty-three are named now. This makes that a property rather than a coincidence: a page
 * added tomorrow gets a test, or this fails and says which page.
 *
 * "Named" means a test file mentions the page's filename, which is what a check written ABOUT a
 * page does — it reads it out of `DOCS_PAGES` by name. A generic sweep never names one, so it
 * cannot satisfy this on every page's behalf, which is the whole point.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCS_PAGES } from '../support/docs-pages.js';

const ROOT = new URL('../../', import.meta.url);

/** Every test file, excluding the gitignored scratch directory. */
const TEST_FILES: readonly string[] = (() => {
  const found: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(new URL(`${relative}/`, ROOT), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'scratch' || entry.name === 'files') continue;
        walk(`${relative}/${entry.name}`);
      } else if (/\.(ts|mjs)$/.test(entry.name)) {
        found.push(`${relative}/${entry.name}`);
      }
    }
  };
  walk('tests');
  return found;
})();

/**
 * Comments removed, string literals kept.
 *
 * `code-only.ts` strips both, which is right for the bans it serves and wrong here: a page is
 * named by a string literal — `DOCS_PAGES.get('concepts.md')` — so stripping those would leave
 * nothing to find. What has to go is the docblock, because a page mentioned as an example in one
 * is not a page being checked. `docs-coverage.test.ts` mentions `api-helpers.md` that way, and the
 * first run of this file reported it as a sweep vouching for a page.
 */
const withoutComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

const SOURCES: ReadonlyMap<string, string> = new Map(
  TEST_FILES.map((file) => [file, withoutComments(readFileSync(new URL(file, ROOT), 'utf8'))]),
);

/**
 * The files that sweep every page wholesale, and this one.
 *
 * They are excluded from counting rather than forbidden from naming a page. `docs-coverage.test.ts`
 * anchors its own non-vacuity with `DOCS.has('api-helpers.md')`, which is a reasonable thing to
 * write and is not a check about that page — the first version of this file forbade it and was
 * wrong to. What matters is that no page is covered ONLY by a sweep.
 */
const SWEEPS = [
  'tests/integration/docs-page-coverage.test.ts',
  'tests/integration/docs-coverage.test.ts',
  'tests/integration/doc-snippets-compile.test.ts',
  'tests/integration/docs-links.test.ts',
  'tests/integration/readme-status.test.ts',
] as const;

/** The test files naming `page`, excluding the sweeps. */
function namedBy(page: string): readonly string[] {
  return [...SOURCES]
    .filter(([file]) => !SWEEPS.includes(file as (typeof SWEEPS)[number]))
    .filter(([, source]) => source.includes(page))
    .map(([file]) => file);
}

describe('every documentation page', () => {
  it('found the pages and the tests, so a passing run is not a vacuous one', () => {
    expect(DOCS_PAGES.size).toBeGreaterThan(20);
    expect(TEST_FILES.length).toBeGreaterThan(80);
  });

  it('is named by at least one test', () => {
    const unnamed = [...DOCS_PAGES.keys()].filter((page) => namedBy(page).length === 0);
    expect(unnamed).toEqual([]);
  });

  it('is named by a test that reads it, rather than merely mentioning it', () => {
    // A page is checked when something loads it: `DOCS_PAGES.get('concepts.md')`. A changelog-style
    // mention in a comment is not a check, and would otherwise satisfy the rule above.
    const read = [...DOCS_PAGES.keys()].filter((page) =>
      namedBy(page).some((file) => (SOURCES.get(file) ?? '').includes(`get('${page}')`)),
    );
    expect(read.length).toBeGreaterThan(DOCS_PAGES.size / 2);
  });
});
