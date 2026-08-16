/**
 * The four copies of the documentation section list agree.
 *
 * `section` is a `z.enum` in `content.config.ts`, and three consumers write the same four names out
 * again: the sidebar in `DocsNav.astro`, and the `/llms.txt` and `/llms-full.txt` endpoints. Each
 * groups pages by walking its own array, so a section the array omits is a section whose pages
 * render at their URL and appear in no index — invisible in the sidebar and absent from both files
 * agents read.
 *
 * DocsNav's own docblock says this cannot happen: "`section` is a `z.enum` over these same four, so
 * a fifth one fails the build rather than going missing from the sidebar." That is true only while
 * the lists agree, and nothing made them. Adding a name to the enum — the one edit that lets a new
 * section exist at all — is exactly the edit that breaks the assumption, and `astro check` sees
 * four well-typed arrays and says nothing.
 *
 * The ORDER is deliberately not checked. Sections appear in an editorial order that no property of
 * the entries expresses, and each consumer is entitled to its own.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');

/** The quoted names inside the first bracketed list following `marker`. */
function names(source: string, marker: string): readonly string[] {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`no ${marker} found`);
  const open = source.indexOf('[', start);
  const close = source.indexOf(']', open);
  if (open === -1 || close === -1) throw new Error(`no list after ${marker}`);
  return [...source.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

const SCHEMA = names(read('../../website/src/content.config.ts'), 'section: z.enum(');

const CONSUMERS = [
  { file: 'DocsNav.astro', source: read('../../website/src/components/DocsNav.astro') },
  { file: 'llms.txt.ts', source: read('../../website/src/pages/llms.txt.ts') },
  { file: 'llms-full.txt.ts', source: read('../../website/src/pages/llms-full.txt.ts') },
] as const;

describe('the documentation section list', () => {
  it('read a real enum out of the schema, so a passing run is not a vacuous one', () => {
    expect(SCHEMA.length).toBeGreaterThanOrEqual(4);
    expect(SCHEMA).toContain('Start here');
  });

  it.each(CONSUMERS)('is the same set in $file as in the schema', ({ source }) => {
    const theirs = names(source, 'const SECTIONS');
    expect([...theirs].sort()).toEqual([...SCHEMA].sort());
  });
});
