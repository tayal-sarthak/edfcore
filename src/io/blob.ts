/**
 * The `Blob`/`File` adapter.
 *
 * Layer 5. The DOM `Blob` is never named: `BlobLike` is the structural shim from `types.ts`, so
 * a real `File` from an `<input type="file">` remains assignable while `lib: ["DOM"]` stays out
 * of the published `.d.ts`.
 *
 * A `Blob` read is the one place where the platform can legitimately hand back fewer bytes than
 * asked (a `File` whose backing file changed on disk since the picker ran), so the exact-length
 * contract is verified rather than assumed.
 */

import type { BlobLike, ByteSource, ReadOptions } from '../types.js';
import { assertExactRead, assertReadRange, throwIfAborted } from './source.js';

/**
 * A `ByteSource` over a `Blob` or `File` — the browser entry point, and what an
 * `<input type="file">` hands you. Reads are ranged, so opening a file the user picked costs the
 * header rather than the recording.
 */
export function blobSource(blob: BlobLike): ByteSource {
  const byteLength = blob.size;

  return {
    byteLength,
    async read(offset: number, length: number, options?: ReadOptions): Promise<Uint8Array> {
      throwIfAborted(options);
      assertReadRange(offset, length, byteLength);
      if (length === 0) return new Uint8Array(0);
      // `Blob.slice` takes an EXCLUSIVE end, unlike an HTTP byte range.
      const buffer = await blob.slice(offset, offset + length).arrayBuffer();
      throwIfAborted(options);
      return assertExactRead(new Uint8Array(buffer), offset, length);
    },
  };
}
