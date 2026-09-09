/**
 * `cachedSource` is the only cache of file BYTES, and four places dropped the qualifier.
 *
 * `src/io/cached.ts` said it twice, `api-sources.md` said it in bold, and `data-sources.md` said it
 * flat: "the only cache in edfcore". `large-files.md` has always been careful — "the only cache of
 * file bytes", with a Note beside it naming the record index's onset memo and calling the two
 * together "the only two forms of memory in the library" — so the site disagreed with itself, and
 * the unqualified version was the one on the page about sources, where a reader building a source
 * expression is deciding what to keep.
 *
 * The memo is not a detail. `record-index.ts` says it in its own docblock: `onsetTicks(r)` reads
 * that ONE record and memoises the answer, which is what makes `locate()` cost O(log recordCount)
 * reads and a second `locate()` nearby cost almost none. It is not opt-in, it is not visible at a
 * call site, no wrapper removes it, and it lives as long as the index does. A reader told
 * `cachedSource` is the only cache concludes that dropping the wrapper leaves edfcore retaining
 * nothing, and then cannot account for an index that grows while a viewer scrolls.
 *
 * So this measures the memo rather than quoting it: the same `locate()` twice, and the second one
 * reads nothing.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { ByteSource } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

/** Enough records that `locate` has to probe rather than answer from the two it opened with. */
const FILE = buildEdf({
  plus: 'D',
  recordCount: 64,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (record) => (record < 32 ? record : record + 10),
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [{ samplesPerRecord: 30 }],
});

/** A source that counts reads, so "almost none" is a number rather than a claim. */
function counting(bytes: Uint8Array): { source: ByteSource; reads: () => number } {
  const inner = byteSource(bytes);
  let reads = 0;
  return {
    source: {
      byteLength: inner.byteLength,
      read: (offset, length, options) => {
        reads += 1;
        return inner.read(offset, length, options);
      },
    },
    reads: () => reads,
  };
}

describe('the pages', () => {
  it('were read, so a passing run is not a vacuous one', () => {
    expect(DOCS_PAGES.get('api-sources.md') ?? '').toContain('cachedSource');
    expect(DOCS_PAGES.get('data-sources.md') ?? '').toContain('cachedSource');
    expect(DOCS_PAGES.get('large-files.md') ?? '').toContain('cachedSource');
  });

  it('all say "of file bytes" now, which is what large-files.md always said', () => {
    for (const name of ['api-sources.md', 'data-sources.md', 'large-files.md']) {
      expect(DOCS_PAGES.get(name) ?? '', name).toContain('only cache of file bytes');
    }
  });

  it('leave no unqualified copy behind, on a page or anywhere in src/', async () => {
    const { readFile } = await import('node:fs/promises');
    // Four sites said it, in three files. Enumerated rather than assumed, so a fifth has to be
    // added here to pass.
    for (const file of ['io/cached.ts', 'types.ts', 'index.ts']) {
      const text = await readFile(new URL(`../../src/${file}`, import.meta.url), 'utf8');
      expect(text, file).toContain('cachedSource');
      expect(text.replace('said "the only cache" flat', ''), file).not.toContain(
        'the only cache in edfcore',
      );
    }
    for (const name of ['api-sources.md', 'data-sources.md', 'large-files.md']) {
      expect(DOCS_PAGES.get(name) ?? '', name).not.toContain('the only cache in edfcore');
    }
  });
});

describe('the thing the qualifier makes room for', () => {
  it('answers a repeated locate without reading again', async () => {
    const { source, reads } = counting(FILE);
    const recording = await openEdf(source);
    const opened = reads();

    const first = await recording.index.locate(45.5);
    const afterFirst = reads();
    expect(first).toBeDefined();
    // The probe binary-searches, so the first locate costs reads.
    expect(afterFirst).toBeGreaterThan(opened);

    const again = await recording.index.locate(45.5);
    expect(again).toEqual(first);
    // And the second costs none: that is the memo, on an index nobody opted into.
    expect(reads()).toBe(afterFirst);
  });

  it('keeps answering nearby questions cheaply, which is what a scrolling viewer does', async () => {
    const { source, reads } = counting(FILE);
    const recording = await openEdf(source);
    await recording.index.locate(45.5);
    const warm = reads();
    for (const seconds of [45.5, 45.25, 45.75, 45.1]) {
      await recording.index.locate(seconds);
    }
    // Four more questions inside the record already decoded, and no new read for any of them.
    expect(reads()).toBe(warm);
  });
});
