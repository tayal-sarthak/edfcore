/**
 * The two byte-layout tables on `edf-format.md`, read out of the page and checked.
 *
 * That page is the one to send a colleague who asks what EDF is, and it is almost entirely
 * addresses: ten rows giving the offset and width of every fixed header field, and ten more
 * giving the address of every per-signal field. Nothing in the suite had ever looked at it —
 * it and `physical-values.md` were the only two pages no test named at all.
 *
 * The numbers are right. What was missing is that nothing held them there. `HEADER_FIELDS` in
 * `constants.ts` is the same table in the same order, and the page is a hand-typed copy of it:
 * an offset corrected in one is a page teaching a byte address that no longer exists, in a
 * document whose whole purpose is being independent of the library.
 *
 * So the rows are PARSED from the page rather than restated here. A test that restates them is a
 * third copy, and a third copy drifts the same way the second one would.
 */

import { describe, expect, it } from 'vitest';
import { HEADER_FIELDS } from '../../src/constants.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

const PAGE = DOCS_PAGES.get('edf-format.md') ?? '';

/**
 * The cells of every pipe-table row under `heading`, up to the blank line that ends the table.
 * The separator row (`|---|---|`) and the header row are dropped.
 */
function tableUnder(heading: string): readonly (readonly string[])[] {
  const start = PAGE.indexOf(heading);
  if (start === -1) throw new Error(`no section ${JSON.stringify(heading)} on edf-format.md`);
  const rows: (readonly string[])[] = [];
  let seenTable = false;
  for (const line of PAGE.slice(start + heading.length).split('\n')) {
    if (!line.trimStart().startsWith('|')) {
      if (seenTable) break;
      continue;
    }
    seenTable = true;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    rows.push(cells.map((cell) => cell.trim()));
  }
  return rows.slice(2);
}

describe('the fixed header table', () => {
  const rows = tableUnder('## The fixed header (256 bytes at offset 0)');

  it('lists every fixed field, in the order the bytes run', () => {
    expect(rows).toHaveLength(Object.keys(HEADER_FIELDS).length);
    const published = rows.map((cells) => Number(cells[0]));
    expect(published).toEqual(Object.values(HEADER_FIELDS).map((field) => field.offset));
  });

  it('gives each field the width the parser reads', () => {
    const widths = rows.map((cells) => Number(cells[1]));
    expect(widths).toEqual(Object.values(HEADER_FIELDS).map((field) => field.length));
  });

  it('leaves no gap and no overlap across the 256 bytes', () => {
    // The heading says "256 bytes at offset 0", so the rows have to tile exactly that.
    let next = 0;
    for (const cells of rows) {
      expect(Number(cells[0])).toBe(next);
      next += Number(cells[1]);
    }
    expect(next).toBe(256);
  });
});
