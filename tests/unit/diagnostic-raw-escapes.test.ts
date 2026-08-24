/**
 * The `raw:` line's escape table, at its edges.
 *
 * `quote` keeps a raw field on ONE line whatever it contains, which is what makes
 * `formatDiagnostics` output greppable: a diagnostic is a block whose continuation lines are
 * indented, and a newline or a tab arriving verbatim from an 80-byte header field would break
 * that. The table has four boundaries, and only one of them - the space at 0x20 - was pinned.
 *
 * The other three matter for ordinary bytes, not exotic ones:
 *
 *  - `~` is 0x7e, the LAST printable ASCII character, and it occurs in real prefiltering fields
 *    (`HP:~0.1Hz`). Narrowing that bound prints it as an escape, which reads as a control byte in
 *    a field where the writer typed a tilde.
 *  - U+00FF is the last character with a two-digit escape. Narrowing that bound spells it
 *    `\u{ff}` while every other Latin-1 byte in the same field is spelled `\xNN`, so two
 *    bytes from one header field print in two different notations.
 *  - Above it the long form is the only one that can say what the character was.
 *
 * The contrast with `expected:` and `actual:` is asserted alongside, because the two rules are
 * deliberately different and neither is obvious on its own. `raw` is quoted, so an escape is
 * right; `expected` and `actual` are unquoted values printed at a fixed width, so a control byte
 * becomes a single dot through `printable` rather than a four-character escape.
 *
 * Every character under test is written as a `\u` escape, so this file stays ASCII and a
 * reader can see which code point each case is about without measuring it.
 */

import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import type { EdfDiagnostic } from '../../src/types.js';

/** Space, tilde, a C0 byte, DEL, the last Latin-1 character, the first one past it, and quoting. */
const SPECIMEN = ' ~\u001f\u007f\u00ff\u0100"\\';

function diagnosticWith(over: Partial<EdfDiagnostic>): EdfDiagnostic {
  return {
    code: 'PATIENT_ID_NONCONFORMANT',
    severity: 'warning',
    message: 'synthesised by a test',
    field: 'patientId',
    byteOffset: 8,
    byteLength: 80,
    rawBytes: undefined,
    raw: undefined,
    expected: undefined,
    actual: undefined,
    signalIndex: undefined,
    recordIndex: undefined,
    specReference: undefined,
    ...over,
  };
}

function lineStartingWith(text: string, prefix: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith(prefix)) ?? ''
  );
}

describe('a raw field on one line', () => {
  it('keeps every printable ASCII character and escapes everything else', () => {
    const out = formatDiagnostics([diagnosticWith({ raw: SPECIMEN })]);

    // Space and `~` survive; 0x1f, 0x7f and 0xff take the two-digit form; U+0100 the long one;
    // and the two characters that would end the quote are backslashed.
    expect(lineStartingWith(out, 'raw:')).toBe('raw: " ~\\x1f\\x7f\\xff\\u{100}\\"\\\\"');
  });

  it('never emits a byte that could start a new line or a new column', () => {
    // The property behind the table: whatever the field held, the rendered line is one line.
    const out = formatDiagnostics([diagnosticWith({ raw: 'a\nb\tc\rd' })]);

    expect(lineStartingWith(out, 'raw:')).toBe('raw: "a\\x0ab\\x09c\\x0dd"');
    expect(out.split('\n').filter((one) => one.includes('raw:'))).toHaveLength(1);
  });
});

describe('expected and actual take the other rule, on purpose', () => {
  it('replaces a control byte with one dot rather than escaping it', () => {
    // A dot is one character wide, which is what a fixed-width column needs; an escape is four
    // and would shift everything after it. The same byte therefore prints differently on the two
    // lines, and that is the design rather than an inconsistency.
    const out = formatDiagnostics([
      diagnosticWith({ raw: SPECIMEN, expected: SPECIMEN, actual: SPECIMEN }),
    ]);

    const dotted = ' ~..\u00ff\u0100"\\';
    expect(lineStartingWith(out, 'expected:')).toBe(`expected: ${dotted}`);
    expect(lineStartingWith(out, 'actual:')).toBe(`actual: ${dotted}`);
    // And the raw line beside them still escapes, so this is a difference and not a regression.
    expect(lineStartingWith(out, 'raw:')).toContain('\\x7f');
  });
});
