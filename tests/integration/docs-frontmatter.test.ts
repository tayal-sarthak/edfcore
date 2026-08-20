/**
 * The sidebar order is a total order, and every page is findable.
 *
 * `content.config.ts` requires `section` and `order` on every page so that "a new page cannot
 * silently land at the bottom of the wrong group". It cannot require what actually makes the
 * sidebar deterministic: that no two pages in a section share an `order`. `DocsNav.astro` sorts by
 * it, and `Array.prototype.sort` is stable, so a tie falls back to whatever order the collection
 * loader happened to return — a filesystem detail. Two pages would swap places between machines
 * and nobody would call it a bug, because nothing says what the right order is.
 *
 * The same numbers drive `llms.txt` and `llms-full.txt`, which is where a tie stops being
 * cosmetic: those are the reading order an agent is handed, and "the guides, in order" is the only
 * structure that file has.
 *
 * Contiguity is checked too, and that one is a judgement rather than a correctness rule — a gap
 * at 4 breaks nothing. It is here because a gap is what a deleted page leaves behind, and finding
 * it later means reconstructing which page used to be there. The suite has 23 pages across four
 * sections and each numbers 1..N today.
 *
 * `title` and `description` are checked for uniqueness because both are addresses rather than
 * prose: the title is what the sidebar shows and what an agent matches on, and the description is
 * the page's line in `llms.txt` and its meta description. Two pages sharing either are two pages
 * a reader cannot tell apart from the outside.
 */

import { describe, expect, it } from 'vitest';
import { DOCS_PAGES } from '../support/docs-pages.js';

interface Page {
  readonly file: string;
  readonly title: string;
  readonly description: string;
  readonly section: string;
  readonly order: number;
}

/** One frontmatter field, unquoted. */
function field(source: string, name: string): string | undefined {
  const match = new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(source);
  return match === null ? undefined : (match[1] as string).replace(/^['"]|['"]$/g, '').trim();
}

const PAGES: readonly Page[] = [...DOCS_PAGES].map(([file, source]) => ({
  file,
  title: field(source, 'title') ?? '',
  description: field(source, 'description') ?? '',
  section: field(source, 'section') ?? '',
  order: Number(field(source, 'order')),
}));

const SECTIONS = [...new Set(PAGES.map((page) => page.section))];

describe('the frontmatter was read', () => {
  it('parsed every page, so a passing run is not a vacuous one', () => {
    expect(PAGES.length).toBeGreaterThan(20);
    expect(PAGES.every((page) => page.title !== '')).toBe(true);
    expect(PAGES.every((page) => Number.isInteger(page.order))).toBe(true);
    // The four the collection schema admits, and no page outside them.
    expect(SECTIONS.sort()).toEqual(['Background', 'Guides', 'Reference', 'Start here']);
  });
});

describe('each section is a total order', () => {
  it.each(SECTIONS)('%s numbers its pages once each', (section) => {
    const orders = PAGES.filter((page) => page.section === section)
      .map((page) => page.order)
      .sort((a, b) => a - b);
    const duplicated = orders.filter((order, index) => orders.indexOf(order) !== index);
    expect(duplicated, `two pages in ${section} share an order, so the sidebar is a tie`).toEqual(
      [],
    );
  });

  it.each(SECTIONS)('%s numbers them 1..N with no gap', (section) => {
    const orders = PAGES.filter((page) => page.section === section)
      .map((page) => page.order)
      .sort((a, b) => a - b);
    expect(orders).toEqual(orders.map((_, index) => index + 1));
  });
});

describe('no two pages wear the same name', () => {
  it('has distinct titles', () => {
    const titles = PAGES.map((page) => page.title);
    const repeated = titles.filter((title, index) => titles.indexOf(title) !== index);
    expect(repeated, 'titles used by more than one page').toEqual([]);
  });

  it('has distinct descriptions, which are the llms.txt lines', () => {
    const descriptions = PAGES.map((page) => page.description);
    const repeated = descriptions.filter((one, index) => descriptions.indexOf(one) !== index);
    expect(repeated, 'descriptions used by more than one page').toEqual([]);
  });

  it('describes every page in a sentence long enough to choose by', () => {
    // These are what an agent reads instead of the page. "Errors" would be a title, not a line.
    const thin = PAGES.filter((page) => page.description.length < 40).map((page) => page.file);
    expect(thin).toEqual([]);
  });
});
