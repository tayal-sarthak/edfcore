/**
 * A real `AbortSignal` reaches `fetch`; a bare `{ aborted }` shim never does.
 *
 * `FetchLike` deliberately does not name `signal` — naming it would pull the DOM `AbortSignal`
 * into the published types by parameter contravariance, which is the exact dependency the
 * structural shims exist to avoid. So the signal is handed over at runtime and the decision about
 * whether to hand it over is one line: attach it only when it carries `addEventListener`.
 *
 * Both halves matter and they fail differently.
 *
 * Attaching a shim would be loud. The platform `fetch` throws a `TypeError` on an init whose
 * `signal` is not an `AbortSignal`, so every request from a caller using the published
 * `AbortSignalLike` type would fail immediately — for a type this package exports and documents.
 *
 * NOT attaching a real one is silent, and it is the half nothing had exercised: no test had ever
 * given `httpSource` a genuine `AbortSignal`. Without the attach, `throwIfSignalAborted` still
 * rejects the caller's promise at the next poll — so an abort looks like it worked — while the
 * request itself runs to completion. On a range covering a few hundred megabytes that is the
 * difference between cancelling a transfer and paying for it, and the only visible symptom is a
 * bill, or a phone that stays warm after the user navigated away.
 *
 * A source-level `signal` and a per-read one are both checked, because `api-sources.md` documents
 * the first as "the default for every request" and the second as winning over it — and the read
 * path resolves them before this decision is reached.
 */

import { describe, expect, it } from 'vitest';
import { httpSource } from '../../src/io/http.js';
import type { AbortSignalLike, FetchLike, HttpResponseLike } from '../../src/types.js';

const HREF = 'https://data.example.org/night.edf';
const SIZE = 64;

interface Seen {
  readonly method: string;
  readonly signal: unknown;
  readonly hasSignal: boolean;
}

/** A server that records the init it was handed, including whether a signal was attached. */
function server(): { fetch: FetchLike; seen: readonly Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl = ((_href: string, init?: Record<string, unknown>) => {
    seen.push({
      method: (init?.method as string) ?? 'GET',
      signal: init?.signal,
      // `in`, not a truthiness test: an absent property and a present `undefined` are the same
      // to a caller reading it and different to the platform, which rejects the latter too.
      hasSignal: init !== undefined && 'signal' in init,
    });
    // Exactly the bytes the Range asked for. A source that pads or truncates is refused by
    // `assertExactRead`, and rightly — the point here is the signal, not a short read.
    const range = (init?.headers as Record<string, string> | undefined)?.Range ?? '';
    const bounds = /bytes=(\d+)-(\d+)/.exec(range);
    const length = bounds === null ? 0 : Number(bounds[2]) - Number(bounds[1]) + 1;
    return Promise.resolve({
      ok: true,
      status: 206,
      headers: { get: () => null },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(length)),
    } as unknown as HttpResponseLike);
  }) as unknown as FetchLike;
  return { fetch: fetchImpl, seen };
}

describe('a genuine AbortSignal', () => {
  it('is handed to fetch, so the request itself can be cancelled', async () => {
    const remote = server();
    const controller = new AbortController();
    const source = await httpSource(HREF, {
      fetch: remote.fetch,
      byteLength: SIZE,
      signal: controller.signal as unknown as AbortSignalLike,
    });
    await source.read(0, 8);

    expect(remote.seen.length).toBeGreaterThan(0);
    for (const call of remote.seen) {
      expect(call.hasSignal, `${call.method} went out without the signal`).toBe(true);
      // The caller's own object, not a copy: aborting theirs has to abort this request.
      expect(call.signal).toBe(controller.signal);
    }
  });

  it('is handed over when it is passed to the read rather than the source', async () => {
    const remote = server();
    const controller = new AbortController();
    const source = await httpSource(HREF, { fetch: remote.fetch, byteLength: SIZE });
    await source.read(0, 8, { signal: controller.signal as unknown as AbortSignalLike });
    expect(remote.seen[0]?.signal).toBe(controller.signal);
  });

  it('lets the request end the read, rather than the read outliving it', async () => {
    // The end-to-end shape: a transport that honours the signal rejects, and that rejection is
    // what the caller sees. Without the attach this fetch would never learn of the abort.
    const controller = new AbortController();
    const fetchImpl = ((_href: string, init?: Record<string, unknown>) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<HttpResponseLike>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          const error = new Error('The operation was aborted.');
          error.name = 'AbortError';
          reject(error);
        });
      });
    }) as unknown as FetchLike;

    const source = await httpSource(HREF, { fetch: fetchImpl, byteLength: SIZE });
    const read = source.read(0, 8, { signal: controller.signal as unknown as AbortSignalLike });
    controller.abort();
    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('a bare { aborted } shim', () => {
  it('is never handed to fetch, which would refuse it', async () => {
    const remote = server();
    const shim: AbortSignalLike = { aborted: false };
    const source = await httpSource(HREF, {
      fetch: remote.fetch,
      byteLength: SIZE,
      signal: shim,
    });
    await source.read(0, 8);

    expect(remote.seen.length).toBeGreaterThan(0);
    for (const call of remote.seen) {
      expect(call.hasSignal, `${call.method} was given a shim as its signal`).toBe(false);
    }
  });

  it('still cancels the read, through the polls around the request', async () => {
    // The compensation for not attaching it. `api-sources.md` promises a caller who passed a shim
    // "is still served by the polls around the request, so cancellation works either way".
    const remote = server();
    const shim = { aborted: false } as { aborted: boolean };
    const source = await httpSource(HREF, { fetch: remote.fetch, byteLength: SIZE });
    shim.aborted = true;
    await expect(source.read(0, 8, { signal: shim })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('is not attached even when it carries other properties', async () => {
    const remote = server();
    // Everything but `addEventListener`: the test is for the one member that makes it real.
    const shim = { aborted: false, reason: undefined, onabort: null } as unknown as AbortSignalLike;
    const source = await httpSource(HREF, { fetch: remote.fetch, byteLength: SIZE, signal: shim });
    await source.read(0, 8);
    expect(remote.seen.every((call) => !call.hasSignal)).toBe(true);
  });
});
