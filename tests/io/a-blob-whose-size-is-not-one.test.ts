/**
 * `blob.size`, the third caller-supplied size in this package and the one nothing checked.
 *
 * 0.6.85 fixed this for `fileHandleSource` and wrote the reason down: a `NaN` size does not fail,
 * it DISABLES the range guard. `assertReadRange` compares every read against `byteLength`, every
 * comparison against `NaN` is false, so the check silently stops happening and the source
 * advertises `byteLength: NaN` to everything downstream — where the first thing to notice is
 * `parseHeader`, which blames a caller who passed IT the right arguments. `fileSource` validates
 * the size it reads off the handle it just opened. `blobSource` took whatever was on the object.
 *
 * That it is the platform's number on a real `File` is not the point. `BlobLike` is a structural
 * shim in `types.ts` precisely so a caller can implement it — a stream-backed file, a mocked blob
 * in a test, a wrapper around a native picker — and an implementation is where a computed size
 * comes from. The adapter's own construction check already says so: it is structural "for both of
 * the reasons `byteSource` gives: a `BlobLike` is an interface a caller may implement".
 *
 * A negative and a fractional size pass the same way, and both are what a subtraction or a
 * division produces.
 */

import { describe, expect, it } from 'vitest';
import { EdfSourceError, isEdfError } from '../../src/errors.js';
import { blobSource } from '../../src/io/blob.js';
import type { BlobLike } from '../../src/types.js';

const BYTES = Uint8Array.from({ length: 64 }, (_, at) => at & 0xff);

/** The smallest thing that satisfies `BlobLike`, with a size the caller chooses. */
const blobOf = (size: unknown): BlobLike =>
  ({
    size,
    slice: (start: number, end: number) => ({
      arrayBuffer: async () => BYTES.slice(start, end).buffer,
    }),
  }) as unknown as BlobLike;

describe.each([
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['negative', -1],
  ['fractional', 1.5],
])('a blob whose size is %s', (_name, size) => {
  it('is refused when the source is built, not on some later read', () => {
    expect(() => blobSource(blobOf(size))).toThrow();
  });

  it('is an EdfSourceError naming the adapter and the value as itself', () => {
    try {
      blobSource(blobOf(size));
      expect.unreachable('a size that is not a byte count must not become a byteLength');
    } catch (error) {
      expect(isEdfError(error)).toBe(true);
      expect(error).toBeInstanceOf(EdfSourceError);
      expect((error as Error).message).toContain('blobSource()');
      expect((error as Error).message).toContain('Next:');
    }
  });
});

describe('the range guard the size exists to power', () => {
  it('no longer lets a NaN size through to disable it', async () => {
    // Before: `byteLength` was NaN, `assertReadRange(0, 1e9, NaN)` compared false throughout, and
    // the read went to the blob unbounded.
    expect(() => blobSource(blobOf(Number.NaN))).toThrow(/blobSource\(\)/);
  });

  it('still refuses a read past a size that IS a byte count', async () => {
    const source = blobSource(blobOf(16));
    await expect(source.read(12, 8)).rejects.toThrow();
  });
});

describe('the sizes a blob legitimately has', () => {
  it('accepts a whole number and bounds the reads by it', async () => {
    const source = blobSource(blobOf(64));
    expect(source.byteLength).toBe(64);
    expect((await source.read(0, 16)).length).toBe(16);
  });

  it('accepts zero, which is what an empty File reports', () => {
    expect(() => blobSource(blobOf(0))).not.toThrow();
  });

  it('still refuses something that is not a blob at all, as before', () => {
    expect(() => blobSource({ size: 10 } as unknown as BlobLike)).toThrow(/needs a Blob or a File/);
  });
});
