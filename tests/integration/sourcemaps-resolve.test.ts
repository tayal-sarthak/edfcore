/**
 * The sourcemaps in the published package point at files the package ships.
 *
 * `config/tsconfig.build.json` turns on `sourceMap` and `declarationMap`, and `package.json` puts
 * `src` in `files`. The two are one feature: tsc emits maps whose `sources` are `../src/x.ts`,
 * relative to `dist/`, and it inlines no `sourcesContent` — so the maps resolve only because the
 * TypeScript ships beside them. That is why `check-tarball.mjs` refuses a tarball without `src/`
 * with the words "the sourcemaps resolve to nothing".
 *
 * Nothing checked that the maps say what that arrangement assumes. Three edits break it and none
 * of them fails anything today:
 *
 *  - Dropping `src` from `files` to make the tarball smaller. It is 250 KB of TypeScript for a
 *    package whose `dist` is what runs, so it looks like dead weight.
 *  - Turning `sourcesContent` on, which makes `src/` redundant — and then dropping `src/`, which
 *    is fine, until someone turns it off again.
 *  - Turning either map off in the build config.
 *
 * What breaks is not a build. It is a consumer stepping into `openEdf` in a debugger and landing
 * in compiled output, or "go to definition" on `EdfHeader` opening a `.d.ts` instead of the file
 * whose comments explain the field. The package still installs, still imports, still passes every
 * test here; the thing that stops working is the reason `removeComments: false` and
 * `declarationMap` are set at all — that the source is what a reader reaches.
 *
 * It skips when `dist/` is absent, the way `shipped-docblocks.test.ts` and `cli-pipe.test.ts` do.
 * `npm run check` builds immediately before the tests, so that is the bare `npm test` case rather
 * than CI.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const BUILT = existsSync(new URL('dist/index.js', ROOT));

interface SourceMap {
  readonly sources: readonly string[];
  readonly sourcesContent?: readonly string[];
  readonly sourceRoot?: string;
}

/** Every emitted file under `dist/`, as a path relative to it. */
const emitted = (): readonly string[] => {
  const found: string[] = [];
  const walk = (prefix: string): void => {
    for (const entry of readdirSync(new URL(`dist/${prefix}`, ROOT), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${prefix}${entry.name}/`);
      else found.push(`${prefix}${entry.name}`);
    }
  };
  walk('');
  return found;
};

const mapOf = (relative: string): SourceMap => JSON.parse(read(`dist/${relative}`)) as SourceMap;

describe('the build asks for them', () => {
  it('emits both kinds of map', () => {
    const options = (
      JSON.parse(read('config/tsconfig.build.json')) as {
        compilerOptions: Record<string, unknown>;
      }
    ).compilerOptions;
    expect(options.sourceMap).toBe(true);
    expect(options.declarationMap).toBe(true);
  });

  it('ships the TypeScript the maps point at', () => {
    const files = (JSON.parse(read('package.json')) as { files: readonly string[] }).files;
    expect(files).toContain('src');
    // And the tarball check refuses without it, with the reason.
    expect(read('scripts/check-tarball.mjs')).toContain('the sourcemaps resolve to nothing');
  });
});

describe.skipIf(!BUILT)('the maps that were emitted', () => {
  const files = BUILT ? emitted() : [];

  it('accompany every file that runs and every file that types', () => {
    const missing = files
      .filter((name) => name.endsWith('.js') || name.endsWith('.d.ts'))
      .filter((name) => !files.includes(`${name}.map`));
    expect(missing, 'emitted without a sourcemap beside it').toEqual([]);
    expect(files.filter((name) => name.endsWith('.js.map')).length).toBeGreaterThan(40);
  });

  it('point at a file that exists, from where the map sits', () => {
    const dangling: string[] = [];
    for (const name of files.filter((one) => one.endsWith('.map'))) {
      const map = mapOf(name);
      for (const source of map.sources) {
        // Resolved the way a debugger resolves it: relative to the map, through `sourceRoot`.
        const target = new URL(`${map.sourceRoot ?? ''}${source}`, new URL(`dist/${name}`, ROOT));
        if (!existsSync(target)) dangling.push(`${name} -> ${source}`);
      }
    }
    expect(dangling, 'a sourcemap points at a file that is not there').toEqual([]);
  });

  it('point into src/, which is the directory that ships', () => {
    const outside: string[] = [];
    for (const name of files.filter((one) => one.endsWith('.map'))) {
      for (const source of mapOf(name).sources) {
        if (!source.includes('src/')) outside.push(`${name} -> ${source}`);
      }
    }
    expect(outside, 'a sourcemap points somewhere the package does not ship').toEqual([]);
  });

  it('inline no content, which is what makes shipping src/ load-bearing', () => {
    // If the sources were inlined, `src/` in `files` would be redundant — and the day it is
    // dropped for that reason is the day inlining is turned off again.
    const inlined = files
      .filter((one) => one.endsWith('.map'))
      .filter((one) => mapOf(one).sourcesContent !== undefined);
    expect(inlined, 'a map carries its own source, making src/ look removable').toEqual([]);
  });
});
