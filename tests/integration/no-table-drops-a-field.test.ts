/**
 * Every `| `SomeInterface` | Type | …` table on the site, against the interface it names.
 *
 * Three of these went stale one at a time, and each was found by reading rather than by a test:
 * `EdfLocation` lost its two `*Ticks` (0.6.53), `EdfChunkSignal` lost `startTicks` (0.6.54), and
 * `FormatDiagnosticsOptions` never listed `redactFields` at all — the one option in the package
 * whose silent absence sends a patient's name to an issue tracker (0.6.55).
 *
 * A field is added to an interface in `src/`, the compiler is happy, every test passes, and the
 * reference table on the site is now a list of what the shape used to hold. Nothing else here
 * notices: the type is checked by `tsc`, the runtime shape by whatever test builds one, and the
 * PAGE by a human comparing two files. So this compares the two mechanically, for every table
 * that names an interface.
 *
 * What it does NOT check: prose. `EdfTriggerEvent` and `EdfDiagnosticSummary` pair fields on one
 * row — `` | `seconds`, `ticks` | `` — which is a good table and is handled; a field described
 * only in a paragraph is not, and should get a row.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCS_PAGES } from '../support/docs-pages.js';

const SRC = new URL('../../src/', import.meta.url);

/** Every `.ts` under `src/`, concatenated — interfaces are matched by name, not by file. */
const SOURCE: string = (function read(dir: URL): string {
  let text = '';
  for (const entry of readdirSync(dir)) {
    const path = join(dir.pathname, entry);
    if (statSync(path).isDirectory()) text += read(new URL(`${entry}/`, dir));
    else if (entry.endsWith('.ts')) text += `${readFileSync(path, 'utf8')}\n`;
  }
  return text;
})(SRC);

/** `interface Name { … }` -> its `readonly` field names, in declaration order. */
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

interface DocumentedTable {
  readonly page: string;
  readonly interfaceName: string;
  readonly fields: readonly string[];
}

/** Every table whose header row's first cell is a backticked interface name. */
const TABLES: readonly DocumentedTable[] = [...DOCS_PAGES].flatMap(([page, text]) => {
  const tables: DocumentedTable[] = [];
  for (const match of text.matchAll(
    /^\| `(\w+)` \| [Tt]ype \| [^\n]*\n\|[-| ]+\|\n((?:\|[^\n]*\n)+)/gm,
  )) {
    const [, interfaceName, rows] = match;
    if (interfaceName === undefined || rows === undefined) continue;
    if (!INTERFACES.has(interfaceName)) continue;
    // A row may name more than one field: `| `seconds`, `ticks` | `number`, `bigint` | … |`
    const fields = [...rows.matchAll(/^\| ((?:`\w+`(?:, )?)+) \|/gm)].flatMap((row) =>
      [...(row[1] ?? '').matchAll(/`(\w+)`/g)].map((cell) => cell[1] ?? ''),
    );
    tables.push({ page, interfaceName, fields });
  }
  return tables;
});

describe('the tables that name an interface', () => {
  it('are found at all, so an empty sweep cannot pass as agreement', () => {
    expect(TABLES.length).toBeGreaterThan(10);
    expect(new Set(TABLES.map((table) => table.page)).size).toBeGreaterThan(3);
  });

  it('includes the three that went stale, so this covers the cases it was written for', () => {
    const named = TABLES.map((table) => table.interfaceName);
    expect(named).toContain('EdfLocation');
    expect(named).toContain('FormatDiagnosticsOptions');
  });
});

describe.each(TABLES)('$page: $interfaceName', ({ interfaceName, fields }) => {
  const declared = INTERFACES.get(interfaceName) ?? [];

  it('lists every field the interface declares', () => {
    expect([...declared].filter((field) => !fields.includes(field))).toEqual([]);
  });

  it('lists nothing the interface does not declare', () => {
    expect([...fields].filter((field) => !declared.includes(field))).toEqual([]);
  });
});
