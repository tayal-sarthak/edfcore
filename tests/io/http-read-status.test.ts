/**
 * A read that fails after the source was built.
 *
 * `httpSource` reports a bad status twice, from two places, and they are not the same event.
 * `httpSource() could not read ...` comes from the length probe: the source never existed, and
 * `http-length.test.ts` covers it. The other is inside a read, on a source that already opened a
 * file, already parsed its header and is part way through a recording — and it had never run.
 *
 * That is the failure this adapter meets most: a signed URL whose expiry passed while a long
 * overnight study was being read, a token rotated by the identity provider, a bucket policy
 * tightened, a 500 from the origin behind a CDN. Every one of them is a mid-read status, and the
 * message is written for exactly that reader — it names the byte range that was being fetched and
 * ends by asking about authentication headers and expiry, neither of which makes sense for a URL
 * that never worked.
 *
 * The status is QUOTED rather than classified. edfcore has no opinion about which 4xx or 5xx means
 * what, and a reader matching the message against an access log needs the number the server sent,
 * so 403, 404 and 503 are checked to produce three different messages rather than one.
 */

import { describe, expect, it } from 'vitest';
import { EdfSourceError } from '../../src/errors.js';
import { httpSource } from '../../src/io/http.js';
import type { FetchLike, HttpResponseLike } from '../../src/types.js';

const HREF = 'https://signed.example.org/overnight.edf?X-Expires=1';
const SIZE = 4096;
const BODY = new Uint8Array(SIZE).map((_, at) => at & 0xff);

interface Server {
  readonly fetch: FetchLike;
  /** The status every GET after the first one is answered with. */
  fail(status: number): void;
  recover(): void;
  gets(): number;
}

/** A range server that serves correctly until it is told to start refusing. */
function expiring(): Server {
  let failWith: number | undefined;
  let gets = 0;
  const fetchImpl = ((
    _href: string,
    init?: { method?: string; headers?: Record<string, string> },
  ) => {
    if ((init?.method ?? 'GET') === 'HEAD') {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: (name: string) => (/content-length/i.test(name) ? String(SIZE) : null) },
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      } as unknown as HttpResponseLike);
    }
    gets += 1;
    if (failWith !== undefined) {
      return Promise.resolve({
        ok: false,
        status: failWith,
        headers: { get: () => null },
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      } as unknown as HttpResponseLike);
    }
    const range = /bytes=(\d+)-(\d+)/.exec(init?.headers?.Range ?? init?.headers?.range ?? '');
    const first = Number(range?.[1] ?? 0);
    const last = Number(range?.[2] ?? SIZE - 1);
    return Promise.resolve({
      ok: true,
      status: 206,
      headers: {
        get: (name: string) =>
          /content-range/i.test(name) ? `bytes ${first}-${last}/${SIZE}` : null,
      },
      arrayBuffer: () => Promise.resolve(BODY.slice(first, last + 1).buffer),
    } as unknown as HttpResponseLike);
  }) as unknown as FetchLike;
  return {
    fetch: fetchImpl,
    fail: (status: number) => {
      failWith = status;
    },
    recover: () => {
      failWith = undefined;
    },
    gets: () => gets,
  };
}

async function thrownBy(call: () => Promise<unknown>): Promise<unknown> {
  const caught = await call().then(
    () => undefined,
    (error: unknown) => ({ error }),
  );
  if (caught === undefined) throw new Error('the read resolved and was supposed to throw');
  return caught.error;
}

describe('a status the server sends part way through a recording', () => {
  it('reads fine first, so the refusal below is about the status and nothing else', async () => {
    const remote = expiring();
    const source = await httpSource(HREF, { fetch: remote.fetch });
    const bytes = await source.read(0, 16);
    expect([...bytes]).toEqual([...BODY.subarray(0, 16)]);
  });

  it('refuses with an EdfSourceError naming the status and the range', async () => {
    const remote = expiring();
    const source = await httpSource(HREF, { fetch: remote.fetch });
    await source.read(0, 16);
    remote.fail(403);

    const error = await thrownBy(() => source.read(1024, 256));

    expect(error).toBeInstanceOf(EdfSourceError);
    expect((error as EdfSourceError).edfErrorKind).toBe('source');
    const message = (error as EdfSourceError).message;
    expect(message).toContain('Reading bytes 1024..1279');
    expect(message).toContain(HREF);
    expect(message).toContain('answered HTTP 403');
    // Written for a caller whose URL worked a minute ago, which is what a mid-read status means.
    expect(message).toContain('a signed URL has expired');
  });

  it('carries the range it was asked for on the error, not the one it received', async () => {
    const remote = expiring();
    const source = await httpSource(HREF, { fetch: remote.fetch });
    remote.fail(500);

    const error = (await thrownBy(() => source.read(2048, 512))) as EdfSourceError;
    expect(error.offset).toBe(2048);
    expect(error.requestedLength).toBe(512);
    // Nothing arrived, so there is no received length to report — `api-errors.md` documents the
    // field as `number | undefined` for exactly this shape of failure.
    expect(error.receivedLength).toBeUndefined();
  });

  it.each([403, 404, 503])('quotes %i rather than classifying it', async (status) => {
    const remote = expiring();
    const source = await httpSource(HREF, { fetch: remote.fetch });
    remote.fail(status);
    const error = (await thrownBy(() => source.read(0, 8))) as EdfSourceError;
    expect(error.message).toContain(`answered HTTP ${status}`);
  });

  it('does not poison the source: a read after the token is renewed succeeds', async () => {
    // A failed read leaves no state behind. Without this the test above would pass on an
    // implementation that latched the first failure and refused everything afterwards.
    const remote = expiring();
    const source = await httpSource(HREF, { fetch: remote.fetch });
    remote.fail(401);
    await thrownBy(() => source.read(0, 8));
    remote.recover();

    const bytes = await source.read(64, 32);
    expect([...bytes]).toEqual([...BODY.subarray(64, 96)]);
    expect(remote.gets()).toBeGreaterThan(1);
  });
});
