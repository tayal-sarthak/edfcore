/**
 * The in-memory adapter.
 *
 * Layer 5. Zero-copy by construction: a read hands back a `subarray` view over the caller's own
 * buffer. That is safe precisely because it is the caller's buffer — the "returned array is
 * owned by the caller" rule exists to stop an adapter handing out a view into state it retains,
 * and this adapter retains nothing the caller does not already hold.
 */

import type { ByteSource, ReadOptions } from '../types.js';
import { assertExactRead, assertReadRange, throwIfAborted } from './source.js';

export function byteSource(bytes: ArrayBuffer | Uint8Array): ByteSource {
  // `ArrayBuffer.isView` rather than `instanceof Uint8Array`: `instanceof` is false for a view
  // that crossed a realm boundary (a worker, an iframe), and this is a public entry point.
  const view: Uint8Array = ArrayBuffer.isView(bytes) ? bytes : new Uint8Array(bytes);
  const byteLength = view.byteLength;

  return {
    byteLength,
    async read(offset: number, length: number, options?: ReadOptions): Promise<Uint8Array> {
      throwIfAborted(options);
      assertReadRange(offset, length, byteLength);
      // `subarray` is relative to this view, so a Uint8Array handed in with a non-zero
      // byteOffset over a larger buffer is respected with no offset arithmetic here.
      return assertExactRead(view.subarray(offset, offset + length), offset, length);
    },
  };
}
