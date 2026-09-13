/**
 * `httpSource`'s options, passed as a bare value.
 *
 * 0.6.130, 0.6.140 and 0.6.154 each refused this shape somewhere else, on the same argument: every
 * option in this package is a field on an object, so the value a caller means IS the option, and
 * `cachedSource(source, 4 * 1024 * 1024)` is what gets written when the intent is a budget.
 *
 * These are the options where it costs most, because `fetch` is one of them. `options?.fetch` read
 * as `undefined` and `resolveFetch` fell back to the global — and the entire reason to supply one
 * is that the global is not what should serve this request: an authenticated client, a signed-URL
 * wrapper, a proxy, or the double a test suite installs instead of reaching the network. `headers`
 * went the same way, so an Authorization header was dropped and the origin answered 401, or served
 * something else anonymously. `byteLength`, `maxConcurrency` and `allowFullDownload` went with
 * them.
 *
 * Silently: the call resolved, because a `ByteSource` over a public URL works perfectly well
 * without any of it.
 *
 * The suite is offline, so the double below is also the proof — a request that escaped it would
 * have to leave the process to fail.
 */

import { describe, expect, it } from 'vitest';
import { EdfSourceError, isEdfError } from '../../src/errors.js';
import { httpSource } from '../../src/io/http.js';
import type { FetchLike, HttpResponseLike } from '../../src/types.js';

const HREF = 'https://data.example.org/night.edf';
const SIZE = 64;

/** Records what it was asked for, and answers exactly the range requested. */
function server(): { fetch: FetchLike; calls: number } {
  const state = { calls: 0 };
  const fetchImpl = ((_href: string, init?: Record<string, unknown>) => {
    state.calls += 1;
    const range = (init?.headers as Record<string, string> | undefined)?.Range ?? '';
    const bounds = /bytes=(\d+)-(\d+)/.exec(range);
    const first = bounds === null ? 0 : Number(bounds[1]);
    const last = bounds === null ? 0 : Number(bounds[2]);
    const length = bounds === null ? 0 : last - first + 1;
    return Promise.resolve({
      ok: true,
      status: 206,
      headers: {
        get: (name: string) => (name === 'Content-Range' ? `bytes ${first}-${last}/${SIZE}` : null),
      },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(length)),
    } as unknown as HttpResponseLike);
  }) as unknown as FetchLike;
  return {
    fetch: fetchImpl,
    get calls() {
      return state.calls;
    },
  };
}

const open = (options: unknown): Promise<unknown> =>
  (httpSource as unknown as (u: string, o: unknown) => Promise<unknown>)(HREF, options);

describe.each([
  ['a number, meant as a byteLength', SIZE],
  ['a boolean, meant as allowFullDownload', true],
  ['a string, meant as a header value', 'Bearer abc'],
])('options that are %s', (_name, options) => {
  it('are refused rather than silently replaced by the defaults', async () => {
    await expect(open(options)).rejects.toThrow(EdfSourceError);
  });

  it('say which fields were about to be dropped, and that the global fetch would serve it', async () => {
    try {
      await open(options);
      expect.unreachable('a bare value must not be taken as no options at all');
    } catch (error) {
      expect(isEdfError(error)).toBe(true);
      expect((error as Error).message).toContain('httpSource()');
      expect((error as Error).message).toContain('the global');
      expect((error as Error).message).toContain('Next:');
    }
  });

  it('never reaches the network to find out', async () => {
    const remote = server();
    await open(options).catch(() => undefined);
    expect(remote.calls).toBe(0);
  });
});

describe('the options object itself', () => {
  it('still uses the fetch it was given', async () => {
    const remote = server();
    const source = await httpSource(HREF, { fetch: remote.fetch, byteLength: SIZE });
    expect(source.byteLength).toBe(SIZE);
    expect((await source.read(0, 8)).length).toBe(8);
    expect(remote.calls).toBeGreaterThan(0);
  });

  it('still takes no options at all where the environment has a global fetch', async () => {
    // Only the argument check is exercised here: an omitted options object is legal and must not
    // be refused by the guard above.
    await expect(open(undefined)).rejects.not.toThrow(/not an object/);
  });

  it('still takes null as "no options"', async () => {
    await expect(open(null)).rejects.not.toThrow(/not an object/);
  });
});
