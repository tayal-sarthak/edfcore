/**
 * HTTP 416, answered with advice about authentication.
 *
 * The catch-all below it covers the statuses that mean "we could not serve you" — 404, 500, 304 —
 * and its advice is about reaching the resource at all: "check the URL, its authentication headers
 * and whether a signed URL has expired." 416 is the opposite of unreachable. The server read the
 * Range header, understood it, and is reporting that the range lies past the end of the resource as
 * it stands now. The length this source was built on is stale, and the URL and its credentials have
 * nothing to do with it.
 *
 * `blob.ts` makes this argument for its own short read and is the precedent: `assertExactRead`
 * "accuses the browser of breaking a contract it kept", and "a picked File is a handle on a file
 * that can still change — the backing file was truncated or replaced since it was chosen, so ask
 * for it again". A URL is the same handle over the network.
 *
 * This adapter already diagnoses two other transport specifics by hand — a 200 that ignored Range,
 * and a Content-Range naming a different part of the resource — so 416 was the one status that says
 * what is wrong and was the one being guessed at.
 *
 * And not advice to clamp: the range was inside the file this source measured, so a caller who
 * clamps is reading a prefix of a resource that changed under them (0.6.302).
 */

import { describe, expect, it } from 'vitest';
import { httpSource } from '../../src/io/http.js';
import type { ByteSource } from '../../src/types.js';

const BODY = new Uint8Array(1000).map((_value, index) => index % 251);

/** The opening request is answered honestly; every later one gets `later`. */
function server(later: () => Response): typeof fetch {
  let seen = 0;
  return (async () => {
    seen += 1;
    return seen === 1
      ? new Response(BODY, {
          status: 200,
          headers: { 'accept-ranges': 'bytes', 'content-length': String(BODY.byteLength) },
        })
      : later();
  }) as unknown as typeof fetch;
}

const opened = (later: () => Response): Promise<ByteSource> =>
  httpSource('https://x.test/f.edf', { fetch: server(later) as never });

const refusal = async (later: () => Response): Promise<string> => {
  const source = await opened(later);
  return Promise.resolve()
    .then(() => source.read(10, 100))
    .then(
      () => '',
      (error: unknown) => (error as Error).message,
    );
};

describe('a range the resource outgrew', () => {
  it('is reported as what 416 actually means', async () => {
    const message = await refusal(() => new Response(null, { status: 416 }));
    expect(message).toContain('HTTP 416 Range Not Satisfiable');
    expect(message).toContain('it read the Range header');
    expect(message).toContain('past the end of the resource as it stands now');
  });

  it('names the length this source was built on, which is the stale part', async () => {
    const message = await refusal(() => new Response(null, { status: 416 }));
    expect(message).toContain('this source was built for 1000 bytes');
  });

  it('no longer sends them to check the URL and its credentials', async () => {
    const message = await refusal(() => new Response(null, { status: 416 }));
    expect(message).not.toContain('authentication headers');
    expect(message).not.toContain('signed URL has expired');
  });

  it('says to rebuild the source rather than clamp the read', async () => {
    const message = await refusal(() => new Response(null, { status: 416 }));
    expect(message).toMatch(
      /Next: the resource was replaced or truncated since its length was probed/,
    );
    expect(message).toContain('build the source again rather than clamping the read');
  });

  it('leaves the unreachable statuses on the advice written for them', async () => {
    for (const status of [404, 500, 304, 403, 401]) {
      const message = await refusal(() => new Response(null, { status }));
      expect(message, String(status)).toContain(`answered HTTP ${status}`);
      expect(message, String(status)).toContain('authentication headers');
      expect(message, String(status)).not.toContain('Range Not Satisfiable');
    }
  });

  it('carries the range it was reading, as every source error here does', async () => {
    const source = await opened(() => new Response(null, { status: 416 }));
    const thrown = await Promise.resolve()
      .then(() => source.read(10, 100))
      .then(
        () => undefined,
        (error: unknown) => error as { offset?: unknown; requestedLength?: unknown },
      );
    expect(thrown?.offset).toBe(10);
    expect(thrown?.requestedLength).toBe(100);
  });

  it('still reads an honest 206 unchanged', async () => {
    const source = await opened(() => {
      const [a, b] = [10, 109];
      return new Response(BODY.subarray(a, b + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${a}-${b}/${BODY.byteLength}` },
      });
    });
    const bytes = await source.read(10, 100);
    expect(bytes.byteLength).toBe(100);
    expect(bytes[0]).toBe(BODY[10]);
  });
});
