/**
 * `httpSource(url, [])`, and the request it sent on the global `fetch`.
 *
 * The guard here was written against a bare value, and its note lists what a missed options object
 * costs: `resolveFetch` falls back to the global, "and the whole point of supplying one is that the
 * global is not what should serve this request: an authenticated client, a signed-URL wrapper, a
 * proxy, or the double a test suite installs instead of reaching the network at all". `headers`
 * goes with it, so "a bearer token was dropped and the server answered 401 or, worse, served a
 * different resource anonymously".
 *
 * An array is an object, so it paid all of that without being seen. Of the four options families
 * this package guards, this is the one where an unseen options object reaches the NETWORK rather
 * than a default — 0.6.245 closed the read and parse options, 0.6.247 the formatters and 0.6.249
 * the cache, and `assertSelection` states the shape: "an ARRAY, which is an object, so the check
 * above let it through".
 *
 * The bare-value guard and the per-field guards keep their own sentences, and a real options object
 * is unchanged.
 */

import { describe, expect, it } from 'vitest';
import { EdfSourceError } from '../../src/errors.js';
import { httpSource } from '../../src/io/http.js';

const URL_ = 'https://example.invalid/recording.edf';

const refusal = async (call: () => unknown): Promise<Error> => {
  const thrown = await Promise.resolve()
    .then(call)
    .then(
      () => undefined,
      (error: unknown) => error as Error,
    );
  expect(thrown, 'nothing was refused').toBeDefined();
  return thrown as Error;
};

/** A double that answers a ranged request, so a call with real options never touches the network. */
function double(): {
  fetch: (input: unknown, init?: unknown) => Promise<unknown>;
  seen: unknown[];
} {
  const seen: unknown[] = [];
  return {
    seen,
    fetch: (input: unknown, init?: unknown) => {
      seen.push({ input, init });
      return Promise.resolve({
        ok: true,
        status: 206,
        headers: {
          get: (name: string) => (name.toLowerCase() === 'content-range' ? 'bytes 0-0/1024' : null),
        },
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      });
    },
  };
}

describe('options wrapped in a list', () => {
  it.each([
    ['empty', []],
    ['a fetch on its own', [() => Promise.resolve()]],
    ['a config spread into a list', [{ headers: { Authorization: 'Bearer t' } }]],
  ])('is refused before any request goes out, when %s', async (_shape, options) => {
    const thrown = await refusal(() => httpSource(URL_, options as never));
    expect(thrown).toBeInstanceOf(EdfSourceError);
    expect(thrown.message).toContain('the options are an array');
  });

  it('names the fields and what the request would have gone out on', async () => {
    const thrown = await refusal(() => httpSource(URL_, [] as never));
    expect(thrown.message).toContain('fetch, headers and byteLength are fields on the options');
    expect(thrown.message).toContain('gone out on the global fetch with none of them');
    expect(thrown.message).toContain('Next: pass them on an options object');
  });

  it('never calls the fetch it was handed inside the list', async () => {
    const { fetch, seen } = double();
    await refusal(() => httpSource(URL_, [fetch] as never));
    expect(seen).toHaveLength(0);
  });

  it('carries the fields an EdfSourceError handler branches on', async () => {
    const thrown = (await refusal(() => httpSource(URL_, [] as never))) as EdfSourceError;
    expect(thrown.offset).toBe(0);
    expect(thrown.requestedLength).toBe(0);
  });
});

describe('the same options on an object', () => {
  it('are used, and the supplied fetch is the one called', async () => {
    const { fetch, seen } = double();
    const source = await httpSource(URL_, { fetch: fetch as never, byteLength: 1024 });
    expect(source.byteLength).toBe(1024);
    await source.read(0, 1);
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe('the guards an array walked past', () => {
  it('still refuses a bare value', async () => {
    const thrown = await refusal(() => httpSource(URL_, 'token' as never));
    expect(thrown.message).toContain('not an object — fetch, headers and byteLength');
  });

  it('still refuses a fetch that is not a function', async () => {
    const thrown = await refusal(() => httpSource(URL_, { fetch: 5 } as never));
    expect(thrown.message).toContain('options.fetch is 5, not a function');
  });

  it('still refuses headers that are not a plain object of strings', async () => {
    const thrown = await refusal(() => httpSource(URL_, { headers: 5 } as never));
    expect(thrown.message).toContain('options.headers is 5');
  });

  it('still refuses an address it cannot fetch, before the options', async () => {
    const thrown = await refusal(() => httpSource('not a url', [] as never));
    expect(thrown.message).toContain('is not an address this runtime can fetch');
  });
});
