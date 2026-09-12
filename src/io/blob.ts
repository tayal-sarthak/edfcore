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

import { EdfSourceError } from '../errors.js';
import { describeValue } from '../text/describe.js';
import type { BlobLike, ByteSource, ReadOptions } from '../types.js';
import { assertExactRead, assertReadRange, throwIfAborted } from './source.js';

/**
 * A `ByteSource` over a `Blob` or `File` — the browser entry point, and what an
 * `<input type="file">` hands you. Reads are ranged, so opening a file the user picked costs the
 * header rather than the recording.
 */
export function blobSource(blob: BlobLike): ByteSource {
  /*
   * Checked structurally, and at construction, for both of the reasons `byteSource` gives: a
   * `BlobLike` is an interface a caller may implement, and a source built over something that is
   * not a blob surfaces later as `[SOURCE_TOO_SMALL] the header is 0 bytes` — blaming the FILE for
   * a mistake in the argument. Until now it did not even get that far: `blob.size` on an omitted
   * argument was V8's `Cannot read properties of undefined (reading 'size')` (fixed in 0.6.102).
   */
  const given = blob as BlobLike | null | undefined;
  if (typeof given?.size !== 'number' || typeof given.slice !== 'function') {
    throw new EdfSourceError(
      'blobSource() needs a Blob or a File — an object with a size and a slice() — and received ' +
        `${describeValue(blob)}. Next: pass the File an <input type="file"> or a drop event hands ` +
        'you, or byteSource(bytes) if you already have the bytes in memory.',
      { offset: 0, requestedLength: 0 },
    );
  }
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
