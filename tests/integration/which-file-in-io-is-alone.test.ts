/**
 * `io/source.ts`'s claim about its own position, read out of the directory it is about.
 *
 * It said "the only file in `io/` that imports an error class". Four of the six do: `bytes.ts`
 * and `http.ts` raise `EdfSourceError` for their own failures, `read.ts` raises `EdfBudgetError`
 * and `EdfRangeError`, and `source.ts` raises `EdfSourceError` for a contract violation. The
 * sentence was a claim about the whole directory, in the file a reader opens to learn how the
 * directory is arranged, and it had been false for as long as `read.ts` has had a budget.
 *
 * What is true is the dependency direction, and it is the half the design rests on: `source.ts`
 * imports nothing from `io/`, and every other file in `io/` imports it. That is what makes the
 * contract check reachable from every adapter rather than from some of them — including from an
 * adapter a caller wrote, which is the property `assertExactRead` exists for (fixed in 0.6.58).
 *
 * Both halves are counted here rather than asserted, so a new adapter that skipped the guard, or
 * a `source.ts` that grew an import from a sibling, fails this.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const IO = new URL('../../src/io/', import.meta.url);

const FILES: readonly string[] = readdirSync(IO)
  .filter((name) => name.endsWith('.ts'))
  .sort();

const sourceOf = (name: string): string => readFileSync(new URL(name, IO), 'utf8');

/** Files whose import statements name `../errors.js`. */
const IMPORT_AN_ERROR_CLASS = FILES.filter((name) =>
  /^import\s[^;]*from '\.\.\/errors\.js';/m.test(sourceOf(name)),
);

/** Files whose import statements name a sibling in `io/`. */
const IMPORT_A_SIBLING = FILES.filter((name) =>
  /^import\s[^;]*from '\.\/[\w-]+\.js';/m.test(sourceOf(name)),
);

describe('the directory the docblock describes', () => {
  it('is found, with more than one file in it', () => {
    expect(FILES).toContain('source.ts');
    expect(FILES.length).toBeGreaterThan(3);
  });

  it('has several files importing an error class, not one', () => {
    expect(IMPORT_AN_ERROR_CLASS).toContain('source.ts');
    expect(IMPORT_AN_ERROR_CLASS.length).toBeGreaterThan(1);
  });

  it('has exactly one file importing no sibling, and it is source.ts', () => {
    expect(FILES.filter((name) => !IMPORT_A_SIBLING.includes(name))).toEqual(['source.ts']);
  });

  it('has every other file importing source.ts specifically', () => {
    const others = FILES.filter((name) => name !== 'source.ts');
    expect(others.filter((name) => !sourceOf(name).includes("from './source.js'"))).toEqual([]);
  });
});

describe('the docblock', () => {
  it('no longer claims to be alone in importing an error class', () => {
    expect(sourceOf('source.ts')).not.toContain(
      'the only file in `io/` that imports an error class. Nothing',
    );
  });

  it('states the direction instead', () => {
    expect(sourceOf('source.ts')).toContain('imports nothing from `io/`');
  });
});
