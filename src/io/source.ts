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
import type { AbortSignalLike, ByteSource, ReadOptions } from '../types.js';

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

/**
 * What the caller passed, and the adapter that would have turned it into a `ByteSource`.
 *
 * Named by shape rather than by class, for the reason `bytes.ts` gives: `instanceof` is false
 * across a realm boundary, and a `File` from an iframe is still a `File`.
 */
function adapterFor(source: unknown): string {
  if (
    ArrayBuffer.isView(source) ||
    Object.prototype.toString.call(source) === '[object ArrayBuffer]'
  ) {
    return 'wrap them with byteSource(bytes)';
  }
  if (typeof source === 'string') {
    return (
      'that looks like a path — use fileSource(path) from "edfcore/node", or read the bytes ' +
      'yourself and pass byteSource(bytes)'
    );
  }
  const candidate = source as { size?: unknown; arrayBuffer?: unknown } | null;
  if (
    typeof candidate?.size === 'number' &&
    typeof (candidate as { arrayBuffer?: unknown }).arrayBuffer === 'function'
  ) {
    return 'that looks like a Blob or a File — use blobSource(file)';
  }
  return (
    'use byteSource(bytes) for bytes in memory, fileSource(path) from "edfcore/node" for a file, ' +
    'blobSource(file) for a File, or httpSource(url) for a URL'
  );
}

/**
 * `Uint8Array`, `ArrayBuffer`, `string`, `nothing`. Never the value: it could be anything.
 *
 * No article, and `byteSource`'s own refusal is phrased the same way — "received Int8Array". An
 * article needs to know that `Uint8Array` is said "yoo-int", which no rule about vowels gets
 * right, and getting it wrong is the kind of thing a reader notices instead of the message.
 */
function describeGiven(source: unknown): string {
  if (source === null) return 'null';
  if (source === undefined) return 'nothing';
  // The built-in tag, not `instanceof`: it is the same across realms, which is the reason
  // `bytes.ts` uses it too.
  return typeof source === 'object' || typeof source === 'function'
    ? Object.prototype.toString.call(source).slice(8, -1)
    : typeof source;
}

/**
 * The source is a `ByteSource` before anything reads from it.
 *
 * This is the first argument of the first call, and passing the bytes themselves — `openEdf(bytes)`
 * rather than `openEdf(byteSource(bytes))` — is the likeliest mistake anyone makes with this
 * library. Until 0.4.444 it produced `TypeError: source.read is not a function`, which names
 * neither edfcore, nor the adapter that was missing, nor the one word that fixes it; `undefined`
 * produced a `TypeError` about a property of undefined instead, from a different line.
 *
 * `byteSource` itself has refused a wrong argument by name since the beginning, and says what to
 * pass instead. This is the same courtesy one call earlier, where more people meet it.
 *
 * Checked structurally — a `read` function and a numeric `byteLength` — because a `ByteSource` is
 * an interface a caller may implement, and `api-sources.md` documents writing one.
 */
export function assertByteSource(source: unknown): asserts source is ByteSource {
  const candidate = source as { read?: unknown; byteLength?: unknown } | null | undefined;
  if (typeof candidate?.read === 'function' && typeof candidate.byteLength === 'number') return;
  const received = describeGiven(source);
  throw new EdfSourceError(
    `a ByteSource is needed — an object with a byteLength and a read() — and received ` +
      `${received}. Next: ${adapterFor(source)}.`,
    { offset: 0, requestedLength: 0 },
  );
}
