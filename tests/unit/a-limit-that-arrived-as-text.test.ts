/**
 * `maxItems`, the one numeric option this package silently coerced.
 *
 * `options.ts` is titled "Numeric options, refused rather than silently coerced", and
 * `requireItemLimit` ended in `Math.floor(value)` — which is where every one of its four documented
 * behaviours is decided, and which is also a coercion. `Math.floor('3')` is 3, so
 * `formatDiagnostics(list, { maxItems: '3' })` printed three blocks and nothing said the option had
 * been read as text (fixed in 0.6.115).
 *
 * Text is exactly what reaches this option: `--limit` is a flag, a viewer's cap comes off a query
 * parameter, and a config file holds strings. The fix for all three is `Number()`, and the `NaN` a
 * bad one produces has been refused since 0.6.1 with a message about that conversion.
 *
 * The four accepted behaviours are unchanged, and `api-primitives.md` documents them: `Infinity`
 * means no cap, a fractional limit floors, `0` and any negative render no blocks, and `NaN` throws.
 */

import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import { formatAnnotations } from '../../src/format-annotations.js';
import { requireItemLimit } from '../../src/options.js';
import type { EdfAnnotation, EdfDiagnostic } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

function diagnosticAt(index: number): EdfDiagnostic {
  return {
    code: `SYNTHETIC_${index}`,
    severity: 'info',
    message: `diagnostic number ${index}`,
    field: undefined,
    byteOffset: undefined,
    byteLength: undefined,
    rawBytes: undefined,
    raw: undefined,
    expected: undefined,
    actual: undefined,
    signalIndex: undefined,
    recordIndex: undefined,
    specReference: undefined,
  };
}

const FIVE = Array.from({ length: 5 }, (_, index) => diagnosticAt(index));

/** The cast a JavaScript caller does not need to write. */
const loosely = <T>(value: unknown) => value as T;

function refusal(run: () => unknown): string {
  const outcome = (() => {
    try {
      return { ok: true as const, value: run() };
    } catch (error) {
      return { ok: false as const, message: (error as Error).message };
    }
  })();
  if (outcome.ok) throw new Error(`accepted, and returned ${JSON.stringify(outcome.value)}`);
  return outcome.message;
}

describe('a limit that is not a number', () => {
  it.each([
    ['a string that spells one', '3', 'the string "3"'],
    ['a string that does not', 'all', 'the string "all"'],
    ['a BigInt', 3n, 'the BigInt 3n'],
    ['null', null, 'null'],
    ['a boolean', true, 'a boolean'],
  ])('refuses %s', (_described, given, expected) => {
    const message = refusal(() => requireItemLimit(loosely<number>(given), 5));
    expect(message).toContain(`options.maxItems must be a number, and was given ${expected}`);
  });

  it('says where text comes from and what to do with it', () => {
    const message = refusal(() => requireItemLimit(loosely<number>('3'), 5));
    expect(message).toContain('A flag, a query parameter and a config key all arrive as text');
    expect(message).toContain('convert with Number()');
  });

  it('reaches the formatters that take the option', () => {
    expect(refusal(() => formatDiagnostics(FIVE, { maxItems: loosely<number>('3') }))).toContain(
      'options.maxItems must be a number',
    );
    const events = [
      { text: 'W', onsetTicksFromFirstRecord: 0n },
    ] as unknown as readonly EdfAnnotation[];
    expect(refusal(() => formatAnnotations(events, { maxItems: loosely<number>('1') }))).toContain(
      'options.maxItems must be a number',
    );
  });

  it('no longer prints the number a string spells', () => {
    expect(formatDiagnostics(FIVE, { maxItems: 3 }).match(/^info \[/gm)).toHaveLength(3);
    expect(refusal(() => formatDiagnostics(FIVE, { maxItems: loosely<number>('3') }))).not.toMatch(
      /^info \[/m,
    );
  });
});

describe('the pages that document the option', () => {
  const pages = ['api-primitives.md', 'api-helpers.md'] as const;

  it('were found, so a passing run is not a vacuous one', () => {
    for (const name of pages) expect(DOCS_PAGES.get(name) ?? '').toContain('`maxItems`');
  });

  it('say a value that is not a number is refused rather than coerced', () => {
    // Three tables carry this option — FormatDiagnosticsOptions, FormatAnnotationsOptions and
    // FormatReportOptions — and a rule stated in one of three is a rule two readers do not meet.
    for (const name of pages) {
      const page = DOCS_PAGES.get(name) ?? '';
      for (const row of page.split('\n').filter((line) => line.includes('| `maxItems`'))) {
        expect({ name, row, says: /not a number|refused rather than coerced/.test(row) }).toEqual({
          name,
          row,
          says: true,
        });
      }
    }
  });

  it('still state the four accepted behaviours where they were stated', () => {
    const page = DOCS_PAGES.get('api-primitives.md') ?? '';
    expect(page).toContain('`Infinity` means no cap');
    expect(page).toContain('`0` and any negative render no blocks');
  });
});

describe('the four behaviours api-primitives.md documents', () => {
  it('reads Infinity as no cap', () => {
    expect(requireItemLimit(Number.POSITIVE_INFINITY, 5)).toBe(5);
  });

  it('floors a fractional limit', () => {
    expect(requireItemLimit(2.9, 5)).toBe(2);
  });

  it('clamps zero and any negative to no blocks', () => {
    expect(requireItemLimit(0, 5)).toBe(0);
    expect(requireItemLimit(-3, 5)).toBe(0);
    expect(formatDiagnostics(FIVE, { maxItems: -3 })).toBe('... and 5 more');
  });

  it('still refuses NaN in its own words, which are about the same conversion', () => {
    const message = refusal(() => requireItemLimit(Number.NaN, 5));
    expect(message).toContain('options.maxItems must be a number, but was NaN');
    expect(message).toContain('Pass Infinity for no cap.');
  });

  it('reads an omitted limit as every item', () => {
    expect(requireItemLimit(undefined, 5)).toBe(5);
  });
});
