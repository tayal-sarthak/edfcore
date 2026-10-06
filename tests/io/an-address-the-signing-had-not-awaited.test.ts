/**
 * `httpSource(getSignedUrl(key))`, told to convert something.
 *
 * The guard's advice was "pass the address as a string, or as new URL(address)". A pending Promise is
 * neither of those, so the sentence reads as a request to convert the value when what is missing is
 * one keyword. 0.6.264 made this argument for the SOURCE and named the two adapters that need
 * awaiting; `httpSource` is one of them, and its own first argument had the same hole.
 *
 * An address that has to be fetched is not an edge case for this adapter. `data-sources.md` publishes
 * "a signed-URL refresher" as a supported use of `options.fetch`, and the comment on `resolveFetch`
 * names "a signed-URL wrapper" twice among the reasons the option exists. So an address minted by a
 * presigning call or a token service is a shape `httpSource` is built for — and minting one is async.
 *
 * The advice names the refresher deliberately, because the two halves pair: `await` the address to
 * build the source, and pass `options.fetch` to re-sign it for the reads that follow. A reader who
 * only awaits will hit the expiry later; this is the one message where both halves fit.
 *
 * The other arm is unchanged: a number, a plain object with no `href`, or an omitted argument is not
 * an address, and for those "pass it as a string, or as new URL(address)" is the useful thing to say
 * (0.6.296).
 */

import { describe, expect, it } from 'vitest';
import { httpSource } from '../../src/io/http.js';

/** A server that answers the one length probe `httpSource` makes at construction. */
const ok = (async () =>
  new Response(null, {
    status: 200,
    headers: { 'accept-ranges': 'bytes', 'content-length': '512' },
  })) as unknown as typeof fetch;

const refusal = async (url: unknown): Promise<string> =>
  Promise.resolve()
    .then(() => httpSource(url as never, { fetch: ok as never }))
    .then(
      () => '',
      (error: unknown) => (error as Error).message,
    );

/** What a presigning call hands back: a Promise of the address, not the address. */
const getSignedUrl = async (key: string): Promise<string> =>
  `https://example.test/${key}?X-Amz-Signature=abc`;

describe('an address the signing had not awaited', () => {
  it('is what a presigning call really returns', async () => {
    const pending = getSignedUrl('f.edf');
    expect(typeof (pending as { then?: unknown }).then).toBe('function');
    // And what it resolves to is what `httpSource` takes.
    expect((await httpSource(await pending, { fetch: ok as never })).byteLength).toBe(512);
  });

  it('is told to await it rather than to convert it', async () => {
    const message = await refusal(getSignedUrl('f.edf'));
    expect(message).toContain('received a pending Promise');
    expect(message).toMatch(/Next: await it/);
    expect(message).not.toMatch(/Next: pass the address as a string/);
  });

  it('names the refresher too, because the two halves pair', async () => {
    const message = await refusal(getSignedUrl('f.edf'));
    expect(message).toContain('options.fetch');
    expect(message).toMatch(/refreshing it once the source exists/);
  });

  it('keeps the conversion advice for everything that is not a Promise', async () => {
    for (const [what, value] of [
      ['undefined', undefined],
      ['a number', 8],
      ['an object with no href', { pathname: '/f.edf' }],
      ['null', null],
    ] as ReadonlyArray<readonly [string, unknown]>) {
      const message = await refusal(value);
      expect(message, what).toMatch(/Next: pass the address as a string, or as new URL\(address\)/);
      expect(message, what).not.toMatch(/Next: await it/);
    }
  });

  it('still says what it needs, in both arms', async () => {
    for (const value of [getSignedUrl('f.edf'), 8]) {
      const message = await refusal(value);
      expect(message).toContain('httpSource() needs a URL string or a URL object');
      expect(message).toMatch(/Next:/);
    }
  });

  it('still accepts a string and a URL object', async () => {
    expect(
      (await httpSource('https://example.test/f.edf', { fetch: ok as never })).byteLength,
    ).toBe(512);
    expect(
      (await httpSource(new URL('https://example.test/f.edf'), { fetch: ok as never })).byteLength,
    ).toBe(512);
  });
});
