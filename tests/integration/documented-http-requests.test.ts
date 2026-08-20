/**
 * Opening an EDF+ over HTTP costs the requests `api-sources.md` says it does.
 *
 * "Opening an EDF+ file over that source issues five requests in total. One `HEAD` for the length,
 * then `bytes=0-255` and one more range covering the rest of the header. Then one whole data
 * record at each end of the file, for the timekeeping probes. Every header you passed goes on all
 * five."
 *
 * That is the page a reader consults before pointing this at S3, and every clause of it is a cost
 * they are budgeting: how many round trips, what each one asks for, and whether the auth header
 * they configured is on all of them. The count is pinned elsewhere against a literal; the
 * COMPOSITION — one HEAD, two header ranges, two record probes — was prose, and so was the
 * promise about the headers, which is the one with a security shape: a request that quietly went
 * out without the caller's `Authorization` would 403 in production and nowhere else.
 *
 * The `fetch` is injected, which the suite requires of anything reaching the network (0.4.272) and
 * which is also how the page tells a reader to test their own adapter.
 */

import { describe, expect, it } from 'vitest';
import { httpSource } from '../../src/io/http.js';
import { openEdf } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { minimalEdfPlus } from '../support/writer.js';

const PAGE = (DOCS_PAGES.get('api-sources.md') ?? '').replace(/\s+/g, ' ');

const WORDS: ReadonlyMap<string, number> = new Map([
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
]);

/** "issues five requests in total" — the page's own number. */
const CLAIMED = WORDS.get(/issues (\w+) requests in total/.exec(PAGE)?.[1] ?? '');

const BYTES = minimalEdfPlus({ recordCount: 6, recordDurationSeconds: 1 });
const AUTH = 'Bearer test-token';

interface Seen {
  readonly method: string;
  readonly range: string | undefined;
  readonly authorization: string | undefined;
}

/** Serves the fixture over a fake fetch and records what was asked for. */
async function requestsToOpen(): Promise<readonly Seen[]> {
  const seen: Seen[] = [];
  const source = await httpSource('https://example.invalid/study.edf', {
    headers: { Authorization: AUTH },
    fetch: (_url, init) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      const method = init.method ?? 'GET';
      seen.push({
        method,
        range: headers.Range,
        authorization: headers.Authorization,
      });
      if (method === 'HEAD') {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) =>
              name.toLowerCase() === 'content-length'
                ? String(BYTES.byteLength)
                : name.toLowerCase() === 'accept-ranges'
                  ? 'bytes'
                  : null,
          },
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        });
      }
      const match = /bytes=(\d+)-(\d+)/.exec(headers.Range ?? '');
      const start = Number(match?.[1] ?? 0);
      const end = Number(match?.[2] ?? BYTES.byteLength - 1);
      const slice = BYTES.slice(start, end + 1);
      return Promise.resolve({
        ok: true,
        status: 206,
        headers: { get: () => null },
        arrayBuffer: () =>
          Promise.resolve(
            slice.buffer.slice(
              slice.byteOffset,
              slice.byteOffset + slice.byteLength,
            ) as ArrayBuffer,
          ),
      });
    },
  });
  await openEdf(source);
  return seen;
}

describe('the page states a count', () => {
  it('parses, so a passing run is not a vacuous one', () => {
    expect(CLAIMED, 'no "issues N requests in total" on api-sources.md').toBeDefined();
  });
});

describe('opening an EDF+ over HTTP', () => {
  it('issues exactly the number the page states', async () => {
    expect((await requestsToOpen()).length).toBe(CLAIMED);
  });

  it('composes them the way the page describes', async () => {
    const seen = await requestsToOpen();
    // One HEAD for the length...
    expect(seen.filter((one) => one.method === 'HEAD')).toHaveLength(1);
    expect(seen[0]?.method).toBe('HEAD');
    // ...then bytes=0-255, the first 256 bytes that carry the signal count.
    expect(seen[1]?.range).toBe('bytes=0-255');
    // ...and every remaining request is a range rather than a whole-body GET.
    for (const request of seen.slice(1)) {
      expect(request.method).toBe('GET');
      expect(request.range, 'a request went out with no Range header').toMatch(/^bytes=\d+-\d+$/);
    }
  });

  it("puts the caller's headers on all five", async () => {
    // The clause with a security shape: one request quietly going out without the caller's
    // Authorization 403s in production and nowhere else.
    const seen = await requestsToOpen();
    const missing = seen.filter((one) => one.authorization !== AUTH);
    expect(missing, 'requests that went out without the configured header').toEqual([]);
  });
});
