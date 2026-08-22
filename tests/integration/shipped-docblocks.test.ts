/**
 * The docblocks reach the published types, which five other checks quietly assume.
 *
 * `config/tsconfig.build.json` sets `removeComments: false`. That one line is why the module
 * docblock of `src/index.ts` is the hover text an editor shows over `import { openEdf } from
 * 'edfcore'`, and why `readme-status.test.ts`, `node-floor.test.ts`, `module-layers.test.ts`,
 * `file-references.test.ts` and `next-clause.test.ts` each say some version of "this comment
 * ships, so a stale one is stale in the package".
 *
 * Nothing asserted it. Flip the flag — or delete it, since `true` is not the default but an
 * `extends` further up could set it — and every one of those five keeps passing: they read
 * `src/`, and the claim they draw from it is about `dist/`. What changes is that the published
 * `.d.ts` files lose every line of documentation, an editor shows a bare signature on hover, and
 * the package's own reasoning about itself stops being visible to anyone who installs it. Nobody
 * would notice from a green suite, and npm would carry it forward one version at a time.
 *
 * So the setting is asserted, and then the artifact is checked rather than the setting: a
 * distinctive sentence from each of three source docblocks has to be present, verbatim, in the
 * `.d.ts` built from it. `removeComments` is one of several ways to lose them — a bundler step, a
 * different emit path, a `declaration` build that runs from somewhere else — and reading the file
 * catches all of them.
 *
 * It skips when `dist/` is absent, the way `cli-pipe.test.ts` does. `npm run check` builds
 * immediately before the tests, so that is the bare `npm test` case rather than CI.
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const BUILD_CONFIG = JSON.parse(read('config/tsconfig.build.json')) as {
  compilerOptions: Record<string, unknown>;
};

/** Source file, the built declaration beside it, and a sentence only that docblock contains. */
const SHIPPED = [
  {
    source: 'src/index.ts',
    declaration: 'dist/index.d.ts',
    sentence: 'Re-exports only: this file contains no logic',
  },
  {
    source: 'src/node.ts',
    declaration: 'dist/node.d.ts',
    sentence: 'is not Baseline yet',
  },
  {
    source: 'src/types.ts',
    declaration: 'dist/types.d.ts',
    sentence: 'Layer 0',
  },
] as const;

describe('the setting that puts them there', () => {
  it('is off, explicitly, in the build config', () => {
    expect(BUILD_CONFIG.compilerOptions.removeComments).toBe(false);
    // And the build emits declarations at all, which is the other half of shipping hover text.
    expect(BUILD_CONFIG.compilerOptions.declaration).toBe(true);
  });
});

describe.skipIf(!existsSync(new URL('dist/index.d.ts', ROOT)))('the built declarations', () => {
  it.each(SHIPPED.map((entry) => [entry.declaration, entry.source, entry.sentence] as const))(
    '%s carries the docblock %s wrote',
    (declaration, source, sentence) => {
      // Present in the source, so the sentence is a real anchor rather than a typo that would
      // make this check pass by being absent from both.
      expect(read(source)).toContain(sentence);
      expect(read(declaration)).toContain(sentence);
    },
  );

  it('keeps enough of them to be documentation rather than a stray line', () => {
    // `dist/index.d.ts` is re-exports and carries two of its own, so the count that means
    // anything is on the module that owns the declarations: `types.ts` documents 65 public types
    // and most of their fields. A handful of survivors would mean something stripped the rest.
    const types = read('dist/types.d.ts');
    expect(types.match(/\/\*\*/g)?.length ?? 0).toBeGreaterThan(50);
  });
});
