/**
 * Every internal link on the site points at something that exists.
 *
 * The documentation pages carry over a hundred `/docs/...` and `#anchor` links between them, and
 * nothing checked one. `astro check` validates types and content collections, not hrefs; the site
 * is a static build, so a link to a page that was renamed produces a 404 for a reader rather than
 * an error for the author. The 404 page exists precisely because that happens — "the address may
 * have moved when the docs were reorganised" — which is a good page to have and a poor substitute
 * for not shipping the link.
 *
 * Anchors are the half that rots quietly. A page rename is at least visible in the diff that
 * renames it; an anchor breaks when someone rewords a heading three sections away, and the link
 * still looks right. 0.4.234 nearly shipped one: a table cell pointed at `#patient-identification`
 * on a page whose redaction note has no heading of its own.
 *
 * `.astro` routes are swept too. Nine of the links on this site are hard-coded there — the 404's
 * three ways out, the landing page's four — and those are the ones a reader hits first.
 *
 * Slugs are generated the way Astro generates them, which is `github-slugger`: lowercase, strip
 * punctuation and backticks, spaces to hyphens. That is exact for the ASCII headings this site
 * uses; a heading needing more than that would be a heading worth simplifying.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCS_PAGES } from '../support/docs-pages.js';

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');

/** `api-helpers.md` -> `api-helpers`, which is the page's slug and its `/docs/` path. */
const slugOf = (fileName: string): string => fileName.replace(/\.mdx?$/, '');

const SLUGS = new Set([...DOCS_PAGES.keys()].map(slugOf));

function slugify(heading: string): string {
  return heading
    .replace(/`/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** Every heading slug, by page slug. */
const HEADINGS = new Map<string, ReadonlySet<string>>(
  [...DOCS_PAGES].map(([name, text]) => [
    slugOf(name),
    new Set([...text.matchAll(/^#{1,6} (.+)$/gm)].map((match) => slugify(match[1] as string))),
  ]),
);

/**
 * Routes the site serves that are not collection pages. `/docs` is the redirect in
 * `astro.config.mjs`; the rest are files under `pages/` or `public/`.
 */
const STANDALONE_ROUTES = new Set([
  '/',
  '/docs',
  '/demo',
  '/favicon.svg',
  '/llms.txt',
  '/llms-full.txt',
  '/robots.txt',
  '/api.json',
]);

interface Link {
  readonly from: string;
  readonly href: string;
}

/** `[text](/docs/x#y)` and `[text](#y)` in the markdown pages. */
const MARKDOWN_LINKS: readonly Link[] = [...DOCS_PAGES].flatMap(([name, text]) =>
  [...text.matchAll(/\]\((\/[^)\s]*|#[^)\s]*)\)/g)].map((match) => ({
    from: name,
    href: match[1] as string,
  })),
);

/** `href="/..."` in the components and routes. */
const ASTRO_LINKS: readonly Link[] = (function collect(dir: URL, into: Link[], prefix: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) collect(child, into, `${prefix}${entry.name}/`);
    else if (entry.name.endsWith('.astro')) {
      for (const match of read(child.pathname).matchAll(/href="(\/[^"]*)"/g)) {
        into.push({ from: `${prefix}${entry.name}`, href: match[1] as string });
      }
    }
  }
  return into;
})(new URL('../../website/src/', import.meta.url), [], '');

/** Undefined when the link resolves; a reason when it does not. */
function broken(link: Link): string | undefined {
  const [path, anchor] = link.href.split('#');
  const target = path === '' ? slugOf(link.from) : (path as string).replace(/^\/docs\//, '');

  if (path !== '' && !(path as string).startsWith('/docs/')) {
    return STANDALONE_ROUTES.has(path as string) ? undefined : `no route ${path}`;
  }
  if (!SLUGS.has(target)) return `no page /docs/${target}`;
  if (anchor === undefined) return undefined;
  return HEADINGS.get(target)?.has(anchor) === true
    ? undefined
    : `no heading #${anchor} on /docs/${target}`;
}

/**
 * Absolute links back at this project: a file in this repository, or a page on this site.
 *
 * These rot exactly like a relative one and are harder to notice, because they look like external
 * links and nobody thinks of them as the site's own. The repository has already made the move
 * that breaks them: the changelog was `CHANGELOG.md` until v0.4.1 and is `docs/CHANGELOG.md`
 * after it, and `scripts/release.mjs` still has to explain which spelling to use for which tag.
 * The README links to that file twice.
 */
const SELF_HOST = /^https:\/\/(?:edfcore\.vercel\.app|github\.com\/tayal-sarthak\/edfcore)(\/.*)?$/;

const README = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

const README_HEADINGS = new Set(
  [...README.matchAll(/^#{1,6} (.+)$/gm)].map((match) => slugify(match[1] as string)),
);

const SELF_LINKS: readonly Link[] = [
  ...[...README.matchAll(/\]\((https:\/\/[^)\s]+|#[^)\s]+)\)/g)].map((match) => ({
    from: 'README.md',
    href: match[1] as string,
  })),
  ...[...DOCS_PAGES].flatMap(([name, text]) =>
    [...text.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].map((match) => ({
      from: name,
      href: match[1] as string,
    })),
  ),
].filter(({ href }) => href.startsWith('#') || SELF_HOST.test(href));

/** Undefined when the link resolves; a reason when it does not. Ignores anything external. */
function brokenSelfLink(link: Link): string | undefined {
  if (link.href.startsWith('#')) {
    // README-internal only: the docs pages' own anchors go through `broken` above.
    return README_HEADINGS.has(link.href.slice(1))
      ? undefined
      : `no heading ${link.href} in README.md`;
  }

  const url = new URL(link.href);
  if (url.host === 'edfcore.vercel.app') return broken({ from: link.from, href: url.pathname });

  // github.com/tayal-sarthak/edfcore/(blob|tree)/main/<path> — a path in this working tree.
  const repoPath = /^\/tayal-sarthak\/edfcore\/(?:blob|tree)\/main\/(.+)$/.exec(url.pathname)?.[1];
  if (repoPath === undefined) return undefined;
  return existsSync(new URL(`../../${repoPath}`, import.meta.url))
    ? undefined
    : `no file ${repoPath} in the repository`;
}

describe('the links were found', () => {
  it('reads enough of them that a passing run is not a vacuous one', () => {
    expect(SLUGS.size).toBeGreaterThan(15);
    expect(MARKDOWN_LINKS.length).toBeGreaterThan(80);
    expect(ASTRO_LINKS.length).toBeGreaterThan(5);
  });

  it('can tell a resolving link from a broken one', () => {
    expect(broken({ from: 'api-helpers.md', href: '/docs/quick-start' })).toBeUndefined();
    expect(broken({ from: 'api-helpers.md', href: '/docs/no-such-page' })).toBeDefined();
    expect(broken({ from: 'api-helpers.md', href: '#the-cli' })).toBeUndefined();
    // The one 0.4.234 nearly shipped.
    expect(broken({ from: 'api-helpers.md', href: '#patient-identification' })).toBeDefined();
    expect(broken({ from: 'index.astro', href: '/demo' })).toBeUndefined();
    expect(broken({ from: 'index.astro', href: '/nowhere' })).toBeDefined();
  });
});

describe('every internal link resolves', () => {
  it('from the documentation pages', () => {
    const dead = MARKDOWN_LINKS.map((link) => ({ link, why: broken(link) }))
      .filter(({ why }) => why !== undefined)
      .map(({ link, why }) => `${link.from} -> ${link.href}: ${why}`);
    expect(dead).toEqual([]);
  });

  it('from the components and routes', () => {
    const dead = ASTRO_LINKS.map((link) => ({ link, why: broken(link) }))
      .filter(({ why }) => why !== undefined)
      .map(({ link, why }) => `${link.from} -> ${link.href}: ${why}`);
    expect(dead).toEqual([]);
  });
});

describe('every link back at this project resolves', () => {
  it('found them, so a passing run is not a vacuous one', () => {
    expect(SELF_LINKS.length).toBeGreaterThanOrEqual(8);
    expect(SELF_LINKS.some(({ href }) => href.includes('/blob/main/'))).toBe(true);
    expect(SELF_LINKS.some(({ href }) => href.startsWith('#'))).toBe(true);
  });

  it('can tell a resolving one from a broken one', () => {
    const repo = 'https://github.com/tayal-sarthak/edfcore/blob/main';
    expect(
      brokenSelfLink({ from: 'README.md', href: `${repo}/docs/CHANGELOG.md` }),
    ).toBeUndefined();
    // Where the changelog lived until v0.4.1, and where two README links would still point.
    expect(brokenSelfLink({ from: 'README.md', href: `${repo}/CHANGELOG.md` })).toBeDefined();
    expect(brokenSelfLink({ from: 'README.md', href: '#roadmap' })).toBeUndefined();
    expect(brokenSelfLink({ from: 'README.md', href: '#no-such-section' })).toBeDefined();
    // An external link is not this file's business.
    expect(
      brokenSelfLink({ from: 'README.md', href: 'https://example.invalid/nowhere' }),
    ).toBeUndefined();
  });

  it('from the README and the documentation pages', () => {
    const dead = SELF_LINKS.map((link) => ({ link, why: brokenSelfLink(link) }))
      .filter(({ why }) => why !== undefined)
      .map(({ link, why }) => `${link.from} -> ${link.href}: ${why}`);
    expect(dead).toEqual([]);
  });
});
