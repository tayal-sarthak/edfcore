/**
 * Slicing, copying and the boundary between them.
 *
 * `sliceBytes` shares memory and `copyBytes` does not, which is the distinction every read in the
 * package is built on: a diagnostic holding a slice of a buffer an I/O adapter is free to reuse
 * would change its own `rawBytes` later. The bounds cases pin the other half — a range outside
 * the buffer throws rather than returning a short array that reads as a truncated file.
 */

import { describe, expect, it } from 'vitest';

import { copyBytes, readAsciiField, sliceBytes } from '../../../src/bytes/view.js';
import { isEdfError } from '../../../src/errors.js';

function bytesOf(...codes: readonly number[]): Uint8Array {
  return Uint8Array.from(codes);
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

function capture(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw, but it returned normally');
}

describe('sliceBytes', () => {
  it('returns the requested bytes', () => {
    const source = bytesOf(10, 11, 12, 13, 14, 15);

    expect([...sliceBytes(source, 2, 3)]).toEqual([12, 13, 14]);
  });

  /**
   * THE DOCUMENTED CONTRACT: a view, not a copy. Nothing in edfcore mutates a source buffer,
   * so sharing memory is safe and avoids a copy per field; a caller that pools buffers must
   * therefore use copyBytes when the bytes have to outlive the read.
   */
  it('returns a VIEW that shares memory with the source, so a write is visible in both', () => {
    const source = bytesOf(10, 11, 12, 13, 14, 15);

    const view = sliceBytes(source, 2, 3);
    view[0] = 99;

    expect(source[2]).toBe(99);
    expect(view.buffer).toBe(source.buffer);
    expect(view.byteOffset).toBe(source.byteOffset + 2);
  });

  it('reflects a later write to the source, since no snapshot was taken', () => {
    const source = bytesOf(10, 11, 12, 13, 14, 15);

    const view = sliceBytes(source, 2, 3);
    source[3] = 77;

    expect(view[1]).toBe(77);
  });

  it('resolves offsets against the view it was given, not the underlying buffer', () => {
    const backing = bytesOf(0, 1, 2, 3, 4, 5, 6, 7);
    const window = backing.subarray(4);

    expect([...sliceBytes(window, 0, 2)]).toEqual([4, 5]);
    // Bytes exist at absolute offset 6 in the buffer, but not at offset 6 of this 4-byte view.
    expect(capture(() => sliceBytes(window, 6, 1))).toBeInstanceOf(RangeError);
  });

  it('allows a zero-length slice at the very end of the buffer', () => {
    const source = bytesOf(1, 2, 3, 4);

    expect(sliceBytes(source, 4, 0).length).toBe(0);
    expect(sliceBytes(source, 0, 0).length).toBe(0);
  });
});

describe('copyBytes', () => {
  it('returns the requested bytes', () => {
    const source = bytesOf(10, 11, 12, 13, 14, 15);

    expect([...copyBytes(source, 2, 3)]).toEqual([12, 13, 14]);
  });

  it('returns an independent buffer, so writing to the copy leaves the source alone', () => {
    const source = bytesOf(10, 11, 12, 13, 14, 15);

    const copy = copyBytes(source, 2, 3);
    copy[0] = 99;

    expect(source[2]).toBe(12);
    expect(copy.buffer).not.toBe(source.buffer);
  });

  it('is a snapshot, so a later write to the source does not reach the copy', () => {
    const source = bytesOf(10, 11, 12, 13, 14, 15);

    const copy = copyBytes(source, 2, 3);
    source[3] = 77;

    expect(copy[1]).toBe(13);
  });

  it('allows a zero-length copy at the very end of the buffer', () => {
    const source = bytesOf(1, 2, 3, 4);

    expect(copyBytes(source, 4, 0).length).toBe(0);
  });
});

describe('bounds checking', () => {
  const source = bytesOf(0, 1, 2, 3, 4, 5, 6, 7);

  const cases: readonly { name: string; offset: number; length: number }[] = [
    { name: 'a range running past the end of the buffer', offset: 6, length: 4 },
    { name: 'an offset one past the last byte with a non-zero length', offset: 8, length: 1 },
    { name: 'a length larger than the whole buffer', offset: 0, length: 9 },
    { name: 'a negative offset', offset: -1, length: 1 },
    { name: 'a negative length', offset: 0, length: -1 },
    { name: 'a fractional offset', offset: 1.5, length: 1 },
    { name: 'a fractional length', offset: 0, length: 2.5 },
    { name: 'a NaN offset', offset: Number.NaN, length: 1 },
    { name: 'a NaN length', offset: 0, length: Number.NaN },
    { name: 'an infinite offset', offset: Number.POSITIVE_INFINITY, length: 0 },
    { name: 'an infinite length', offset: 0, length: Number.POSITIVE_INFINITY },
    {
      name: 'an offset beyond the exact-integer range',
      offset: Number.MAX_SAFE_INTEGER + 1,
      length: 0,
    },
  ];

  for (const testCase of cases) {
    it(`sliceBytes throws on ${testCase.name}`, () => {
      expect(capture(() => sliceBytes(source, testCase.offset, testCase.length))).toBeInstanceOf(
        RangeError,
      );
    });

    it(`copyBytes throws on ${testCase.name}`, () => {
      expect(capture(() => copyBytes(source, testCase.offset, testCase.length))).toBeInstanceOf(
        RangeError,
      );
    });

    it(`readAsciiField throws on ${testCase.name}`, () => {
      expect(
        capture(() => readAsciiField(source, testCase.offset, testCase.length)),
      ).toBeInstanceOf(RangeError);
    });
  }

  /**
   * Deliberately a plain RangeError, not EdfRangeError: reaching here means edfcore computed
   * an offset wrongly or a caller mixed a header with another file's bytes. EdfRangeError is
   * reserved for the honest case of asking for records that do not exist, and conflating the
   * two would let an internal bug present itself as user error.
   */
  it('throws a plain RangeError that is not an EdfError', () => {
    const error = capture(() => sliceBytes(source, 0, 99));

    expect(error).toBeInstanceOf(RangeError);
    expect(isEdfError(error)).toBe(false);
  });

  it('names the buffer size and the requested range in the message', () => {
    const error = capture(() => sliceBytes(source, 6, 4)) as RangeError;

    expect(error.message).toContain('6');
    expect(error.message).toContain('10');
    expect(error.message).toContain('8');
  });
});

describe('readAsciiField', () => {
  it('returns the RAW, untrimmed field text so the padding stays visible', () => {
    // Untrimmed on purpose: header.raw.* exposes what the file actually wrote, and the
    // numeric grammars need the padding to tell a right-justified field from a conformant one.
    const source = asciiBytes('XX  256  YY');

    const field = readAsciiField(source, 2, 7);

    expect(field).toBe('  256  ');
    expect(field.length).toBe(7);
  });

  it('keeps trailing NUL padding rather than terminating at it', () => {
    const source = bytesOf(0x46, 0x70, 0x31, 0x00, 0x00);

    const field = readAsciiField(source, 0, 5);

    expect(field.length).toBe(5);
    expect(field.charCodeAt(3)).toBe(0);
  });

  it('decodes as Latin-1, so a raw 0xB5 is U+00B5 and 0x80 is U+0080', () => {
    const source = bytesOf(0x75, 0x56, 0xb5, 0x80);

    const field = readAsciiField(source, 0, 4);

    expect(field.charCodeAt(2)).toBe(0xb5);
    expect(field.charCodeAt(3)).toBe(0x80);
  });

  it('returns the empty string for a zero-length field', () => {
    expect(readAsciiField(bytesOf(1, 2, 3), 1, 0)).toBe('');
  });

  it('reads only the window a subarray describes', () => {
    const backing = asciiBytes('XXFp1  XX');

    expect(readAsciiField(backing.subarray(2, 7), 0, 5)).toBe('Fp1  ');
  });
});
