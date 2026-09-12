/**
 * `parseHeader` given an `ArrayBuffer` instead of a view over it.
 *
 * Every size test in the function reads `headerBytes.length`, which is `undefined` on an
 * `ArrayBuffer` — what `await response.arrayBuffer()` and `await blob.arrayBuffer()` both hand over
 * — so every one of them compared false, the fixed-header check passed a buffer of unknown size, and
 * the failure arrived several checks later as `bytes.subarray is not a function` from a field reader.
 *
 * `decodeHeaderLatin1` refuses the same pair one layer down (0.6.96). This is the entry point a
 * reader is sent to: `api-primitives.md` opens with it (fixed in 0.6.121).
 */

import { describe, expect, it } from 'vitest';
import { isByteArray } from '../../../src/bytes/latin1.js';
import { parseHeader } from '../../../src/header/parse.js';
import { buildEdf } from '../../support/writer.js';

const BYTES = buildEdf({
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

/** The cast a JavaScript caller does not need to write. */
const loosely = <T>(value: unknown) => value as T;

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the argument was accepted');
}

describe('an ArrayBuffer', () => {
  it('is named as one rather than reaching a field reader', () => {
    const buffer = BYTES.slice().buffer;
    const message = refusal(() => parseHeader(loosely<Uint8Array>(buffer), BYTES.byteLength));
    expect(message).toContain('parseHeader(): the header bytes are ArrayBuffer, not a Uint8Array');
    expect(message).not.toContain('subarray is not a function');
  });

  it('says how to wrap it, and where a ByteSource read leaves one', () => {
    const buffer = BYTES.slice().buffer;
    const message = refusal(() => parseHeader(loosely<Uint8Array>(buffer), BYTES.byteLength));
    expect(message).toContain('Next: pass `new Uint8Array(buffer)`');
    expect(message).toContain('source.read(0, 256)');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['an Int8Array, which has one byte per element and would decode differently', new Int8Array(4)],
    ['a header', 'header'],
  ])('refuses %s', (_described, given) => {
    const value = given === 'header' ? parseHeader(BYTES, BYTES.byteLength) : given;
    expect(refusal(() => parseHeader(loosely<Uint8Array>(value), 256))).toContain(
      'not a Uint8Array',
    );
  });

  it('is checked before the byte length, so a caller with two wrong arguments hears about the bytes', () => {
    const buffer = BYTES.slice().buffer;
    expect(refusal(() => parseHeader(loosely<Uint8Array>(buffer), -1))).toContain(
      'sourceByteLength must be a non-negative safe integer',
    );
  });
});

describe('the views that are bytes', () => {
  it('still parse', () => {
    expect(parseHeader(BYTES, BYTES.byteLength).recordCount).toBe(2);
    expect(parseHeader(new Uint8Array(BYTES), BYTES.byteLength).signals).toHaveLength(1);
  });

  it('are exactly the set isByteArray admits', () => {
    for (const value of [
      BYTES,
      new Uint8ClampedArray(BYTES),
      new Int8Array(4),
      new ArrayBuffer(4),
    ]) {
      const accepted = (() => {
        try {
          parseHeader(loosely<Uint8Array>(value), BYTES.byteLength);
          return true;
        } catch (error) {
          return !/not a Uint8Array/.test((error as Error).message);
        }
      })();
      expect({ tag: Object.prototype.toString.call(value), accepted }).toEqual({
        tag: Object.prototype.toString.call(value),
        accepted: isByteArray(value),
      });
    }
  });
});
