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
import type { AbortSignalLike, ByteSource, CacheOptions, ReadOptions } from '../types.js';
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

/** The shape a real `AbortSignal` has and `AbortSignalLike` does not promise. */
interface WatchableSignal {
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

function isWatchable(signal: unknown): signal is AbortSignalLike & WatchableSignal {
  const candidate = signal as { addEventListener?: unknown; removeEventListener?: unknown } | null;
  return (
    typeof candidate?.addEventListener === 'function' &&
    typeof candidate.removeEventListener === 'function'
  );
}

/**
 * A promise that rejects when `signal` aborts, plus the teardown for its listener.
 *
 * `undefined` when the signal cannot be watched, which is the caller's cue to fall back to polling.
 * The rejection is the same `AbortError` `throwIfAborted` produces, so a caller branching on
 * `error.name` cannot tell which route rejected it.
 */
function watchSignal(
  signal: AbortSignalLike | undefined,
): { aborted: Promise<never>; dispose: () => void } | undefined {
  if (signal === undefined || !isWatchable(signal)) return undefined;
  let dispose = (): void => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => {
      const error = new Error('The read was aborted through options.signal.');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort);
    dispose = () => {
      signal.removeEventListener('abort', onAbort);
    };
  });
  // Losing the race must not surface as an unhandled rejection.
  aborted.catch(() => {});
  return { aborted, dispose: () => dispose() };
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

  /**
   * The shared block read, deliberately WITHOUT the caller's signal.
   *
   * One block read serves every concurrent reader of that block, so letting one of them cancel it
   * cancels the others. A viewer using the ordinary stale-request pattern — abort the controller
   * for the window the user scrolled away from — killed the FRESH window whenever both landed in
   * the same block, with `AbortError: The read was aborted through options.signal` describing
   * something that never happened to it. A reader that passed no signal at all was rejected the
   * same way, and because the message reads as self-cancellation the app's own `catch` swallows
   * it: a blank panel and no error anywhere. Which reader died depended on which touched the
   * block first (fixed in 0.3.43).
   *
   * The caller no longer decides for anyone else, and the cost is that an abort does not tear down
   * the underlying request — the right trade for a read whose result other readers are waiting on:
   * the bytes are valid and already paid for, so they are admitted to the cache.
   *
   * This used to claim that the polls around `Promise.all` left an aborting caller rejecting
   * "promptly". They did not: the only poll that can fire is the one AFTER the gather, so the
   * caller's promise stayed pending for the whole underlying block read and settled only when the
   * bytes it no longer wanted arrived. With the signal no longer reaching the source, nothing else
   * was watching it. `read` now RACES the caller's own signal against the gather when the signal
   * can be watched, so it rejects at abort time while the shared read continues untouched — which
   * is what 0.3.43 decided, rather than what it wrote down (fixed in 0.3.79).
   */
  async function fetchBlock(index: number, options?: ReadOptions): Promise<Uint8Array> {
    const start = index * blockBytes;
    const length = Math.min(blockBytes, byteLength - start);
    const shared: ReadOptions | undefined =
      options?.maxMaterializeBytes === undefined
        ? undefined
        : { maxMaterializeBytes: options.maxMaterializeBytes };
    return assertExactRead(await source.read(start, length, shared), start, length);
  }

  function blockFor(index: number, options?: ReadOptions): Promise<Uint8Array> {
    const cached = blocks.get(index);
    if (cached !== undefined) {
      blocks.delete(index);
      blocks.set(index, cached);
      return Promise.resolve(cached);
    }
    const pending = inflight.get(index);
    // Deduped readers share one underlying read, which is the whole point. They no longer share a
    // signal — see `fetchBlock`.
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
      /*
       * Raced, not merely awaited. `AbortSignalLike` is `{ aborted: boolean }` and nothing more, so
       * a signal that carries no `addEventListener` cannot be watched and the post-gather poll
       * below is still the only answer for it. A real `AbortSignal` — what every caller in
       * practice passes — is watched, and rejects the moment it fires.
       *
       * The gather is NOT cancelled either way: `pending` holds the shared block promises, other
       * readers are waiting on them, and their rejections must not become unhandled. They are
       * already attached inside `blockFor`, so losing the race leaves nothing dangling.
       */
      const watch = watchSignal(options?.signal);
      let resolved: Uint8Array[];
      try {
        resolved =
          watch === undefined
            ? await Promise.all(pending)
            : await Promise.race([Promise.all(pending), watch.aborted]);
      } finally {
        watch?.dispose();
      }
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
