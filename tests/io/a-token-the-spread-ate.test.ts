/**
 * `options.headers` in a shape the spread cannot carry.
 *
 * `httpSource` builds the request headers as `{ ...options?.headers }`, which launders anything into
 * a plausible object — the shape 0.6.178 found in `buildTimeline`, where by the time a check could
 * see the mistake it was already gone. Here it goes out on the wire instead.
 *
 * - a bearer STRING, which is what a caller writes when the token is the only header they have,
 *   spreads into one single-character header per index;
 * - an ARRAY of pairs — the form `new Headers()` takes and `Object.entries` returns — spreads into
 *   `{ 0: [...] }`;
 * - a `Map`, or a real `Headers`, has no own enumerable properties at all and spreads into `{}`.
 *
 * The options guard above names this cost in its own words — "a bearer token was dropped and the
 * server answered 401 or, worse, served a different resource anonymously" — for the whole object.
 * The field inside it went the same way, and the last of the three is the silent one: the request
 * went out unauthenticated and the adapter never knew.
 */

import { describe, expect, it, vi } from 'vitest';
import { EdfSourceError, isEdfError } from '../../src/errors.js';
import { httpSource } from '../../src/io/http.js';
import type { HttpResponseLike } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

const URL_ = 'https://example.org/study.edf';

/** Records the headers each request actually carried. */
function spyFetch(seen: Array<Record<string, unknown>>): ReturnType<typeof vi.fn> {
  return vi.fn(async (_url: string, init?: { headers?: Record<string, unknown> }) => {
    seen.push({ ...(init?.headers ?? {}) });
    return {
      ok: true,
      status: 206,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-range'
            ? `bytes 0-255/${FILE.byteLength}`
            : name.toLowerCase() === 'accept-ranges'
              ? 'bytes'
              : null,
      },
      arrayBuffer: async () => FILE.slice(0, 256).buffer,
    } as unknown as HttpResponseLike;
  });
}

const MANGLED: ReadonlyArray<readonly [string, unknown]> = [
  ['a bearer string', 'Bearer abc123'],
  ['a list of pairs', [['authorization', 'Bearer abc123']]],
  ['a Map', new Map([['authorization', 'Bearer abc123']])],
  ['a Headers-like iterable', { [Symbol.iterator]: function* () {}, authorization: 'Bearer abc' }],
  ['a record with a non-string value', { authorization: 123 }],
];

describe.each(MANGLED)('given %s', (_name, headers) => {
  it('is refused rather than sent in whatever shape the spread made', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const fetch = spyFetch(seen);
    const thrown = await httpSource(URL_, {
      headers: headers as never,
      fetch: fetch as never,
    }).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown, 'the request went out with mangled headers').toBeDefined();
    expect(thrown?.message).toContain('options.headers is');
    expect(thrown?.message).toContain('Next:');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('names what each shape becomes, and the one line that converts it', async () => {
    const thrown = await httpSource(URL_, {
      headers: headers as never,
      fetch: spyFetch([]) as never,
    }).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown?.message).toContain('one header per character');
    expect(thrown?.message).toContain('Object.fromEntries(headers)');
  });

  it('is an EdfSourceError, as every other refusal from this adapter is', async () => {
    const thrown = await httpSource(URL_, {
      headers: headers as never,
      fetch: spyFetch([]) as never,
    }).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown).toBeInstanceOf(EdfSourceError);
    expect(isEdfError(thrown)).toBe(true);
  });
});

describe('a plain record of strings', () => {
  it('still reaches the request intact', async () => {
    const seen: Array<Record<string, unknown>> = [];
    await httpSource(URL_, {
      headers: { authorization: 'Bearer abc' },
      fetch: spyFetch(seen) as never,
    });
    expect(seen[0]?.authorization).toBe('Bearer abc');
  });

  it('still allows no headers at all', async () => {
    const seen: Array<Record<string, unknown>> = [];
    await httpSource(URL_, { fetch: spyFetch(seen) as never });
    expect(seen.length).toBeGreaterThan(0);
  });

  it('takes what Object.fromEntries makes of a Map, which is the advice', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const map = new Map([['authorization', 'Bearer abc']]);
    await httpSource(URL_, {
      headers: Object.fromEntries(map),
      fetch: spyFetch(seen) as never,
    });
    expect(seen[0]?.authorization).toBe('Bearer abc');
  });

  it('leaves the bare-options refusal of 0.6.163 saying its own thing', async () => {
    await expect(httpSource(URL_, 'Bearer abc' as never)).rejects.toThrow(
      /fetch, headers and byteLength are fields on one/,
    );
  });
});
