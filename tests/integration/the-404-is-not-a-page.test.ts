/**
 * The 404, and the second URL it is reachable at.
 *
 * `404.astro` exists for one reason, which its docblock states: a crawler that gets a real 404
 * status treats the URL as gone, and a site with no 404 route serves "a soft-200 that search
 * engines index as duplicate junk". Astro names the file `404` and Vercel serves it with the
 * right status for a miss.
 *
 * It is also served at `/404`. `cleanUrls` is on, so the extensionless path resolves to
 * `404.html` with a 200 — and the page carries a canonical pointing at itself and nothing telling
 * a crawler to leave it alone. That is a soft 404 at a guessable URL, on the page written to
 * avoid one (fixed in 0.6.67).
 *
 * `noindex, follow` rather than `nofollow`: the three links on the page are its whole purpose, and
 * the point is to keep the page out of an index, not to strand what it points at.
 *
 * Checked against the BUILT site, because the question is what a crawler receives. Every other
 * page must not carry the tag, which is the half that would otherwise go unnoticed.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIST = new URL('../../website/dist/', import.meta.url);
const BUILT = existsSync(DIST);

/** Every `.html` under `website/dist`, as a path relative to it. */
function pages(dir: URL, prefix = ''): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir.pathname, entry);
    if (statSync(path).isDirectory())
      found.push(...pages(new URL(`${entry}/`, dir), `${prefix}${entry}/`));
    else if (entry.endsWith('.html')) found.push(`${prefix}${entry}`);
  }
  return found;
}

const robotsOf = (page: string): string | undefined =>
  /<meta name="robots" content="([^"]*)"/.exec(readFileSync(new URL(page, DIST), 'utf8'))?.[1];

describe.skipIf(!BUILT)('the built site', () => {
  const ALL = BUILT ? pages(DIST) : [];

  it('has a 404 page and a good many others', () => {
    expect(ALL).toContain('404.html');
    expect(ALL.length).toBeGreaterThan(10);
  });

  it('keeps the 404 out of an index, and its links followable', () => {
    expect(robotsOf('404.html')).toBe('noindex, follow');
  });

  it('leaves every page a reader is meant to find indexable', () => {
    const indexable = ALL.filter((page) => page !== '404.html' && page !== 'docs/index.html');
    expect(indexable.filter((page) => robotsOf(page) !== undefined)).toEqual([]);
  });

  it('still gives the 404 the canonical and description every page gets', () => {
    const html = readFileSync(new URL('404.html', DIST), 'utf8');
    expect(html).toMatch(/<link rel="canonical" href="[^"]+\/404">/);
    expect(html).toContain('<meta name="description"');
  });
});

describe('the source the build comes from', () => {
  const layout = readFileSync(
    new URL('../../website/src/layouts/Base.astro', import.meta.url),
    'utf8',
  );
  const page = readFileSync(new URL('../../website/src/pages/404.astro', import.meta.url), 'utf8');

  it('makes noindex opt-in, so it cannot spread by default', () => {
    expect(layout).toContain('noindex = false');
    expect(layout).toContain('noindex, follow');
  });

  it('is asked for by the 404 and by nothing else', () => {
    const dir = new URL('../../website/src/pages/', import.meta.url);
    const asking = readdirSync(dir).filter(
      (name) =>
        name.endsWith('.astro') && /\n\s*noindex\b/.test(readFileSync(new URL(name, dir), 'utf8')),
    );
    expect(asking).toEqual(['404.astro']);
    expect(page).toContain('noindex');
  });
});
