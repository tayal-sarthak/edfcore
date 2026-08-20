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
import {
  EDF_HEADER_BLOCK_BYTES,
  HEADER_FIELDS,
  SIGNAL_FIELD_BLOCK_OFFSETS,
  SIGNAL_FIELD_WIDTHS,
} from '../../src/constants.js';
import { signalFieldOffset } from '../../src/header/signals.js';
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

describe('the per-signal address table', () => {
  const rows = tableUnder('## The per-signal header is field-major');

  /** `` `256 + ns*96 + i*8` `` as the three numbers in it. */
  function address(cell: string): { base: number; perSignalCount: number; perIndex: number } {
    const match = /^`(\d+) \+ ns\*(\d+) \+ i\*(\d+)`$/.exec(cell);
    if (match === null) throw new Error(`unreadable address cell ${JSON.stringify(cell)}`);
    return {
      base: Number(match[1]),
      perSignalCount: Number(match[2]),
      perIndex: Number(match[3]),
    };
  }

  it('lists every per-signal field, in the order the bytes run', () => {
    expect(rows).toHaveLength(Object.keys(SIGNAL_FIELD_WIDTHS).length);
    const published = rows.map((cells) => address(cells[2] ?? '').perSignalCount);
    expect(published).toEqual(Object.values(SIGNAL_FIELD_BLOCK_OFFSETS));
  });

  it('gives each field the width the parser reads, in both columns', () => {
    const widths = Object.values(SIGNAL_FIELD_WIDTHS);
    expect(rows.map((cells) => Number(cells[1]))).toEqual(widths);
    // The same width again inside the address, where it multiplies the signal index.
    expect(rows.map((cells) => address(cells[2] ?? '').perIndex)).toEqual(widths);
  });

  it('starts every address at the end of the first 256-byte block', () => {
    for (const cells of rows) expect(address(cells[2] ?? '').base).toBe(EDF_HEADER_BLOCK_BYTES);
  });

  it('makes each ns multiplier the sum of the widths before it, as the page says', () => {
    // "The multiplier on `ns` in each row is the sum of the widths of every field before it."
    let before = 0;
    for (const cells of rows) {
      expect(address(cells[2] ?? '').perSignalCount).toBe(before);
      before += Number(cells[1]);
    }
    // "The widths sum to 256, which is why the per-signal section is `ns * 256` bytes."
    expect(before).toBe(EDF_HEADER_BLOCK_BYTES);
  });

  it('resolves to the address the parser actually reads', () => {
    // ns = 1 is the case the page warns about: there the field-major and struct-per-signal
    // layouts are identical, so it is the one signal count that cannot tell them apart.
    for (const signalCount of [1, 2, 30]) {
      for (let index = 0; index < signalCount; index += 1) {
        const names = Object.keys(SIGNAL_FIELD_WIDTHS) as (keyof typeof SIGNAL_FIELD_WIDTHS)[];
        names.forEach((field, row) => {
          const { base, perSignalCount, perIndex } = address(rows[row]?.[2] ?? '');
          expect(base + signalCount * perSignalCount + index * perIndex).toBe(
            signalFieldOffset(field, signalCount, index),
          );
        });
      }
    }
  });
});
