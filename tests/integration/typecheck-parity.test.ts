/**
 * The two tsconfigs differ only where they are meant to.
 *
 * `npm run typecheck` runs both, and that is deliberate: `config/tsconfig.build.json` compiles
 * `src/` with `lib: ["ES2022"]` and `types: []`, so neither the DOM nor `@types/node` can leak
 * into the published declarations, while the root `tsconfig.json` compiles `src`, `tests`,
 * `scripts` and `config/*.ts` with both available. AGENTS.md states the split and the reason.
 *
 * What it does not state is that everything ELSE about them has to be the same, and that is the
 * half with consequences. Every strictness flag in the root config is the setting the test suite
 * is written under — including `tests/types/*.test-d.ts`, whose entire job is to prove the public
 * API compiles for a consumer. `noUncheckedIndexedAccess` is the example the repository has
 * already paid for: until 0.4.259 the snippet AGENTS.md tells agents to copy ended
 * `chunks[0].signals[0].digital` and did not compile in a strict project. That was found because
 * the flag is on here. Turn it off in the root config alone and the type tests keep passing while
 * they stop testing what they claim: `src/` still compiles strictly, and the snippet asserting a
 * consumer's experience is now checked under settings no consumer has.
 *
 * A relaxation in the other direction is loud — `src/` fails the build config — so the asymmetry
 * is the point. This compares the two configs directly and requires the differences to be named.
 *
 * What this does NOT check: `website/tsconfig.json`, which extends `astro/tsconfigs/strict` and
 * is checked by `astro check` in a separate workspace with its own dependency tree. It compiles
 * no file this package publishes.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const options = (relative: string): Record<string, unknown> =>
  (
    JSON.parse(readFileSync(new URL(relative, ROOT), 'utf8')) as {
      compilerOptions: Record<string, unknown>;
    }
  ).compilerOptions;

const BUILD = options('config/tsconfig.build.json');
const DEV = options('tsconfig.json');

/**
 * The keys allowed to differ, each with what it is for.
 *
 * `lib` and `types` are the isolation AGENTS.md describes. The rest are emit: the build config
 * writes `dist/`, the root config writes nothing, and `isolatedDeclarations` is a constraint on
 * declaration output that cannot apply to a config which emits none.
 */
const DIVERGENT = {
  lib: 'the published types must not see the DOM',
  types: 'the published types must not see @types/node',
  declaration: 'only the build config emits',
  declarationMap: 'only the build config emits',
  sourceMap: 'only the build config emits',
  removeComments: 'only the build config emits',
  isolatedDeclarations: 'a constraint on declaration output',
  outDir: 'only the build config emits',
  rootDir: 'only the build config emits',
  noEmit: 'the root config is the one that emits nothing',
} as const;

describe('the two configs', () => {
  it('were both read, so a passing run is not a vacuous one', () => {
    expect(Object.keys(BUILD).length).toBeGreaterThan(15);
    expect(Object.keys(DEV).length).toBeGreaterThan(15);
    // The isolation itself, which is the reason there are two of them at all.
    expect(BUILD.types).toEqual([]);
    expect(BUILD.lib).toEqual(['ES2022']);
    expect(DEV.types).toEqual(['node']);
  });

  it('agree on every option that is not one of the named exceptions', () => {
    const shared = [...new Set([...Object.keys(BUILD), ...Object.keys(DEV)])]
      .filter((key) => !(key in DIVERGENT))
      .filter((key) => JSON.stringify(BUILD[key]) !== JSON.stringify(DEV[key]));
    expect(
      shared.map(
        (key) => `${key}: build ${JSON.stringify(BUILD[key])}, root ${JSON.stringify(DEV[key])}`,
      ),
      'an option differs between the two configs and is not a named exception',
    ).toEqual([]);
  });

  it('names no exception that is not actually one', () => {
    // A key listed above that the two configs agree on is a stale entry, and a stale entry is a
    // hole: it would let a real divergence appear later without failing anything.
    const settled = Object.keys(DIVERGENT).filter(
      (key) => JSON.stringify(BUILD[key]) === JSON.stringify(DEV[key]),
    );
    expect(settled, 'listed as divergent and no longer divergent').toEqual([]);
  });
});

describe('the strictness the suite is written under', () => {
  // Named individually as well as compared, so that turning one off in BOTH configs — which the
  // comparison above would call agreement — still fails.
  it.each([
    'strict',
    'noUncheckedIndexedAccess',
    'exactOptionalPropertyTypes',
    'noImplicitOverride',
    'noImplicitReturns',
    'noFallthroughCasesInSwitch',
    'noUnusedLocals',
    'noUnusedParameters',
    'verbatimModuleSyntax',
    'erasableSyntaxOnly',
    'useDefineForClassFields',
  ])('%s is on in both', (flag) => {
    expect(BUILD[flag], `config/tsconfig.build.json ${flag}`).toBe(true);
    expect(DEV[flag], `tsconfig.json ${flag}`).toBe(true);
  });

  it('compiles the type tests, which is what makes them run', () => {
    const include = JSON.parse(readFileSync(new URL('tsconfig.json', ROOT), 'utf8')) as {
      include: readonly string[];
      exclude: readonly string[];
    };
    expect(include.include).toContain('tests');
    // And the one directory excluded from it, for the reason vitest.config.ts gives.
    expect(include.exclude).toEqual(['tests/scratch']);
  });
});
