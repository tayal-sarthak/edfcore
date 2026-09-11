/**
 * `reading-signals.md`'s `EdfChunkSignal` table, checked against a chunk.
 *
 * The table listed six of the shape's seven fields. The one it dropped was `startTicks`, and
 * `startTicks` is the field the rest of the package tells a caller to use: `trimToWindow`
 * measures its window from it, `readWindow` puts every chunk on the same tick axis, and
 * `api-types.md` spends a paragraph on why the seconds beside it can be a sub-tick out after a
 * trim. The guide a reader follows to get their first chunk showed them the float64 half only,
 * and said nothing about the exact one existing (fixed in 0.6.54).
 *
 * `the-exact-half-of-a-location.test.ts` is the same property for `EdfLocation`, fixed one
 * version earlier. This one compares against a chunk a read actually returned, so the table
 * is held to the object rather than to the type.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('reading-signals.md') ?? '';

const FILE = buildEdf({
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

async function firstChunkSignal() {
  const recording = await openEdf(byteSource(FILE));
  const chunk = await readRecords(recording, {
    records: { start: 1, count: 2 },
    signalIndices: [0],
  });
  const [series] = chunk.signals;
  if (series === undefined) throw new Error('no signal in that chunk');
  return series;
}

/** The first column of the `| field | meaning |` table under "is an `EdfChunkSignal`". */
const DOCUMENTED: readonly string[] = (() => {
  const at = PAGE.indexOf('Each entry of `chunk.signals` is an `EdfChunkSignal`:');
  if (at === -1) throw new Error('reading-signals.md no longer introduces EdfChunkSignal');
  const names: string[] = [];
  let started = false;
  for (const line of PAGE.slice(at).split('\n')) {
    const cell = /^\| `(\w+)` \|/.exec(line);
    if (cell?.[1] !== undefined) {
      started = true;
      names.push(cell[1]);
    } else if (started) break;
  }
  return names;
})();

describe('the object a read hands back', () => {
  it('carries an exact tick beside its seconds', async () => {
    const series = await firstChunkSignal();
    expect(typeof series.startTicks).toBe('bigint');
    expect(series.startSeconds).toBe(1);
    expect(series.startTicks).toBe(10_000_000n);
  });
});

describe('the table in the reading guide', () => {
  it('lists every field that object has, and no others', async () => {
    const series = await firstChunkSignal();
    expect([...DOCUMENTED].sort()).toEqual(Object.keys(series).sort());
  });

  it('does not stop at the float64 half', () => {
    expect(DOCUMENTED).toContain('startSeconds');
    expect(DOCUMENTED).toContain('startTicks');
  });
});
