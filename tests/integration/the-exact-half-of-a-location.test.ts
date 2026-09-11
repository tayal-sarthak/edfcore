/**
 * `EdfLocation`'s exact fields, and the table that left them out.
 *
 * `api-types.md` documents `EdfSegment` and `EdfGap` with every `*Seconds` beside its `*Ticks`
 * twin, and the paragraph between those two tables is unambiguous about which to use: "Every
 * second on these two is a float64 conversion of the tick beside it. Compare and sum the ticks."
 *
 * The `EdfLocation` table underneath it then listed three fields of five, and the two it dropped
 * were `recordStartTicks` and `offsetInRecordTicks` — the exact halves the paragraph had just
 * told the reader to prefer, on the one shape `index.locate()` returns. A caller working from
 * that table does their arithmetic in float64 seconds and has no idea the exact values were
 * sitting on the object (fixed in 0.6.53).
 *
 * The fields are read off a real `locate()` result rather than off the type, so the table is
 * checked against the object a caller actually receives.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('api-types.md') ?? '';

/** Four ten-second records, so a location falls inside one with a non-zero offset. */
const FILE = buildEdf({
  recordCount: 4,
  recordDurationSeconds: 10,
  signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
});

async function locate(seconds: number) {
  const recording = await openEdf(byteSource(FILE));
  const location = await recording.index.locate(seconds);
  if (location === undefined) throw new Error(`no location for ${seconds}s`);
  return location;
}

/** The field names of the `| `EdfLocation` | type | meaning |` table, in order. */
const DOCUMENTED: readonly string[] = (() => {
  const at = PAGE.indexOf('| `EdfLocation` | type | meaning |');
  if (at === -1) throw new Error('api-types.md no longer tabulates EdfLocation');
  const names: string[] = [];
  for (const line of PAGE.slice(at).split('\n').slice(2)) {
    const cell = /^\| `(\w+)` \|/.exec(line);
    if (cell?.[1] === undefined) break;
    names.push(cell[1]);
  }
  return names;
})();

describe('the object index.locate() returns', () => {
  it('carries an exact tick beside each of its two seconds', async () => {
    const location = await locate(25);
    expect(typeof location.recordStartTicks).toBe('bigint');
    expect(typeof location.offsetInRecordTicks).toBe('bigint');
  });

  it('is the record and offset those ticks describe', async () => {
    const location = await locate(25);
    expect(location.recordIndex).toBe(2);
    expect(location.recordStartSeconds).toBe(20);
    expect(location.offsetInRecordSeconds).toBe(5);
    // TICKS_PER_SECOND is 10_000_000, and these are the exact values the floats approximate.
    expect(location.recordStartTicks).toBe(200_000_000n);
    expect(location.offsetInRecordTicks).toBe(50_000_000n);
  });
});

describe('the table on api-types.md', () => {
  it('lists every field the returned object has, and no others', async () => {
    const location = await locate(25);
    expect([...DOCUMENTED].sort()).toEqual(Object.keys(location).sort());
  });

  it('does not stop at the float64 half', () => {
    expect(DOCUMENTED).toContain('recordStartTicks');
    expect(DOCUMENTED).toContain('offsetInRecordTicks');
  });
});
