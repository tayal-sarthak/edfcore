/**
 * The three ways `httpSource` learns the size, in the order it tries them.
 *
 * Random access is meaningless without a length, so this happens before a source exists at all —
 * which is why `httpSource` is `async`. `api-sources.md` lists the routes and what falls through
 * to what: `options.byteLength`, then a `HEAD` using its `Content-Length`, then a `GET` with
 * `Range: bytes=0-0` using the total from `Content-Range`. "A rejected or forbidden `HEAD` is
 * common (CORS, some object stores) and falls through to the next step."
 *
 * That fall-through is the clause with teeth. An object store answering `403` to `HEAD` while
 * serving ranges happily is the ordinary case for a bucket with a narrow policy, and a library
 * that gave up there would be unusable against half the places these recordings live. It is also
 * a `catch` that swallows every rejection, which is a shape worth pinning: what it must swallow,
 * and that it stops swallowing once the probe itself fails.
 *
 * `documented-http-requests.test.ts` counts the five requests that opening a recording costs, on
 * a server that answers everything. This is the other half — what happens when one of them does
 * not answer, and what a caller is told when none of the routes works.
 *
 * The `Content-Length` route in particular had never been taken. Every double in the suite
 * answers the probe, so the HEAD's own answer was the cheapest path and the untested one.
 *
 * What this does NOT check: that a real server behaves this way. These are doubles, deliberately:
 * the suite is offline, and the shapes below are the misbehaviours worth naming rather than a
 * survey of what any particular origin does.
 */

import { describe, expect, it } from 'vitest';
import { EdfSourceError } from '../../src/errors.js';
import { httpSource } from '../../src/io/http.js';
import type { FetchLike, HttpResponseLike } from '../../src/types.js';

const HREF = 'https://data.example.org/night.bdf';

interface Call {
  readonly method: string;
  readonly range: string | undefined;
}

type Answer = { status: number; headers: Record<string, string> } | Error;

/**
 * A server scripted per method. `headers.get` answers the exact spellings it was given and
 * nothing else, so a lookup that guesses the case wrong sees `null` rather than a value.
 */
function server(script: { HEAD?: Answer; GET?: Answer }): {
  fetch: FetchLike;
  calls: readonly Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = ((
    _href: string,
    init?: { method?: string; headers?: Record<string, string> },
  ) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, range: init?.headers?.Range });
    const answer = script[method as 'HEAD' | 'GET'];
    if (answer === undefined) return Promise.reject(new Error(`no script for ${method}`));
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve({
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      headers: { get: (name: string) => answer.headers[name] ?? null },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
    } as unknown as HttpResponseLike);
  }) as unknown as FetchLike;
  return { fetch: fetchImpl, calls };
}

const RANGED = { status: 206, headers: { 'Content-Range': 'bytes 0-0/4096' } };

const refusal = async (fetchImpl: FetchLike): Promise<EdfSourceError | undefined> =>
  httpSource(HREF, { fetch: fetchImpl }).then(
    () => undefined,
    (thrown: unknown) => thrown as EdfSourceError,
  );

describe('the HEAD, which is the cheapest route with a network on it', () => {
  it('is believed, and stops the probe from going out at all', async () => {
    const remote = server({ HEAD: { status: 200, headers: { 'Content-Length': '4096' } } });
    const source = await httpSource(HREF, { fetch: remote.fetch });
    expect(source.byteLength).toBe(4096);
    // One request, and it was the HEAD: the range probe is the fallback, not a second opinion.
    expect(remote.calls).toEqual([{ method: 'HEAD', range: undefined }]);
  });

  it('is read case-insensitively, because a hand-written double usually is not', async () => {
    // "A real `Headers` lookup is case-insensitive, but a hand-written test double usually is
    // not, so `httpSource` tries both the given spelling and the lowercase one."
    const remote = server({ HEAD: { status: 200, headers: { 'content-length': '4096' } } });
    expect((await httpSource(HREF, { fetch: remote.fetch })).byteLength).toBe(4096);
  });

  it.each([
    ['it is rejected outright, the way a CORS preflight fails', new Error('blocked by CORS')],
    ['it is forbidden, the way a narrow bucket policy answers', { status: 403, headers: {} }],
    ['it succeeds and says nothing about length', { status: 200, headers: {} }],
    ['its length is not a number', { status: 200, headers: { 'Content-Length': 'chunked' } }],
    ['its length is negative', { status: 200, headers: { 'Content-Length': '-1' } }],
    ['its length is fractional', { status: 200, headers: { 'Content-Length': '40.96' } }],
    [
      'its length is past the safe integers',
      { status: 200, headers: { 'Content-Length': '9007199254740993' } },
    ],
  ] as ReadonlyArray<readonly [string, Answer]>)(
    'falls through to the probe when %s',
    async (_why, head) => {
      const remote = server({ HEAD: head, GET: RANGED });
      const source = await httpSource(HREF, { fetch: remote.fetch });
      expect(source.byteLength).toBe(4096);
      // And the probe asked for exactly one byte, inclusive at both ends.
      expect(remote.calls.map((call) => call.method)).toEqual(['HEAD', 'GET']);
      expect(remote.calls[1]?.range).toBe('bytes=0-0');
    },
  );
});

describe('the range probe, which is the last route there is', () => {
  it('takes the total after the slash, not the range before it', async () => {
    const remote = server({
      HEAD: { status: 500, headers: {} },
      GET: { status: 206, headers: { 'Content-Range': 'bytes 0-0/13421772800' } },
    });
    expect((await httpSource(HREF, { fetch: remote.fetch })).byteLength).toBe(13_421_772_800);
  });

  it.each([
    ['the total is unknown', 'bytes 0-0/*'],
    ['the header is not a byte range at all', 'items 0-0/4096'],
    ['there is no slash in it', 'bytes 0-0'],
    ['the total is not a number', 'bytes 0-0/many'],
  ])('is fatal when %s', async (_why, contentRange) => {
    const remote = server({
      HEAD: { status: 500, headers: {} },
      GET: { status: 206, headers: { 'Content-Range': contentRange } },
    });
    const failure = await refusal(remote.fetch);
    expect(failure).toBeInstanceOf(EdfSourceError);
    // Names both routes, because the caller has to know that neither worked rather than one.
    expect(failure?.message).toContain('HEAD returned no usable Content-Length');
    expect(failure?.message).toContain('no Content-Range total');
    expect(failure?.message).toContain('options.byteLength');
  });

  it('is fatal when the probe answers 206 and no Content-Range at all', async () => {
    const remote = server({
      HEAD: { status: 500, headers: {} },
      GET: { status: 206, headers: {} },
    });
    expect((await refusal(remote.fetch))?.message).toContain('could not determine the size');
  });

  it('names the status and the range when the server refuses it', async () => {
    const remote = server({
      HEAD: { status: 500, headers: {} },
      GET: { status: 404, headers: {} },
    });
    const failure = await refusal(remote.fetch);
    expect(failure).toBeInstanceOf(EdfSourceError);
    expect(failure?.message).toContain('HTTP 404');
    expect(failure?.message).toContain('Range probe');
    expect(failure?.requestedLength).toBe(1);
  });

  it('stops swallowing once it is the probe that fails', async () => {
    // The `catch` around the HEAD takes every rejection. A rejection from the probe is a different
    // thing entirely — there is no next route — and has to reach the caller as it was thrown.
    const network = new Error('getaddrinfo ENOTFOUND data.example.org');
    const remote = server({ HEAD: new Error('blocked by CORS'), GET: network });
    await expect(httpSource(HREF, { fetch: remote.fetch })).rejects.toBe(network);
  });
});
