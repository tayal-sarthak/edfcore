/**
 * The rule the matrix states about itself, enforced.
 *
 * `awkward-files.ts` ends its docblock with an instruction to everything that reads it: "Anything
 * using this list should assert `AWKWARD.length` rather than trusting it, so a shape removed from
 * here fails the test that was relying on it." Eighteen files import the matrix. Seven followed the
 * rule and eleven did not, which is the ordinary fate of a convention written down in one file and
 * relied on in eighteen.
 *
 * The failure it prevents is quiet by construction. Almost every consumer is a `for (const file of
 * AWKWARD)` loop generating one `it` per shape, so deleting a shape does not fail anything — it
 * removes cases. The suite goes green with less in it, the count in the terminal drops by a number
 * nobody has memorised, and the coverage a file was written to have is gone with no evidence
 * anywhere that it ever existed.
 *
 * That is also why the assertion has to live in each consumer rather than once here. A single
 * check that the matrix has eleven entries would keep the number honest and say nothing about
 * whether the file that needed a BDF shape still gets one. Each consumer states the size it was
 * written against, so changing the matrix is a change every dependent file has to be looked at for.
 *
 * The consumers are found by their import, so a nineteenth fails this file until it says the same.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AWKWARD } from '../support/awkward-files.js';

const TESTS = new URL('../', import.meta.url);

/** Every test file that imports the matrix, with its text. */
function consumers(): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  const walk = (directory: URL, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // `scratch/` is gitignored probe code and is not part of the suite.
        if (entry.name === 'scratch' || entry.name === 'support') continue;
        walk(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      const text = readFileSync(new URL(entry.name, directory), 'utf8');
      if (text.includes('support/awkward-files.js')) found.set(`${prefix}${entry.name}`, text);
    }
  };
  walk(TESTS, '');
  return found;
}

const CONSUMERS = consumers();

describe('the matrix is used widely enough for the rule to matter', () => {
  it('is imported by more than a dozen files', () => {
    expect(CONSUMERS.size).toBeGreaterThan(12);
  });

  it('has a shape for each thing it claims to cover, with no name used twice', () => {
    expect(AWKWARD).toHaveLength(16);
    expect(new Set(AWKWARD.map((file) => file.name)).size).toBe(AWKWARD.length);
    // Every entry says what it breaks. An entry without that is a file nobody can reason about.
    expect(AWKWARD.filter((file) => file.awkward.length < 20)).toEqual([]);
  });
});

describe('and every file that uses it says how big it was when they were written', () => {
  for (const [name, text] of CONSUMERS) {
    it(`${name} asserts the matrix size`, () => {
      const asserts =
        /AWKWARD\)\.toHaveLength\(\s*\d+\s*\)/.test(text) || text.includes('AWKWARD.length');
      expect(asserts, `${name} reads AWKWARD without pinning how many shapes it had`).toBe(true);
    });
  }
});

describe('the count each of them states is the count there is', () => {
  it('finds no file pinned to a size the matrix no longer has', () => {
    const wrong: string[] = [];
    for (const [name, text] of CONSUMERS) {
      for (const match of text.matchAll(/AWKWARD\)\.toHaveLength\(\s*(\d+)\s*\)/g)) {
        if (Number(match[1]) !== AWKWARD.length) wrong.push(`${name} -> ${match[1]}`);
      }
    }
    // This is what turns "add a shape" into a change the author has to walk through the suite for,
    // which is the whole intent of the rule.
    expect(wrong).toEqual([]);
  });
});
