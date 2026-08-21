/**
 * The badge on the README and the table beneath it show the same number, and one reason they do.
 *
 * `/api.json` exists so the badge is counted rather than typed — the endpoint imports the three
 * published entry points at build time and sums their runtime exports. `api-surface.test.ts`
 * counts the same thing from the barrels and asserts the README's table. Two counters, one number,
 * printed a screen apart on the same page.
 *
 * They agree today for a reason nothing states: the three entry points export no runtime name in
 * common, so a SUM is the same as a union. `edfcore/node` exports two adapters and `edfcore/validate`
 * three functions, and neither re-exports anything from the universal barrel.
 *
 * That is a real invariant with a plausible way to break. Re-exporting `openEdf` from
 * `edfcore/node` so a Node consumer needs one import is an obvious convenience, and it would make
 * the badge count it twice — a badge reading 79 above a table reading 78, on a page a reader is
 * looking at to decide whether to install the package. Neither number would be wrong about what it
 * measures, which is what makes the disagreement hard to explain and easy to ship.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as universal from '../../src/index.js';
import * as nodeEntry from '../../src/node.js';
import * as validateEntry from '../../src/validate.js';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const README = read('README.md');
const ENDPOINT = read('website/src/pages/api.json.ts');

const ENTRIES = {
  edfcore: Object.keys(universal),
  'edfcore/node': Object.keys(nodeEntry),
  'edfcore/validate': Object.keys(validateEntry),
} as const;

/** `| Functions, classes and constants | 78 |` */
const PUBLISHED = Number(
  /\| Functions, classes and constants \| (\d+) \|/.exec(README)?.[1] ?? Number.NaN,
);

describe('the three entry points', () => {
  it('export no runtime name in common', () => {
    const seen = new Map<string, string>();
    const shared: string[] = [];
    for (const [entry, names] of Object.entries(ENTRIES)) {
      for (const name of names) {
        const first = seen.get(name);
        if (first !== undefined) shared.push(`${name}: ${first} and ${entry}`);
        else seen.set(name, entry);
      }
    }
    expect(shared).toEqual([]);
  });

  it('each carry something, so the disjointness is not vacuous', () => {
    for (const [entry, names] of Object.entries(ENTRIES)) {
      expect(names.length, entry).toBeGreaterThan(0);
    }
  });
});

describe('the badge and the table', () => {
  it('are backed by an endpoint that counts rather than restates', () => {
    // The failure the endpoint's own docblock cites: "the site footer that said 'Version 0.1.0'
    // through three minor series".
    expect(ENDPOINT).toContain('Object.keys(universal).length');
    expect(ENDPOINT).toContain('reduce((sum, count) => sum + count, 0)');
  });

  it('sum to the number the README table publishes', () => {
    expect(Number.isInteger(PUBLISHED)).toBe(true);
    const total = Object.values(ENTRIES).reduce((sum, names) => sum + names.length, 0);
    expect(total).toBe(PUBLISHED);
  });

  it('sum to the same number counted as a union, which is what disjointness buys', () => {
    // If an entry point ever re-exported a name from another, the badge would count it twice and
    // the two numbers on the page would part company.
    const union = new Set(Object.values(ENTRIES).flat());
    const sum = Object.values(ENTRIES).reduce((total, names) => total + names.length, 0);
    expect(union.size).toBe(sum);
    expect(union.size).toBe(PUBLISHED);
  });

  it('is what the badge URL actually asks the endpoint for', () => {
    // `query=%24.exports.total` in the shields.io URL at the top of the README.
    expect(README).toContain('query=%24.exports.total');
    expect(ENDPOINT).toContain('total:');
  });
});
