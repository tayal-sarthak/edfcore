/**
 * `cachedSource` — the ONLY caching in edfcore, and the properties that make it safe to have.
 *
 * DESIGN decision 7: "Caching is an explicit, removable `cachedSource(src)` wrapper — nothing
 * caches behind your back." Two properties matter more than the hit rate, and both are tested
 * here as contracts rather than as optimisations:
 *
 * 1. A read returns a COPY, never a view into a retained block. `types.ts` gives the returned
 *    array to the caller, so a caller who writes into it must not be able to corrupt what the
 *    next reader sees. This is an ownership contract, not an implementation detail.
 * 2. Concurrent reads wanting the same block issue ONE underlying read. Over HTTP the difference
 *    between one request and eight is the difference between usable and not.
 *
 * And the property that makes the wrapper honest: DELETING it changes results not at all. The
 * last describe runs the same work with and without the wrapper and compares the bytes, the
 * decoded samples and the annotations — only the read COUNT differs.
 *
 * Block boundaries here are byte-aligned. `cached.ts` explains why: the module is
 * format-independent by construction and has no header to learn a record size from.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { throwIfAborted } from '../../src/io/source.js';
import { openEdf, readAnnotations, readWindow } from '../../src/recording.js';
import type { ByteSource, EdfChunk, ReadOptions } from '../../src/types.js';
import { type SpySource, spySource } from '../support/spy-source.js';
import { buildEdf } from '../support/writer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic bytes whose value identifies their offset, so a mix-up is visible. */
function ramp(byteLength: number): Uint8Array {
  return Uint8Array.from({ length: byteLength }, (_, index) => index & 0xff);
}

function offsetsOf(spy: SpySource): number[] {
  return spy.reads.map((read) => read.offset);
}

/**
 * A source that will not answer until it is released, so "concurrent" means genuinely
 * overlapping in flight rather than merely issued in the same synchronous turn.
 */
function gatedSource(inner: ByteSource): { source: ByteSource; release: () => void } {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    release: () => open(),
    source: {
      byteLength: inner.byteLength,
      async read(offset: number, length: number, options?: ReadOptions): Promise<Uint8Array> {
        await opened;
        return inner.read(offset, length, options);
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Concurrent dedupe
// ---------------------------------------------------------------------------

describe('concurrent reads of one block cost one underlying read', () => {
  it('collapses four overlapping in-flight reads into a single source read', async () => {
    const bytes = ramp(4096);
    const spy = spySource(byteSource(bytes));
    const gate = gatedSource(spy);
    const cached = cachedSource(gate.source, { blockBytes: 4096, maxBytes: 1 << 20 });

    // Fired before anything can resolve: all four are in flight at once.
    const inFlight = [
      cached.read(0, 100),
      cached.read(0, 100),
      cached.read(10, 50),
      cached.read(3000, 1000),
    ];
    gate.release();
    const results = await Promise.all(inFlight);

    expect(spy.reads).toHaveLength(1);
    expect(spy.reads).toEqual([{ offset: 0, length: 4096, sequence: 0 }]);
    expect(results.map((result) => result.length)).toEqual([100, 100, 50, 1000]);
    // Every reader got the right bytes, not just the first one.
    for (const [position, offset] of [0, 0, 10, 3000].entries()) {
      const result = results[position];
      expect(result === undefined ? undefined : Array.from(result.subarray(0, 4))).toEqual(
        Array.from(bytes.subarray(offset, offset + 4)),
      );
    }
  });

  it('issues one read per DISTINCT block, not one per caller', async () => {
    const spy = spySource(byteSource(ramp(4096)));
    const gate = gatedSource(spy);
    const cached = cachedSource(gate.source, { blockBytes: 1024, maxBytes: 1 << 20 });

    const inFlight = [
      cached.read(0, 10), // block 0
      cached.read(500, 10), // block 0 again
      cached.read(1100, 10), // block 1
      cached.read(1200, 10), // block 1 again
      cached.read(500, 1200), // blocks 0 and 1, both already in flight
    ];
    gate.release();
    await Promise.all(inFlight);

    expect(offsetsOf(spy)).toEqual([0, 1024]);
  });

  it('does not cache a failed block, so a retry reaches the source again', async () => {
    // A rejection must not be memoised as an answer: `inflight` is cleared in a `finally`, and
    // only a resolved block is admitted.
    let failing = true;
    let calls = 0;
    const bytes = ramp(512);
    const flaky: ByteSource = {
      byteLength: bytes.length,
      read(offset: number, length: number): Promise<Uint8Array> {
        calls += 1;
        if (failing) return Promise.reject(new Error('simulated I/O failure'));
        return Promise.resolve(bytes.subarray(offset, offset + length));
      },
    };
    const cached = cachedSource(flaky, { blockBytes: 512, maxBytes: 4096 });

    await expect(cached.read(0, 10)).rejects.toThrow('simulated I/O failure');
    failing = false;
    const recovered = await cached.read(0, 10);

    expect(Array.from(recovered)).toEqual(Array.from(bytes.subarray(0, 10)));
    expect(calls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Ownership: a copy, never a view
// ---------------------------------------------------------------------------

describe('a cached read hands back a copy the caller owns outright', () => {
  it('is unaffected by a caller writing into a previously returned array', async () => {
    // DESIGN, ByteSource: "The returned array is OWNED BY THE CALLER — caching implementations
    // must copy." Without this, one consumer scaling a buffer in place silently rewrites what
    // the next consumer decodes.
    const spy = spySource(byteSource(ramp(1024)));
    const cached = cachedSource(spy, { blockBytes: 1024, maxBytes: 1 << 20 });

    const first = await cached.read(0, 16);
    expect(Array.from(first.subarray(0, 4))).toEqual([0, 1, 2, 3]);
    first.fill(0xff);

    const second = await cached.read(0, 16);

    expect(Array.from(second)).toEqual(Array.from(ramp(16)));
    // The second read was served from the cache, so it really is the CACHED block that survived
    // the mutation — not a fresh read papering over a corrupted one.
    expect(spy.reads).toHaveLength(1);
  });

  it('gives every deduped concurrent caller its own array', async () => {
    const spy = spySource(byteSource(ramp(1024)));
    const gate = gatedSource(spy);
    const cached = cachedSource(gate.source, { blockBytes: 1024, maxBytes: 1 << 20 });

    const inFlight = [cached.read(0, 8), cached.read(0, 8), cached.read(0, 8)];
    gate.release();
    const [a, b, c] = await Promise.all(inFlight);
    if (a === undefined || b === undefined || c === undefined) throw new Error('unreachable');
    a.fill(0xff);

    expect(Array.from(b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(Array.from(c)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(a).not.toBe(b);
    expect(spy.reads).toHaveLength(1);
  });

  it('stitches a read spanning several blocks into one fresh array', async () => {
    const bytes = ramp(1000);
    const spy = spySource(byteSource(bytes));
    const cached = cachedSource(spy, { blockBytes: 256, maxBytes: 1 << 20 });

    const stitched = await cached.read(200, 600);

    expect(Array.from(stitched)).toEqual(Array.from(bytes.subarray(200, 800)));
    // 4 blocks touched: 0 (200..255), 1, 2, 3 (768..799).
    expect(offsetsOf(spy)).toEqual([0, 256, 512, 768]);
    stitched.fill(0xff);
    expect(Array.from(await cached.read(200, 600))).toEqual(Array.from(bytes.subarray(200, 800)));
  });

  it('serves the short final block of a file correctly', async () => {
    // 1000 bytes with 256-byte blocks leaves a 232-byte tail; the stitch clamps to
    // `block.byteLength`, not to `blockBytes`.
    const bytes = ramp(1000);
    const spy = spySource(byteSource(bytes));
    const cached = cachedSource(spy, { blockBytes: 256, maxBytes: 1 << 20 });

    const tail = await cached.read(999, 1);

    expect(Array.from(tail)).toEqual([999 & 0xff]);
    expect(spy.reads).toEqual([{ offset: 768, length: 232, sequence: 0 }]);
  });
});

// ---------------------------------------------------------------------------
// LRU eviction
// ---------------------------------------------------------------------------

describe('the LRU budget is respected, and a read too big for it is not cached', () => {
  it('evicts the least recently USED block, not the least recently fetched', async () => {
    // 6 blocks of 64 bytes, a budget of 128: exactly two blocks fit.
    const spy = spySource(byteSource(ramp(384)));
    const cached = cachedSource(spy, { blockBytes: 64, maxBytes: 128 });

    await cached.read(0, 8); // fetch block 0
    await cached.read(64, 8); // fetch block 1 — cache holds {0, 1}
    await cached.read(0, 8); // HIT on block 0, which moves it to the back
    expect(offsetsOf(spy)).toEqual([0, 64]);

    await cached.read(128, 8); // fetch block 2 — over budget, so the oldest USED block goes
    expect(offsetsOf(spy)).toEqual([0, 64, 128]);

    await cached.read(0, 8); // block 0 survived because it was touched
    expect(offsetsOf(spy)).toEqual([0, 64, 128]);

    await cached.read(64, 8); // block 1 was the evicted one
    expect(offsetsOf(spy)).toEqual([0, 64, 128, 64]);
  });

  it('never admits a block wider than the whole budget', async () => {
    // A 1 MiB block under a 4 KiB budget would evict itself on every insert, so the block size
    // is clamped to the budget instead of leaving a cache that can never hold anything.
    const spy = spySource(byteSource(ramp(65_536)));
    const cached = cachedSource(spy, { blockBytes: 1 << 20, maxBytes: 4096 });

    await cached.read(0, 8);
    await cached.read(0, 8);

    expect(spy.reads).toEqual([{ offset: 0, length: 4096, sequence: 0 }]);
  });

  it('sends a read larger than the budget straight to the source, uncached', async () => {
    // Such a read cannot benefit from the cache and would evict every block on its way through.
    const bytes = ramp(1024);
    const spy = spySource(byteSource(bytes));
    const cached = cachedSource(spy, { blockBytes: 64, maxBytes: 128 });

    const first = await cached.read(0, 200);
    const second = await cached.read(0, 200);

    expect(Array.from(first)).toEqual(Array.from(bytes.subarray(0, 200)));
    expect(Array.from(second)).toEqual(Array.from(first));
    expect(spy.reads).toEqual([
      { offset: 0, length: 200, sequence: 0 },
      { offset: 0, length: 200, sequence: 1 },
    ]);
  });

  it('degenerates to a pass-through when the budget cannot hold one byte', async () => {
    const bytes = ramp(256);
    const spy = spySource(byteSource(bytes));
    const cached = cachedSource(spy, { maxBytes: 0 });

    expect(Array.from(await cached.read(8, 8))).toEqual(Array.from(bytes.subarray(8, 16)));
    expect(Array.from(await cached.read(8, 8))).toEqual(Array.from(bytes.subarray(8, 16)));

    expect(spy.reads).toEqual([
      { offset: 8, length: 8, sequence: 0 },
      { offset: 8, length: 8, sequence: 1 },
    ]);
  });

  it('closes the wrapped source and drops what it was holding', async () => {
    const spy = spySource(byteSource(ramp(256)));
    const cached = cachedSource(spy, { blockBytes: 256, maxBytes: 1 << 20 });
    await cached.read(0, 8);
    spy.reset();

    await cached.close?.();

    expect(spy.closed).toBe(true);
    await cached.read(0, 8);
    expect(spy.reads).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Removing the wrapper changes nothing but the read count
// ---------------------------------------------------------------------------

describe('deleting cachedSource changes results not at all — same bytes, more reads', () => {
  const script = [
    { offset: 0, length: 256 },
    { offset: 256, length: 512 },
    { offset: 0, length: 16 },
    { offset: 700, length: 300 },
    { offset: 256, length: 512 },
    { offset: 990, length: 10 },
  ];

  it('returns byte-identical results for an identical sequence of reads', async () => {
    const bytes = ramp(1000);
    const plainSpy = spySource(byteSource(bytes));
    const cachedSpy = spySource(byteSource(bytes));
    const cached = cachedSource(cachedSpy);

    for (const range of script) {
      const plain = await plainSpy.read(range.offset, range.length);
      const viaCache = await cached.read(range.offset, range.length);
      expect(Array.from(viaCache)).toEqual(Array.from(plain));
    }

    expect(plainSpy.reads).toHaveLength(script.length);
    // The default 1 MiB block swallows this file whole, so one read answers all six.
    expect(cachedSpy.reads).toHaveLength(1);
    expect(cachedSpy.reads.length).toBeLessThan(plainSpy.reads.length);
  });

  it('produces identical headers, samples and annotations through a real open-and-read', async () => {
    const bytes = buildEdf({
      plus: 'C',
      signals: [
        { label: 'Fp1', samplesPerRecord: 8 },
        { label: 'Fp2', samplesPerRecord: 8 },
      ],
      annotationSignals: [
        {
          samplesPerRecord: 24,
          tals: (recordIndex) =>
            recordIndex === 1 ? [{ onset: 1.5, duration: 0.25, texts: ['spike'] }] : [],
        },
      ],
      recordCount: 6,
      recordDurationSeconds: 1,
    });

    async function run(source: ByteSource): Promise<{
      chunks: readonly EdfChunk[];
      annotationCount: number;
      onsets: string;
      variant: string;
    }> {
      const recording = await openEdf(source);
      const chunks = await readWindow(recording, {
        startSeconds: 1,
        durationSeconds: 3,
        signalIndices: [0, 1],
      });
      const annotations = await readAnnotations(recording, {
        start: 0,
        count: recording.header.recordCount,
      });
      return {
        chunks,
        annotationCount: annotations.annotations.length,
        onsets: String(annotations.recordOnsetTicks),
        variant: recording.header.variant,
      };
    }

    const plainSpy = spySource(byteSource(bytes));
    const cachedSpy = spySource(byteSource(bytes));
    const plain = await run(plainSpy);
    const viaCache = await run(cachedSource(cachedSpy));

    expect(viaCache.variant).toBe(plain.variant);
    expect(viaCache.annotationCount).toBe(plain.annotationCount);
    expect(viaCache.onsets).toBe(plain.onsets);
    expect(viaCache.chunks).toHaveLength(plain.chunks.length);
    for (const [position, chunk] of viaCache.chunks.entries()) {
      const reference = plain.chunks[position];
      if (reference === undefined) throw new Error('unreachable: lengths were compared above');
      expect(chunk.records).toEqual(reference.records);
      expect(chunk.startSeconds).toBe(reference.startSeconds);
      expect(chunk.byteOffset).toBe(reference.byteOffset);
      expect(chunk.byteLength).toBe(reference.byteLength);
      for (const [signalPosition, signal] of chunk.signals.entries()) {
        const referenceSignal = reference.signals[signalPosition];
        expect(Array.from(signal.digital)).toEqual(
          referenceSignal === undefined ? undefined : Array.from(referenceSignal.digital),
        );
      }
    }

    // MEASURED: 6 reads totalling 1,904 bytes uncached, against 1 read of 1,504 bytes cached.
    // Fewer reads, and — for a file this small — fewer bytes too; on a large file the cache
    // trades bytes for requests, which is the trade that matters over HTTP.
    expect(plainSpy.reads).toHaveLength(6);
    expect(cachedSpy.reads).toHaveLength(1);
    expect(cachedSpy.reads.length).toBeLessThan(plainSpy.reads.length);
  });
});

describe('close', () => {
  /** A source whose reads block until released, so a read can be in flight across close(). */
  function gated(bytes: Uint8Array) {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let closed = false;
    let reads = 0;
    const source: ByteSource = {
      byteLength: bytes.byteLength,
      async read(offset, length) {
        reads += 1;
        await gate;
        return bytes.subarray(offset, offset + length);
      },
      async close() {
        closed = true;
      },
    };
    return { source, release: () => release?.(), isClosed: () => closed, reads: () => reads };
  }

  it('does not let an in-flight read repopulate the cache after close', async () => {
    // The read's `.then` runs after `blocks.clear()`, so before 0.2.37 the cache refilled itself
    // AFTER being closed and then served that data — from a source whose own close had run.
    const bytes = new Uint8Array(4096).fill(7);
    const { source, release, isClosed, reads } = gated(bytes);
    const cache = cachedSource(source, { blockBytes: 1024, maxBytes: 4096 });

    const inflight = cache.read(0, 16);
    await cache.close?.();
    release();
    await inflight;

    expect(isClosed()).toBe(true);
    const before = reads();
    await cache.read(0, 16);
    // The later read went to the wrapped source rather than to a cache that should be empty.
    expect(reads()).toBeGreaterThan(before);
  });

  it('stays empty after close, so every later read is delegated', async () => {
    const bytes = new Uint8Array(4096).fill(3);
    const { source, release, reads } = gated(bytes);
    const cache = cachedSource(source, { blockBytes: 1024, maxBytes: 4096 });
    release();

    await cache.read(0, 16);
    const warm = reads();
    await cache.read(0, 16);
    // Warm cache: the second read costs nothing.
    expect(reads()).toBe(warm);

    await cache.close?.();
    await cache.read(0, 16);
    await cache.read(0, 16);
    // Cold and staying cold: two more delegated reads, not zero and not one.
    expect(reads()).toBe(warm + 2);
  });

  it('delegates close to the wrapped source', async () => {
    const { source, release, isClosed } = gated(new Uint8Array(64));
    release();
    const cache = cachedSource(source, { blockBytes: 32, maxBytes: 64 });
    await cache.close?.();
    expect(isClosed()).toBe(true);
  });
});

describe("one reader's abort does not cancel another's", () => {
  /**
   * A block read serves every concurrent reader of that block. It carried the FIRST caller's
   * options, signal included, so aborting one reader rejected the others — including a reader
   * that passed no signal at all, with `AbortError: The read was aborted through options.signal`
   * describing something that never happened to it.
   *
   * That is the ordinary stale-request pattern in a viewer: the user scrolls, the app aborts the
   * window they left and issues the new one. Both land in the same 1 MiB block, and the FRESH
   * window dies. Because the message reads as self-cancellation, the app's own `catch` swallows
   * it — a blank panel and no error anywhere (fixed in 0.3.43).
   */
  function slowSource(byteLength: number) {
    let reads = 0;
    const backing = new Uint8Array(byteLength);
    const source: ByteSource = {
      byteLength,
      async read(offset: number, length: number, options?: ReadOptions) {
        reads += 1;
        // Exactly what byteSource, httpSource and fileHandleSource all do.
        throwIfAborted(options);
        await new Promise((resolve) => setTimeout(resolve, 10));
        throwIfAborted(options);
        return backing.subarray(offset, offset + length);
      },
    };
    return { source, reads: () => reads };
  }

  it('rejects only the reader whose signal was aborted', async () => {
    const { source, reads } = slowSource(4096);
    const cached = cachedSource(source, { blockBytes: 4096, maxBytes: 1 << 20 });
    const controller = new AbortController();

    const aborted = cached.read(0, 16, { signal: controller.signal }).then(
      () => 'resolved',
      (e: Error) => e.name,
    );
    const untouched = cached.read(32, 16).then(
      () => 'resolved',
      (e: Error) => e.name,
    );
    controller.abort();

    expect(await aborted).toBe('AbortError');
    expect(await untouched).toBe('resolved');
    // Still ONE underlying read: the dedup is the whole point and is unaffected.
    expect(reads()).toBe(1);
  });

  it('rejects only the reader whose signal was aborted, whichever started first', async () => {
    // Which reader owned the shared read used to decide which one died.
    const { source } = slowSource(4096);
    const cached = cachedSource(source, { blockBytes: 4096, maxBytes: 1 << 20 });
    const controller = new AbortController();

    const untouched = cached.read(32, 16).then(
      () => 'resolved',
      (e: Error) => e.name,
    );
    const aborted = cached.read(0, 16, { signal: controller.signal }).then(
      () => 'resolved',
      (e: Error) => e.name,
    );
    controller.abort();

    expect(await untouched).toBe('resolved');
    expect(await aborted).toBe('AbortError');
  });

  it('keeps the block it paid for, so a later read is served from cache', async () => {
    const { source, reads } = slowSource(4096);
    const cached = cachedSource(source, { blockBytes: 4096, maxBytes: 1 << 20 });
    const controller = new AbortController();

    const aborted = cached.read(0, 16, { signal: controller.signal }).then(
      () => 'resolved',
      (e: Error) => e.name,
    );
    controller.abort();
    expect(await aborted).toBe('AbortError');

    // The bytes were valid and already fetched; a later read must not pay for them again.
    expect((await cached.read(0, 16)).length).toBe(16);
    expect(reads()).toBe(1);
  });
});
