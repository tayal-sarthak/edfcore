/**
 * No test pulls a TypeScript file out of `website/` through vite's transform.
 *
 * 0.4.231 added a check that read `website/src/content.config.ts` with
 * `import.meta.glob(..., { query: '?raw' })`. `?raw` returns the bytes, but the path still goes
 * through vite's transform first, and the transform resolves that file's nearest tsconfig —
 * `website/tsconfig.json`, which extends `astro/tsconfigs/strict` out of `website/node_modules`.
 * The CI `check` job installs the root workspace only. So `npm run check` passed on every machine
 * with the site's dependencies present and died with
 * `[TSCONFIG_ERROR] Failed to load tsconfig 'astro/tsconfigs/strict'` on every machine without —
 * which is every runner. Six versions were tagged and none of them published (fixed in 0.4.237).
 *
 * Markdown is fine and is how `tests/support/docs-pages.ts` reads the pages: no JavaScript
 * tooling looks at a `.md` file's tsconfig. It is the `.ts` and `.astro` files the rule is about.
 *
 * The scanner reads with `readFileSync` rather than a glob, which is the same reasoning one level
 * up: a check on what the tests transform should not be a thing that transforms.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface GlobCall {
  readonly from: string;
  readonly pattern: string;
}

const TESTS = new URL('../', import.meta.url);

/** Every `.glob('…')` in the suite, with the file that wrote it. */
const GLOBS: readonly GlobCall[] = (function collect(dir: URL, into: GlobCall[], prefix: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // `scratch/` is gitignored throwaway probes and is excluded from the suite and the typecheck.
    if (entry.isDirectory()) {
      if (entry.name !== 'scratch') {
        collect(new URL(`${entry.name}/`, dir), into, `${prefix}${entry.name}/`);
      }
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    const source = readFileSync(new URL(entry.name, dir), 'utf8');
    for (const match of source.matchAll(/\.glob\(\s*'([^']+)'/g)) {
      into.push({ from: `${prefix}${entry.name}`, pattern: match[1] as string });
    }
  }
  return into;
})(TESTS, [], '');

const MARKDOWN = /\.(md|mdx|\{md,mdx\})$/;

describe('the suite was scanned', () => {
  it('found the globs, so a passing run is not a vacuous one', () => {
    expect(GLOBS.length).toBeGreaterThan(4);
    // The two shapes the rule is about: one into `src/`, one into the site's markdown.
    expect(GLOBS.some(({ pattern }) => pattern.includes('/src/'))).toBe(true);
    expect(GLOBS.some(({ pattern }) => pattern.includes('/website/'))).toBe(true);
  });
});

describe('a glob into the website reads markdown only', () => {
  it('transforms no TypeScript the root workspace cannot resolve a tsconfig for', () => {
    const offenders = GLOBS.filter(
      ({ pattern }) => pattern.includes('/website/') && !MARKDOWN.test(pattern),
    ).map(
      ({ from, pattern }) =>
        `${from}: ${pattern} — read it with readFileSync; a ?raw glob still transforms`,
    );
    expect(offenders).toEqual([]);
  });
});
