/**
 * `edfcore/node` imports one Node built-in, and the README names it.
 *
 * "Zero runtime dependencies, permanently. `edfcore/node` imports `node:fs/promises` and nothing
 * else." That is a promise about the surface a consumer has to think about: every built-in in the
 * graph is something a bundler has to shim, a serverless runtime has to provide, and an Electron
 * or Deno target has to allow. One is a footnote; three is a compatibility matrix.
 *
 * The neighbouring claims are checked and this one was not. `public-api.test.ts` walks the graph
 * from the universal entry and proves nothing there reaches `node:` at all; `readme-status.test.ts`
 * proves exactly two modules in `src/` import a built-in, `node.ts` and `cli.ts`. Neither says
 * WHICH built-ins, so adding `node:path` to the Node adapters would have left both green and the
 * README wrong.
 *
 * The expectation is read from the README rather than written here, so the sentence and the
 * import are one fact. `cli.ts` is pinned too — it is the `bin`, outside the exports map and
 * outside that sentence, and its two built-ins are worth being deliberate about for the same
 * reason.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

/**
 * Every `node:` specifier a module imports.
 *
 * Comments are stripped and string literals are NOT, which is the opposite of what the two bans
 * in 0.4.275 and 0.4.277 need — an import specifier IS a string literal, so `codeOnly` would
 * remove the very thing being counted, and the first version of this file did exactly that and
 * reported every module as importing nothing. The regex is anchored to an import statement
 * instead, so a built-in named inside a diagnostic message is not mistaken for a dependency.
 */
function builtinsOf(relative: string): readonly string[] {
  const withoutComments = read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return [
    ...new Set(
      [...withoutComments.matchAll(/^import\s[^;]*?from '(node:[\w/]+)'/gm)].map(
        (match) => match[1] as string,
      ),
    ),
  ].sort();
}

/** The one the README names, taken from the README. */
const CLAIMED = /`edfcore\/node` imports `(node:[\w/]+)` and nothing\s+else/.exec(
  read('README.md'),
);

describe("the README's claim about the Node subpath", () => {
  it('is present and parses, so a passing run is not a vacuous one', () => {
    expect(
      CLAIMED,
      'no "edfcore/node imports `node:…` and nothing else" in README.md',
    ).not.toBeNull();
    expect(CLAIMED?.[1]).toMatch(/^node:/);
  });

  it('names the only built-in src/node.ts imports', () => {
    expect(builtinsOf('src/node.ts')).toEqual([CLAIMED?.[1]]);
  });
});

describe('the bin, which that sentence does not cover', () => {
  it('imports the two it needs and no more', () => {
    // `cli.ts` is the `bin` target, reachable through no import path — `readme-status.test.ts`
    // pins that separately. It reads a file and it exits with a code, hence exactly these.
    expect(builtinsOf('src/cli.ts')).toEqual(['node:fs/promises', 'node:process']);
  });
});

describe('and nowhere else in the package', () => {
  it('leaves every other module free of built-ins', () => {
    // The invariant `public-api.test.ts` proves by walking the graph, asserted here per file so a
    // module unreachable from the universal entry cannot pick one up unnoticed either.
    const offenders: string[] = [];
    const walk = (dir: URL, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const name = `${prefix}${entry.name}`;
        if (entry.isDirectory()) {
          walk(new URL(`${entry.name}/`, dir), `${name}/`);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        if (name === 'node.ts' || name === 'cli.ts') continue;
        if (builtinsOf(`src/${name}`).length > 0) offenders.push(name);
      }
    };
    walk(new URL('src/', ROOT), '');
    expect(offenders, 'modules importing a Node built-in').toEqual([]);
  });
});
