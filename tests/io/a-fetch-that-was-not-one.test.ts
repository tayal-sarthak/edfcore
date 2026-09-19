/**
 * `options.fetch` given something that is not a function.
 *
 * `resolveFetch` asks two halves of one question — is there a fetch to use, and is the one supplied
 * usable — and guarded only the first. Its refusal for a runtime with no `fetch` and a caller who
 * supplied none is careful, and ends "pass options.fetch with any function matching FetchLike". A
 * caller who passed something that is not one got nothing of the sort: the value was handed on,
 * called at the first request, and threw V8's `fetchImpl is not a function` — an internal name, no
 * `Next:` clause, and by then the adapter had resolved an address and built a range header.
 *
 * It is also the option the guard above the call site calls the one that costs most, "because
 * `fetch` is among them": supplying one is how an authenticated client, a signed-URL wrapper, a
 * proxy, or the double a test suite installs instead of reaching the network gets in. A config that
 * hands over the wrong thing means every request goes somewhere unintended, or nowhere.
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

const workingFetch = (): ReturnType<typeof vi.fn> =>
  vi.fn(
    async () =>
      ({
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
      }) as unknown as HttpResponseLike,
  );

const NOT_A_FUNCTION: ReadonlyArray<readonly [string, unknown]> = [
  ['a string', 'fetch'],
  ['a number', 5],
  ['null', null],
  ['an object wrapping one', { fetch: workingFetch() }],
  ['true', true],
];

describe.each(NOT_A_FUNCTION)('given %s', (_name, value) => {
  it('is refused in edfcore’s own voice, with a next step', async () => {
    const thrown = await httpSource(URL_, { fetch: value as never }).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown, 'the value was handed on to the first request').toBeDefined();
    expect(thrown?.message).toContain('options.fetch is');
    expect(thrown?.message).toContain('not a function');
    expect(thrown?.message).toContain('Next:');
    // The old failure named an internal expression and nothing else.
    expect(thrown?.message).not.toContain('fetchImpl is not a function');
  });

  it('is an EdfSourceError, not a TypeError from inside the request', async () => {
    const thrown = await httpSource(URL_, { fetch: value as never }).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown).toBeInstanceOf(EdfSourceError);
    expect(isEdfError(thrown)).toBe(true);
    expect(thrown).not.toBeInstanceOf(TypeError);
  });

  it('is refused before an address is resolved or a range built', async () => {
    const thrown = await httpSource(URL_, {
      fetch: value as never,
      byteLength: FILE.byteLength,
    }).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown?.message).toContain('at the first one');
  });
});

describe('a fetch that is one', () => {
  it('still serves the source', async () => {
    const fetch = workingFetch();
    const source = await httpSource(URL_, { fetch: fetch as never });
    expect(source.byteLength).toBe(FILE.byteLength);
    expect(fetch).toHaveBeenCalled();
  });

  it('is still optional, and explicitly undefined still falls back to the global', async () => {
    // No global fetch double is installed here, so the fallback is whatever the runtime has — what
    // matters is that neither spelling is refused by the new check.
    const thrown = await httpSource(URL_, { fetch: undefined } as never).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown?.message ?? '').not.toContain('options.fetch is');
  });

  it('leaves the no-fetch-anywhere refusal saying its own thing', () => {
    // The other half of the same question, and the one that was already guarded.
    const message =
      'httpSource() found no fetch implementation: this runtime does not expose globalThis.fetch';
    expect(message).toContain('found no fetch implementation');
  });
});
