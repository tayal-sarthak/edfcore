/**
 * The documentation section list is one list, or agrees with it.
 *
 * `section` is a `z.enum` in `content.config.ts`, and three consumers group pages by it: the
 * sidebar in `DocsNav.astro`, and the `/llms.txt` and `/llms-full.txt` endpoints. Each walks a list
 * of names, so a section the list omits is a section whose pages render at their URL and appear in
 * no index — invisible in the sidebar and absent from both files agents read.
 *
 * There were four copies of that list, and this file checked that they agreed. They now read one,
 * `DOC_SECTIONS` in `website/src/doc-sections.ts`, and the schema is built from it. What is still
 * checked is the way back to four: a file that groups by section and writes its own list out again
 * must write the same names, as before.
 *
 * The ORDER is deliberately not checked. Sections appear in an editorial order that no property of
 * the entries expresses, and a consumer is entitled to its own.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');

const WEBSITE_SRC = new URL('../../website/src/', import.meta.url);

/** The quoted names inside the first bracketed list following `marker`. */
function names(source: string, marker: string): readonly string[] {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`no ${marker} found`);
  const open = source.indexOf('[', start);
  const close = source.indexOf(']', open);
  if (open === -1 || close === -1) throw new Error(`no list after ${marker}`);
  return [...source.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

const LIST = names(read('../../website/src/doc-sections.ts'), 'DOC_SECTIONS = ');
const SCHEMA_SOURCE = read('../../website/src/content.config.ts');

/**
 * Every file that groups pages by section — found, not listed. Naming the three here would make
 * this guard the same shape as the defect it exists to catch: a fourth file grouping by its own
 * list would simply not be one of the three, and the run would stay green while it drifted.
 */
const CONSUMERS = readdirSync(WEBSITE_SRC, { recursive: true, encoding: 'utf8' })
  .filter((relative) => relative.endsWith('.ts') || relative.endsWith('.astro'))
  .map((relative) => ({
    file: relative,
    source: readFileSync(new URL(relative, WEBSITE_SRC), 'utf8'),
  }))
  .filter(({ source }) => source.includes('data.section === section'));

describe('the documentation section list', () => {
  it('read a real list, so a passing run is not a vacuous one', () => {
    expect(LIST.length).toBeGreaterThanOrEqual(4);
    expect(LIST).toContain('Start here');
  });

  it('is what the schema is built from', () => {
    expect(SCHEMA_SOURCE).toContain('section: z.enum(DOC_SECTIONS)');
  });

  it('found every consumer there is, so the search itself cannot go quiet', () => {
    // A typo in the pattern, or a move out of website/src, would leave nothing to compare and
    // every assertion below would pass by having nothing to say. A floor and one anchor rather
    // than the exact three: a fourth consumer is welcome here and should need no edit.
    expect(CONSUMERS.length).toBeGreaterThanOrEqual(3);
    expect(CONSUMERS.map((consumer) => consumer.file)).toContain('components/DocsNav.astro');
  });

  it.each(CONSUMERS)('is read by $file, or copied there exactly', ({ source }) => {
    if (source.includes('DOC_SECTIONS')) return;
    const theirs = names(source, 'const SECTIONS');
    expect([...theirs].sort()).toEqual([...LIST].sort());
  });
});
