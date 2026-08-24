/**
 * `/api.json` and the README's table show the same number, and one reason they do.
 *
 * The endpoint imports the three published entry points at build time and sums their runtime
 * exports; `api-surface.test.ts` counts the same thing from the barrels and asserts the README's
 * table. Two counters, one number, and the README links the first from under the second.
 *
 * They agree today for a reason nothing states: the three entry points export no runtime name in
 * common, so a SUM is the same as a union. `edfcore/node` exports two adapters and
 * `edfcore/validate` three functions, and neither re-exports anything from the universal barrel.
 *
 * That is a real invariant with a plausible way to break. Re-exporting `openEdf` from
 * `edfcore/node` so a Node consumer needs one import is an obvious convenience, and it would make
 * the endpoint count it twice — `/api.json` reading 79 under a table reading 78, on the page a
 * reader is looking at to decide whether to install the package. Neither number would be wrong
 * about what it measures, which is what makes the disagreement hard to explain and easy to ship.
 *
 * A shields.io badge at the top of the README read `$.exports.total` from that endpoint until
 * 0.4.478, and a badge-contract test checked that the JSONPath still resolved. The badge is gone;
 * the path is still what the endpoint publishes and what the site's own readers walk, so that
 * check moved here rather than leaving with it.
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

describe('the endpoint and the table', () => {
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

  it('publish that number at the path the endpoint documents', () => {
    // `exports.total`, walked through the body `api.json.ts` builds, rebuilt here from the same
    // three modules. Renaming the field or nesting it a level deeper leaves every reader of the
    // endpoint asking for a path that no longer exists, and JSON has no way to say so.
    const entries = {
      edfcore: Object.keys(universal).length,
      'edfcore/node': Object.keys(nodeEntry).length,
      'edfcore/validate': Object.keys(validateEntry).length,
    };
    const body: Record<string, unknown> = {
      version: universal.VERSION,
      entryPoints: Object.keys(entries).length,
      exports: { ...entries, total: Object.values(entries).reduce((sum, one) => sum + one, 0) },
    };

    const exports = body.exports as Record<string, unknown>;
    expect(exports.total).toBe(PUBLISHED);
    // Read as text rather than imported: this file lives under `website/`, and importing it would
    // pull in a tsconfig the CI check does not install (0.4.264).
    for (const fragment of ['exports', 'total:', 'Object.keys(universal).length']) {
      expect(ENDPOINT, `api.json.ts no longer mentions ${fragment}`).toContain(fragment);
    }
  });

  it('no longer carry a badge, which is what the README says', () => {
    // Removed at the user's request in 0.4.478. Asserted so it cannot drift back in beside a
    // table that already states the same number one line below it.
    expect(README).not.toContain('img.shields.io/badge/dynamic/json');
    expect(README).not.toContain('query=%24.exports.total');
  });
});
