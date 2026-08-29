/**
 * The hex dump line, exactly as `diagnostics.md` prints it.
 *
 * The page shows one line and says one thing about it: "When `rawBytes` is present the block
 * includes a hex dump of up to 24 bytes", followed by
 *
 *     bytes: 63 61 66 e9  |caf.|
 *
 * Four bytes, four hex pairs, two spaces, and an ASCII gutter. It had no test, and it is the line a
 * bug report is pasted from — the one place in the package where a reader is looking at bytes
 * rather than at edfcore's reading of them.
 *
 * The interesting byte is the last one. `0xe9` is `e-acute` in Latin-1, and every header field in
 * this package decodes as Latin-1, so the obvious gutter for these four bytes is `|cafe|` with an
 * accent. The page prints `|caf.|`, because the gutter is PRINTABLE ASCII and nothing else: a
 * reader comparing the dump against a hex editor needs each column to mean one byte, and a byte
 * that renders as a character in one decoding and a different character in another is worse than
 * a dot. It is the one deliberate exception to the package's Latin-1 rule, and it was carried by
 * an example rather than by an assertion.
 *
 * The cap is the other half. It is stated on the page as a number, lives in `format.ts` as a
 * constant, and beyond it the dump says how many bytes it did not show — a truncated dump that
 * did not say so would read as a complete one, which is the same defect the diagnostic limit and
 * the CLI listing each had.
 */

import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import type { EdfDiagnostic } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

const PAGE = DOCS_PAGES.get('diagnostics.md') ?? '';

/** The `bytes: ...` line the page prints, without its indent. */
const PRINTED = (() => {
  const found = PAGE.split(String.fromCharCode(10)).find((line) =>
    line.trim().startsWith('bytes:'),
  );
  if (found === undefined) throw new Error('diagnostics.md no longer prints a hex dump');
  return found.trim();
})();

/** "a hex dump of up to 24 bytes" -> 24. */
const CAP = (() => {
  const stated = /hex dump of up to (\d+) bytes/.exec(PAGE.replace(/\s+/g, ' '));
  if (stated === null) throw new Error('diagnostics.md no longer states the cap');
  return Number(stated[1]);
})();

function diagnosticWith(rawBytes: Uint8Array): EdfDiagnostic {
  return {
    code: 'NON_ASCII_HEADER_FIELD',
    severity: 'warning',
    message: 'synthesised by a test',
    field: 'patientId',
    byteOffset: 8,
    byteLength: rawBytes.length,
    rawBytes,
    raw: undefined,
    expected: undefined,
    actual: undefined,
    signalIndex: undefined,
    recordIndex: undefined,
    specReference: undefined,
  };
}

/** The `bytes:` line `formatDiagnostics` emits for one diagnostic, without its indent. */
function dumpOf(rawBytes: Uint8Array): string {
  const line = formatDiagnostics([diagnosticWith(rawBytes)])
    .split(String.fromCharCode(10))
    .find((entry) => entry.trim().startsWith('bytes:'));
  if (line === undefined) throw new Error('formatDiagnostics emitted no hex dump');
  return line.trim();
}

describe('the line the page prints', () => {
  it('was read, and names four bytes, so a passing run is not a vacuous one', () => {
    expect(PRINTED).toContain('|');
    expect(CAP).toBeGreaterThan(0);
    // Four hex pairs before the gutter.
    expect(PRINTED.slice('bytes:'.length, PRINTED.indexOf('|')).trim().split(/\s+/)).toHaveLength(
      4,
    );
  });

  it('is what formatDiagnostics emits for those bytes', () => {
    const bytes = Uint8Array.from(
      (PRINTED.slice('bytes:'.length, PRINTED.indexOf('|')).trim().split(/\s+/) as string[]).map(
        (pair) => Number.parseInt(pair, 16),
      ),
    );
    expect(dumpOf(bytes)).toBe(PRINTED);
  });

  it('renders a Latin-1 byte as a dot, which is the exception the gutter makes', () => {
    // `0xe9` is `e-acute` through the decoder every header field uses. The gutter is printable
    // ASCII only, so it is a dot here and the page prints `|caf.|`.
    expect(dumpOf(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]))).toBe('bytes: 63 61 66 e9  |caf.|');
    // The boundaries of "printable ASCII": space is in, DEL is out, and so is everything above it.
    expect(dumpOf(Uint8Array.from([0x20, 0x7e, 0x1f, 0x7f, 0xff]))).toBe(
      'bytes: 20 7e 1f 7f ff  | ~...|',
    );
  });
});

describe('the cap the page states', () => {
  it('shows every byte up to it, and says nothing about more', () => {
    const exactly = Uint8Array.from({ length: CAP }, () => 0x41);
    const dump = dumpOf(exactly);
    expect(dump.split('  |')[0]?.slice('bytes:'.length).trim().split(/\s+/)).toHaveLength(CAP);
    expect(dump).not.toContain('more');
  });

  it('says how many it withheld beyond it, rather than truncating in silence', () => {
    const over = Uint8Array.from({ length: CAP + 7 }, () => 0x41);
    const dump = dumpOf(over);
    expect(dump.split('  |')[0]?.slice('bytes:'.length).trim().split(/\s+/)).toHaveLength(CAP);
    expect(dump).toContain('+7 more');
  });

  it('keeps the gutter the same length as the hex, so the columns line up', () => {
    const over = Uint8Array.from({ length: CAP + 7 }, (_, at) => 0x41 + (at % 26));
    const dump = dumpOf(over);
    const gutter = /\|([^|]*)\|/.exec(dump)?.[1] ?? '';
    expect(gutter).toHaveLength(CAP);
  });
});
