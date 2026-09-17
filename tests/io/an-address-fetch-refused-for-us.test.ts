/**
 * `httpSource` given a string that is not an address it can fetch.
 *
 * 0.6.102 checked the ARGUMENT — a URL string or an object with an `href` — and stopped there, so
 * anything a string can hold reached `fetch`, and `fetch` answered for itself:
 * `httpSource('not a url')` was `TypeError: Failed to parse URL from not a url`. No `Next:` clause,
 * not an `EdfSourceError`, so `isEdfError` was false; from the one adapter whose whole argument is
 * an address; and before any request went out, so there was nothing about the network in it either.
 *
 * `file:///path/to.edf` is the case worth naming separately, because no parse catches it — it is a
 * perfectly good URL. This adapter reads by asking a server for byte ranges, which no runtime serves
 * for a file URL, and the adapter that does read a file is `fileSource`.
 *
 * The relative case is resolved the way the runtime itself resolves it: against `location.href` when
 * there is one. A relative address is legitimate in a page and meaningless in Node, Deno or Bun, so
 * the check reproduces that rule rather than inventing one — which is why `/data/x.edf` is refused
 * here and is not refused in a browser.
 *
 * Nothing below reaches the network: every one of these is refused before a request is built, and
 * the fetch double is there to fail the test loudly if one ever is.
 */

import { describe, expect, it, vi } from 'vitest';
import { EdfSourceError, isEdfError } from '../../src/errors.js';
import { httpSource } from '../../src/io/http.js';

/** Fails the test if the guard ever lets a request out. */
const neverCalled = (): ReturnType<typeof vi.fn> =>
  vi.fn(() => {
    throw new Error('a request was issued for an address that should have been refused');
  });

const UNFETCHABLE: ReadonlyArray<readonly [string, string, RegExp]> = [
  ['plain text', 'not a url', /is not an address this runtime can fetch/],
  ['an absolute path', '/data/study.edf', /is not an address this runtime can fetch/],
  ['a relative path', 'recordings/study.edf', /is not an address this runtime can fetch/],
  ['an empty string', '', /is not an address this runtime can fetch/],
];

describe.each(UNFETCHABLE)('given %s', (_name, href, expected) => {
  it('is refused in edfcore’s own voice, with a next step', async () => {
    const fetch = neverCalled();
    const thrown = await httpSource(href, { fetch: fetch as never }).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown, 'the address was handed to fetch').toBeDefined();
    expect(thrown?.message).toMatch(expected);
    expect(thrown?.message).toContain('Next:');
    expect(thrown?.message).toContain(JSON.stringify(href));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is an EdfSourceError, so a caller’s source branch sees it', async () => {
    const thrown = await httpSource(href, { fetch: neverCalled() as never }).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown).toBeInstanceOf(EdfSourceError);
    expect(isEdfError(thrown)).toBe(true);
    expect(thrown).not.toBeInstanceOf(TypeError);
  });
});

describe('a URL this adapter cannot serve', () => {
  it.each([
    ['file', 'file:///Users/me/study.edf'],
    ['ftp', 'ftp://example.org/study.edf'],
    ['data', 'data:application/octet-stream;base64,AAAA'],
    ['host-and-port with the scheme left off', 'localhost:8080/study.edf'],
  ])('names the adapter that reads a %s address instead', async (_scheme, href) => {
    const fetch = neverCalled();
    const thrown = await httpSource(href, { fetch: fetch as never }).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown, 'the address was handed to fetch').toBeDefined();
    expect(thrown?.message).toContain('asking a server for byte ranges over HTTP');
    expect(thrown?.message).toContain('fileSource(path)');
    // And the likeliest reading of a bare `host:port`, which parses as a scheme of its own.
    expect(thrown?.message).toContain('http:// or https://');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('an address that really is fetchable', () => {
  it('reaches the fetch it was given', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('reached the network, as expected');
    });
    await expect(
      httpSource('https://example.org/study.edf', { fetch: fetch as never }),
    ).rejects.toThrow(/reached the network/);
    expect(fetch).toHaveBeenCalled();
  });

  it('accepts a URL object, which 0.6.102 made the other accepted form', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('reached the network, as expected');
    });
    await expect(
      httpSource(new URL('http://example.org/study.edf'), { fetch: fetch as never }),
    ).rejects.toThrow(/reached the network/);
    expect(fetch).toHaveBeenCalled();
  });

  it('leaves the 0.6.102 refusal for a non-address saying its own thing', async () => {
    await expect(httpSource(42 as never)).rejects.toThrow(/needs a URL string or a URL object/);
  });
});
