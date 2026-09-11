/**
 * The types docs spell out inline — `` `{ a, b?, c? }` `` — against the interfaces they name.
 *
 * `no-table-drops-a-field.test.ts` does this for the `| `Interface` | Type |` tables. The other
 * way a shape is published is a one-line spelling in prose, and `api-errors.md` had one that was
 * a field short: `EdfFormatErrorInit` was written `{ code, diagnostic?, field?, byteOffset?,
 * signalIndex?, recordIndex?, cause? }`, leaving out `collected` (fixed in 0.6.62).
 *
 * `collected` is the one worth not losing. It carries the diagnostics the parse had already found
 * when one of them turned out to be fatal — often several that have nothing to do with the fatal,
 * and the fatal is frequently the least informative of the set. The same page documents it, two
 * tables above, in the `EdfFormatError` field list. So the page explained the field and then
 * published an initialiser without it, which is exactly the shape a reader copies.
 *
 * The check is generic: any `` `Name` … `{ … }` `` in a docs page, where `Name` is an exported
 * interface, must list that interface's fields exactly.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCS_PAGES } from '../support/docs-pages.js';

const SRC = new URL('../../src/', import.meta.url);

const SOURCE: string = (function read(dir: URL): string {
  let text = '';
  for (const entry of readdirSync(dir)) {
    const path = join(dir.pathname, entry);
    if (statSync(path).isDirectory()) text += read(new URL(`${entry}/`, dir));
    else if (entry.endsWith('.ts')) text += `${readFileSync(path, 'utf8')}\n`;
  }
  return text;
})(SRC);

const INTERFACES: ReadonlyMap<string, readonly string[]> = (() => {
  const found = new Map<string, readonly string[]>();
  for (const match of SOURCE.matchAll(/export interface (\w+)[^{]*\{([\s\S]*?)\n\}/g)) {
    const [, name, body] = match;
    if (name === undefined || body === undefined) continue;
    found.set(
      name,
      [...body.matchAll(/^\s*readonly (\w+)\??:/gm)].map((field) => field[1] ?? ''),
    );
  }
  return found;
})();

interface InlineSpelling {
  readonly page: string;
  readonly interfaceName: string;
  readonly fields: readonly string[];
}

/** `` `EdfFormatErrorInit`: `{ code, diagnostic?, … }` `` — the name, then the braces. */
const SPELLINGS: readonly InlineSpelling[] = [...DOCS_PAGES].flatMap(([page, text]) => {
  const collapsed = text.replace(/\s+/g, ' ');
  const found: InlineSpelling[] = [];
  for (const match of collapsed.matchAll(/`(\w+)`[^`]{0,40}?`\{ ([a-zA-Z?, ]+?) \}`/g)) {
    const [, interfaceName, body] = match;
    if (interfaceName === undefined || body === undefined) continue;
    if (!INTERFACES.has(interfaceName)) continue;
    found.push({
      page,
      interfaceName,
      fields: body
        .split(',')
        .map((field) => field.trim().replace('?', ''))
        .filter((field) => field.length > 0),
    });
  }
  return found;
});

describe('the inline type spellings', () => {
  it('are found, so an empty sweep cannot pass as agreement', () => {
    expect(SPELLINGS.length).toBeGreaterThan(0);
    expect(SPELLINGS.map((spelling) => spelling.interfaceName)).toContain('EdfFormatErrorInit');
  });
});

describe.each(SPELLINGS)('$page: $interfaceName', ({ interfaceName, fields }) => {
  const declared = INTERFACES.get(interfaceName) ?? [];

  it('lists every field the interface declares', () => {
    expect([...declared].filter((field) => !fields.includes(field))).toEqual([]);
  });

  it('lists them in declaration order, so the spelling reads as the type', () => {
    expect(fields).toEqual([...declared]);
  });
});
