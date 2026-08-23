/**
 * What a cached read passes down to the source, and what it keeps.
 *
 * A block read serves every concurrent reader of that block, which makes the caller's read options
 * a question rather than a detail: an option that belongs to one reader must not travel, and one
 * that belongs to the read must.
 *
 * `signal` does not travel, and `cache.test.ts` covers why at length. A viewer using the ordinary
 * stale-request pattern — abort the controller for the window the user scrolled away from — killed
 * the FRESH window whenever both landed in the same block, with an `AbortError` describing
 * something that never happened to it. A reader that passed no signal at all was rejected the same
 * way (0.3.43).
 *
 * `maxMaterializeBytes` does travel, and nothing checked it. It is not one reader's preference: it
 * is a ceiling on what may be allocated, and the block read is the allocation. `cachedSource` over
 * `httpSource` is the composition `api-sources.md` recommends, and there the block read is the
 * request that goes out — a caller who lowered the budget for a read on a phone, and had it
 * dropped on the way to the transport, gets exactly the allocation they were refusing.
 *
 * The pair is the point. Two options, two answers, one call site, and the reason each is what it
 * is has nothing to do with the other.
 *
 * What this does NOT check: what the wrapped source does with the budget. That is the source's
 * business — `httpSource` and `fileSource` each decide — and the claim here is only that the
 * number arrives.
 */

import { describe, expect, it } from 'vitest';
import { cachedSource } from '../../src/io/cached.js';
import type { AbortSignalLike, ByteSource, ReadOptions } from '../../src/types.js';

const SIZE = 512;
const BYTES = Uint8Array.from({ length: SIZE }, (_, at) => at & 0xff);

/** A source that records the options it was handed for each read. */
function watched(): { source: ByteSource; seen: readonly (ReadOptions | undefined)[] } {
  const seen: (ReadOptions | undefined)[] = [];
  return {
    seen,
    source: {
      byteLength: SIZE,
      read: (offset, length, options) => {
        seen.push(options);
        return Promise.resolve(BYTES.subarray(offset, offset + length));
      },
    },
  };
}

describe('the budget', () => {
  it('reaches the source, because the block read is the allocation', async () => {
    const under = watched();
    const cached = cachedSource(under.source, { blockBytes: 64, maxBytes: 4096 });
    await cached.read(0, 8, { maxMaterializeBytes: 1234 });
    expect(under.seen).toHaveLength(1);
    expect(under.seen[0]?.maxMaterializeBytes).toBe(1234);
  });

  it('is absent rather than undefined when the caller did not set one', async () => {
    // `exactOptionalPropertyTypes` is on: `{ maxMaterializeBytes: undefined }` is not the same as
    // an absent property, and a source reading it with `??` would see a different thing.
    const under = watched();
    await cachedSource(under.source, { blockBytes: 64 }).read(0, 8);
    const options = under.seen[0];
    expect(options === undefined || !('maxMaterializeBytes' in options)).toBe(true);
  });

  it('reaches it on a read too wide to cache, which bypasses the cache entirely', async () => {
    const under = watched();
    const cached = cachedSource(under.source, { blockBytes: 64, maxBytes: 64 });
    await cached.read(0, 256, { maxMaterializeBytes: 99 });
    expect(under.seen.at(-1)?.maxMaterializeBytes).toBe(99);
  });
});

describe('the signal', () => {
  it('does not reach the source, because one reader must not cancel another', async () => {
    const under = watched();
    const controller = new AbortController();
    const cached = cachedSource(under.source, { blockBytes: 64, maxBytes: 4096 });
    await cached.read(0, 8, { signal: controller.signal as unknown as AbortSignalLike });
    expect(under.seen).toHaveLength(1);
    const options = under.seen[0];
    expect(options === undefined || options.signal === undefined).toBe(true);
  });

  it('is left behind even when the budget travels beside it', async () => {
    const under = watched();
    const controller = new AbortController();
    await cachedSource(under.source, { blockBytes: 64 }).read(0, 8, {
      maxMaterializeBytes: 777,
      signal: controller.signal as unknown as AbortSignalLike,
    });
    expect(under.seen[0]?.maxMaterializeBytes).toBe(777);
    expect(under.seen[0]?.signal).toBeUndefined();
  });

  it('still cancels the caller, which is what it was for', async () => {
    // Not forwarding it is not ignoring it: the read races the signal and rejects at abort time
    // while the shared block read continues untouched (0.3.79).
    const controller = new AbortController();
    const slow: ByteSource = {
      byteLength: SIZE,
      read: (offset, length) =>
        new Promise((resolve) => {
          setTimeout(() => resolve(BYTES.subarray(offset, offset + length)), 50);
        }),
    };
    const cached = cachedSource(slow, { blockBytes: 64, maxBytes: 4096 });
    const read = cached.read(0, 8, { signal: controller.signal as unknown as AbortSignalLike });
    controller.abort();
    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
  });
});
