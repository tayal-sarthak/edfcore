/**
 * `og:type` and the JSON-LD `@type`, which describe the same page to the same crawlers.
 *
 * `Base.astro` states the rule for structured data in its own props: it "must restate what is
 * visible on the page, never more", because data that contradicts the page — schema drift — reads
 * as spam to the crawlers it exists for. Two blocks of metadata the same layout emits disagreed
 * about the same page: every docs page carried `og:type: website` while its `@graph` called
 * itself a `TechArticle` (fixed in 0.6.68).
 *
 * `og:type` is now a prop, defaulting to `website`, and the docs route passes `article`. The
 * landing page, the inspector and the 404 keep `website`, which is what they are.
 *
 * Read off the BUILT site, because the pairing only exists in the rendered head, and each page's
 * JSON-LD is parsed rather than pattern-matched so a malformed block fails here too.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIST = new URL('../../website/dist/', import.meta.url);
const BUILT = existsSync(DIST);

function pages(dir: URL, prefix = ''): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir.pathname, entry);
    if (statSync(path).isDirectory()) {
      found.push(...pages(new URL(`${entry}/`, dir), `${prefix}${entry}/`));
    } else if (entry.endsWith('.html')) found.push(`${prefix}${entry}`);
  }
  return found;
}

const htmlOf = (page: string): string => readFileSync(new URL(page, DIST), 'utf8');

const ogTypeOf = (page: string): string | undefined =>
  /<meta property="og:type" content="([^"]*)"/.exec(htmlOf(page))?.[1];

/** Every `@type` in the page's JSON-LD blocks, parsed. */
function schemaTypes(page: string): readonly string[] {
  const types: string[] = [];
  for (const block of htmlOf(page).matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  )) {
    const parsed = JSON.parse(block[1] ?? '{}') as { '@graph'?: { '@type'?: string }[] };
    for (const node of parsed['@graph'] ?? []) if (node['@type']) types.push(node['@type']);
  }
  return types;
}

describe.skipIf(!BUILT)('the built pages', () => {
  const ALL = BUILT ? pages(DIST) : [];
  const DOCS = ALL.filter((page) => page.startsWith('docs/') && page !== 'docs/index.html');
  const OTHERS = ALL.filter((page) => !page.startsWith('docs/'));

  it('are found, in both kinds', () => {
    expect(DOCS.length).toBeGreaterThan(10);
    expect(OTHERS).toContain('index.html');
    expect(OTHERS).toContain('demo/index.html');
    expect(OTHERS).toContain('404.html');
  });

  it('call a docs page an article in both places', () => {
    for (const page of DOCS) {
      expect(ogTypeOf(page), page).toBe('article');
      expect(schemaTypes(page), page).toContain('TechArticle');
    }
  });

  it('call everything else a website, and claim no article about it', () => {
    for (const page of OTHERS) {
      expect(ogTypeOf(page), page).toBe('website');
      expect(schemaTypes(page), page).not.toContain('TechArticle');
    }
  });
});

describe('the layout', () => {
  const LAYOUT = readFileSync(
    new URL('../../website/src/layouts/Base.astro', import.meta.url),
    'utf8',
  );

  it('defaults to website, so a new page cannot claim to be an article by accident', () => {
    expect(LAYOUT).toContain("ogType = 'website'");
    expect(LAYOUT).toContain('<meta property="og:type" content={ogType} />');
  });

  it('still states the rule the two blocks have to obey', () => {
    expect(LAYOUT.replace(/\s+/g, ' ')).toContain(
      'everything in it must restate what is visible on the page, never more',
    );
  });
});
