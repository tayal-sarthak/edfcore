/**
 * The documentation pages, read the way the site loads them.
 *
 * Four checks sweep these pages — `docs-coverage.test.ts` for every exported name,
 * `diagnostic-docs.test.ts` for the code tables, and `readme-status.test.ts` twice for stale
 * version claims — and all four wrote their own reader. Three globbed the top-level `.md` files
 * and one called `readdirSync(...).filter(name => name.endsWith('.md'))`.
 *
 * `website/src/content.config.ts` loads `**\/*.{md,mdx}`, and `astro.config.mjs` registers the
 * MDX integration. So the site publishes pages in a subdirectory, and pages written as `.mdx`,
 * that none of the four could see. That gap fails in the unhelpful direction: a name documented
 * only on an unseen page is reported as undocumented, and a type on the recorded
 * `UNDOCUMENTED_TYPES` list stays on it after the page that documents it is written.
 *
 * A page is part of the documentation because the collection loads it, not because of where it
 * sits or which of the two extensions it uses. That rule now has one home, the way the barrel
 * type parser got one in 0.4.224 after the same thing happened to it.
 */

interface RawModuleGlob {
  glob(
    pattern: string,
    options: { query: string; import: string; eager: true },
  ): Record<string, string>;
}

/**
 * The pattern is written out as a literal: `import.meta.glob` is replaced at transform time, so
 * it cannot come from a variable — which is the reason each caller had a copy to begin with.
 */
const SOURCES = (import.meta as unknown as RawModuleGlob).glob(
  '../../website/src/content/docs/**/*.{md,mdx}',
  { query: '?raw', import: 'default', eager: true },
);

const PREFIX = '../../website/src/content/docs/';

/**
 * Keyed by path relative to `content/docs/`, which is the page's slug plus its extension —
 * `api-helpers.md`, and a nested one would keep its directory in the key.
 */
export const DOCS_PAGES: ReadonlyMap<string, string> = new Map(
  Object.entries(SOURCES).map(([path, source]) => [
    path.startsWith(PREFIX) ? path.slice(PREFIX.length) : (path.split('/').pop() ?? path),
    source,
  ]),
);

/** Every page concatenated, for checks that ask whether a name appears anywhere at all. */
export const ALL_DOCS: string = [...DOCS_PAGES.values()].join('\n');
