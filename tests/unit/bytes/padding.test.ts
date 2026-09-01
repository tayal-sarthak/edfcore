/**
 * One definition of what EDF field padding is.
 *
 * `trimEdfField` states the rule and the reason it is narrow: only 0x20 and 0x00, because a
 * trailing TAB or CR is not padding but content the file should not contain, and stripping it
 * there would hide it from `NON_ASCII_HEADER_FIELD`. Four modules act on that rule —
 * `bytes/latin1.ts` trimming a field for display and comparison, `bytes/numbers.ts` trimming one
 * before parsing it as a number, and `header/fields.ts` finding a field's content bounds inside
 * its own bytes for a diagnostic's evidence window — and each had grown a byte-identical copy of
 * the same two lines, with its own pair of constants.
 *
 * Four copies are four chances for two of them to disagree, and the disagreement would not look
 * like one. A field would trim one way for display and another way for its numeric parse, so
 * `NUMERIC_FIELD_NOT_LEFT_JUSTIFIED` would fire on a field `trimEdfField` had already called
 * clean, or an evidence window would point at a byte the message says is not there. Nothing would
 * name padding as the cause.
 *
 * Same treatment as `floorDiv` and `ceilDiv`, and for the same reason their docblock gives: one
 * owner, and a test that says every module doing the thing imports it.
 *
 * The behavioural half is the direction that matters. A padding byte being kept is visible — the
 * value is wrong or the label does not match. A CONTENT byte being stripped is invisible: the
 * field parses, the label compares equal, and the diagnostic that would have named the byte never
 * fires. So the check is that no byte outside the number grammar survives being appended to a
 * numeric field, which can only happen if something stripped it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isEdfPadding, trimEdfField } from '../../../src/bytes/latin1.js';
import { parseEdfNumber } from '../../../src/bytes/numbers.js';

const SRC = new URL('../../../src/', import.meta.url);

const ALL_BYTES = Array.from({ length: 256 }, (_, code) => code);

/** The characters the number grammar admits, so appending one is not evidence of stripping. */
const GRAMMAR = new Set([...'0123456789.eE+-'].map((one) => one.charCodeAt(0)));

function filesMentioning(needle: string): readonly string[] {
  const found: string[] = [];
  const walk = (directory: URL, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith('.ts')) {
        const source = readFileSync(new URL(entry.name, directory), 'utf8');
        if (source.includes(needle)) found.push(`${prefix}${entry.name}`);
      }
    }
  };
  walk(SRC, '');
  return found.sort();
}

describe('the rule', () => {
  it('is 0x20 and 0x00 and nothing else, over every byte value', () => {
    const padding = ALL_BYTES.filter((code) => isEdfPadding(code));
    expect(padding).toEqual([0x00, 0x20]);
  });

  it('excludes the whitespace a reader would expect it to include', () => {
    // TAB, LF, CR and vertical tab are whitespace to `String.prototype.trim` and content here.
    for (const code of [0x09, 0x0a, 0x0b, 0x0c, 0x0d]) {
      expect({ code, padding: isEdfPadding(code) }).toEqual({ code, padding: false });
      expect(`12${String.fromCharCode(code)}`.trim()).toBe('12');
    }
  });
});

describe('trimEdfField', () => {
  it('strips exactly the padding bytes, from both ends', () => {
    for (const code of ALL_BYTES) {
      const char = String.fromCharCode(code);
      expect({ code, trimmed: trimEdfField(`${char}12${char}`) }).toEqual({
        code,
        trimmed: isEdfPadding(code) ? '12' : `${char}12${char}`,
      });
    }
  });

  it('strips a run rather than one, which is the shape a real field has', () => {
    expect(trimEdfField(`Fp1${' '.repeat(13)}`)).toBe('Fp1');
    expect(trimEdfField(`Fp1${String.fromCharCode(0).repeat(13)}`)).toBe('Fp1');
    // Mixed, which a writer that switched pad bytes mid-field produces.
    expect(trimEdfField(`Fp1 ${String.fromCharCode(0)} `)).toBe('Fp1');
  });
});

describe('the numeric parser agrees about it', () => {
  it('accepts a number wrapped in padding and nothing else', () => {
    for (const code of ALL_BYTES) {
      if (GRAMMAR.has(code)) continue;
      const char = String.fromCharCode(code);
      const parsed = parseEdfNumber(`${char}12${char}`);
      expect({ code, ok: parsed.ok }).toEqual({ code, ok: isEdfPadding(code) });
      if (parsed.ok) expect(parsed.value).toBe(12);
    }
  });

  it('does not strip a content byte, which is the invisible direction', () => {
    // A stripped content byte parses cleanly and says nothing. This is the check that would fail
    // if one of the three copies had started treating TAB or CR as padding.
    for (const code of ALL_BYTES) {
      if (GRAMMAR.has(code) || isEdfPadding(code)) continue;
      // Refused, not silently trimmed. A comma gets its own problem code — `'0,5'` and `'1,024'`
      // are indistinguishable, and that is a different message rather than a different answer —
      // so the claim is the refusal, not which word it uses.
      expect({ code, ok: parseEdfNumber(`12${String.fromCharCode(code)}`).ok }).toEqual({
        code,
        ok: false,
      });
    }
  });

  it('still reports right-justification, which is the other half of padding', () => {
    // Leading padding parses and is reported. Losing that would look like agreement.
    expect(parseEdfNumber('      12').problem).toBe('not-left-justified');
    expect(parseEdfNumber('12      ').problem).toBe('none');
  });
});

describe('every module that strips it', () => {
  it('imports the one definition rather than growing another', () => {
    expect(filesMentioning('isEdfPadding')).toEqual([
      'bytes/latin1.ts',
      'bytes/numbers.ts',
      'header/fields.ts',
      'header/variant.ts',
    ]);
  });

  it('leaves the constants in one place too, which is where the copies started', () => {
    // Each copy carried its own `CHAR_SPACE`/`CHAR_NUL` pair. One file names the space now.
    expect(filesMentioning('CHAR_SPACE')).toEqual(['bytes/latin1.ts']);
  });
});
