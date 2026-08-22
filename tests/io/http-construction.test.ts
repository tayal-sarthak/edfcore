/**
 * What `httpSource` accepts before it issues anything: a URL, a `fetch`, and a length.
 *
 * Three sentences on `api-sources.md` describe the construction of a source, and all three were
 * prose. Each is the first thing a caller meets, and each fails in a way that is confusing rather
 * than obvious.
 *
 *  - "It accepts a `URL` object as well as a string, because `URL` structurally satisfies
 *    `{ href: string }`." A `URL` is what `new URL(name, base)` hands you and what a router gives
 *    you, so passing one is the normal case rather than the clever one. Nothing here had ever
 *    passed anything but a string literal, and `String(url)` and `url.href` differ for enough
 *    inputs that "it probably works" is not an answer.
 *  - `fetch` defaults to `globalThis.fetch`, and "Throws `EdfSourceError` at construction when
 *    neither is available." That path is the one every browser caller takes and the one no test
 *    could take, because the suite replaces the global with a trap that refuses — see
 *    `tests/support/offline.ts`. It is exercised here by putting a counting double in the global's
 *    place for the length of one test, which is the only way to observe the fallback without
 *    reaching a network.
 *  - `byteLength` "must be a non-negative safe integer or construction throws". Its whole purpose
 *    is to skip the probes, so a bad value is a value that would otherwise be trusted as the size
 *    of a resource nobody measured: every read is then range-checked against a fiction.
 *
 * `documented-defaults.test.ts` observes the numeric defaults and says in its docblock that it
 * does not check `globalThis.fetch`, because there is nothing numeric to observe. This is that.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { EdfSourceError } from '../../src/errors.js';
import { httpSource } from '../../src/io/http.js';
import type { FetchLike, HttpResponseLike } from '../../src/types.js';

const HREF = 'https://data.example.org/night.bdf';

/** A server that answers every request with one byte and remembers what it was asked. */
function server(): { fetch: FetchLike; hrefs: readonly string[] } {
  const hrefs: string[] = [];
  const fetchImpl = ((href: string) => {
    hrefs.push(href);
    return Promise.resolve({
      ok: true,
      status: 206,
      headers: { get: (name: string) => (/content-range/i.test(name) ? 'bytes 0-0/4096' : null) },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
    } as unknown as HttpResponseLike);
  }) as unknown as FetchLike;
  return { fetch: fetchImpl, hrefs };
}

/** A fetch that fails the test if anything reaches it. */
const forbidden = (() => {
  throw new Error('httpSource issued a request it should not have');
}) as unknown as FetchLike;

const ambient = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = ambient;
});

describe('the URL it was given', () => {
  it('may be a string, which is what the page shows', async () => {
    const remote = server();
    await httpSource(HREF, { fetch: remote.fetch });
    expect(remote.hrefs.every((href) => href === HREF)).toBe(true);
  });

  it('may be a URL object, and is read through .href', async () => {
    const remote = server();
    // Built the way a caller builds one: relative to a base, which is why they hold a URL at all.
    const url = new URL('night.bdf', 'https://data.example.org/');
    const source = await httpSource(url, { fetch: remote.fetch });
    expect(source.byteLength).toBe(4096);
    expect(remote.hrefs[0]).toBe(url.href);
  });

  it('may be any object carrying an href, which is what the type says', async () => {
    // The structural half of the claim: a `URL` is accepted because of its shape, not its class.
    const remote = server();
    await httpSource({ href: HREF }, { fetch: remote.fetch });
    expect(remote.hrefs[0]).toBe(HREF);
  });
});

describe('the fetch it will use', () => {
  it('is the one passed, in preference to the global', async () => {
    let ambientCalls = 0;
    globalThis.fetch = (() => {
      ambientCalls += 1;
      return Promise.reject(new Error('the global was used'));
    }) as typeof globalThis.fetch;
    const remote = server();
    await httpSource(HREF, { fetch: remote.fetch });
    expect(remote.hrefs.length).toBeGreaterThan(0);
    expect(ambientCalls).toBe(0);
  });

  it('is globalThis.fetch when none is passed', async () => {
    const remote = server();
    globalThis.fetch = remote.fetch as typeof globalThis.fetch;
    const source = await httpSource(HREF);
    expect(source.byteLength).toBe(4096);
    expect(remote.hrefs[0]).toBe(HREF);
  });

  it('is an EdfSourceError at construction when there is neither', async () => {
    (globalThis as { fetch?: unknown }).fetch = undefined;
    const failure = await httpSource(HREF).then(
      () => undefined,
      (thrown: unknown) => thrown as EdfSourceError,
    );
    expect(failure).toBeInstanceOf(EdfSourceError);
    // Names both halves of what is missing, because either one alone is the fix.
    expect(failure?.message).toContain('globalThis.fetch');
    expect(failure?.message).toContain('options.fetch');
    expect(failure?.message).toContain('Next:');
  });
});

describe('the byteLength it was told', () => {
  it('skips both probes when it is good, issuing no request at all', async () => {
    const source = await httpSource(HREF, { fetch: forbidden, byteLength: 4096 });
    expect(source.byteLength).toBe(4096);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    'refuses %p before issuing anything',
    async (declared) => {
      const failure = await httpSource(HREF, { fetch: forbidden, byteLength: declared }).then(
        () => undefined,
        (thrown: unknown) => thrown as EdfSourceError,
      );
      expect(failure).toBeInstanceOf(EdfSourceError);
      // Quotes the value back, so the caller can see which config key produced it.
      expect(failure?.message).toContain(String(declared));
      expect(failure?.message).toContain('non-negative safe integer');
    },
  );

  it('accepts zero, which is a real resource and not a missing one', async () => {
    const source = await httpSource(HREF, { fetch: forbidden, byteLength: 0 });
    expect(source.byteLength).toBe(0);
  });
});
