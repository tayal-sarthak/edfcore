/**
 * The three packaging promises in the README's compatibility list, checked against the manifest.
 *
 * > Zero runtime dependencies, permanently.
 * > Three entry points, no environment conditions in the exports map.
 * > ESM only.
 *
 * The first is in the package description on npm, which is where most people meet edfcore; the
 * second is what lets a bundler resolve one file per subpath with nothing to configure; the third
 * is why the Node floor is what it is. `api-surface.test.ts` counts the exports and
 * `public-api.test.ts` walks the module graph, so what the package CONTAINS is well covered —
 * none of them reads the manifest that says how it is shipped.
 *
 * Adding a dependency is one `npm install --save` away and the tree stays green: nothing here
 * imports it, so no test fails, and "zero-dependency" quietly stops being true in the one place a
 * reader looks before installing. An environment condition is the same shape of edit — `browser`
 * next to `default` is a two-line change that makes the resolution story a paragraph longer than
 * the sentence promising it is one line.
 *
 * `publint` and `@arethetypeswrong/cli` check a stronger version of the export-target half, but
 * they run in `publish.yml` only — after the tag is pushed, in the window 0.4.226 is about. This
 * runs in `npm run check`, which is what the release script gates on.
 */

import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface RawModuleGlob {
  glob(
    pattern: string,
    options: { query: string; import: string; eager: true },
  ): Record<string, string>;
}

/** Read as raw text at transform time, the way `public-api.test.ts` reads it: no `fs`, no path. */
const MANIFEST = JSON.parse(
  Object.values(
    (import.meta as unknown as RawModuleGlob).glob('../../package.json', {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  )[0] ?? '{}',
) as {
  type?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  exports?: Record<string, unknown>;
  bin?: Record<string, string>;
};

const EXPORTS = MANIFEST.exports ?? {};

describe('the manifest was read', () => {
  it('parses, so a passing run is not a vacuous one', () => {
    expect(Object.keys(EXPORTS).length).toBeGreaterThan(0);
    expect(MANIFEST.bin?.edfcore).toBeDefined();
  });
});

describe('zero runtime dependencies, permanently', () => {
  it.each(['dependencies', 'peerDependencies', 'optionalDependencies'] as const)(
    'declares no %s',
    (field) => {
      // Absent or empty — an empty object is the shape `npm uninstall` leaves behind.
      expect(Object.keys(MANIFEST[field] ?? {}), `package.json ${field}`).toEqual([]);
    },
  );
});

describe('ESM only, with no environment conditions', () => {
  it('is a module package', () => {
    expect(MANIFEST.type).toBe('module');
  });

  it('publishes exactly the three entry points, plus the manifest', () => {
    // `./package.json` is exported so a consumer can read the version without a deep path; it is
    // not an entry point and is excluded from the count the README states.
    expect(Object.keys(EXPORTS).sort()).toEqual(['.', './node', './package.json', './validate']);
  });

  it.each(['.', './node', './validate'] as const)('%s names only types and default', (subpath) => {
    const entry = EXPORTS[subpath] as Record<string, string>;
    // `types` first: a condition after it would never be reached by a TypeScript resolver, and
    // the order is the part a linter of the manifest would check. `default` last is the same rule.
    expect(Object.keys(entry)).toEqual(['types', 'default']);
    // No `import`, `require`, `browser`, `node`, `development` — the whole point of the claim.
    expect(entry.default?.endsWith('.js')).toBe(true);
    expect(entry.types?.endsWith('.d.ts')).toBe(true);
  });
});

describe('every published target exists in the build', () => {
  const targets = [
    ...Object.entries(EXPORTS)
      .filter(([subpath]) => subpath !== './package.json')
      .flatMap(([, entry]) => Object.values(entry as Record<string, string>)),
    MANIFEST.bin?.edfcore ?? '',
  ];

  it('found the targets', () => {
    // Six files across three subpaths, plus the bin. A manifest that lost its exports map would
    // otherwise make the assertion below pass on an empty list.
    expect(targets.length).toBe(7);
  });

  it.each(targets)('%s is emitted', (target) => {
    const path = new URL(`../../${target.replace(/^\.\//, '')}`, import.meta.url);
    expect(
      existsSync(path),
      `${target} is in package.json but not in dist — run \`npm run build\``,
    ).toBe(true);
  });
});
