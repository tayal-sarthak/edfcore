/**
 * Every signature the reference pages print is the signature the package exports.
 *
 * Four pages open each function with a `ts` fence holding its declaration and nothing else —
 * thirty-odd of them across `api-primitives`, `api-reading`, `api-sources` and `api-validate`.
 * They are the first thing a reader sees for a function and the thing they write their call
 * against, and every one is hand-typed.
 *
 * `doc-snippets-compile.test.ts` compiles the fences that are complete PROGRAMS, and skips these:
 * a bare declaration imports nothing, so it never matched the filter that finds runnable examples.
 * So the most load-bearing line on each reference page was also the one nothing compiled.
 *
 * Assignability is checked in BOTH directions, which is the difference between "the documented
 * shape is usable" and "the documented shape is the real one". One direction alone accepts a page
 * that widens a parameter or narrows a return: `(x: string | number) => unknown` accepts every
 * call the real function does, and describes a function that does not exist.
 *
 * A signature is checked when its name is an actual export. Example functions defined inside a
 * snippet — `function resolve(header, label)` on `api-primitives` — are not API and are skipped by
 * that rule rather than by a list.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as edfcore from '../../src/index.js';
import * as edfcoreNode from '../../src/node.js';
import * as edfcoreValidate from '../../src/validate.js';
import { exportedTypes } from '../support/barrel-types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Which entry point each name comes from, so the generated file imports it from the right one.
 *
 * Types as well as values. A declaration fence names types with no import of its own — it is one
 * line on a page — so the generated file has to supply them, and `FileHandleLike` lives only in
 * `node.ts` while `AnyEdfError` and `CacheOptions` live only in the universal barrel. The first
 * version of this hard-coded a list of type names to qualify and missed four of them, which is the
 * failure `barrel-types.ts` was extracted to stop repeating.
 */
const ENTRY_SOURCES = [
  ['src/index.js', 'src/index.ts', edfcore],
  ['src/node.js', 'src/node.ts', edfcoreNode],
  ['src/validate.js', 'src/validate.ts', edfcoreValidate],
] as const;

const ENTRY: ReadonlyMap<string, string> = new Map(
  ENTRY_SOURCES.flatMap(([specifier, , namespace]) =>
    Object.keys(namespace).map((name) => [name, specifier] as const),
  ),
);

/** Every public TYPE name, with the entry point that exports it. */
const TYPE_ENTRY: ReadonlyMap<string, string> = new Map(
  ENTRY_SOURCES.flatMap(([specifier, file]) =>
    [...exportedTypes(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'))].map(
      (name) => [name, specifier] as const,
    ),
  ),
);

interface Documented {
  readonly page: string;
  readonly name: string;
  /** The declaration as written, minus the `function` keyword's name. */
  readonly signature: string;
}

/**
 * Every declaration-only `ts` fence on a reference page.
 *
 * Per fence rather than by scanning the page, which the first version did and got wrong: a lazy
 * match for the closing paren of the parameter list runs straight past it into the prose below,
 * because `Promise<{ timeline: … }>` contains no `):` to stop at and the next parenthetical
 * sentence does. A fence holding one declaration has an unambiguous end, so that is the unit.
 *
 * A fence is a declaration when it opens with `function` and has no body — no `}` at column zero.
 * That distinguishes `api-primitives`'s example `function resolve(header, label): EdfSignal { … }`
 * from the declarations around it without a list of exceptions.
 */
const DOCUMENTED: readonly Documented[] = [...DOCS_PAGES]
  .flatMap(([page, text]) =>
    [...text.matchAll(/```ts\n([\s\S]*?)```/g)].flatMap(([, fence = '']) => {
      const body = fence.trim();
      if (!body.startsWith('function ') || /\n\}/.test(body)) return [];
      const declaration = /^function ([a-zA-Z][\w]*)\s*(\([\s\S]*\))\s*:\s*([\s\S]+)$/.exec(body);
      if (declaration === null) return [];
      return [
        {
          page,
          name: declaration[1] ?? '',
          signature: `${declaration[2] ?? ''}: ${(declaration[3] ?? '').trim()}`,
        },
      ];
    }),
  )
  .filter((entry) => ENTRY.has(entry.name));

/** `import type { … } from '…'` lines for every public type the signature mentions. */
function typeImportsFor(signature: string): readonly string[] {
  const byEntry = new Map<string, Set<string>>();
  for (const [, word = ''] of signature.matchAll(/\b([A-Z][\w]*)\b/g)) {
    const specifier = TYPE_ENTRY.get(word);
    if (specifier === undefined) continue;
    const names = byEntry.get(specifier) ?? new Set<string>();
    names.add(word);
    byEntry.set(specifier, names);
  }
  return [...byEntry].map(
    ([specifier, names]) =>
      `import type { ${[...names].sort().join(', ')} } from '${join(ROOT, specifier)}';`,
  );
}

/** One file per signature, compiled together, so a failure names the function. */
function compile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'edfcore-signatures-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');

  for (const [at, entry] of DOCUMENTED.entries()) {
    const from = join(ROOT, ENTRY.get(entry.name) ?? 'src/index.js');
    writeFileSync(
      join(dir, `${entry.name}-${at}.ts`),
      [
        `import { ${entry.name} } from '${from}';`,
        ...typeImportsFor(entry.signature),
        '',
        `// ${entry.page}`,
        `declare function documented${entry.signature};`,
        '',
        '// Both directions: one alone accepts a page that widens a parameter or narrows a return.',
        `const forward: typeof documented = ${entry.name};`,
        `const backward: typeof ${entry.name} = documented;`,
        'void forward;',
        'void backward;',
      ].join('\n'),
    );
  }

  try {
    execFileSync(
      'npx',
      [
        'tsc',
        '--noEmit',
        '--strict',
        '--exactOptionalPropertyTypes',
        '--target',
        'es2022',
        '--module',
        'node18',
        '--moduleResolution',
        'node16',
        '--lib',
        'ES2022,DOM,DOM.Iterable',
        '--types',
        'node',
        '--skipLibCheck',
        ...DOCUMENTED.map((entry, at) => join(dir, `${entry.name}-${at}.ts`)),
      ],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return '';
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }
}

describe('the printed signatures', () => {
  it('found a substantial number of them across the reference pages', () => {
    // Thirty-odd today. A collapse to a handful means the extraction stopped matching, which
    // would leave this passing while checking almost nothing.
    expect(DOCUMENTED.length).toBeGreaterThan(20);
    expect(new Set(DOCUMENTED.map((entry) => entry.page)).size).toBeGreaterThan(2);
  });

  it('names only functions the package actually exports', () => {
    for (const entry of DOCUMENTED) {
      expect(ENTRY.has(entry.name), `${entry.page}: ${entry.name}`).toBe(true);
    }
  });

  it('are assignable to and from the real ones', () => {
    const output = compile();
    expect(output, output).toBe('');
  });
});
