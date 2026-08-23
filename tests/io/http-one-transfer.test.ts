/**
 * A server that ignores Range is downloaded once, however the readers arrive.
 *
 * `allowFullDownload: true` is what a caller reaches for when an origin cannot be fixed, and it
 * turns every read into a claim on one transfer. Getting that wrong is not slow, it is fatal:
 * every read that entered `fetchRange` used to issue its own GET, each buffering the whole
 * resource, so N concurrent block reads downloaded the file N times and held up to
 * `maxConcurrency` copies at once — a large remote recording becoming an out-of-memory crash
 * rather than a slow read.
 *
 * `hardening.test.ts` pins the count for readers that arrive together at the default concurrency.
 * There are three other ways to arrive, and each takes a different branch:
 *
 *  - **Queued behind the gate.** With `maxConcurrency: 1` a reader waits, and by the time it has a
 *    slot the answer already exists. Waiting for a slot can take arbitrarily long, which is
 *    exactly when a stale decision is most likely.
 *  - **Waiting on someone else's probe.** A reader that arrives while the first is still finding
 *    out whether the server honours Range has nothing to do but wait for that answer, and then use
 *    it rather than asking again.
 *  - **Arriving afterwards.** A read issued once everything has settled must not go out at all.
 *
 * What this does NOT distinguish: the re-check immediately after the gate from the shared-probe
 * wait below it. With `allowFullDownload` on, a queued reader that reaches the gate always finds
 * the probe already there and takes its answer, so removing the earlier check changes no count.
 * They are belt and braces for the same window; what is pinned is that the window is closed.
 *
 * All three end in the same place, which is the point: one request, one transfer, and every reader
 * served the bytes it asked for. Both counts are asserted, because they are protected by different
 * guards — the one inside the response handler stops a second DOWNLOAD, and the ones before the
 * request stop a second GET. With only the first, eight readers cost eight requests and one body:
 * the same bill on a metered origin, for the same bytes, and nothing in the result to show it.
 */

import { describe, expect, it } from 'vitest';
import { httpSource } from '../../src/io/http.js';
import type { ByteSource, FetchLike, HttpResponseLike } from '../../src/types.js';

const HREF = 'https://data.example.org/night.bdf';
const SIZE = 4096;
const BODY = new Uint8Array(SIZE).map((_, at) => at & 0xff);

interface Server {
  readonly fetch: FetchLike;
  /** Bodies actually pulled down: what memory and bandwidth cost. */
  transfers(): number;
  /** Requests issued: what a metered origin bills, and what the outer guards exist to avoid. */
  requests(): number;
  release(): void;
}

/**
 * Ignores Range on every GET and answers 200 with the whole resource.
 *
 * `hold` keeps the body promise pending until `release()`, so a test can put a second reader into
 * the window where the first has issued its request and has not yet finished.
 */
function rangeIgnoring(hold: boolean): Server {
  let transfers = 0;
  let requests = 0;
  let releaseBody = (): void => {};
  const gate = new Promise<void>((resolve) => {
    releaseBody = resolve;
  });
  const fetchImpl = (() => {
    requests += 1;
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => {
        transfers += 1;
        if (hold) await gate;
        return BODY.buffer.slice(0);
      },
    } as unknown as HttpResponseLike);
  }) as unknown as FetchLike;
  return {
    fetch: fetchImpl,
    transfers: () => transfers,
    requests: () => requests,
    release: releaseBody,
  };
}

const openWith = (server: Server, maxConcurrency: number): Promise<ByteSource> =>
  httpSource(HREF, {
    fetch: server.fetch,
    byteLength: SIZE,
    allowFullDownload: true,
    maxConcurrency,
  });

const expectBytes = (got: Uint8Array, offset: number, length: number): void => {
  expect([...got]).toEqual([...BODY.subarray(offset, offset + length)]);
};

describe('readers queued behind the gate', () => {
  it('take the answer the first one found rather than asking again', async () => {
    // One slot: every reader after the first waits, and finds the resource already in hand.
    const server = rangeIgnoring(false);
    const source = await openWith(server, 1);
    const reads = Array.from({ length: 8 }, (_, at) => source.read(at * 64, 64));
    const chunks = await Promise.all(reads);

    expect(server.transfers()).toBe(1);
    // And one REQUEST, not eight. The inner guard alone would still have downloaded once while
    // sending eight GETs — the same bill, on a metered origin, for the same bytes.
    expect(server.requests()).toBe(1);
    chunks.forEach((chunk, at) => {
      expectBytes(chunk, at * 64, 64);
    });
  });
});

describe('a reader that arrives while the first is still finding out', () => {
  it('waits for that answer instead of starting a second transfer', async () => {
    const server = rangeIgnoring(true);
    const source = await openWith(server, 4);

    const first = source.read(0, 64);
    // Let the first read reach the transport and sit there.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = source.read(128, 64);
    await new Promise((resolve) => setTimeout(resolve, 5));

    server.release();
    const [a, b] = await Promise.all([first, second]);

    expect(server.transfers()).toBe(1);
    // The second reader had nothing to do but wait for the first one's answer.
    expect(server.requests()).toBe(1);
    expectBytes(a, 0, 64);
    expectBytes(b, 128, 64);
  });
});

describe('a reader that arrives afterwards', () => {
  it('is served from memory and issues nothing', async () => {
    const server = rangeIgnoring(false);
    const source = await openWith(server, 4);
    await source.read(0, 16);
    const settled = server.transfers();
    const asked = server.requests();

    for (const [offset, length] of [
      [0, 1],
      [SIZE - 1, 1],
      [1000, 500],
    ] as ReadonlyArray<readonly [number, number]>) {
      expectBytes(await source.read(offset, length), offset, length);
    }
    expect(server.transfers()).toBe(settled);
    expect(server.requests()).toBe(asked);
  });
});

describe('however they arrive', () => {
  it('every reader gets the bytes it asked for, not the ones someone else did', async () => {
    // The failure a transfer count cannot see: one buffer, shared, and sliced at the wrong offset.
    const server = rangeIgnoring(false);
    const source = await openWith(server, 2);
    const offsets = [0, 7, 64, 1023, 2048, SIZE - 32];
    const chunks = await Promise.all(offsets.map((offset) => source.read(offset, 32)));
    chunks.forEach((chunk, at) => {
      expectBytes(chunk, offsets[at] as number, 32);
    });
    expect(server.transfers()).toBe(1);
    expect(server.requests()).toBe(1);
  });
});
