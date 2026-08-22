/**
 * The defaults the option tables print are the defaults the code uses — observed, not read off a
 * constant.
 *
 * Four reference pages carry a `Default` column, and between them they publish five numbers a
 * caller plans around: 256 MiB for `maxMaterializeBytes`, 1 MiB blocks and a 64 MiB budget for
 * `cachedSource`, four in-flight requests for `httpSource`. Those are the values you get by
 * passing nothing, which makes them the values almost everyone gets, and nothing compared them
 * with the code.
 *
 * They are checked here by making the code reveal them rather than by importing the constants
 * beside them. Importing `DEFAULT_MAX_MATERIALIZE_BYTES` and comparing it with the table would
 * pass just as happily on a release where the constant is no longer what resolves — the failure
 * mode `options.ts` opens by describing, where a budget was resolved in six modules and one of
 * them had its own idea. So: the budget is read off the `EdfBudgetError` a refused allocation
 * carries, the block size off the read the cache actually issues, the LRU budget off the clamp it
 * applies to an oversized block, and the concurrency off the peak number of requests in flight.
 *
 * The last check is the closure. Every numeric cell in those `Default` columns has to be one of
 * the values observed here, so a newly documented number either gets an observation or fails and
 * says which page it is on.
 *
 * What this does NOT check: the non-numeric defaults in those tables — `globalThis.fetch`, `{}`,
 * `probed`, `none`, `every annotations signal`. Two booleans are checked because their default is
 * a refusal a caller would notice (`strict`, `allowFullDownload`); the rest describe an absence,
 * and there is nothing to observe about a header map that is empty.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { httpSource } from '../../src/io/http.js';
import { openEdf, readRecords } from '../../src/recording.js';
import type { ByteSource } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { spySource } from '../support/spy-source.js';
import { buildEdf } from '../support/writer.js';

const PAGES = ['api-sources.md', 'api-primitives.md', 'api-reading.md', 'data-sources.md'] as const;

interface Documented {
  readonly page: string;
  readonly option: string;
  readonly value: string;
}

/**
 * Every row of every table with a `Default` column, as `option` → the cell, with the backticks and
 * any trailing gloss (`(1 MiB)`) removed.
 */
const DOCUMENTED: readonly Documented[] = (() => {
  const rows: Documented[] = [];
  for (const page of PAGES) {
    const text = DOCS_PAGES.get(page) ?? '';
    const lines = text.split('\n');
    let column = -1;
    for (const line of lines) {
      if (!line.startsWith('|')) {
        column = -1;
        continue;
      }
      const cells = line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim());
      if (column === -1) {
        column = cells.indexOf('Default');
        continue;
      }
      if (cells[0]?.startsWith('---') === true) continue;
      const option = (cells[0] ?? '').replaceAll('`', '');
      const value = (cells[column] ?? '')
        .replace(/\s*\([^)]*\)\s*$/, '')
        .replaceAll('`', '')
        .trim();
      if (option !== '' && value !== '') rows.push({ page, option, value });
    }
  }
  return rows;
})();

const documented = (option: string): readonly string[] => [
  ...new Set(DOCUMENTED.filter((row) => row.option === option).map((row) => row.value)),
];

/** A source of any size that never allocates more than one read at a time. */
const fabricated = (byteLength: number): ByteSource => ({
  byteLength,
  read: (_offset: number, length: number) => Promise.resolve(new Uint8Array(length)),
});

describe('the tables were read', () => {
  it('found the Default columns, so a passing run is not a vacuous one', () => {
    expect(DOCUMENTED.length).toBeGreaterThan(15);
    expect(new Set(DOCUMENTED.map((row) => row.page)).size).toBe(PAGES.length);
    // The same option is documented on more than one page, and the pages agree.
    expect(documented('maxConcurrency')).toEqual(['4']);
    expect(documented('maxMaterializeBytes')).toEqual(['268435456']);
  });
});

describe('the number a caller gets by passing nothing', () => {
  it('is the allocation budget the tables print', async () => {
    // A header declaring 4,000 records of 120,000 bytes, over a source that reports the size those
    // records would occupy and fabricates the data. The budget is checked against the geometry
    // before anything is allocated, so finding out what 256 MiB is costs a few hundred bytes.
    const header = buildEdf({
      recordCount: 0,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 60_000 }],
      raw: { recordCount: '4000'.padEnd(8, ' ') },
    });
    const recording = await openEdf({
      byteLength: header.byteLength + 4000 * 120_000,
      read: (offset: number, length: number) => {
        const out = new Uint8Array(length);
        if (offset < header.byteLength) {
          out.set(header.subarray(offset, Math.min(header.byteLength, offset + length)));
        }
        return Promise.resolve(out);
      },
    });
    expect(recording.header.recordCount).toBe(4000);

    const error = await readRecords(recording, {
      records: { start: 0, count: 4000 },
      signalIndices: [0],
    }).then(
      () => undefined,
      (thrown: unknown) => thrown as { budgetBytes?: number },
    );
    expect(String(error?.budgetBytes)).toBe(documented('maxMaterializeBytes')[0]);
  });

  it('is the cache block size the tables print', async () => {
    const spy = spySource(fabricated(8 * 1024 * 1024));
    await cachedSource(spy).read(0, 1);
    // One byte asked for, one whole block read: that read's length is the default.
    expect(String(spy.reads[0]?.length)).toBe(documented('blockBytes')[0]);
  });

  it('is the cache budget the tables print, revealed by the clamp', async () => {
    // "clamped down to `maxBytes`, since a block wider than the whole budget evicts itself on
    // every insert" — so an absurd block size comes back as the budget.
    const spy = spySource(fabricated(512 * 1024 * 1024));
    await cachedSource(spy, { blockBytes: 512 * 1024 * 1024 }).read(0, 1);
    expect(String(spy.reads[0]?.length)).toBe(documented('maxBytes')[0]);
  });

  it('is the number of requests httpSource keeps in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchLike = async (): Promise<unknown> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return {
        ok: true,
        status: 206,
        headers: { get: () => null },
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
      };
    };
    const source = await httpSource('https://example.org/night.edf', {
      byteLength: 4096,
      fetch: fetchLike as never,
    });
    await Promise.all(Array.from({ length: 12 }, (_, at) => source.read(at * 16, 16)));
    expect(String(peak)).toBe(documented('maxConcurrency')[0]);
  });
});

describe('the two booleans, whose default is a refusal', () => {
  it('leaves strict off, so a warning is a value rather than a throw', async () => {
    expect(documented('strict')).toEqual(['false']);
    // A header field that is impolite but readable. With `strict` it would throw instead.
    const recording = await openEdf(
      byteSource(
        buildEdf({
          recordCount: 1,
          recordDurationSeconds: 1,
          signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
          raw: { startDate: '32.13.99' },
        }),
      ),
    );
    expect(recording.header.diagnostics.length).toBeGreaterThan(0);
  });

  it('leaves allowFullDownload off, so an ignored Range is refused', async () => {
    expect(documented('allowFullDownload')).toEqual(['false']);
    const fetchLike = (): Promise<unknown> =>
      Promise.resolve({
        ok: true,
        // 200 to a Range request: the server is sending the whole resource.
        status: 200,
        headers: { get: () => null },
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(64)),
      });
    const source = await httpSource('https://example.org/night.edf', {
      byteLength: 64,
      fetch: fetchLike as never,
    });
    const error = await source.read(0, 16).then(
      () => undefined,
      (thrown: unknown) => thrown as Error,
    );
    expect(error?.message).toContain('HTTP_RANGE_IGNORED');
  });
});

describe('every documented number is one of those', () => {
  it('leaves no numeric default unobserved', () => {
    const observed = new Set(
      ['maxMaterializeBytes', 'blockBytes', 'maxBytes', 'maxConcurrency'].flatMap((option) =>
        documented(option),
      ),
    );
    const unobserved = DOCUMENTED.filter(
      (row) => /^\d+$/.test(row.value) && !observed.has(row.value),
    ).map((row) => `${row.page}: ${row.option} defaults to ${row.value}, and nothing checks it`);
    expect(unobserved).toEqual([]);
  });
});
