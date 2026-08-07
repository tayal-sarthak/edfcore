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
import type { AbortSignalLike, ReadOptions } from '../types.js';

/**
 * The byte count of a genuine byte array, or `undefined` for anything else — which is why
 * `EdfSourceError.receivedLength` is `number | undefined` rather than `number`.
 *
 * Reading `.length` off the value was not enough, even though the message it feeds already
 * promised to detect "a value that is not a byte array". A `string`, a `number[]` and a
 * `{ length }` object all satisfied it and then threw an unrelated `TypeError` deeper in — noisy,
 * but at least loud. The case that was not loud is a typed-array view of the WRONG signedness:
 * `Int8Array` has one byte per element, so it passes a length check, and `decodeInt16` then
 * sign-extends an already-signed element a second time. A file holding `[-32768, -1, 200, 32767]`
 * decodes as `[-98304, -65537, -65592, -65537]` with no error anywhere — fabricated microvolts.
 *
 * The test is on the built-in tag, not on `instanceof` and not on `BYTES_PER_ELEMENT`.
 * `instanceof Uint8Array` is false across a realm boundary, and a `Uint8Array` from a worker or an
 * iframe is a perfectly good byte array — the same reason `io/bytes.ts` reaches for
 * `ArrayBuffer.isView`. `BYTES_PER_ELEMENT === 1` looks like the right test and is not: `Int8Array`
 * has one byte per element too, so it is exactly the dangerous case that check would admit.
 *
 * `Object.prototype.toString` reads `Symbol.toStringTag` off the TypedArray prototype, which every
 * realm agrees on. It admits `Uint8Array` — including Node's `Buffer`, a subclass that inherits the
 * tag — and `Uint8ClampedArray`, and rejects `Int8Array`, every wider view, and `DataView`.
 */
const BYTE_ARRAY_TAGS = new Set(['[object Uint8Array]', '[object Uint8ClampedArray]']);

/**
 * Whether a value is a real one-byte-per-element view: `Uint8Array`, `Uint8ClampedArray`, or
 * Node's `Buffer` (a `Uint8Array` subclass, so it inherits the tag).
 *
 * Shared with `byteSource`, which has to reject the same set at construction time rather than
 * building a source over something that is not bytes.
 */
export function isByteArray(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && BYTE_ARRAY_TAGS.has(Object.prototype.toString.call(value));
}

function receivedLengthOf(received: unknown): number | undefined {
  return isByteArray(received) ? received.byteLength : undefined;
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
  throwIfSignalAborted(options?.signal);
}

/**
 * The same check against a signal that was resolved by the caller.
 *
 * A source can carry its own signal as well as the one passed per read, and the effective signal
 * is `readOptions?.signal ?? sourceOptions?.signal`. That cannot be handed back to
 * `throwIfAborted` as an object literal, because `exactOptionalPropertyTypes` refuses
 * `{ signal: undefined }` where the property is declared optional.
 */
export function throwIfSignalAborted(signal?: AbortSignalLike): void {
  if (signal?.aborted !== true) return;
  const error = new Error('The read was aborted through options.signal.');
  error.name = 'AbortError';
  throw error;
}
