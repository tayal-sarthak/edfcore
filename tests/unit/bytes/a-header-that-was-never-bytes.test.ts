/**
 * `decodeHeaderLatin1` given a view that is not a `Uint8Array`.
 *
 * Two wrong arguments produced text rather than an error, which is the worst pair of outcomes a
 * decoder can have.
 *
 * An `ArrayBuffer` — what `await blob.arrayBuffer()` and `await response.arrayBuffer()` hand you —
 * has no `length`, so `undefined <= CHUNK_BYTES` was false, the chunk loop never ran, and the whole
 * header decoded to `''`. An `Int8Array` has one byte per element, so it passed every length check
 * and then decoded every byte above 0x7f to a different character: `String.fromCharCode(-75)` is
 * U+FFB5, not the U+00B5 micro sign real equipment writes into a physical dimension.
 *
 * `byteSource` refuses that exact pair at construction and explains why: an Int8Array "has one byte
 * per element, so it would pass every length check and then decode to fabricated sample values."
 * This is the same refusal one layer down, where the bytes are actually read (fixed in 0.6.96).
 */

import { describe, expect, it } from 'vitest';
import { decodeHeaderLatin1 } from '../../../src/bytes/latin1.js';
import { isByteArray } from '../../../src/io/source.js';

/** The cast a JavaScript caller does not need to write. */
const asBytes = (value: unknown) => value as Uint8Array;

function refusal(value: unknown): string {
  let decoded: string | undefined;
  try {
    decoded = decodeHeaderLatin1(asBytes(value));
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`the argument was accepted, and decoded to ${JSON.stringify(decoded)}`);
}

/** `"µV "`, as a real physical-dimension field is written: a bare 0xb5 and two padding spaces. */
const MICROVOLTS = Uint8Array.of(0xb5, 0x56, 0x20, 0x20);

describe('the bytes that are really bytes', () => {
  it('still decode, and 0xb5 is still the micro sign', () => {
    expect(decodeHeaderLatin1(MICROVOLTS)).toBe('µV  ');
  });

  it('still decode past the chunk boundary, which is where the loop lives', () => {
    const long = new Uint8Array(9000).fill(0x41);
    expect(decodeHeaderLatin1(long)).toBe('A'.repeat(9000));
  });

  it("accepts the other one-byte view, and Node's Buffer through it", () => {
    expect(decodeHeaderLatin1(asBytes(new Uint8ClampedArray(MICROVOLTS)))).toBe('µV  ');
  });
});

describe('an ArrayBuffer, which is what fetch and Blob hand you', () => {
  it('is refused rather than decoded to the empty string', () => {
    const message = refusal(MICROVOLTS.buffer);
    expect(message).toContain('decodeHeaderLatin1() needs a Uint8Array');
    expect(message).toContain('An ArrayBuffer has no length');
  });

  it('says how to wrap it', () => {
    expect(refusal(MICROVOLTS.buffer)).toContain('Next: pass `new Uint8Array(buffer)`');
  });
});

describe('an Int8Array, which would have decoded to different characters', () => {
  it('is refused', () => {
    expect(refusal(new Int8Array(MICROVOLTS))).toContain('one byte per element');
  });

  it('would have fabricated the text, which is why it is refused rather than tolerated', () => {
    // The value the old code would have produced, computed here rather than asserted from memory.
    expect(String.fromCharCode(new Int8Array(MICROVOLTS)[0] as number)).toBe('ﾵ');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['a string', 'EDF'],
    ['a plain array of byte values', [0xb5, 0x56]],
    ['a Uint16Array', new Uint16Array(2)],
  ])('refuses %s too', (_described, given) => {
    expect(() => decodeHeaderLatin1(asBytes(given))).toThrow(RangeError);
  });
});

describe('the tag test is the same one io/source.ts uses', () => {
  it('admits and refuses the same values, so the two copies cannot drift', () => {
    const cases: readonly unknown[] = [
      new Uint8Array(1),
      new Uint8ClampedArray(1),
      new Int8Array(1),
      new Uint16Array(1),
      new ArrayBuffer(1),
      new DataView(new ArrayBuffer(1)),
      undefined,
      null,
      'EDF',
      [0],
    ];
    for (const value of cases) {
      const accepted = (() => {
        try {
          decodeHeaderLatin1(asBytes(value));
          return true;
        } catch {
          return false;
        }
      })();
      expect({ value: String(value), accepted }).toEqual({
        value: String(value),
        accepted: isByteArray(value),
      });
    }
  });
});
