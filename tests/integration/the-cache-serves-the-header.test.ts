/**
 * "The cache never sees a header", said on three pages, and disproved on one of them.
 *
 * `cachedSource` aligns its blocks on byte boundaries rather than record boundaries, and the
 * reason given was that it "never sees a header, so there is no record size for it to align to".
 * The first half is false and the second does not need it: the cache wraps a `ByteSource`, so
 * every read `openEdf` issues — the header's two included — goes through it. What it never does
 * is PARSE one, which is what leaves it with no record size.
 *
 * `large-files.md` refuted its own sentence twenty lines further down, in the paragraph that
 * makes the cache's best argument: "The first was already resident because the header read at
 * open pulled it in, so the reads that come with opening a file are not wasted." Both sentences
 * were on the page a reader consults while choosing `blockBytes`. `types.ts`, beside the option,
 * already carried the qualified version — "never sees a header to learn a record size from" —
 * which is the shape 0.6.48 fixed for "the only cache": the docblock keeps the qualifier and the
 * pages drop it (fixed in 0.6.57).
 *
 * The measurement below is the point. A 4 KiB block turns the header's two reads into ONE
 * underlying read, and a third read of the same bytes costs nothing — which is only possible if
 * the cache saw them.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { openEdf } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { spySource } from '../support/spy-source.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  recordCount: 40,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 64 }],
});

const PAGES = ['large-files.md', 'api-sources.md', 'data-sources.md'] as const;

describe('opening a file through cachedSource', () => {
  it('serves the header read out of the cache, so the header is something it sees', async () => {
    const spy = spySource(byteSource(FILE));
    const cached = cachedSource(spy, { blockBytes: 4096, maxBytes: 1024 * 1024 });
    await openEdf(cached);
    // Two header reads — 256 bytes, then 256 * signalCount — collapsed into one block fetch.
    expect(spy.reads).toHaveLength(1);
    expect(spy.reads[0]?.offset).toBe(0);

    const before = spy.reads.length;
    await cached.read(0, 256);
    expect(spy.reads.length - before).toBe(0);
  });

  it('still aligns its blocks on bytes, which is what the pages are explaining', async () => {
    const spy = spySource(byteSource(FILE));
    const cached = cachedSource(spy, { blockBytes: 4096, maxBytes: 1024 * 1024 });
    await cached.read(5000, 16);
    // Block 1 of 4096 bytes, not a record boundary: the cache has no record size to use.
    expect(spy.reads[0]?.offset).toBe(4096);
  });
});

describe.each(PAGES)('%s', (page) => {
  const text = (DOCS_PAGES.get(page) ?? '').replace(/\s+/g, ' ');

  it('is present, so an empty read cannot pass', () => {
    expect(text.length).toBeGreaterThan(100);
  });

  it('no longer says the cache never sees a header', () => {
    expect(text).not.toMatch(/never sees a header, so/);
  });

  it('gives the reason that is actually true', () => {
    expect(text).toContain('never parses a header');
  });
});
