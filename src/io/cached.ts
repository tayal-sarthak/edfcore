/**
 * The only cache in edfcore: opt-in, visible at the call site, and removed by deleting one
 * wrapper from the expression that built the source.
 *
 * Layer 5. A block-aligned LRU over an arbitrary `ByteSource`. Two properties matter more than
 * the hit rate:
 *
 * 1. A read returns a COPY, never a view into a retained block. `types.ts` gives the returned
 *    array to the caller, and a caller who writes into it must not be able to corrupt what the
 *    next reader sees.
 * 2. Concurrent reads wanting the same block issue ONE underlying read. Over HTTP the
 *    difference between one request and eight is the difference between usable and not.
 *
 * Block boundaries are byte-aligned, not record-aligned: this module is format-independent by
 * construction and has no access to a header, so there is no record size to align to.
 */

import { requireFiniteOption } from '../options.js';
import type { ByteSource, CacheOptions, ReadOptions } from '../types.js';
import { assertExactRead, assertReadRange, throwIfAborted } from './source.js';

const DEFAULT_BLOCK_BYTES = 1024 * 1024;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

/** Delegation with the contract still enforced, for configurations that cannot cache. */
function passThrough(source: ByteSource): ByteSource {
  return {
    byteLength: source.byteLength,
    async read(offset: number, length: number, options?: ReadOptions): Promise<Uint8Array> {
      return assertExactRead(await source.read(offset, length, options), offset, length);
    },
    async close(): Promise<void> {
      await source.close?.();
    },
  };
}

export function cachedSource(source: ByteSource, options?: CacheOptions): ByteSource {
  const byteLength = source.byteLength;
  const maxBytes = Math.max(
    0,
    Math.floor(requireFiniteOption(options?.maxBytes, 'maxBytes', DEFAULT_MAX_BYTES)),
  );
  const requestedBlockBytes = Math.max(
    1,
    Math.floor(requireFiniteOption(options?.blockBytes, 'blockBytes', DEFAULT_BLOCK_BYTES)),
  );
  // A block wider than the whole budget would evict itself on every insert, so the block is
  // clamped to the budget rather than the cache being left in a state that can never hold one.
  const blockBytes = Math.min(requestedBlockBytes, maxBytes);
  if (blockBytes < 1) return passThrough(source);

  /** Insertion order is LRU order, oldest first; a hit re-inserts to move to the back. */
  const blocks = new Map<number, Uint8Array>();
  const inflight = new Map<number, Promise<Uint8Array>>();
  let cachedBytes = 0;

  function evict(): void {
    // Deleting during Map iteration is well defined and never revisits an entry, so this walks
    // strictly from the oldest block forward.
    for (const [index, block] of blocks) {
      if (cachedBytes <= maxBytes) return;
      blocks.delete(index);
      cachedBytes -= block.byteLength;
    }
  }

  // Set by `close()`. A read that was already in flight when close was called still resolves, and
  // its `.then` still runs — after `blocks.clear()` — so without this the cache repopulated itself
  // AFTER being closed and then served that data on later reads, from a source whose own `close`
  // had already run. `admit` is where that happens, so `admit` is where it is stopped.
  let closed = false;

  function admit(index: number, block: Uint8Array): void {
    if (closed || blocks.has(index)) return;
    blocks.set(index, block);
    cachedBytes += block.byteLength;
    evict();
  }

  async function fetchBlock(index: number, options?: ReadOptions): Promise<Uint8Array> {
    const start = index * blockBytes;
    const length = Math.min(blockBytes, byteLength - start);
    return assertExactRead(await source.read(start, length, options), start, length);
  }

  function blockFor(index: number, options?: ReadOptions): Promise<Uint8Array> {
    const cached = blocks.get(index);
    if (cached !== undefined) {
      blocks.delete(index);
      blocks.set(index, cached);
      return Promise.resolve(cached);
    }
    const pending = inflight.get(index);
    // Deduped readers share the first caller's options, which is inherent to issuing one read
    // for all of them.
    if (pending !== undefined) return pending;

    const started = fetchBlock(index, options)
      .then((block) => {
        admit(index, block);
        return block;
      })
      .finally(() => {
        inflight.delete(index);
      });
    inflight.set(index, started);
    return started;
  }

  return {
    byteLength,
    async read(offset: number, length: number, options?: ReadOptions): Promise<Uint8Array> {
      throwIfAborted(options);
      assertReadRange(offset, length, byteLength);
      if (length === 0) return new Uint8Array(0);
      // A read wider than the entire budget cannot benefit from the cache and would evict every
      // block on its way through, so it goes straight to the source. The array is the wrapped
      // source's own, not a copy, and that is correct rather than an oversight: the "a cache hands
      // back a copy" rule exists because a cache RETAINS its blocks, and nothing is retained here.
      // This path is exactly as safe as calling the wrapped source directly, because that is what
      // it does.
      if (length > maxBytes) {
        return assertExactRead(await source.read(offset, length, options), offset, length);
      }

      const firstBlock = Math.floor(offset / blockBytes);
      const lastBlock = Math.floor((offset + length - 1) / blockBytes);
      const pending: Array<Promise<Uint8Array>> = [];
      for (let index = firstBlock; index <= lastBlock; index += 1) {
        pending.push(blockFor(index, options));
      }
      const resolved = await Promise.all(pending);
      throwIfAborted(options);

      const out = new Uint8Array(length);
      for (const [position, block] of resolved.entries()) {
        const blockStart = (firstBlock + position) * blockBytes;
        const from = Math.max(offset, blockStart);
        const to = Math.min(offset + length, blockStart + block.byteLength);
        if (to <= from) continue;
        out.set(block.subarray(from - blockStart, to - blockStart), from - offset);
      }
      return assertExactRead(out, offset, length);
    },
    async close(): Promise<void> {
      // Order matters only in that `closed` must be set before anything awaits: an in-flight read
      // can resolve during `source.close()` and would otherwise re-admit its block.
      closed = true;
      blocks.clear();
      inflight.clear();
      cachedBytes = 0;
      await source.close?.();
    },
  };
}
