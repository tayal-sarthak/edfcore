/**
 * The README's "Before edfcore" table, against the two paragraphs under it.
 *
 * The table states three absolutes — no standalone reader ships TypeScript types, "Nothing
 * published does byte-range reads", "No published package can read" BDF — and two paragraphs
 * later the same README credits `@epicurrents/edf-reader` with "real TAL parsing, real partial
 * reads, BDF support". A reader meets the flat contradiction in one screen.
 *
 * The reconciliation was already published, on `comparison.md`, and only there: that page marks
 * random access and BDF as Yes for `@epicurrents` and then says to "Read the `@epicurrents`
 * column as describing its repository, rather than the artifact currently on npm", because "the
 * artifact published to npm predates a good deal of the work in the repository". The README's
 * rows say "published" and mean it; nothing on the page said so (fixed in 0.6.63).
 *
 * This repository is not entitled to assert anything new about someone else's package —
 * `comparison-column.test.ts` says why, and checks only the edfcore column. So what is checked
 * here is narrower and entirely ours: that the README carries the qualification its own next
 * paragraph makes necessary, and points at the page that draws the distinction.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCS_PAGES } from '../support/docs-pages.js';

const README = readFileSync(new URL('../../README.md', import.meta.url), 'utf8').replace(
  /\s+/g,
  ' ',
);
const COMPARISON = (DOCS_PAGES.get('comparison.md') ?? '').replace(/\s+/g, ' ');

describe('the two things the README says about the same package', () => {
  it('still states the absolutes, so this is about a live contradiction', () => {
    expect(README).toContain('Nothing published does byte-range reads');
    expect(README).toContain('No published package can read it');
  });

  it('still credits the same project with both capabilities', () => {
    expect(README).toContain('real TAL parsing, real partial reads, BDF support');
  });

  it('carries the qualification that reconciles them', () => {
    expect(README).toContain('Those rows describe the packages as published to npm');
  });

  it('sends a reader to the page that draws the distinction', () => {
    expect(README).toContain('/docs/comparison');
  });
});

describe('the page it sends them to', () => {
  it('is where the distinction is actually made', () => {
    expect(COMPARISON).toContain(
      'Read the `@epicurrents` column as describing its repository, rather than the artifact currently on npm',
    );
  });

  it('is careful about what the survey did not verify, which the README now says too', () => {
    expect(COMPARISON).toContain(
      '"Not established" means this survey did not verify it either way',
    );
    expect(README).toContain('says which claims that survey verified and which it did not');
  });
});
