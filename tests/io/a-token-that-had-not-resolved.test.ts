/**
 * `httpSource` options handed over as the Promise that will produce them.
 *
 * This is the fifth and last family to get this branch, and the only one where an unseen options
 * object means a REQUEST rather than a default. `resolveFetch` fell back to the global and `headers`
 * went with it, which the guard above states in full: "a bearer token was dropped and the server
 * answered 401 or, worse, served a different resource anonymously".
 *
 * It is also the family where the forgotten keyword is the COMMON spelling rather than the odd one,
 * because a credential is what sits behind an async call. A token is fetched, refreshed, or read out
 * of a keychain, so `httpSource(url, authFor(session))` is how the options for this adapter get built
 * — while the other four families' options are usually literals at the call site.
 *
 * 0.6.258 through 0.6.262 closed the read, parse, listing, materialize and cache halves. The route is
 * the same in all six; the consequences are not, and each message says its own.
 *
 * A property read, never a call: a Promise that never settles is refused rather than awaited, which
 * is what lets this refuse at the call instead of at the first range request.
 */

import { describe, expect, it } from 'vitest';
import { EdfSourceError, isEdfError } from '../../src/errors.js';
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

/** What a caller's own async token lookup hands back if the await is left off. */
const pendingOptions = (): unknown =>
  Promise.resolve({ headers: { authorization: 'Bearer t0ken' }, byteLength: 1024 });

describe('an http source given the Promise its options are behind', () => {
  it('is refused before any request goes out', async () => {
    const thrown = await refusal(() => httpSource(URL_, pendingOptions() as never));
    expect(thrown).toBeInstanceOf(EdfSourceError);
    expect(thrown.message).toContain('the options are a pending Promise');
  });

  it('names the three fields and says the request would have gone out bare', async () => {
    const thrown = await refusal(() => httpSource(URL_, pendingOptions() as never));
    expect(thrown.message).toContain('fetch, headers and byteLength are read off the object');
    expect(thrown.message).toContain('gone out on the global fetch with no headers');
    expect(thrown.message).toContain('Next: await them before passing them');
  });

  it('never calls the fetch the Promise was going to resolve to', async () => {
    const { fetch, seen } = double();
    await refusal(() => httpSource(URL_, Promise.resolve({ fetch }) as never));
    expect(seen).toHaveLength(0);
  });

  it('carries the fields an EdfSourceError handler branches on', async () => {
    const thrown = (await refusal(() =>
      httpSource(URL_, pendingOptions() as never),
    )) as EdfSourceError;
    expect(isEdfError(thrown)).toBe(true);
    expect(thrown.offset).toBe(0);
    expect(thrown.requestedLength).toBe(0);
  });

  it('is never awaited, settled or subscribed to', async () => {
    const neverSettles = new Promise<never>(() => {});
    const thrown = await refusal(() => httpSource(URL_, neverSettles as never));
    expect(thrown.message).toContain('a pending Promise');
  });
});

describe('the same options once they have resolved', () => {
  it('are used, and the headers reach the request', async () => {
    const { fetch, seen } = double();
    const resolved = await (pendingOptions() as Promise<{
      headers: Record<string, string>;
      byteLength: number;
    }>);
    const source = await httpSource(URL_, { ...resolved, fetch: fetch as never });
    expect(source.byteLength).toBe(1024);
    await source.read(0, 1);
    expect(JSON.stringify(seen)).toContain('Bearer t0ken');
  });
});

describe('the branches that were already there', () => {
  it('keep their own sentences', async () => {
    expect((await refusal(() => httpSource(URL_, [] as never))).message).toContain(
      'the options are an array',
    );
    expect((await refusal(() => httpSource(URL_, 'token' as never))).message).toContain(
      'not an object — fetch, headers and byteLength',
    );
    expect((await refusal(() => httpSource(URL_, { headers: 'a: b' } as never))).message).toContain(
      'options.headers is the string',
    );
  });

  it('and the address is still checked first', async () => {
    const thrown = await refusal(() =>
      httpSource('ftp://example.invalid/x.edf', pendingOptions() as never),
    );
    expect(thrown.message).toContain('ftp address');
  });
});
