/**
 * Every field table on `api-types.md` lists the fields the interface actually has.
 *
 * That page is the field-by-field reference — 679 lines of it — and it is where someone goes when
 * they need to know what is on an `EdfHeader` without opening `types.ts`. Six of its tables have
 * one row per member of one interface, and all six are hand-typed copies.
 *
 * Both directions of drift are silent and both are bad in the same way. A member added to
 * `types.ts` and not to the page is a field nobody can discover, which is how `declaredRecordCount`
 * or `recordCountSource` would go unused by every caller who needed exactly that. A row on the page
 * for a member that no longer exists is worse: it reads as an API, the reader writes
 * `header.something`, and the answer is `undefined` rather than an error.
 *
 * `docs-coverage.test.ts` proves every EXPORT is mentioned somewhere. Nothing looked inside a type.
 *
 * The table under `### EdfStartTime, EdfCalendarDate, EdfClockTime` is deliberately not checked:
 * its rows span three interfaces and a field name cannot be attributed to one of them by reading
 * the table. The number of tables skipped for that reason is asserted, so the exemption cannot
 * quietly grow to cover a table that could have been checked.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCS_PAGES } from '../support/docs-pages.js';

const PAGE = DOCS_PAGES.get('api-types.md') ?? '';
const TYPES = readFileSync(new URL('../../src/types.ts', import.meta.url), 'utf8');

/**
 * The member names of `export interface Name`, at the top level of its body.
 *
 * Brace depth is tracked because a member's type can itself be an object literal, and the names
 * inside one are not members of the interface.
 */
function membersOf(name: string): readonly string[] {
  const start = TYPES.indexOf(`export interface ${name} {`);
  if (start === -1) throw new Error(`no interface ${name} in types.ts`);
  const body = TYPES.slice(start + `export interface ${name} {`.length);

  const members: string[] = [];
  let depth = 0;
  for (const line of body.split('\n')) {
    if (depth === 0) {
      const member = /^\s{2}(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*[:(]/.exec(line);
      if (member?.[1] !== undefined) members.push(member[1]);
    }
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (depth < 0) break;
  }
  return members;
}

interface TypeTable {
  readonly heading: string;
  readonly fields: readonly string[];
}

/** Every `| field | type | meaning |` table on the page, with the `###` heading above it. */
const TABLES: readonly TypeTable[] = (() => {
  const lines = PAGE.split('\n');
  const found: TypeTable[] = [];
  let heading = '';
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at] ?? '';
    if (line.startsWith('### ')) heading = line.slice(4).trim();
    if (line !== '| field | type | meaning |') continue;
    const fields: string[] = [];
    // Skip the header row and the `|---|` separator.
    for (let row = at + 2; row < lines.length; row += 1) {
      const cells = lines[row] ?? '';
      if (!cells.startsWith('|')) break;
      const first = (cells.split('|')[1] ?? '').trim();
      fields.push(first.replaceAll('`', ''));
    }
    found.push({ heading, fields });
  }
  return found;
})();

/** A heading naming exactly one interface is one this can check. */
const SINGLE = TABLES.filter((table) => !table.heading.includes(','));
const SPANNING = TABLES.filter((table) => table.heading.includes(','));

describe('the field tables', () => {
  it('found them, so a passing run is not a vacuous one', () => {
    expect(TABLES.length).toBeGreaterThan(0);
    for (const table of TABLES) expect(table.fields.length, table.heading).toBeGreaterThan(0);
  });

  it('skips only the tables that span more than one interface', () => {
    // One today. If a second appears, it is a deliberate decision rather than a silent gap.
    expect(SPANNING.map((table) => table.heading)).toEqual([
      'EdfStartTime, EdfCalendarDate, EdfClockTime',
    ]);
    expect(SINGLE).toHaveLength(TABLES.length - 1);
  });

  for (const table of SINGLE) {
    it(`lists every member of ${table.heading}, and no others`, () => {
      expect(new Set(table.fields)).toEqual(new Set(membersOf(table.heading)));
    });

    it(`lists the members of ${table.heading} in declaration order`, () => {
      // A reference is read top to bottom beside the declaration; a table in a different order
      // is one a reader cannot scan against the source.
      expect(table.fields).toEqual([...membersOf(table.heading)]);
    });
  }
});
