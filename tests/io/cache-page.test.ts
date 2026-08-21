/**
 * What `data-sources.md` publishes about `cachedSource`, against what it does.
 *
 * `cache.test.ts` covers the behaviour thoroughly — eviction order, deduplication, copies,
 * clamping, abort. What no test asks is whether the page describes that behaviour: the two
 * DEFAULTS a caller inherits by writing `cachedSource(inner)` with no options, and the worked
 * recipe at the end of the section, which is arithmetic a reader is told to do themselves.
 *
 * The defaults are the more valuable half. They are private constants, published on the page in
 * MiB, and they are what almost every caller actually gets — a change to either is invisible to
 * every existing test, because each of those passes its own sizes in order to be deterministic.
 *
 * The recipe is checked because it makes a claim about cost — "`readHeader` costs two reads
 * against the uncached source, and `openEdf` then reads the header a second time through the
 * cache" — and a cost claim about a wrapper whose purpose is to reduce cost is worth holding.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { readHeader } from '../../src/io/read.js';
import { openEdf } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { spySource } from '../support/spy-source.js';
import { minimalEdfPlus } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('data-sources.md') ?? '';
const FLAT = PAGE.replace(/\s+/g, ' ');
const SOURCE = readFileSync(new URL('../../src/io/cached.ts', import.meta.url), 'utf8');

const MIB = 1024 * 1024;

describe('the defaults the page publishes', () => {
  /** `(1 MiB blocks and a 64 MiB budget by default)` */
  const PUBLISHED = /\((\d+) MiB blocks and a (\d+) MiB budget by default\)/.exec(FLAT);

  it('states both of them', () => {
    expect(PUBLISHED).not.toBeNull();
  });

  it('are the constants the module falls back to', () => {
    const block = /const DEFAULT_BLOCK_BYTES = ([\d *]+);/.exec(SOURCE);
    const max = /const DEFAULT_MAX_BYTES = ([\d *]+);/.exec(SOURCE);
    expect(block).not.toBeNull();
    expect(max).not.toBeNull();
    // Written as `1024 * 1024` in the source and as MiB on the page.
    const evaluate = (text: string): number =>
      text.split('*').reduce((product, part) => product * Number(part.trim()), 1);
    expect(evaluate(block?.[1] ?? '')).toBe(Number(PUBLISHED?.[1]) * MIB);
    expect(evaluate(max?.[1] ?? '')).toBe(Number(PUBLISHED?.[2]) * MIB);
  });

  it('are what a caller who passes no options actually gets', async () => {
    // Behavioural rather than textual: one byte asked for, one whole default block fetched.
    const bytes = new Uint8Array(3 * MIB);
    const spy = spySource(byteSource(bytes));
    const cached = cachedSource(spy);

    await cached.read(0, 1);
    expect(spy.reads).toHaveLength(1);
    expect(spy.reads[0]).toMatchObject({ offset: 0, length: Number(PUBLISHED?.[1]) * MIB });

    // And the rest of that block is then free.
    await cached.read(1, Number(PUBLISHED?.[1]) * MIB - 1);
    expect(spy.reads).toHaveLength(1);
  });
});

describe('the block boundaries the page describes', () => {
  it('are byte-aligned, at multiples of blockBytes', async () => {
    // "Block boundaries are byte-aligned, not record-aligned. The cache is format-independent by
    //  construction and never sees a header, so there is no record size for it to align to."
    expect(FLAT).toContain('Block boundaries are byte-aligned, not record-aligned');
    const bytes = new Uint8Array(10_000);
    const spy = spySource(byteSource(bytes));
    const cached = cachedSource(spy, { blockBytes: 1_000, maxBytes: 100_000 });

    await cached.read(2_500, 10);
    const first = spy.reads[0];
    expect(first).toBeDefined();
    expect(first?.offset).toBe(2_000);
    expect((first?.offset ?? -1) % 1_000).toBe(0);
  });
});

describe('the record-aligned recipe the page hands you', () => {
  const RECORDS_PER_BLOCK_TARGET = 1024 * 1024;

  const BYTES = minimalEdfPlus({
    recordCount: 400,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 256 }],
    annotationSignals: [{ samplesPerRecord: 30 }],
  });

  it('is still the arithmetic the page prints', () => {
    expect(FLAT).toContain(
      'const recordsPerBlock = Math.max(1, Math.floor(target / header.recordByteLength));',
    );
  });

  it('costs two reads for the header against the uncached source', async () => {
    // "`readHeader` costs two reads against the uncached source"
    expect(FLAT).toContain('`readHeader` costs two reads against the uncached source');
    const raw = spySource(byteSource(BYTES));
    await readHeader(raw);
    expect(raw.reads).toHaveLength(2);
  });

  it('produces a block size that is a whole number of records', async () => {
    const raw = spySource(byteSource(BYTES));
    const header = await readHeader(raw);
    const recordsPerBlock = Math.max(
      1,
      Math.floor(RECORDS_PER_BLOCK_TARGET / header.recordByteLength),
    );
    const blockBytes = recordsPerBlock * header.recordByteLength;
    expect(blockBytes % header.recordByteLength).toBe(0);
    expect(recordsPerBlock).toBeGreaterThan(1);
  });

  it('reads the header a second time through the cache, pulling in block 0', async () => {
    // "`openEdf` then reads the header a second time through the cache. That second pass pulls in
    //  block 0, which is the block your first record read needs anyway."
    const raw = spySource(byteSource(BYTES));
    const header = await readHeader(raw);
    const recordsPerBlock = Math.max(
      1,
      Math.floor(RECORDS_PER_BLOCK_TARGET / header.recordByteLength),
    );
    const before = raw.reads.length;
    const cached = cachedSource(raw, { blockBytes: recordsPerBlock * header.recordByteLength });
    await openEdf(cached);

    const throughCache = raw.reads.slice(before);
    expect(throughCache.length).toBeGreaterThan(0);
    // Block 0 starts at byte 0 and covers the header and the first records together.
    expect(throughCache[0]?.offset).toBe(0);
    expect(throughCache[0]?.length).toBeGreaterThan(header.headerByteLength);
  });
});
