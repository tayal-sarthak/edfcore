/**
 * `cachedSource` given a block size below one byte, and clamping it up.
 *
 * `options.ts` opens with the shape this is an instance of: a guard written so that it does not
 * fire. `Math.max(1, Math.floor(blockBytes))` never rejects anything — it turns `0`, `-1` and `0.5`
 * into a perfectly working cache whose blocks are ONE BYTE.
 *
 * What that costs is the opposite of what the wrapper is for. A 512-byte read became 512 underlying
 * reads of one byte each; over HTTP, where this wrapper is the only one worth using, that is 512
 * range requests for half a kilobyte. More requests than not caching at all, and nothing said so.
 *
 * `resolveMaterializeBudget` has refused a negative byte count since 0.3.21, in these same words.
 * The cache's own byte counts were the two still clamping.
 *
 * `maxBytes: 0` is left alone: a budget of nothing is a coherent way to say "do not cache", and the
 * wrapper already answers it by passing reads straight through.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import type { ByteSource, ReadOptions } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  recordCount: 8,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 16 }],
});

/** Counts what actually reaches the source underneath, which is the whole subject here. */
function counting(inner: ByteSource): ByteSource & { reads: number[] } {
  const reads: number[] = [];
  return {
    reads,
    byteLength: inner.byteLength,
    read: (offset: number, length: number, options?: ReadOptions): Promise<Uint8Array> => {
      reads.push(length);
      return inner.read(offset, length, options);
    },
  } as ByteSource & { reads: number[] };
}

describe.each([
  ['zero', 0],
  ['negative', -1],
  ['a fraction below one', 0.5],
])('a blockBytes of %s', (_name, blockBytes) => {
  it('is refused rather than clamped to a single byte', () => {
    let thrown: Error | undefined;
    try {
      cachedSource(byteSource(FILE), { blockBytes });
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown, 'a one-byte block cache was built').toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain('options.blockBytes must be at least 1 byte');
    expect(thrown?.message).toContain('Next:');
  });

  it('prints the value that was written, not the value it was clamped to', () => {
    const thrown = ((): Error | undefined => {
      try {
        cachedSource(byteSource(FILE), { blockBytes });
        return undefined;
      } catch (error) {
        return error as Error;
      }
    })();
    expect(thrown?.message).toContain(String(blockBytes));
  });
});

describe('what a one-byte block cost', () => {
  it('is one underlying read per byte, which the default avoids entirely', async () => {
    const plain = counting(byteSource(FILE));
    await cachedSource(plain).read(0, 512);
    expect(plain.reads.length).toBe(1);
    // And the refusal is what stands between a caller and 512 of them.
    expect(() => cachedSource(counting(byteSource(FILE)), { blockBytes: 0 })).toThrow(
      /at least 1 byte/,
    );
  });

  it('still serves a small but legitimate block size, in blocks of that size', async () => {
    const counted = counting(byteSource(FILE));
    await cachedSource(counted, { blockBytes: 64 }).read(0, 512);
    expect(counted.reads.length).toBe(8);
    expect(counted.reads.every((length) => length === 64)).toBe(true);
  });
});

describe('the options that were already right', () => {
  it('still cache by default, and serve the same bytes', async () => {
    const cached = cachedSource(byteSource(FILE));
    const first = await cached.read(0, 256);
    const second = await cached.read(0, 256);
    expect(first).toEqual(second);
    expect(first.byteLength).toBe(256);
  });

  it('still take maxBytes: 0 as "do not cache", passing reads straight through', async () => {
    const counted = counting(byteSource(FILE));
    const cached = cachedSource(counted, { maxBytes: 0 });
    await cached.read(0, 512);
    await cached.read(0, 512);
    expect(counted.reads).toEqual([512, 512]);
  });

  it('still refuse a bare value where the options belong, which 0.6.140 added', () => {
    expect(() => cachedSource(byteSource(FILE), (4 * 1024 * 1024) as never)).toThrow(
      /blockBytes and maxBytes are fields on one/,
    );
  });

  it('still refuse a non-finite block size in options.ts’s own words', () => {
    expect(() => cachedSource(byteSource(FILE), { blockBytes: Number.NaN })).toThrow(
      /options.blockBytes must be a finite number/,
    );
  });
});
