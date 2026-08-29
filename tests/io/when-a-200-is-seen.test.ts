/**
 * The table that says when an ignored `Range` is discovered.
 *
 * `data-sources.md` refuses a `200 OK` answer to a Range request by default, because it means the
 * server sent the whole resource rather than the bytes asked for. The interesting part is WHEN the
 * refusal happens, and the page tabulates it:
 *
 *   | `options.byteLength` was given            | on your first `read()`  |
 *   | `HEAD` returned a usable `Content-Length` | on your first `read()`  |
 *   | the `bytes=0-0` probe                     | during `httpSource()`   |
 *
 * `hardening.test.ts` covers the second and third rows, as the pair the page calls "the ordinary
 * shape of this failure": a CDN that answers HEAD and then ignores Range constructs cleanly and
 * refuses the first read. The first row — the caller supplied the length, so no probe is issued at
 * all — was not covered, and it is the row a caller reaches deliberately, by passing `byteLength`
 * to skip the two requests.
 *
 * The distinction matters to a caller who has to decide where to put a try/catch. A source that
 * constructs and then refuses needs the guard around the read; one that refuses at construction
 * needs it around the constructor. Getting that wrong is not a crash — it is an unhandled
 * rejection somewhere a page never expected one.
 *
 * The rows are read out of the page, so a row added to the table is a row with no test until it
 * has one.
 */

import { describe, expect, it } from 'vitest';
import { EdfSourceError } from '../../src/errors.js';
import { httpSource } from '../../src/io/http.js';
import type { FetchLike, HttpResponseLike } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

const PAGE = DOCS_PAGES.get('data-sources.md') ?? '';
const HREF = 'https://example.invalid/night.edf';
const CONTENT = Uint8Array.from({ length: 16 }, (_, at) => at);

/** The rows of "How the length is learned | When a 200 is first seen". */
const ROWS: ReadonlyArray<{ learned: string; seen: string }> = (() => {
  const at = PAGE.indexOf('| How the length is learned | When a 200 is first seen |');
  if (at === -1) throw new Error('data-sources.md no longer tabulates when a 200 is seen');
  const found: Array<{ learned: string; seen: string }> = [];
  for (const line of PAGE.slice(at).split(String.fromCharCode(10)).slice(2)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|');
    found.push({ learned: (cells[1] ?? '').trim(), seen: (cells[2] ?? '').trim() });
  }
  return found;
})();

/**
 * A server that ignores `Range` entirely and answers every GET with the whole body.
 *
 * `head` decides whether it also answers `HEAD` with a usable `Content-Length`, which is what
 * moves the source between the table's second and third rows.
 */
function ignoresRange(head: 'answers' | 'refuses'): {
  fetch: FetchLike;
  methods: readonly string[];
} {
  const methods: string[] = [];
  const fetchImpl = (async (_href: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    methods.push(method);
    if (method === 'HEAD') {
      return {
        status: head === 'answers' ? 200 : 405,
        headers: {
          get: (name: string) =>
            head === 'answers' && name.toLowerCase() === 'content-length'
              ? String(CONTENT.length)
              : null,
        },
        arrayBuffer: async () => new ArrayBuffer(0),
      } satisfies HttpResponseLike;
    }
    return {
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => CONTENT.slice().buffer,
    } satisfies HttpResponseLike;
  }) as unknown as FetchLike;
  return { fetch: fetchImpl, methods };
}

describe('the table was read', () => {
  it('has three rows and two distinct answers, so a passing run is not a vacuous one', () => {
    expect(ROWS).toHaveLength(3);
    expect(new Set(ROWS.map((row) => row.seen)).size).toBe(2);
    expect(ROWS.filter((row) => row.seen.includes('read()'))).toHaveLength(2);
    expect(ROWS.filter((row) => row.seen.includes('httpSource()'))).toHaveLength(1);
  });
});

describe('when the caller supplies the length', () => {
  it('issues no request at all while constructing', async () => {
    expect(ROWS[0]?.learned).toContain('options.byteLength');
    expect(ROWS[0]?.seen).toContain('read()');

    const server = ignoresRange('refuses');
    await httpSource(HREF, { fetch: server.fetch, byteLength: CONTENT.length });
    // Neither the HEAD nor the probe: there is nothing left to learn, so nothing is asked.
    expect(server.methods).toEqual([]);
  });

  it('refuses the first read instead, which is where the guard has to go', async () => {
    const server = ignoresRange('refuses');
    const source = await httpSource(HREF, {
      fetch: server.fetch,
      byteLength: CONTENT.length,
    });
    await expect(source.read(0, 4)).rejects.toThrow(EdfSourceError);
    expect(server.methods).toEqual(['GET']);
  });

  it('accepts the whole body on that read when allowFullDownload is set', async () => {
    // "the body is buffered at whichever of those points the 200 arrives" — here, the first read.
    const server = ignoresRange('refuses');
    const source = await httpSource(HREF, {
      fetch: server.fetch,
      byteLength: CONTENT.length,
      allowFullDownload: true,
    });
    expect(Array.from(await source.read(0, 4))).toEqual([0, 1, 2, 3]);
    // "one download rather than two": a second read is served from the body already held.
    expect(Array.from(await source.read(8, 2))).toEqual([8, 9]);
    expect(server.methods.filter((method) => method === 'GET')).toHaveLength(1);
  });
});

describe('the other two rows, for the contrast the table draws', () => {
  it('sees it at the first read when HEAD answered', async () => {
    expect(ROWS[1]?.seen).toContain('read()');
    const server = ignoresRange('answers');
    const source = await httpSource(HREF, { fetch: server.fetch });
    expect(server.methods).toEqual(['HEAD']);
    await expect(source.read(0, 4)).rejects.toThrow(EdfSourceError);
  });

  it('sees it during construction when the probe had to run', async () => {
    expect(ROWS[2]?.seen).toContain('httpSource()');
    const server = ignoresRange('refuses');
    await expect(httpSource(HREF, { fetch: server.fetch })).rejects.toThrow(EdfSourceError);
    expect(server.methods).toEqual(['HEAD', 'GET']);
  });
});
