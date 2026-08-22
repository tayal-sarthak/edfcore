/**
 * The whole resource, buffered once, and what a read off it owes the caller.
 *
 * A `200 OK` to a Range request means the server ignored the header. That is refused by default,
 * and `allowFullDownload: true` is the escape hatch `data-sources.md` recommends when the origin
 * is broken and cannot be fixed: buffer the resource once, serve every read from memory.
 *
 * `hardening.test.ts` pins the transfer count — thirty-two concurrent reads cost one download —
 * which was a real out-of-memory defect. What that leaves is everything about the buffer once it
 * exists, and each piece has a failure a reader would not connect to this option:
 *
 *  - A read returns a COPY. `sliceFullBody` says `slice`, not `subarray`, because the body is
 *    retained state: a view into it makes one caller's write change what the next caller reads,
 *    and the samples that change belong to a different part of the recording. This is the same
 *    property `api-sources.md` states for `cachedSource`, on the other object that retains bytes.
 *  - The resource can be SHORTER than the source was told. `options.byteLength` with
 *    `allowFullDownload` is exactly the pair the page recommends for a broken origin, so it is the
 *    combination a reader reaches for, and a stale `Content-Length` then makes every read past the
 *    real end a range that does not exist. That message is written here rather than left to
 *    `assertExactRead`, whose advice — loop until the bytes arrive — is unactionable when no
 *    number of retries produces bytes the resource does not contain (0.3.75).
 *  - A transfer that FAILS must not poison the source. The one in-flight promise is cleared on
 *    rejection, so a later read starts a new one instead of inheriting a rejected one forever.
 *
 * The probe-time entry is checked too. When no `byteLength` was passed and the length probe itself
 * is answered with a 200, the body arrives before any read does, and the source is built from it —
 * a different route to the same buffer, and the one where the size is learned from the download
 * rather than from a header.
 */

import { describe, expect, it } from 'vitest';
import { EdfSourceError } from '../../src/errors.js';
import { httpSource } from '../../src/io/http.js';
import type { FetchLike, HttpResponseLike } from '../../src/types.js';

const HREF = 'https://data.example.org/night.bdf';
const SIZE = 4096;
const BODY = new Uint8Array(SIZE).map((_, at) => at & 0xff);

interface Server {
  readonly fetch: FetchLike;
  gets(): number;
}

/**
 * A server that ignores Range on every GET and sends the whole resource.
 *
 * `headLength` is what its HEAD claims, or `null` for a HEAD that fails — the two ways a caller
 * arrives here with and without a length already in hand.
 */
function rangeIgnoring(options?: { headLength?: number | null; failFirstBody?: boolean }): Server {
  let gets = 0;
  let bodies = 0;
  const fetchImpl = ((_href: string, init?: { method?: string }) => {
    if ((init?.method ?? 'GET') === 'HEAD') {
      const claim = options?.headLength;
      if (claim === undefined || claim === null) return Promise.reject(new Error('HEAD refused'));
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: (name: string) => (/content-length/i.test(name) ? String(claim) : null) },
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      } as unknown as HttpResponseLike);
    }
    gets += 1;
    return Promise.resolve({
      ok: true,
      // The whole point: a 200 to a request that carried a Range header.
      status: 200,
      headers: { get: () => null },
      arrayBuffer: () => {
        bodies += 1;
        if (options?.failFirstBody === true && bodies === 1) {
          return Promise.reject(new Error('connection reset mid-transfer'));
        }
        return Promise.resolve(BODY.buffer.slice(0));
      },
    } as unknown as HttpResponseLike);
  }) as unknown as FetchLike;
  return { fetch: fetchImpl, gets: () => gets };
}

describe('the probe that had to download everything', () => {
  it('builds the source from what arrived, and reads it without asking again', async () => {
    const server = rangeIgnoring();
    const source = await httpSource(HREF, { fetch: server.fetch, allowFullDownload: true });
    // No HEAD length and no Content-Range: the size is what the transfer turned out to be.
    expect(source.byteLength).toBe(SIZE);
    const before = server.gets();
    expect([...(await source.read(0, 4))]).toEqual([0, 1, 2, 3]);
    expect([...(await source.read(SIZE - 2, 2))]).toEqual([(SIZE - 2) & 0xff, (SIZE - 1) & 0xff]);
    expect(server.gets()).toBe(before);
  });

  it('refuses without the option, naming the one-byte range it asked for', async () => {
    const server = rangeIgnoring();
    const failure = await httpSource(HREF, { fetch: server.fetch }).then(
      () => undefined,
      (thrown: unknown) => thrown as EdfSourceError,
    );
    expect(failure).toBeInstanceOf(EdfSourceError);
    expect(failure?.message).toContain('HTTP_RANGE_IGNORED');
    expect(failure?.message).toContain('bytes=0-0');
    expect(failure?.message).toContain('allowFullDownload: true');
  });

  it('answers a zero-length read without any transfer at all', async () => {
    const server = rangeIgnoring({ headLength: SIZE });
    const source = await httpSource(HREF, { fetch: server.fetch, allowFullDownload: true });
    expect(await source.read(0, 0)).toHaveLength(0);
    expect(server.gets()).toBe(0);
  });
});

describe('a read off the buffer', () => {
  it('is a copy, so one caller cannot rewrite another caller bytes', async () => {
    const server = rangeIgnoring({ headLength: SIZE });
    const source = await httpSource(HREF, { fetch: server.fetch, allowFullDownload: true });

    const mine = await source.read(64, 8);
    mine.fill(0xff);
    const yours = await source.read(64, 8);
    expect([...yours]).toEqual([64, 65, 66, 67, 68, 69, 70, 71]);
    // And the neighbouring bytes are intact too, which a subarray write would have spilled into.
    expect([...(await source.read(72, 2))]).toEqual([72, 73]);
  });

  it('says the length is what is wrong when the resource is shorter than claimed', async () => {
    // The pair the page recommends for a broken origin, with a stale Content-Length behind it.
    const server = rangeIgnoring({ headLength: SIZE });
    const source = await httpSource(HREF, {
      fetch: server.fetch,
      allowFullDownload: true,
      byteLength: SIZE * 2,
    });
    const failure = await source.read(SIZE - 8, 16).then(
      () => undefined,
      (thrown: unknown) => thrown as EdfSourceError,
    );
    expect(failure).toBeInstanceOf(EdfSourceError);
    // The real size, taken from the body in hand rather than left for the caller to discover.
    expect(failure?.message).toContain(`it is ${SIZE} bytes`);
    expect(failure?.message).toContain(`built for ${SIZE * 2} bytes`);
    expect(failure?.message).toContain('the length is what is wrong');
    // Not the advice `assertExactRead` would have given, which no retry could act on.
    expect(failure?.message).not.toContain('loop until');
    expect(failure?.receivedLength).toBe(8);
  });
});

describe('a transfer that failed', () => {
  it('does not poison the reads that come after it', async () => {
    const server = rangeIgnoring({ headLength: SIZE, failFirstBody: true });
    const source = await httpSource(HREF, { fetch: server.fetch, allowFullDownload: true });

    await expect(source.read(0, 4)).rejects.toThrow('connection reset');
    // A retained rejected promise would make this the same failure forever.
    expect([...(await source.read(0, 4))]).toEqual([0, 1, 2, 3]);
    expect(server.gets()).toBe(2);
  });
});
