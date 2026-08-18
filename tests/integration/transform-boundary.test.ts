/**
 * No test pulls a TypeScript file out of `website/` through vite's transform, by any route.
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
 * It checked only `.glob(...)` calls until 0.4.264, which was the narrower half of its own rule: a
 * plain `import { buildSampleEdf } from '../../website/src/scripts/sample-edf.js'` reaches the
 * same transform by the more obvious route and was waved straight through. Confirmed rather than
 * assumed — that exact import passes locally and dies with the same `[TSCONFIG_ERROR]` with
 * `website/node_modules` moved aside.
 *
 * The scanner reads with `readFileSync` rather than a glob, which is the same reasoning one level
 * up: a check on what the tests transform should not be a thing that transforms.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** JS comments only, and `//` never when preceded by `:` so a URL survives intact. */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

interface Reference {
  readonly from: string;
  /** How the file is reached: a glob pattern, or an import specifier. */
  readonly path: string;
  readonly kind: 'glob' | 'import';
}

const TESTS = new URL('../', import.meta.url);

/** Every `.glob('…')` and every `from '…'` in the suite, with the file that wrote it. */
const REFERENCES: readonly Reference[] = (function collect(
  dir: URL,
  into: Reference[],
  prefix: string,
) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // `scratch/` is gitignored throwaway probes and is excluded from the suite and the typecheck.
    if (entry.isDirectory()) {
      if (entry.name !== 'scratch') {
        collect(new URL(`${entry.name}/`, dir), into, `${prefix}${entry.name}/`);
      }
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    // Comments stripped first, the same rule 0.4.232 applied to the site sweep: what a file DOES
    // is the claim, and this file's own docblock quotes the offending import to explain it.
    const source = withoutComments(readFileSync(new URL(entry.name, dir), 'utf8'));
    for (const match of source.matchAll(/\.glob\(\s*'([^']+)'/g)) {
      into.push({ from: `${prefix}${entry.name}`, path: match[1] as string, kind: 'glob' });
    }
    // `from '…'` covers static imports and re-exports; `import('…')` covers the dynamic form.
    for (const match of source.matchAll(/(?:from|import\()\s*'([^']+)'/g)) {
      into.push({ from: `${prefix}${entry.name}`, path: match[1] as string, kind: 'import' });
    }
  }
  return into;
})(TESTS, [], '');

const MARKDOWN = /\.(md|mdx|\{md,mdx\})$/;

describe('the suite was scanned', () => {
  it('found both routes, so a passing run is not a vacuous one', () => {
    expect(REFERENCES.filter(({ kind }) => kind === 'glob').length).toBeGreaterThan(4);
    expect(REFERENCES.filter(({ kind }) => kind === 'import').length).toBeGreaterThan(50);
    // The two shapes the rule is about: one into `src/`, one into the site's markdown.
    expect(REFERENCES.some(({ path }) => path.includes('/src/'))).toBe(true);
    expect(REFERENCES.some(({ path }) => path.includes('/website/'))).toBe(true);
  });
});

describe('anything reaching into the website reads markdown only', () => {
  it('transforms no TypeScript the root workspace cannot resolve a tsconfig for', () => {
    const offenders = REFERENCES.filter(
      ({ path }) => path.includes('/website/') && !MARKDOWN.test(path),
    ).map(
      ({ from, path, kind }) =>
        `${from}: ${kind} of ${path} — read it with readFileSync; the transform runs either way`,
    );
    expect(offenders).toEqual([]);
  });
});
