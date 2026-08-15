/**
 * Header text decoding, byte by byte.
 *
 * `decodeHeaderLatin1` exists instead of a `TextDecoder` because every `latin1` label Node
 * accepts decodes byte 0x80 differently from the WHATWG standard, so the same header would yield
 * different strings in Node and in a browser. That is the claim these cases hold: one byte in,
 * one code point out, for all 256 of them — which is what makes a header string the same value
 * everywhere the package runs.
 */

import { describe, expect, it } from 'vitest';

import {
  decodeHeaderLatin1,
  hasNonPrintableAscii,
  trimEdfField,
} from '../../../src/bytes/latin1.js';

/**
 * This file is pure ASCII on purpose: every control or non-ASCII character is built from its
 * code point, so what a test asserts cannot be changed by an editor normalising the file.
 */
const NUL = String.fromCharCode(0x00);
const TAB = String.fromCharCode(0x09);
const CR = String.fromCharCode(0x0d);

/** U+20AC EURO SIGN - what a WHATWG-conformant windows-1252 decoder produces for byte 0x80. */
const EURO = String.fromCodePoint(0x20ac);

function bytesOf(...codes: readonly number[]): Uint8Array {
  return Uint8Array.from(codes);
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

function codePointsOf(text: string): number[] {
  const points: number[] = [];
  for (const char of text) points.push(char.codePointAt(0) ?? -1);
  return points;
}

describe('decodeHeaderLatin1', () => {
  /**
   * THE PINNED TEST. DESIGN.md section 5, "Header text decoding - mandatory": every
   * TextDecoder label Node accepts for latin1 ('latin1', 'iso-8859-1', 'ascii',
   * 'windows-1252') reports `encoding === 'windows-1252'`, and the WHATWG Encoding Standard
   * mandates U+20AC for that label. A TextDecoder-based decoder would therefore turn the same
   * header bytes into different strings in Node and in a spec-compliant browser, which is why
   * TextDecoder is banned outside src/tal/. ISO-8859-1 is the identity map, so 0x80 is U+0080.
   */
  it('decodes byte 0x80 as U+0080, never the windows-1252 euro sign', () => {
    const decoded = decodeHeaderLatin1(bytesOf(0x80));

    expect(decoded.length).toBe(1);
    expect(decoded.codePointAt(0)).toBe(0x80);
    expect(decoded.codePointAt(0)).not.toBe(0x20ac);
    expect(decoded).not.toBe(EURO);
  });

  /** The four bytes DESIGN.md section 5 names as the Node/WHATWG divergence, in one string. */
  it('decodes 0x80 0x85 0x92 0x9F as U+0080 U+0085 U+0092 U+009F, not the cp1252 glyphs', () => {
    const decoded = decodeHeaderLatin1(bytesOf(0x80, 0x85, 0x92, 0x9f));

    expect(codePointsOf(decoded)).toEqual([0x80, 0x85, 0x92, 0x9f]);
    // U+20AC U+2026 U+2019 U+0178 is what the WHATWG windows-1252 index gives.
    expect(codePointsOf(decoded)).not.toEqual([0x20ac, 0x2026, 0x2019, 0x0178]);
  });

  it('maps every one of the 256 byte values onto the identically numbered code point', () => {
    const all = new Uint8Array(256);
    for (let byte = 0; byte < 256; byte++) all[byte] = byte;

    const decoded = decodeHeaderLatin1(all);

    expect(decoded.length).toBe(256);
    for (let byte = 0; byte < 256; byte++) {
      // Paired with the index so a failure names the byte that broke.
      expect([byte, decoded.charCodeAt(byte)]).toEqual([byte, byte]);
    }
  });

  it('decodes a raw 0xB5 as U+00B5, the micro sign equipment writes for microvolts', () => {
    const decoded = decodeHeaderLatin1(bytesOf(0x75, 0x56, 0xb5, 0x56));

    expect(codePointsOf(decoded)).toEqual([0x75, 0x56, 0xb5, 0x56]);
    expect(decoded.length).toBe(4);
  });

  it('returns the empty string for an empty range', () => {
    expect(decodeHeaderLatin1(new Uint8Array(0))).toBe('');
  });

  it('preserves a NUL rather than terminating the string at it', () => {
    expect(decodeHeaderLatin1(bytesOf(0x41, 0x00, 0x42))).toBe(`A${NUL}B`);
  });

  // The decoder chunks its String.fromCharCode.apply calls to stay under the engine argument
  // limit; these lengths straddle that 4096-byte boundary, so a dropped, duplicated or
  // misordered chunk shows up here.
  for (const length of [1, 4095, 4096, 4097, 8192, 8199]) {
    it(`joins its internal chunks losslessly for a ${length}-byte field`, () => {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = (i * 31 + 7) & 0xff;

      const decoded = decodeHeaderLatin1(bytes);

      expect(decoded.length).toBe(length);
      let mismatches = 0;
      for (let i = 0; i < length; i++) {
        if (decoded.charCodeAt(i) !== bytes[i]) mismatches++;
      }
      expect(mismatches).toBe(0);
    });
  }

  it('decodes only the window a subarray describes, not its backing buffer', () => {
    const backing = asciiBytes('XXhelloXX');

    expect(decodeHeaderLatin1(backing.subarray(2, 7))).toBe('hello');
  });
});

describe('hasNonPrintableAscii', () => {
  // The spec's legal header alphabet is printable ASCII 32..126. Anything outside it drives
  // the NON_ASCII_HEADER_FIELD warning (DESIGN.md section 6) - a warning, not an error,
  // because the field still decodes truthfully as Latin-1.
  const cases: readonly { name: string; bytes: Uint8Array; expected: boolean }[] = [
    {
      name: 'flags a raw 0xB5 micro sign, which real equipment writes',
      bytes: bytesOf(0xb5),
      expected: true,
    },
    {
      name: 'accepts ordinary ASCII text',
      bytes: asciiBytes('EEG Fpz-Cz'),
      expected: false,
    },
    {
      name: 'accepts space-padded text, the exact layout the spec mandates',
      bytes: asciiBytes('Fp1             '),
      expected: false,
    },
    {
      name: 'accepts the space at the low edge of printable ASCII',
      bytes: bytesOf(0x20),
      expected: false,
    },
    {
      name: 'accepts the tilde at the high edge of printable ASCII',
      bytes: bytesOf(0x7e),
      expected: false,
    },
    {
      name: 'flags DEL, one past the high edge',
      bytes: bytesOf(0x7f),
      expected: true,
    },
    {
      name: 'flags 0x1F, one below the low edge',
      bytes: bytesOf(0x1f),
      expected: true,
    },
    {
      // Deliberate: NUL is outside the alphabet too. A caller willing to tolerate NUL padding
      // inspects the padding itself instead of having this function hide it.
      name: 'flags NUL padding rather than treating it as a second legal pad byte',
      bytes: bytesOf(0x45, 0x44, 0x46, 0x00, 0x00),
      expected: true,
    },
    {
      name: 'flags a TAB, which is neither padding nor legal header content',
      bytes: bytesOf(0x46, 0x70, 0x31, 0x09),
      expected: true,
    },
    {
      name: 'flags an accented Latin-1 name',
      bytes: bytesOf(0x4a, 0x6f, 0x73, 0xe9),
      expected: true,
    },
    {
      name: 'reports nothing for an empty range',
      bytes: new Uint8Array(0),
      expected: false,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(hasNonPrintableAscii(testCase.bytes)).toBe(testCase.expected);
    });
  }

  it('inspects only the window a subarray describes', () => {
    const backing = bytesOf(0xb5, 0x41, 0x42, 0x43, 0xb5);

    expect(hasNonPrintableAscii(backing.subarray(1, 4))).toBe(false);
    expect(hasNonPrintableAscii(backing.subarray(1, 5))).toBe(true);
  });
});

describe('trimEdfField', () => {
  const cases: readonly { name: string; input: string; expected: string }[] = [
    {
      // EDF pads on the right with spaces, so this is the expected case.
      name: 'strips the trailing spaces the spec mandates as padding',
      input: 'EDF+C                                       ',
      expected: 'EDF+C',
    },
    {
      name: 'strips trailing NULs, which writers emit in place of spaces',
      input: `Fp1${NUL}${NUL}${NUL}`,
      expected: 'Fp1',
    },
    {
      name: 'strips a trailing mixture of spaces and NULs',
      input: `Fp1 ${NUL} ${NUL}`,
      expected: 'Fp1',
    },
    {
      name: 'returns the empty string for an all-space field',
      input: '        ',
      expected: '',
    },
    {
      name: 'returns the empty string for an all-NUL field',
      input: `${NUL}${NUL}${NUL}${NUL}`,
      expected: '',
    },
    {
      name: 'returns the empty string for an empty field',
      input: '',
      expected: '',
    },
    {
      // Deliberate: '  Fp1' names the same electrode as 'Fp1   '. No evidence is lost - every
      // field is also exposed raw and untrimmed, and numeric non-conformance is reported
      // separately by the number grammars, which read the untrimmed string.
      name: 'strips leading padding too, so a right-justified label compares equal',
      input: `  ${NUL}Fp1   `,
      expected: 'Fp1',
    },
    {
      name: 'keeps interior spaces, so the annotation label survives intact',
      input: 'EDF Annotations ',
      expected: 'EDF Annotations',
    },
    {
      name: 'keeps an interior NUL, which is evidence of a broken writer',
      input: `a${NUL}b   `,
      expected: `a${NUL}b`,
    },
    {
      // Only 0x20 and 0x00 are padding. Hiding a TAB here would also hide it from
      // NON_ASCII_HEADER_FIELD.
      name: 'keeps a trailing TAB, which is content the file should not contain',
      input: `Fp1${TAB}`,
      expected: `Fp1${TAB}`,
    },
    {
      name: 'keeps a trailing CR for the same reason',
      input: `Fp1${CR}`,
      expected: `Fp1${CR}`,
    },
    {
      name: 'leaves an already-trimmed field untouched',
      input: 'Fp1',
      expected: 'Fp1',
    },
    {
      name: 'trims down to a single significant character',
      input: '  X     ',
      expected: 'X',
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(trimEdfField(testCase.input)).toBe(testCase.expected);
    });
  }

  it('is idempotent', () => {
    const once = trimEdfField(`  ${NUL}EDF Annotations ${NUL} `);

    expect(once).toBe('EDF Annotations');
    expect(trimEdfField(once)).toBe(once);
  });
});
