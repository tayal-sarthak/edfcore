/**
 * `options.headers` given a container with no own enumerable values.
 *
 * `assertHeaders` accepts an object whose values are all strings, and `every` on an EMPTY array is
 * true — the shape `options.ts` warns about in its own module note: a guard that does not fire. So an
 * object with nothing enumerable on it passed the check and then spread to nothing, which is exactly
 * the outcome the refusal already names for a Map and a Headers: "becomes nothing at all".
 *
 * Two shapes reach it that way, and a credential is what both are carrying:
 *
 * - a pending Promise, from `headers: fetchToken()` with the keyword left off;
 * - a class instance holding the token behind a prototype getter, which `Object.values` does not see.
 *
 * The request then went out on the global `fetch` with no authorization — "a bearer token was
 * dropped and the server answered 401 or, worse, served a different resource anonymously", which is
 * the cost 0.6.250 and 0.6.263 both state for this adapter. There was no edfcore error at all: the
 * failure arrived as fetch's own `TypeError`, or as a 401, or not at all.
 *
 * `{}` keeps passing. It is the one empty object that is legitimate, and it is what `undefined`
 * already means.
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

/** Records every request, so a dropped header is observable rather than argued. */
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

type Http = (url: string, options: unknown) => unknown;
const open = httpSource as unknown as Http;

describe('a token the spread could not carry', () => {
  it('is refused when it is still a Promise', async () => {
    const { fetch } = double();
    const thrown = await refusal(() =>
      open(URL_, { headers: Promise.resolve({ authorization: 'Bearer t0ken' }), fetch }),
    );
    expect(thrown).toBeInstanceOf(EdfSourceError);
    expect(thrown.message).toContain('options.headers is a pending Promise');
  });

  it('is refused when its values live on the prototype', async () => {
    class Auth {
      get authorization(): string {
        return 'Bearer t0ken';
      }
    }
    const { fetch } = double();
    const thrown = await refusal(() => open(URL_, { headers: new Auth(), fetch }));
    expect(thrown.message).toContain('not a plain object of header names to string values');
  });

  it('never reaches the fetch, so no request goes out bare', async () => {
    const { fetch, seen } = double();
    await refusal(() => open(URL_, { headers: Promise.resolve({ a: 'b' }), fetch }));
    expect(seen).toHaveLength(0);
  });

  it('says what a spread does to a container, which is what happened here', async () => {
    const { fetch } = double();
    const thrown = await refusal(() => open(URL_, { headers: Promise.resolve({}), fetch }));
    expect(thrown.message).toContain('becomes nothing at all');
    expect(thrown.message).toContain('Object.fromEntries(headers)');
  });
});

describe('what the old behaviour produced', () => {
  it('is pinned through the double: real headers do reach the request', async () => {
    const { fetch, seen } = double();
    const source = await httpSource(URL_, {
      headers: { authorization: 'Bearer t0ken' },
      fetch: fetch as never,
      byteLength: 1024,
    });
    await source.read(0, 1);
    expect(JSON.stringify(seen)).toContain('Bearer t0ken');
  });
});

describe('the empty object that is legitimate', () => {
  it('still passes, because it is what undefined already means', async () => {
    const { fetch } = double();
    await expect(
      httpSource(URL_, { headers: {}, fetch: fetch as never, byteLength: 1024 }),
    ).resolves.toBeDefined();
    await expect(
      httpSource(URL_, { fetch: fetch as never, byteLength: 1024 }),
    ).resolves.toBeDefined();
  });
});

describe('the shapes that were already refused', () => {
  it('keep their own sentences', async () => {
    expect((await refusal(() => open(URL_, { headers: 'a: b' }))).message).toContain(
      'options.headers is the string',
    );
    expect((await refusal(() => open(URL_, { headers: new Map() }))).message).toContain(
      'not a plain object',
    );
    expect((await refusal(() => open(URL_, { headers: { authorization: 7 } }))).message).toContain(
      'not a plain object',
    );
  });
});
