/**
 * The in-memory adapter.
 *
 * Layer 5. Zero-copy by construction: a read hands back a `subarray` view over the caller's own
 * buffer. That is safe precisely because it is the caller's buffer — the "returned array is
 * owned by the caller" rule exists to stop an adapter handing out a view into state it retains,
 * and this adapter retains nothing the caller does not already hold.
 */

import { EdfSourceError } from '../errors.js';
import type { ByteSource, ReadOptions } from '../types.js';
import { assertExactRead, assertReadRange, isByteArray, throwIfAborted } from './source.js';

/**
 * Describes what arrived, for an argument that is not bytes. Never prints the value: it could be
 * anything, including something large.
 */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (ArrayBuffer.isView(value)) return Object.prototype.toString.call(value).slice(8, -1);
  if (Array.isArray(value)) return 'a plain Array';
  // Buffers are named too. Without this a refusal called them "a plain object", which sent the
  // reader looking for the wrong problem entirely.
  if (BUFFER_TAGS.has(Object.prototype.toString.call(value))) {
    return Object.prototype.toString.call(value).slice(8, -1);
  }
  return typeof value === 'object' ? 'a plain object' : `a ${typeof value}`;
}

/**
 * The built-in tags, not `instanceof`.
 *
 * A tag comes from `Symbol.toStringTag` on the buffer prototype and every realm agrees on it;
 * `instanceof ArrayBuffer` is false for a buffer that crossed a realm boundary — an iframe, an
 * Electron contextBridge, jsdom, a Node `vm` context. Until 0.3.20 the ArrayBuffer half of the
 * guard below used `instanceof` while the SharedArrayBuffer half already used the tag, so a real,
 * fully usable ArrayBuffer from another realm was refused as "a plain object" and told to "pass
 * the ArrayBuffer itself" — which is what the caller had done. `new Uint8Array(thatBuffer)` was
 * accepted, because `isByteArray` twelve lines below was rewritten in 0.2.23 for this exact
 * reason and this one was missed.
 */
const BUFFER_TAGS = new Set(['[object ArrayBuffer]', '[object SharedArrayBuffer]']);

/**
 * A `ByteSource` over bytes already in memory, for a file you fetched yourself or a fixture in a
 * test. The signedness of the view is checked at construction rather than at first read: an
 * `Int8Array` has one byte per element and would decode into plausible, wrong sample values.
 */
export function byteSource(bytes: ArrayBuffer | Uint8Array): ByteSource {
  // Refused at CONSTRUCTION, because the alternative is worse than an error. `new Uint8Array(x)`
  // accepts almost anything: a string, a plain object and `null` all yield an empty array, and a
  // `number[]` yields one of the wrong length. The source was then built happily and the failure
  // surfaced later as `[SOURCE_TOO_SMALL] the header is 0 bytes` — blaming the FILE for a mistake
  // in the caller's argument, which is the one confusion this package works hardest to avoid.
  //
  // `Int8Array` is rejected too, and deliberately: it has one byte per element so it passes any
  // length check, and its already-signed elements are sign-extended a second time during decode
  // (see `assertExactRead`). Fabricated microvolts, with no error anywhere.
  const isBuffer = BUFFER_TAGS.has(Object.prototype.toString.call(bytes));
  if (!isBuffer && !isByteArray(bytes)) {
    throw new EdfSourceError(
      `byteSource() needs an ArrayBuffer or a Uint8Array, received ${describe(bytes)}. ` +
        'Next: pass `new Uint8Array(await blob.arrayBuffer())`, `await readFile(path)`, or the ' +
        'ArrayBuffer itself. An Int8Array is not accepted — it has one byte per element, so it ' +
        'would pass every length check and then decode to fabricated sample values.',
      { offset: 0, requestedLength: 0 },
    );
  }

  // `isByteArray` rather than `instanceof Uint8Array`: `instanceof` is false for a view that
  // crossed a realm boundary (a worker, an iframe), and this is a public entry point.
  const view: Uint8Array = isByteArray(bytes) ? bytes : new Uint8Array(bytes as ArrayBuffer);
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
