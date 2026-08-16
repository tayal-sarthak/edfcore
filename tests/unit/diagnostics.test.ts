/**
 * The diagnostic machinery, apart from any file that would produce one.
 *
 * Severity is derived from the code and never passed in, `strict` becomes a decision in exactly
 * one place, and a fatal keeps what was already collected rather than discarding it with the
 * parse. Those are properties of the vocabulary itself, so they are pinned here from literals —
 * which code a given file earns is a different claim, and the parser tests hold that one.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  DIAGNOSTIC_DISPOSITIONS,
  dispositionOf,
  type EdfDiagnosticDisposition,
  type EdfKnownDiagnosticCode,
  type EdfSeverity,
  isAlwaysFatal,
  severityOf,
} from '../../src/diagnostics/codes.js';
import {
  createDiagnostic,
  DiagnosticSink,
  fatalError,
  toFormatError,
} from '../../src/diagnostics/collector.js';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import { EdfFormatError, isEdfError } from '../../src/errors.js';
import type { EdfDiagnostic } from '../../src/types.js';

/** Pure-ASCII source: every control character is built from its code point, never typed. */
const NUL = String.fromCharCode(0x00);
const ESC = String.fromCharCode(0x1b);
const BACKSLASH = String.fromCharCode(0x5c);
const QUOTE = String.fromCharCode(0x22);
const MICRO = String.fromCharCode(0xb5);

const ANSI_RESET = `${ESC}[0m`;
const ANSI_DIM = `${ESC}[2m`;
const ANSI_RED = `${ESC}[31m`;
const ANSI_YELLOW = `${ESC}[33m`;
const ANSI_CYAN = `${ESC}[36m`;

const KNOWN_CODES = Object.keys(DIAGNOSTIC_DISPOSITIONS) as EdfKnownDiagnosticCode[];

function codesWithDisposition(disposition: EdfDiagnosticDisposition): string[] {
  return KNOWN_CODES.filter((code) => DIAGNOSTIC_DISPOSITIONS[code] === disposition).sort();
}

function capture(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw, but it returned normally');
}

// ===========================================================================
// codes.ts - the vocabulary
// ===========================================================================

describe('the diagnostic vocabulary', () => {
  /**
   * Severity is DERIVED from the code and never passed in, which is what stops one code from
   * acquiring two severities in two call sites. DESIGN.md section 6: fatal and deferred are
   * both errors; the difference is where the failure lands, not how bad it is.
   */
  const SEVERITY_OF_DISPOSITION: Readonly<Record<EdfDiagnosticDisposition, EdfSeverity>> = {
    fatal: 'error',
    deferred: 'error',
    warning: 'warning',
    info: 'info',
  };

  it('derives one severity from each code, for every code it can emit', () => {
    for (const code of KNOWN_CODES) {
      const disposition = DIAGNOSTIC_DISPOSITIONS[code];
      // Paired with the code so a failure names the one that drifted.
      expect([code, severityOf(code)]).toEqual([code, SEVERITY_OF_DISPOSITION[disposition]]);
      expect([code, dispositionOf(code)]).toEqual([code, disposition]);
    }
  });

  it('marks exactly the always-fatal codes DESIGN.md section 6 lists as fatal', () => {
    expect(codesWithDisposition('fatal')).toEqual(
      [
        'NOT_AN_EDF_FILE',
        'SOURCE_TOO_SMALL',
        'SIGNAL_COUNT_INVALID',
        'NUMERIC_FIELD_INVALID',
        'COMMA_DECIMAL_SEPARATOR',
        'RECORD_SIZE_ZERO',
        'EDFPLUS_WITHOUT_ANNOTATION_SIGNAL',
        'TIMELINE_NOT_MONOTONIC',
        // Added after section 6 was written. Fatal for the same reason as the rest of this list:
        // a declared span past the signed 64-bit tick range has no representable onset for its
        // later records, so continuing would mean inventing every time the file reports.
        'RECORDING_SPAN_UNREPRESENTABLE',
      ].sort(),
    );
  });

  it('marks exactly the deferred-fatal codes DESIGN.md section 6 lists as deferred', () => {
    expect(codesWithDisposition('deferred')).toEqual(
      [
        'DEGENERATE_DIGITAL_RANGE',
        'DEGENERATE_PHYSICAL_RANGE',
        'INVERTED_DIGITAL_RANGE',
        'LOG_TRANSFORMED_CHANNEL',
        'SCALE_UNAVAILABLE',
      ].sort(),
    );
  });

  it('keeps the spec-sanctioned situations as info, not warnings', () => {
    // All three describe a CORRECT file: a negative amplifier gain (EDF FAQ Q6), a
    // pre-stimulus onset, and the spec's own two-digit-year rule, which every conforming
    // file triggers.
    expect(codesWithDisposition('info')).toEqual(
      ['DATE_CLIPPED_TO_1985_2084', 'INVERTED_PHYSICAL_RANGE', 'NEGATIVE_ANNOTATION_ONSET'].sort(),
    );
  });

  it('reports isAlwaysFatal for the fatal codes only, so a deferred code stays collectable', () => {
    for (const code of KNOWN_CODES) {
      expect([code, isAlwaysFatal(code)]).toEqual([
        code,
        DIAGNOSTIC_DISPOSITIONS[code] === 'fatal',
      ]);
    }
    expect(isAlwaysFatal('DEGENERATE_DIGITAL_RANGE')).toBe(false);
    expect(severityOf('DEGENERATE_DIGITAL_RANGE')).toBe('error');
  });

  it('treats a code it does not recognise as a warning, so it can never escalate', () => {
    // The code union is open so a code added in a minor release cannot break a consumer.
    expect(dispositionOf('SOME_FUTURE_CODE')).toBe('warning');
    expect(severityOf('SOME_FUTURE_CODE')).toBe('warning');
    expect(isAlwaysFatal('SOME_FUTURE_CODE')).toBe(false);
  });
});

// ===========================================================================
// collector.ts - createDiagnostic
// ===========================================================================

describe('createDiagnostic', () => {
  it('stamps the severity from the code rather than taking one from the caller', () => {
    expect(createDiagnostic({ code: 'TRUNCATED_FILE', message: 'm' }).severity).toBe('warning');
    expect(createDiagnostic({ code: 'INVERTED_PHYSICAL_RANGE', message: 'm' }).severity).toBe(
      'info',
    );
    expect(createDiagnostic({ code: 'INVERTED_DIGITAL_RANGE', message: 'm' }).severity).toBe(
      'error',
    );
  });

  it('copies rawBytes instead of aliasing the caller buffer, which an adapter may reuse', () => {
    const source = Uint8Array.from([1, 2, 3]);

    const diagnostic = createDiagnostic({
      code: 'TRUNCATED_FILE',
      message: 'm',
      rawBytes: source,
    });
    source[0] = 99;

    expect(diagnostic.rawBytes).not.toBe(source);
    expect([...(diagnostic.rawBytes ?? [])]).toEqual([1, 2, 3]);
  });

  it('defines every optional key as undefined rather than omitting it', () => {
    const diagnostic = createDiagnostic({ code: 'TRUNCATED_FILE', message: 'm' });

    for (const key of [
      'field',
      'byteOffset',
      'byteLength',
      'rawBytes',
      'raw',
      'expected',
      'actual',
      'signalIndex',
      'recordIndex',
      'specReference',
    ]) {
      expect([key, Object.hasOwn(diagnostic, key)]).toEqual([key, true]);
      expect([key, (diagnostic as unknown as Record<string, unknown>)[key]]).toEqual([
        key,
        undefined,
      ]);
    }
  });

  it('carries every field it was given through unchanged', () => {
    const diagnostic = createDiagnostic({
      code: 'DEGENERATE_DIGITAL_RANGE',
      message: 'signal 7 declares digitalMinimum == digitalMaximum',
      field: 'digital minimum',
      byteOffset: 3400,
      byteLength: 8,
      raw: '0       ',
      expected: 'digitalMaximum > digitalMinimum',
      actual: '0 == 0',
      signalIndex: 7,
      recordIndex: 2,
      specReference: 'EDF+ additional specification 5',
    });

    expect(diagnostic).toEqual({
      code: 'DEGENERATE_DIGITAL_RANGE',
      severity: 'error',
      message: 'signal 7 declares digitalMinimum == digitalMaximum',
      field: 'digital minimum',
      byteOffset: 3400,
      byteLength: 8,
      rawBytes: undefined,
      raw: '0       ',
      expected: 'digitalMaximum > digitalMinimum',
      actual: '0 == 0',
      signalIndex: 7,
      recordIndex: 2,
      specReference: 'EDF+ additional specification 5',
    });
  });
});

// ===========================================================================
// collector.ts - DiagnosticSink
// ===========================================================================

describe('DiagnosticSink', () => {
  it('collects rather than throws by default', () => {
    const sink = new DiagnosticSink();

    sink.report({ code: 'NON_ASCII_HEADER_FIELD', message: 'label holds a raw 0xB5' });

    expect(sink.strict).toBe(false);
    expect(sink.size).toBe(1);
    expect(sink.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'NON_ASCII_HEADER_FIELD',
    ]);
    expect(sink.diagnostics[0]?.severity).toBe('warning');
  });

  it('treats a missing or false strict option as collect', () => {
    expect(new DiagnosticSink().strict).toBe(false);
    expect(new DiagnosticSink({}).strict).toBe(false);
    expect(new DiagnosticSink({ strict: false }).strict).toBe(false);
    expect(new DiagnosticSink({ strict: true }).strict).toBe(true);
  });

  it('preserves report order', () => {
    const sink = new DiagnosticSink();

    sink.report({ code: 'TRUNCATED_FILE', message: 'a' });
    sink.report({ code: 'TRAILING_BYTES', message: 'b' });
    sink.report({ code: 'NON_ASCII_HEADER_FIELD', message: 'c' });

    expect(sink.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(['a', 'b', 'c']);
  });

  /** Strict throws on the first would-be diagnostic whose severity is not `info`. */
  it('throws EdfFormatError on the FIRST would-be diagnostic when strict', () => {
    const sink = new DiagnosticSink({ strict: true });

    const error = capture(() =>
      sink.report({
        code: 'NUMERIC_FIELD_NOT_LEFT_JUSTIFIED',
        message: 'samples per record is right-justified',
        field: 'samples per record',
        byteOffset: 3400,
        signalIndex: 7,
        recordIndex: 2,
      }),
    );

    expect(error).toBeInstanceOf(EdfFormatError);
    expect(sink.size).toBe(0);
    expect(sink.diagnostics).toEqual([]);
  });

  it('carries the code and the whole diagnostic on the error it throws', () => {
    const sink = new DiagnosticSink({ strict: true });

    const error = capture(() =>
      sink.report({
        code: 'NUMERIC_FIELD_NOT_LEFT_JUSTIFIED',
        message: 'samples per record is right-justified',
        field: 'samples per record',
        byteOffset: 3400,
        signalIndex: 7,
        recordIndex: 2,
      }),
    ) as EdfFormatError;

    expect(error.code).toBe('NUMERIC_FIELD_NOT_LEFT_JUSTIFIED');
    expect(error.diagnostic?.code).toBe('NUMERIC_FIELD_NOT_LEFT_JUSTIFIED');
    expect(error.diagnostic?.severity).toBe('warning');
    expect(error.diagnostic?.message).toBe('samples per record is right-justified');
    // Re-derived from the diagnostic rather than repeated at the call site.
    expect(error.field).toBe('samples per record');
    expect(error.byteOffset).toBe(3400);
    expect(error.signalIndex).toBe(7);
    expect(error.recordIndex).toBe(2);
    expect(error.edfErrorKind).toBe('format');
    expect(isEdfError(error)).toBe(true);
    expect(error.message).toContain('[NUMERIC_FIELD_NOT_LEFT_JUSTIFIED]');
    expect(error.message).toContain('samples per record is right-justified');
  });

  it('does not throw under strict for an info-severity code', () => {
    // `info` means the file is correct and the note is only explanatory. Throwing on one
    // would make `strict` reject conforming files: every EDF has a two-digit year, so
    // DATE_CLIPPED_TO_1985_2084 fires on all of them. Info notes are still collected.
    const sink = new DiagnosticSink({ strict: true });
    expect(() =>
      sink.report({ code: 'INVERTED_PHYSICAL_RANGE', message: 'negative amplifier gain' }),
    ).not.toThrow();
    expect(sink.diagnostics.map((d) => d.code)).toEqual(['INVERTED_PHYSICAL_RANGE']);
  });

  it('still throws under strict for a warning-severity code', () => {
    const sink = new DiagnosticSink({ strict: true });
    expect(() => sink.report({ code: 'TRAILING_BYTES', message: 'extra bytes' })).toThrow();
  });

  it('keeps throwing on later reports rather than throwing only once', () => {
    const sink = new DiagnosticSink({ strict: true });

    expect(capture(() => sink.report({ code: 'TRUNCATED_FILE', message: 'a' }))).toBeInstanceOf(
      EdfFormatError,
    );
    expect(capture(() => sink.report({ code: 'TRAILING_BYTES', message: 'b' }))).toBeInstanceOf(
      EdfFormatError,
    );
    expect(sink.diagnostics).toEqual([]);
  });

  /** Proceeding past one of these would require inventing data, so strict is irrelevant. */
  it('throws on a fatal-disposition code EVEN WHEN strict is false', () => {
    for (const code of codesWithDisposition('fatal')) {
      const sink = new DiagnosticSink({ strict: false });

      const error = capture(() => sink.report({ code, message: `m ${code}` })) as EdfFormatError;

      expect([code, error instanceof EdfFormatError]).toEqual([code, true]);
      expect([code, error.code]).toEqual([code, code]);
      expect([code, sink.size]).toEqual([code, 0]);
    }
  });

  it('collects a deferred-fatal code when not strict, because the header still parses', () => {
    // DESIGN.md section 6: these set signal.scale = undefined; decodeDigital keeps working and
    // the failure lands on toPhysical, not on the parse.
    const sink = new DiagnosticSink();

    for (const code of codesWithDisposition('deferred')) {
      sink.report({ code, message: `m ${code}` });
    }

    expect(sink.size).toBe(codesWithDisposition('deferred').length);
    expect(sink.diagnostics.every((diagnostic) => diagnostic.severity === 'error')).toBe(true);
  });

  it('stays usable after a fatal code threw, so later warnings are still collected', () => {
    const sink = new DiagnosticSink();

    sink.report({ code: 'TRUNCATED_FILE', message: 'a' });
    capture(() => sink.report({ code: 'RECORD_SIZE_ZERO', message: 'fatal' }));
    sink.report({ code: 'TRAILING_BYTES', message: 'b' });

    expect(sink.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'TRUNCATED_FILE',
      'TRAILING_BYTES',
    ]);
  });

  it('gives the sink and the thrown error the same severity for every known code', () => {
    // The one place severity could drift is between the collect path and the throw path.
    for (const code of KNOWN_CODES) {
      const sink = new DiagnosticSink();
      let observed: EdfDiagnostic | undefined;
      try {
        sink.report({ code, message: `m ${code}` });
        observed = sink.diagnostics[0];
      } catch (error) {
        observed = (error as EdfFormatError).diagnostic;
      }

      expect([code, observed?.severity]).toEqual([code, severityOf(code)]);
    }
  });

  it('hands back a frozen copy, so an array already attached to a result cannot grow', () => {
    const sink = new DiagnosticSink();
    sink.report({ code: 'TRUNCATED_FILE', message: 'a' });

    const first = sink.diagnostics;
    sink.report({ code: 'TRAILING_BYTES', message: 'b' });

    expect(Object.isFrozen(first)).toBe(true);
    expect(first.length).toBe(1);
    expect(sink.diagnostics.length).toBe(2);
    expect(() => (first as EdfDiagnostic[]).push(first[0] as EdfDiagnostic)).toThrow(TypeError);
  });

  it('returns the collected diagnostics and resets on drain', () => {
    const sink = new DiagnosticSink();
    sink.report({ code: 'TRUNCATED_FILE', message: 'a' });
    sink.report({ code: 'TRAILING_BYTES', message: 'b' });

    const drained = sink.drain();

    expect(drained.map((diagnostic) => diagnostic.message)).toEqual(['a', 'b']);
    expect(sink.size).toBe(0);
    expect(sink.diagnostics).toEqual([]);
    expect(sink.drain()).toEqual([]);

    sink.report({ code: 'NON_ASCII_HEADER_FIELD', message: 'c' });

    // The already-returned array is a snapshot and does not see the new report.
    expect(drained.length).toBe(2);
    expect(sink.size).toBe(1);
  });

  it('accepts an unrecognised code without escalating it', () => {
    const sink = new DiagnosticSink();

    sink.report({ code: 'SOME_FUTURE_CODE', message: 'from a newer minor release' });

    expect(sink.diagnostics[0]?.severity).toBe('warning');
  });
});

// ===========================================================================
// collector.ts - error construction
// ===========================================================================

describe('toFormatError and fatalError', () => {
  const diagnostic = createDiagnostic({
    code: 'COMMA_DECIMAL_SEPARATOR',
    message: 'physical minimum is "0,5"',
    field: 'physical minimum',
    byteOffset: 1234,
    signalIndex: 3,
  });

  it('prefixes the message with the code so the code survives a bare console print', () => {
    expect(toFormatError(diagnostic).message).toBe(
      '[COMMA_DECIMAL_SEPARATOR] physical minimum is "0,5"',
    );
  });

  it('re-derives the location from the diagnostic instead of repeating it', () => {
    const error = toFormatError(diagnostic);

    expect(error.diagnostic).toBe(diagnostic);
    expect(error.code).toBe('COMMA_DECIMAL_SEPARATOR');
    expect(error.field).toBe('physical minimum');
    expect(error.byteOffset).toBe(1234);
    expect(error.signalIndex).toBe(3);
    expect(error.recordIndex).toBeUndefined();
  });

  it('attaches a cause when one is given and leaves it undefined otherwise', () => {
    const cause = new Error('underlying');

    expect(toFormatError(diagnostic, cause).cause).toBe(cause);
    expect(toFormatError(diagnostic).cause).toBeUndefined();
  });

  it('builds, but does not throw, the error for the paths that have no sink yet', () => {
    const error = fatalError({ code: 'NOT_AN_EDF_FILE', message: 'no version block at offset 0' });

    expect(error).toBeInstanceOf(EdfFormatError);
    expect(error.code).toBe('NOT_AN_EDF_FILE');
    expect(error.diagnostic?.severity).toBe('error');
    expect(error.name).toBe('EdfFormatError');
  });
});

// ===========================================================================
// format.ts
// ===========================================================================

describe('formatDiagnostics', () => {
  const full = createDiagnostic({
    code: 'NUMERIC_FIELD_NOT_LEFT_JUSTIFIED',
    message: 'samples per record is right-justified',
    field: 'samples per record',
    byteOffset: 3400,
    byteLength: 8,
    rawBytes: Uint8Array.from([0x20, 0x20, 0x32, 0x35, 0x36]),
    raw: '  256',
    expected: 'left-justified',
    actual: 'right-justified',
    signalIndex: 7,
    recordIndex: 2,
    specReference: 'EDF spec, header field layout',
  });

  function manyDiagnostics(count: number): EdfDiagnostic[] {
    return Array.from({ length: count }, (_unused, index) =>
      createDiagnostic({ code: 'TRUNCATED_FILE', message: `d${index}` }),
    );
  }

  it('returns the empty string for an empty list, so it concatenates cleanly', () => {
    expect(formatDiagnostics([])).toBe('');
    expect(formatDiagnostics([], { maxItems: 0 })).toBe('');
  });

  it('lays out every field of a diagnostic in a fixed order', () => {
    expect(formatDiagnostics([full])).toBe(
      [
        'warning [NUMERIC_FIELD_NOT_LEFT_JUSTIFIED] samples per record is right-justified',
        '  at byte offset 3400 (8 bytes), samples per record, signal 7, record 2',
        `  raw: ${QUOTE}  256${QUOTE}`,
        '  bytes: 20 20 32 35 36  |  256|',
        '  expected: left-justified',
        '  actual: right-justified',
        '  spec: EDF spec, header field layout',
      ].join('\n'),
    );
  });

  it('prints only the parts a diagnostic actually carries', () => {
    const sparse = createDiagnostic({
      code: 'TRAILING_BYTES',
      message: 'bytes past the last record',
    });

    expect(formatDiagnostics([sparse])).toBe('warning [TRAILING_BYTES] bytes past the last record');
  });

  it('omits the byte length from the location when only an offset is known', () => {
    const diagnostic = createDiagnostic({
      code: 'TRAILING_BYTES',
      message: 'm',
      byteOffset: 512,
    });

    expect(formatDiagnostics([diagnostic])).toBe(
      ['warning [TRAILING_BYTES] m', '  at byte offset 512'].join('\n'),
    );
  });

  it('omits the location line entirely when nothing locates the diagnostic', () => {
    const diagnostic = createDiagnostic({
      code: 'TRAILING_BYTES',
      message: 'm',
      expected: 'e',
    });

    expect(formatDiagnostics([diagnostic])).toBe(
      ['warning [TRAILING_BYTES] m', '  expected: e'].join('\n'),
    );
  });

  it('indents the continuation lines of a multi-line message', () => {
    const diagnostic = createDiagnostic({
      code: 'TRAILING_BYTES',
      message: 'first line   \n     second line   \n  third line',
    });

    expect(formatDiagnostics([diagnostic])).toBe(
      ['warning [TRAILING_BYTES] first line', '  second line', '  third line'].join('\n'),
    );
  });

  it('marks each severity with its own word, taken from the diagnostic', () => {
    const rendered = formatDiagnostics([
      createDiagnostic({ code: 'INVERTED_DIGITAL_RANGE', message: 'a' }),
      createDiagnostic({ code: 'TRAILING_BYTES', message: 'b' }),
      createDiagnostic({ code: 'INVERTED_PHYSICAL_RANGE', message: 'c' }),
    ]);

    expect(rendered).toBe(
      [
        'error [INVERTED_DIGITAL_RANGE] a',
        'warning [TRAILING_BYTES] b',
        'info [INVERTED_PHYSICAL_RANGE] c',
      ].join('\n'),
    );
  });

  it('escapes control and non-ASCII characters in raw so every entry stays on one line', () => {
    const raw = `a${QUOTE}b${BACKSLASH}c${MICRO}${NUL}${String.fromCodePoint(0x1f600)}`;
    const diagnostic = createDiagnostic({ code: 'TRAILING_BYTES', message: 'm', raw });

    const expectedQuote = [
      QUOTE,
      'a',
      `${BACKSLASH}${QUOTE}`,
      'b',
      `${BACKSLASH}${BACKSLASH}`,
      'c',
      `${BACKSLASH}xb5`,
      `${BACKSLASH}x00`,
      `${BACKSLASH}u{1f600}`,
      QUOTE,
    ].join('');

    expect(formatDiagnostics([diagnostic])).toBe(
      ['warning [TRAILING_BYTES] m', `  raw: ${expectedQuote}`].join('\n'),
    );
  });

  it('dumps bytes as lower-case hex with an ASCII gutter, dotting the unprintable ones', () => {
    const diagnostic = createDiagnostic({
      code: 'TRAILING_BYTES',
      message: 'm',
      rawBytes: Uint8Array.from([0x30, 0x00, 0xb5, 0x7f]),
    });

    expect(formatDiagnostics([diagnostic])).toBe(
      ['warning [TRAILING_BYTES] m', '  bytes: 30 00 b5 7f  |0...|'].join('\n'),
    );
  });

  it('elides a long byte run with a count, since a report is a summary not a hex dump', () => {
    const twentySix = new Uint8Array(26);
    for (let i = 0; i < 26; i++) twentySix[i] = 0x41 + i;
    const diagnostic = createDiagnostic({
      code: 'TRAILING_BYTES',
      message: 'm',
      rawBytes: twentySix,
    });

    expect(formatDiagnostics([diagnostic])).toBe(
      [
        'warning [TRAILING_BYTES] m',
        '  bytes: 41 42 43 44 45 46 47 48 49 4a 4b 4c 4d 4e 4f 50 51 52 53 54 55 56 57 58' +
          '  |ABCDEFGHIJKLMNOPQRSTUVWX| +2 more',
      ].join('\n'),
    );
  });

  it('prints no bytes line for an empty rawBytes array', () => {
    const diagnostic = createDiagnostic({
      code: 'TRAILING_BYTES',
      message: 'm',
      rawBytes: new Uint8Array(0),
    });

    expect(formatDiagnostics([diagnostic])).toBe('warning [TRAILING_BYTES] m');
  });

  describe('maxItems', () => {
    it('truncates to the limit and names how many were hidden', () => {
      expect(formatDiagnostics(manyDiagnostics(5), { maxItems: 2 })).toBe(
        ['warning [TRUNCATED_FILE] d0', 'warning [TRUNCATED_FILE] d1', `${'... and 3 more'}`].join(
          '\n',
        ),
      );
    });

    it('hides everything at a limit of zero and still reports the count', () => {
      expect(formatDiagnostics(manyDiagnostics(5), { maxItems: 0 })).toBe('... and 5 more');
    });

    it('clamps a negative limit to zero rather than throwing', () => {
      expect(formatDiagnostics(manyDiagnostics(5), { maxItems: -3 })).toBe('... and 5 more');
    });

    it('floors a fractional limit', () => {
      expect(formatDiagnostics(manyDiagnostics(5), { maxItems: 2.9 })).toBe(
        ['warning [TRUNCATED_FILE] d0', 'warning [TRUNCATED_FILE] d1', '... and 3 more'].join('\n'),
      );
    });

    it('adds no elision line when the limit is at or above the count', () => {
      const all = manyDiagnostics(3);
      const unlimited = formatDiagnostics(all);

      expect(formatDiagnostics(all, { maxItems: 3 })).toBe(unlimited);
      expect(formatDiagnostics(all, { maxItems: 99 })).toBe(unlimited);
      expect(unlimited).not.toContain('more');
    });

    it('treats a non-finite limit as no limit', () => {
      const all = manyDiagnostics(3);
      const unlimited = formatDiagnostics(all);

      expect(formatDiagnostics(all, { maxItems: Number.POSITIVE_INFINITY })).toBe(unlimited);
      expect(formatDiagnostics(all, { maxItems: Number.NaN })).toBe(unlimited);
    });
  });

  describe('colour', () => {
    it('emits no ANSI escapes unless colour is requested', () => {
      const rendered = formatDiagnostics([full], { maxItems: 1 });

      expect(rendered).not.toContain(ESC);
      expect(formatDiagnostics(manyDiagnostics(5), { maxItems: 1 })).not.toContain(ESC);
      expect(formatDiagnostics([full], { color: false })).toBe(rendered);
    });

    it('paints the marker by severity and the details dim when colour is requested', () => {
      const rendered = formatDiagnostics(
        [
          createDiagnostic({ code: 'INVERTED_DIGITAL_RANGE', message: 'a', byteOffset: 8 }),
          createDiagnostic({ code: 'TRAILING_BYTES', message: 'b' }),
          createDiagnostic({ code: 'INVERTED_PHYSICAL_RANGE', message: 'c' }),
        ],
        { color: true, maxItems: 3 },
      );

      expect(rendered).toBe(
        [
          `${ANSI_RED}error [INVERTED_DIGITAL_RANGE]${ANSI_RESET} a`,
          `  ${ANSI_DIM}at byte offset 8${ANSI_RESET}`,
          `${ANSI_YELLOW}warning [TRAILING_BYTES]${ANSI_RESET} b`,
          `${ANSI_CYAN}info [INVERTED_PHYSICAL_RANGE]${ANSI_RESET} c`,
        ].join('\n'),
      );
    });

    it('paints the elision line dim', () => {
      expect(formatDiagnostics(manyDiagnostics(5), { color: true, maxItems: 0 })).toBe(
        `${ANSI_DIM}... and 5 more${ANSI_RESET}`,
      );
    });
  });

  it('is deterministic: the same input renders identically every time', () => {
    const list = [full, ...manyDiagnostics(3)];

    expect(formatDiagnostics(list)).toBe(formatDiagnostics(list));
    // No locale-sensitive formatting: an equal-valued list built separately renders the same.
    expect(formatDiagnostics([...list])).toBe(formatDiagnostics(list));
    expect(formatDiagnostics(manyDiagnostics(3))).toBe(formatDiagnostics(manyDiagnostics(3)));
  });

  it('never writes to console, here or anywhere else in the diagnostics layer', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const trace = vi.spyOn(console, 'trace').mockImplementation(() => undefined);

    try {
      formatDiagnostics([full, ...manyDiagnostics(4)], { color: true, maxItems: 2 });

      const sink = new DiagnosticSink();
      sink.report({ code: 'NON_ASCII_HEADER_FIELD', message: 'm' });
      capture(() => sink.report({ code: 'RECORD_SIZE_ZERO', message: 'fatal' }));
      capture(() =>
        new DiagnosticSink({ strict: true }).report({ code: 'TRAILING_BYTES', message: 'm' }),
      );

      for (const spy of [log, info, warn, error, debug, trace]) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      vi.restoreAllMocks();
    }
  });
});
