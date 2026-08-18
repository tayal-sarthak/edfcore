/**
 * `printable` replaces exactly the C0 controls and DEL, and nothing else.
 *
 * The rule is stated in the module and was checked nowhere: four test files mention `printable`
 * while testing something else, and none of them pins which code points it acts on. That rule is
 * the whole module — one function, and the reason it exists is that a value must never become
 * structure. A newline in an electrode label opens a table row describing a signal the file does
 * not contain; a tab invents a column in the CLI's tab-separated output.
 *
 * The boundary matters in both directions, and the module argues both. Replacing too little lets
 * a control character through into a table. Replacing too much mangles an electrode label written
 * on a European system, where `0xB5` for micro and accented letters are ordinary text — which is
 * why `0x80`-`0xFF` are left alone: header bytes are decoded as ISO-8859-1, where that range is
 * not control characters.
 *
 * Above `U+00FF` is the case the module comment did not cover until 0.4.265, and it is reachable:
 * header text is Latin-1 and can never exceed `U+00FF`, but ANNOTATION text is UTF-8 and
 * `printable` is what prints it — `cli-run.ts` for `events`, `format-annotations.ts` for the
 * hypnogram formatter. So `U+2028 LINE SEPARATOR` really can arrive here, and it passes through
 * unchanged. That is deliberate: no terminal and no HTML renderer breaks a line on it, so it is
 * not structure in any output edfcore produces, and replacing it would be replacing a character
 * somebody's annotation legitimately contains.
 */

import { describe, expect, it } from 'vitest';
import { printable } from '../../../src/text/printable.js';

const DOT = '.';

describe('the C0 controls and DEL', () => {
  it('replaces every one of them', () => {
    const survivors: string[] = [];
    for (let code = 0x00; code <= 0x1f; code++) {
      if (printable(String.fromCharCode(code)) !== DOT) survivors.push(code.toString(16));
    }
    if (printable('\u007f') !== DOT) survivors.push('7f');
    expect(survivors, 'control characters that reached the output').toEqual([]);
  });

  it('replaces rather than strips, so a fixed-width column still lines up', () => {
    // Stripping would silently narrow the field; escaping to `\\n` would widen it by one.
    const label = `Fp1\u0009Cz\u000aO2`;
    expect(printable(label)).toBe('Fp1.Cz.O2');
    expect(printable(label)).toHaveLength(label.length);
  });

  it('kills the escape that would let a label paint the terminal', () => {
    // ESC is 0x1b, so ANSI injection through an electrode label ends at the first character.
    expect(printable('\u001b[31mred')).toBe('.[31mred');
  });
});

describe('everything else survives', () => {
  it('leaves printable ASCII exactly as it was', () => {
    let ascii = '';
    for (let code = 0x20; code <= 0x7e; code++) ascii += String.fromCharCode(code);
    expect(printable(ascii)).toBe(ascii);
  });

  it('leaves the whole of Latin-1 above ASCII alone', () => {
    // Including 0x80-0x9f, which is C1 in Unicode and ordinary text in ISO-8859-1 — the encoding
    // `decodeHeaderLatin1` uses, so these bytes are letters here rather than controls.
    let latin1 = '';
    for (let code = 0x80; code <= 0xff; code++) latin1 += String.fromCharCode(code);
    expect(printable(latin1)).toBe(latin1);
    expect(printable('\u00b5V')).toBe('\u00b5V');
  });

  it('leaves code points above U+00FF alone, which annotation text can reach', () => {
    // Header text is Latin-1 and stops at U+00FF. Annotation text is UTF-8 and does not.
    for (const text of [
      'a\u2028b',
      'a\u2029b',
      'a\u0085b',
      'a\ufeffb',
      '\u30b9\u30c6\u30fc\u30b8',
    ]) {
      expect(printable(text)).toBe(text);
    }
  });

  it('keeps an astral character whole rather than splitting its surrogates', () => {
    // Iterated by code point, so a character outside the BMP is one unit and survives intact.
    const astral = 'stage \u{1F600} W';
    expect(printable(astral)).toBe(astral);
  });
});
