/**
 * The type tests are checked by `tsc`, and nothing else is checking them.
 *
 * `tests/types/` holds five `.test-d.ts` files, and they are the only assertions in this repository
 * that a runtime test cannot make: what each subpath can name on its own, that the documented
 * examples typecheck, that a `Blob` and a `Response` satisfy the structural shims.
 *
 * They are inside the vitest `include` glob, and vitest runs them with `typecheck.enabled: false`.
 * That combination reports a **false green**: introduce a plain type error into one and vitest
 * loads the file, finds no runtime assertions, and prints `1 passed`. Their entire value comes from
 * `npm run typecheck`, which is `tsc -p tsconfig.json`, whose `include` happens to list `tests`.
 *
 * "Happens to" is the problem. Nothing connects that line in `tsconfig.json` to the five files that
 * depend on it. Narrowing the include to `src` would be an ordinary-looking tidy-up: `npm run
 * check` would stay green, vitest would keep reporting the type tests as passing, and every
 * type-level guarantee in the package would be unchecked.
 *
 * So the wiring is asserted rather than assumed — which config the typecheck script names, that its
 * include reaches every type test, and that vitest is deliberately not the thing doing it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const MANIFEST = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

/** `tsconfig.json` carries comments, so it is read as text rather than parsed. */
const TSCONFIG = read('tsconfig.json');
const VITEST_CONFIG = read('config/vitest.config.ts');

/** Every `.test-d.ts` in the tree, by path relative to the repository root. */
const TYPE_TESTS: readonly string[] = (() => {
  const found: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(new URL(`${relative}/`, ROOT), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'scratch') continue;
        walk(`${relative}/${entry.name}`);
      } else if (entry.name.endsWith('.test-d.ts')) {
        found.push(`${relative}/${entry.name}`);
      }
    }
  };
  walk('tests');
  return found;
})();

/** The directories `tsconfig.json` includes. */
const INCLUDED: readonly string[] = (() => {
  const list = /"include"\s*:\s*\[([^\]]*)\]/.exec(TSCONFIG);
  if (list === null) throw new Error('tsconfig.json has no include list');
  return [...(list[1] ?? '').matchAll(/"([^"]+)"/g)].map(([, entry = '']) => entry);
})();

describe('where the type tests are checked', () => {
  it('found them, so a passing run is not a vacuous one', () => {
    expect(TYPE_TESTS.length).toBeGreaterThan(3);
  });

  it('is `tsc` against the config the typecheck script names', () => {
    // Two configs on purpose: `tsconfig.build.json` compiles `src` alone with `types: []`, and
    // this one is the one that reaches the tests.
    expect(MANIFEST.scripts.typecheck).toContain('tsc -p tsconfig.json');
  });

  it('reaches every one of them through that config’s include', () => {
    for (const file of TYPE_TESTS) {
      const covered = INCLUDED.some(
        (entry) => file === entry || file.startsWith(`${entry.replace(/\/$/, '')}/`),
      );
      expect(covered, `${file} is not under ${INCLUDED.join(', ')}`).toBe(true);
    }
  });

  it('excludes only the throwaway directory, which is gitignored', () => {
    const excluded = /"exclude"\s*:\s*\[([^\]]*)\]/.exec(TSCONFIG);
    expect([...(excluded?.[1] ?? '').matchAll(/"([^"]+)"/g)].map(([, entry]) => entry)).toEqual([
      'tests/scratch',
    ]);
    for (const file of TYPE_TESTS) expect(file.startsWith('tests/scratch/')).toBe(false);
  });
});

describe('what vitest does with them, which is not checking them', () => {
  it('runs them, because they are inside its include glob', () => {
    expect(VITEST_CONFIG).toContain("'tests/**/*.test-d.ts'");
  });

  it('has its own typecheck turned off, so it is not the thing verifying them', () => {
    // The false green this file exists for: with this false, a `.test-d.ts` carrying a plain type
    // error loads, finds no runtime assertion, and is reported as passing.
    expect(VITEST_CONFIG).toMatch(/typecheck:\s*\{\s*enabled:\s*false,?\s*\}/);
  });

  it('cannot see the half of these files that is type-level', () => {
    // Some of them also carry runtime blocks, and those do run — which is what makes the green
    // misleading rather than merely uninformative. A file whose runtime half passes and whose
    // type half no longer compiles is reported exactly like one that is entirely fine.
    //
    // The type-level half is what has no runtime existence at all: an `import type`, an
    // assignability alias, a `declare const` standing in for a value the snippet never builds.
    // Every one of these files carries at least one, and `tsc` is the only thing that reads them.
    for (const file of TYPE_TESTS) {
      const source = read(file);
      expect(source, file).toMatch(/^\s*(?:import type\b|export type |declare )/m);
    }
  });
});
