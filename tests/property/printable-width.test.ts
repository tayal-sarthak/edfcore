/**
 * `printable` never changes the width of what it is given.
 *
 * Every table this package prints is built on that. `formatHeader` pads a label into a column,
 * the CLI's `signals` output is tab-separated for `cut -f2`, and `formatValidationReport` lines up
 * observed ranges under a heading — all of them on text read out of a file, where EDF says a label
 * is sixteen bytes and says nothing about what may be in them.
 *
 * The module's own docblock states the rule and the reasoning: replacement, not escaping, and not
 * stripping. Stripping changes the width silently, so a padded column stops lining up; escaping is
 * two characters where the field allowed one. Both rejected alternatives are the natural thing to
 * reach for, and both are correct-looking — a stripped control character is gone, an escaped one is
 * legible. Either shifts a column by a character per occurrence, in a table whose whole job is that
 * a reader can scan down it.
 *
 * By example that is three assertions on three strings. The property is over arbitrary text,
 * including the parts a person writing a fixture does not think of: astral characters, which are
 * two UTF-16 units and one iteration of a for-of; lone surrogates, which are one of each; the
 * Latin-1 supplement, which a European electrode label really contains; and the line separator the
 * docblock argues at length should pass through.
 *
 * Three invariants, and the third is what makes the first two mean anything: the length is
 * unchanged, no C0 or DEL survives, and every character that was not one is exactly what it was.
 * Without the third, returning a string of dots would satisfy the other two.
 *
 * The seed is constant, so a failure is reproducible from the terminal output alone.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { printable } from '../../src/text/printable.js';

const SEED = 0x7d21;

const REPLACED = (code: number): boolean => code < 0x20 || code === 0x7f;

/** Text drawn from the ranges that actually reach this function, not just from ASCII. */
const character = fc.oneof(
  // C0 and DEL: the characters being replaced. DEL is drawn separately — it is not in the C0
  // range, and a generator that only covers 0x00-0x1f leaves the second half of the condition
  // untouched, which is how it stays untested while looking covered.
  fc.integer({ min: 0, max: 0x1f }).map((code) => String.fromCharCode(code)),
  fc.constant('\u007f'),
  fc.constantFrom(...'Fp1-Cz EEG 0123'.split('')),
  // Latin-1 supplement: an electrode label written on a European system.
  fc.integer({ min: 0xa0, max: 0xff }).map((code) => String.fromCharCode(code)),
  // 0x80-0x9f, left alone because headers are decoded as ISO-8859-1.
  fc.integer({ min: 0x80, max: 0x9f }).map((code) => String.fromCharCode(code)),
  // Above the BMP: two UTF-16 units, one code point, one iteration of a for-of.
  fc.integer({ min: 0x1f300, max: 0x1f5ff }).map((code) => String.fromCodePoint(code)),
  // Line and paragraph separators, which the docblock argues should pass through.
  fc.constantFrom('\u2028', '\u2029'),
  // A lone surrogate: one UTF-16 unit that is not a character.
  fc.integer({ min: 0xd800, max: 0xdbff }).map((code) => String.fromCharCode(code)),
);

/** `fc.stringOf` is gone in fast-check 4; a joined array of characters is the same thing. */
const text = fc.array(character, { maxLength: 40 }).map((parts) => parts.join(''));

describe('whatever it is given', () => {
  it('comes back the same width', () => {
    fc.assert(
      fc.property(text, (input) => {
        expect(printable(input)).toHaveLength(input.length);
      }),
      { seed: SEED, numRuns: 400 },
    );
  });

  it('comes back with no C0 and no DEL in it', () => {
    fc.assert(
      fc.property(text, (input) => {
        const out = printable(input);
        for (let at = 0; at < out.length; at += 1) {
          expect(REPLACED(out.charCodeAt(at)), `code ${out.charCodeAt(at)} survived`).toBe(false);
        }
      }),
      { seed: SEED, numRuns: 400 },
    );
  });

  it('comes back unchanged wherever it was already printable', () => {
    // The invariant that stops "return a string of dots" satisfying the other two.
    fc.assert(
      fc.property(text, (input) => {
        const out = printable(input);
        for (let at = 0; at < input.length; at += 1) {
          const code = input.charCodeAt(at);
          if (REPLACED(code)) expect(out[at]).toBe('.');
          else expect(out.charCodeAt(at)).toBe(code);
        }
      }),
      { seed: SEED, numRuns: 400 },
    );
  });
});

describe('the alternatives the docblock rejects', () => {
  it('would each have changed the width, which is why they were rejected', () => {
    // An executable contrast rather than a comment: stripping shortens, escaping lengthens, and
    // both are the natural thing to write.
    fc.assert(
      fc.property(text, (input) => {
        const controls = [...input].filter((one) => REPLACED(one.codePointAt(0) ?? 0)).length;
        fc.pre(controls > 0);
        const stripped = [...input].filter((one) => !REPLACED(one.codePointAt(0) ?? 0)).join('');
        const escaped = [...input]
          .map((one) => (REPLACED(one.codePointAt(0) ?? 0) ? '\\n' : one))
          .join('');
        expect(stripped.length).toBeLessThan(input.length);
        expect(escaped.length).toBeGreaterThan(input.length);
        expect(printable(input)).toHaveLength(input.length);
      }),
      { seed: SEED, numRuns: 200 },
    );
  });
});
