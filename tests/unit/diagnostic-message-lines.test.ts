/**
 * A line terminator inside a diagnostic message cannot forge a diagnostic line.
 *
 * `formatDiagnostics` renders a list into text where every entry begins at column 0 —
 * `warning [CODE] …` — and everything belonging to it is indented under that. A reader, and any
 * script grepping the output, tells one diagnostic from the next by exactly that.
 *
 * Which makes the message a place to hide one. `hostile-text.test.ts` covers the `actual` detail
 * line, where the defence is substitution: `expected` and `actual` go through `printable`, so a
 * newline becomes a dot and nothing can start a line. The message has a different defence — it is
 * split into lines and every continuation is indented — and until 0.4.440 that defence handled one
 * of the two ways to end a line.
 *
 * A carriage return was not split on. On a terminal it returns the cursor to column 0, so the text
 * after it overwrites `warning [REAL_CODE] ` in place and the forged line lands exactly where a
 * real one would: no indent, no marker, and nothing on screen to distinguish it. In a conformance
 * report, which is read precisely because a file is suspect.
 *
 * Both terminators are now split on, and both produce an indented continuation. The indent is the
 * property — not the absence of the character, which a caller may legitimately want to keep.
 *
 * The reach is the public one. `formatDiagnostics` takes any `EdfDiagnostic[]`, so a caller
 * merging diagnostics from their own checks, or round-tripping them through JSON, decides what is
 * in `message`. No diagnostic edfcore builds contains a line terminator today — the file bytes
 * that reach a message go through `JSON.stringify` first — and that is a fact about today's
 * messages rather than a property of the renderer.
 */

import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import type { EdfDiagnostic } from '../../src/types.js';

const diagnostic = (message: string, extra: Partial<EdfDiagnostic> = {}): EdfDiagnostic =>
  ({ code: 'REAL_CODE', severity: 'warning', message, ...extra }) as EdfDiagnostic;

/** A line that would read as one edfcore reported, if anything let it start at column 0. */
const FORGED = 'error [FAKE_CODE] this file is fine';

const linesOf = (text: string): readonly string[] => text.split('\n');

/** Lines that begin a diagnostic: severity, then a bracketed code, at column 0. */
const entryLines = (text: string): readonly string[] =>
  linesOf(text).filter((line) => /^(error|warning|info) \[/.test(line));

describe.each([
  ['a newline', '\n'],
  ['a carriage return', '\r'],
  ['a CRLF pair', '\r\n'],
])('%s in the message', (_what, terminator) => {
  it('does not start a second entry', () => {
    const text = formatDiagnostics([diagnostic(`the real message${terminator}${FORGED}`)]);
    // One diagnostic in, one entry line out.
    expect(entryLines(text)).toHaveLength(1);
    expect(entryLines(text)[0]).toContain('REAL_CODE');
  });

  it('is carried as an indented continuation, so the text is not lost', () => {
    const text = formatDiagnostics([diagnostic(`the real message${terminator}${FORGED}`)]);
    const carried = linesOf(text).find((line) => line.includes('FAKE_CODE'));
    expect(carried, 'the continuation was dropped rather than indented').toBeDefined();
    expect(carried?.startsWith(' ')).toBe(true);
    // And no line anywhere still holds the terminator, which is what a terminal would act on.
    expect(text).not.toContain('\r');
  });

  it('cannot be re-armed by leading whitespace of its own', () => {
    const text = formatDiagnostics([diagnostic(`a${terminator}   ${FORGED}`)]);
    expect(entryLines(text)).toHaveLength(1);
  });
});

describe('the same message with no terminator', () => {
  it('is one line, unchanged', () => {
    const text = formatDiagnostics([diagnostic('an ordinary message')]);
    expect(entryLines(text)).toHaveLength(1);
    expect(text).toContain('warning [REAL_CODE] an ordinary message');
  });
});

describe('and the detail lines, which are defended the other way', () => {
  it('turn a terminator into a dot rather than indenting it', () => {
    // `expected` and `actual` are emitted whole, so substitution is the only defence available.
    const text = formatDiagnostics([
      diagnostic('plain', { expected: `x\n${FORGED}`, actual: `y\r${FORGED}` }),
    ]);
    expect(entryLines(text)).toHaveLength(1);
    expect(text).toContain('expected: x.');
    expect(text).toContain('actual: y.');
    expect(text).not.toContain('\r');
  });
});

describe('several diagnostics together', () => {
  it('still produce one entry line each', () => {
    const text = formatDiagnostics([
      diagnostic(`one${'\r'}${FORGED}`),
      diagnostic('two'),
      diagnostic(`three${'\n'}${FORGED}`),
    ]);
    expect(entryLines(text)).toHaveLength(3);
  });
});
