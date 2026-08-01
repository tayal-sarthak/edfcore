/**
 * The `ByteSource` contract guard.
 *
 * Layer 5, and the only file in `io/` that imports an error class. Nothing here knows anything
 * about EDF.
 *
 * The contract is one sentence — a read resolves with EXACTLY `length` bytes or rejects, it
 * never pads and never truncates — and it is *checked on every call*, including calls into a
 * source the caller wrote. A source that quietly returns a short buffer is indistinguishable
 * from a truncated file, so without this guard the parser would confidently report the wrong
 * cause for the wrong thing.
 */

import { EdfSourceError } from '../errors.js';
import type { ReadOptions } from '../types.js';

/**
 * A misbehaving source may resolve with something that is not a byte array at all, which is
 * why `EdfSourceError.receivedLength` is `number | undefined` rather than `number`.
 */
function receivedLengthOf(received: unknown): number | undefined {
  if (received === null || received === undefined) return undefined;
  const length = (received as { length?: unknown }).length;
  return typeof length === 'number' ? length : undefined;
}

/**
 * Enforces the exact-length contract and returns the value unchanged so it can wrap a read
 * expression directly.
 */
export function assertExactRead(received: Uint8Array, offset: number, length: number): Uint8Array {
  const receivedLength = receivedLengthOf(received);
  if (receivedLength === length) return received;
  const got =
    receivedLength === undefined ? 'a value that is not a byte array' : `${receivedLength} bytes`;
  throw new EdfSourceError(
    `ByteSource.read(offset ${offset}, length ${length}) resolved with ${got}. A ByteSource ` +
      'must resolve with exactly the requested number of bytes or reject: padding or ' +
      'truncating makes a short read indistinguishable from a truncated file. Next: make ' +
      'read() loop until `length` bytes have arrived, and reject if they never do.',
    { offset, requestedLength: length, receivedLength },
  );
}

/**
 * Validates a requested range against the source length, with the real numbers in the message.
 *
 * Offsets are plain JS numbers throughout edfcore — exact to 2^53 — so this checks
 * safe-integer-ness rather than truncating with `| 0`, which silently wraps past 2 GiB.
 */
export function assertReadRange(offset: number, length: number, byteLength: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new EdfSourceError(
      `ByteSource.read was given offset ${offset}, which is not a non-negative safe integer. ` +
        'Next: pass a plain integer byte offset; edfcore never truncates offsets to 32 bits.',
      { offset, requestedLength: length },
    );
  }
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new EdfSourceError(
      `ByteSource.read was given length ${length}, which is not a non-negative safe integer. ` +
        'Next: pass a plain integer byte count.',
      { offset, requestedLength: length },
    );
  }
  if (offset + length > byteLength) {
    throw new EdfSourceError(
      `ByteSource.read(offset ${offset}, length ${length}) ends at byte ${offset + length}, ` +
        `past the end of a ${byteLength}-byte source. Next: clamp the request, or check that ` +
        'the source was built over the whole file rather than a prefix of it.',
      { offset, requestedLength: length },
    );
  }
}

/**
 * Aborts a read when the caller's signal is already aborted.
 *
 * `DOMException` cannot be named without the DOM lib, and the thing consumers actually branch
 * on is `error.name === 'AbortError'`, so that is what this produces.
 */
export function throwIfAborted(options?: ReadOptions): void {
  if (options?.signal?.aborted !== true) return;
  const error = new Error('The read was aborted through options.signal.');
  error.name = 'AbortError';
  throw error;
}
