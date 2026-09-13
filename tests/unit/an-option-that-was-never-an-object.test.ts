/**
 * The options argument of the three formatters that take a `maxItems`.
 *
 * Every option in this package is a field on an object, so the number a caller means IS the
 * option, and `formatAnnotations(annotations, 20)` is what gets written when the intent is twenty
 * rows. A bare number has no `maxItems`, so `options?.maxItems` was `undefined`, `requireItemLimit`
 * read that as "no limit given" — its documented default — and every annotation was printed.
 *
 * Silently, and that is the part that costs something. `format-annotations.ts` argues the opposite
 * case at length in its own docblock: truncation "always says how much it withheld", because a
 * listing that stopped without saying so "would be indistinguishable from a recording that simply
 * had no more events". A listing that did NOT truncate when it was asked to is the same confusion
 * from the other side, with no `... and N more` line to give it away — and on a scoring file with
 * fifty thousand events it is fifty thousand lines where twenty were asked for.
 *
 * `formatValidationReport` shares the shape through its own `maxItems`, which it resolves before
 * handing anything to `formatDiagnostics`, so guarding the one below it would not have reached it.
 *
 * `null` and `undefined` still mean "no options". Both already did, and a caller spelling "no
 * options" as `null` is not making this mistake.
 */

import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import { isEdfError } from '../../src/errors.js';
import { formatAnnotations } from '../../src/format-annotations.js';
import { formatValidationReport } from '../../src/format-report.js';
import type { EdfAnnotation, EdfDiagnostic, ValidationReport } from '../../src/types.js';

const EVENTS = Array.from({ length: 6 }, (_, i) => ({
  onsetTicks: BigInt(i) * 10000000n,
  onsetSeconds: i,
  onsetTicksFromFirstRecord: BigInt(i) * 10000000n,
  onsetSecondsFromFirstRecord: i,
  durationTicks: undefined,
  durationSeconds: undefined,
  text: `Event ${i}`,
  channel: undefined,
  recordIndex: 0,
  isTimekeeping: false,
})) as unknown as readonly EdfAnnotation[];

const DIAGNOSTICS = Array.from({ length: 6 }, (_, i) => ({
  code: 'DATE_CLIPPED_TO_1985_2084',
  severity: 'info',
  message: `Diagnostic ${i}`,
  field: undefined,
  signalIndex: undefined,
  byteOffset: undefined,
  byteLength: undefined,
  raw: undefined,
  recordIndex: undefined,
  expected: undefined,
  received: undefined,
  specReference: undefined,
  nextStep: undefined,
})) as unknown as readonly EdfDiagnostic[];

const REPORT = {
  ok: false,
  diagnostics: DIAGNOSTICS,
  recordsScanned: 0,
  bytesRead: 0,
  signalStats: [],
} as unknown as ValidationReport;

type Formatter = (subject: unknown, options: unknown) => string;

const FORMATTERS: ReadonlyArray<readonly [string, Formatter, unknown, string]> = [
  ['formatAnnotations', formatAnnotations as unknown as Formatter, EVENTS, 'annotation'],
  ['formatDiagnostics', formatDiagnostics as unknown as Formatter, DIAGNOSTICS, 'diagnostic'],
  ['formatValidationReport', formatValidationReport as unknown as Formatter, REPORT, 'diagnostic'],
];

describe.each(FORMATTERS)('%s given a bare number', (name, format, subject, listed) => {
  it('refuses it rather than listing everything', () => {
    expect(() => format(subject, 2)).toThrow(RangeError);
  });

  it('is a caller mistake, so isEdfError says false', () => {
    let thrown: unknown;
    try {
      format(subject, 2);
    } catch (error) {
      thrown = error;
    }
    expect(isEdfError(thrown)).toBe(false);
  });

  it('names the call, the number, and what listing every one of them would have meant', () => {
    expect(() => format(subject, 2)).toThrow(
      new RegExp(
        `^${name}\\(\\): the options are 2, not an object — maxItems is a field on one, so this ` +
          `call would have listed every ${listed} rather than that many\\.`,
      ),
    );
    expect(() => format(subject, 2)).toThrow(/Next: pass maxItems on an options object\.$/);
  });

  it('names a string as itself, which a config file produces as easily', () => {
    expect(() => format(subject, '2')).toThrow(/the options are the string "2", not an object/);
  });

  it('still takes no options at all, spelled either way', () => {
    expect(() => format(subject, undefined)).not.toThrow();
    expect(() => format(subject, null)).not.toThrow();
  });

  it('still truncates when maxItems is where it belongs', () => {
    expect(format(subject, { maxItems: 2 })).toContain('4 more');
  });
});
