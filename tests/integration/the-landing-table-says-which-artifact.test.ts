/**
 * The landing page's "Before edfcore" table, and the qualification the README already carries.
 *
 * 0.6.63 fixed this in the README: the table states three absolutes — no standalone reader ships
 * types, nothing published does byte-range reads, no published package reads BDF — and the same
 * document then credits `@epicurrents/edf-reader` with partial reads and BDF support. The
 * reconciliation is on `comparison.md`: read that project's column "as describing its repository,
 * rather than the artifact currently on npm", because the published artifact predates a good deal
 * of the work in it.
 *
 * The landing page carries the same table and the same link to the same project, and carried no
 * qualification at all (fixed in 0.6.84). It is the first page anyone sees, so it is the one the
 * absolutes are read off.
 *
 * Nothing new is asserted here about anyone else's package — `comparison-column.test.ts` explains
 * why this repository is not entitled to, and checks only the edfcore column. What is checked is
 * ours: that the three statements of this table now agree about which artifact they describe.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCS_PAGES } from '../support/docs-pages.js';

const ROOT = new URL('../../', import.meta.url);
const collapse = (text: string): string => text.replace(/\s+/g, ' ');

const PAGE = collapse(readFileSync(new URL('website/src/pages/index.astro', ROOT), 'utf8'));
const README = collapse(readFileSync(new URL('README.md', ROOT), 'utf8'));
const COMPARISON = collapse(DOCS_PAGES.get('comparison.md') ?? '');

describe('the landing page', () => {
  it('still states the absolutes, so this is about a live contradiction', () => {
    expect(PAGE).toContain('No published package can read them');
    expect(PAGE).toContain('Nothing published — the file is loaded whole');
  });

  it('still links the project that has both', () => {
    expect(PAGE).toContain('github.com/epicurrents/edf-reader');
  });

  it('says which artifact the rows describe', () => {
    expect(PAGE).toContain('Those rows describe the packages as published to npm');
  });

  it('points at the page that draws the distinction', () => {
    expect(PAGE).toContain('/docs/comparison');
    expect(PAGE).toContain('which claims that survey verified and which it did not');
  });
});

describe('the three places that carry this table', () => {
  it('has the README saying the same thing since 0.6.63', () => {
    expect(README).toContain('Those rows describe the packages as published to npm');
  });

  it('has comparison.md as the one that actually draws it', () => {
    expect(COMPARISON).toContain(
      'Read the `@epicurrents` column as describing its repository, rather than the artifact currently on npm',
    );
  });
});
