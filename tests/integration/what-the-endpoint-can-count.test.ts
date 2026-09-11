/**
 * `/api.json` against the README's API-surface table, which said it served "the same counts".
 *
 * The table has five rows. The endpoint has two of them: the entry-point count and the total
 * number of runtime exports. It cannot have the other three, and its own docblock says why —
 * "Runtime exports only. Types are erased before this file can see them, and counting them would
 * mean parsing source that is not this project's to parse from here." The diagnostic codes and
 * the CLI commands are the same problem: `api-surface.test.ts` gets them by reading source, which
 * is not something a build-time endpoint importing `dist` can do (fixed in 0.6.69).
 *
 * A reader who took "the same counts" at its word went looking for a machine-readable public-type
 * count and found a document that does not mention types.
 *
 * The endpoint is read rather than imported. It imports `edfcore` by package name, which resolves
 * through `website/node_modules` — a directory CI does not install for this suite, and the reason
 * `browser-floor.test.ts` warns about reaching into it.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const README = read('README.md');
const ENDPOINT = read('website/src/pages/api.json.ts');

/** The `| label | value |` rows of the API-surface table, stopping where the table does. */
const ROWS: ReadonlyArray<readonly [string, string]> = (() => {
  const lines = README.slice(README.indexOf('## API surface')).split('\n');
  const rows: Array<readonly [string, string]> = [];
  let started = false;
  for (const line of lines) {
    const cells = /^\| ([A-Z][^|]*?) \| ([^|]+?) \|$/.exec(line);
    if (cells?.[1] !== undefined && cells[2] !== undefined) {
      started = true;
      rows.push([cells[1], cells[2]]);
    } else if (started && !line.startsWith('|')) break;
  }
  return rows;
})();

/** The keys the endpoint's `body` literal puts in the response. */
const SERVED_KEYS: readonly string[] = (() => {
  const open = ENDPOINT.indexOf('const body = {');
  const close = ENDPOINT.indexOf('\n  };', open);
  return [...ENDPOINT.slice(open, close).matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1] ?? '');
})();

describe('the table the sentence is about', () => {
  it('is the five rows the sentence now distinguishes between', () => {
    expect(ROWS.map(([label]) => label)).toEqual([
      'Entry points',
      'Functions, classes and constants',
      'Public types',
      'Diagnostic codes',
      'CLI commands',
    ]);
  });
});

describe('the document the endpoint builds', () => {
  it('has the two keys that answer the first two rows', () => {
    expect(SERVED_KEYS).toEqual(['version', 'entryPoints', 'exports']);
  });

  it('names nothing that could answer the other three', () => {
    const body = ENDPOINT.slice(ENDPOINT.indexOf('const body = {')).toLowerCase();
    for (const word of ['type', 'diagnostic', 'command']) {
      expect(body, `api.json would serve a ${word} count`).not.toContain(`${word}s:`);
    }
  });

  it('says itself that it cannot count the rest', () => {
    expect(ENDPOINT.replace(/\s*\n\s*\*\s?/g, ' ')).toContain('Runtime exports only');
  });
});

describe('the README', () => {
  it('no longer says the endpoint serves the same counts', () => {
    expect(README.replace(/\s+/g, ' ')).not.toContain('The same counts are served at');
  });

  it('says which rows it does serve, and why the rest cannot be there', () => {
    const collapsed = README.replace(/\s+/g, ' ');
    expect(collapsed).toContain('The first two rows are also served at');
    expect(collapsed).toContain('types are erased before that endpoint can see them');
  });
});
