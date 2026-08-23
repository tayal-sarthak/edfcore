/**
 * Asking a source for nothing costs nothing, in every adapter.
 *
 * A zero-length read is not a contrived input. It is what a caller gets from `end - start` when a
 * window selects no samples, from a range computed off a record count that turned out to be zero,
 * or from a loop whose last iteration has nothing left to take. `assertReadRange` allows it — zero
 * is a non-negative safe integer — so every adapter has to decide what to do with it, and each one
 * decides separately.
 *
 * The wrong answers are all quiet. Handing the request to the transport gets a `bytes=100--1`
 * range that no server will honour, or a `Blob.slice(100, 100)` and a promise allocated for
 * nothing. Neither is an error a caller could act on, and both are about a request nobody meant
 * to make.
 *
 * So each adapter returns an empty array before touching anything, and this checks all five in one
 * table rather than adapter by adapter — because the contract is about `ByteSource`, and an
 * adapter added later inherits it.
 *
 * What this does NOT distinguish: which line produces the empty array in each adapter. Two of
 * them would answer correctly without their early return — `fileHandleSource` fills a buffer in a
 * `while (filled < length)` loop that simply never runs, and `byteSource` takes a `subarray` of
 * width zero. The early returns state the case rather than rescue it there; the ones that matter
 * are the adapters whose transport would otherwise be handed the request. What is pinned is the
 * answer, for all five, which is what a caller depends on.
 *
 * The offset still has to be a real one. `offset === byteLength` is legal, because that is where a
 * read of nothing sits at the end of a file; past it, the offset is outside the source whether or
 * not any bytes would have been read, and saying so is what stops a wrong offset from being
 * discovered later as an empty result.
 */

import { describe, expect, it } from 'vitest';
import { EdfSourceError } from '../../src/errors.js';
import { blobSource } from '../../src/io/blob.js';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { httpSource } from '../../src/io/http.js';
import { type FileHandleLike, fileHandleSource } from '../../src/node.js';
import type { BlobLike, ByteSource, FetchLike, HttpResponseLike } from '../../src/types.js';

const SIZE = 64;
const BYTES = Uint8Array.from({ length: SIZE }, (_, at) => at);

/** Every adapter, with a counter for whatever it would have had to touch. */
interface Adapter {
  readonly name: string;
  make(): Promise<{ source: ByteSource; touched: () => number }>;
}

const ADAPTERS: readonly Adapter[] = [
  {
    name: 'byteSource',
    make: () => Promise.resolve({ source: byteSource(BYTES), touched: () => 0 }),
  },
  {
    name: 'blobSource',
    make: () => {
      let slices = 0;
      const blob: BlobLike = {
        size: SIZE,
        slice: (start?: number, end?: number) => {
          slices += 1;
          return {
            size: (end ?? SIZE) - (start ?? 0),
            slice: blob.slice,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
          } as BlobLike;
        },
        arrayBuffer: () => Promise.resolve(BYTES.buffer as ArrayBuffer),
      };
      return Promise.resolve({ source: blobSource(blob), touched: () => slices });
    },
  },
  {
    name: 'cachedSource',
    make: () => {
      let reads = 0;
      const underlying: ByteSource = {
        byteLength: SIZE,
        read: (offset, length) => {
          reads += 1;
          return Promise.resolve(BYTES.subarray(offset, offset + length));
        },
      };
      return Promise.resolve({ source: cachedSource(underlying), touched: () => reads });
    },
  },
  {
    name: 'fileHandleSource',
    make: () => {
      let reads = 0;
      const handle: FileHandleLike = {
        read: (buffer: Uint8Array, offset: number, length: number, position: number) => {
          reads += 1;
          const slice = BYTES.subarray(position, position + length);
          buffer.set(slice, offset);
          return Promise.resolve({ bytesRead: slice.length });
        },
        close: () => Promise.resolve(),
      };
      return Promise.resolve({ source: fileHandleSource(handle, SIZE), touched: () => reads });
    },
  },
  {
    name: 'httpSource',
    make: async () => {
      let requests = 0;
      const fetchImpl = (() => {
        requests += 1;
        return Promise.resolve({
          ok: true,
          status: 206,
          headers: { get: () => null },
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        } as unknown as HttpResponseLike);
      }) as unknown as FetchLike;
      const source = await httpSource('https://data.example.org/night.edf', {
        fetch: fetchImpl,
        byteLength: SIZE,
      });
      return { source, touched: () => requests };
    },
  },
];

describe.each(ADAPTERS.map((adapter) => [adapter.name, adapter] as const))(
  '%s',
  (_name, adapter) => {
    it.each([0, 1, SIZE - 1, SIZE])(
      'returns nothing for a read of nothing at %i',
      async (offset) => {
        const { source, touched } = await adapter.make();
        const before = touched();
        const empty = await source.read(offset, 0);
        expect(empty).toBeInstanceOf(Uint8Array);
        expect(empty).toHaveLength(0);
        // Nothing was asked of the transport: there was nothing to ask for.
        expect(touched()).toBe(before);
      },
    );

    it('still refuses an offset outside the source', async () => {
      const { source } = await adapter.make();
      // Zero bytes of a range that does not exist is still a range that does not exist, and this
      // is where the caller finds out rather than three calls later.
      await expect(source.read(SIZE + 1, 0)).rejects.toBeInstanceOf(EdfSourceError);
    });

    it('still refuses a length that is not a byte count', async () => {
      const { source } = await adapter.make();
      await expect(source.read(0, -1)).rejects.toBeInstanceOf(EdfSourceError);
      await expect(source.read(0, Number.NaN)).rejects.toBeInstanceOf(EdfSourceError);
    });
  },
);
