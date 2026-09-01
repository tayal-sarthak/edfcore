/**
 * `maxItems: NaN` is refused rather than read as "no cap".
 *
 * `parseArgs` has always refused a `NaN --limit`, and says why in a comment beside the guard: "a
 * NaN limit would disable the cap silently, which is the opposite of what was asked for". The two
 * library functions that flag ultimately reaches did exactly that. Both resolved the option with
 * `!Number.isFinite(maxItems)`, which is true of `NaN` and of `Infinity` alike, and both answered
 * it with the total — so a limit computed from an absent environment variable, query parameter or
 * config key printed the whole list.
 *
 * It is the class `options.ts` was written for and states in its own docblock: an omitted option
 * means "use the default", a `NaN` means a caller computed something and got nothing, and treating
 * them alike applies the default to a real mistake. The failure is quiet in the direction that
 * costs most — a validation sweep over a damaged file can produce six figures of diagnostics, and
 * `TIMEKEEPING_TAL_MISSING` is one per record, so the caller who asked for twenty gets a terminal
 * full of them and no sign that a limit was ever applied.
 *
 * `Infinity` keeps meaning "all of them", which is why this is a second resolver rather than a
 * call to `requireFiniteOption`: `formatValidationReport` caps at twenty by default, so `Infinity`
 * is the only spelling a caller has for printing the lot, and refusing it would take that away
 * while fixing something else.
 *
 * The consumers are enumerated from `src/` rather than listed by hand, so a fourth one fails here
 * until it is covered.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CliUsageError, parseArgs } from '../../src/cli-run.js';
import { TICKS_PER_SECOND } from '../../src/constants.js';
import { createDiagnostic } from '../../src/diagnostics/collector.js';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import { formatAnnotations } from '../../src/format-annotations.js';
import { formatValidationReport } from '../../src/format-report.js';
import type { EdfAnnotation, EdfDiagnostic, ValidationReport } from '../../src/types.js';

const SRC = new URL('../../src/', import.meta.url);

/** Every `src/` file that mentions the option, so a new consumer of it shows up here. */
function filesMentioningMaxItems(): readonly string[] {
  const found: string[] = [];
  const walk = (directory: URL, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith('.ts')) {
        const source = readFileSync(new URL(entry.name, directory), 'utf8');
        if (source.includes('maxItems')) found.push(`${prefix}${entry.name}`);
      }
    }
  };
  walk(SRC, '');
  return found.sort();
}

function diagnostics(count: number): readonly EdfDiagnostic[] {
  return Array.from({ length: count }, (_, i) =>
    createDiagnostic({ code: 'TRAILING_BYTES', message: `problem ${i}` }),
  );
}

function annotations(count: number): readonly EdfAnnotation[] {
  return Array.from({ length: count }, (_, i) => {
    const ticks = BigInt(i) * TICKS_PER_SECOND;
    return {
      onsetSecondsFromHeaderStart: i,
      onsetSecondsFromFirstRecord: i,
      onsetTicks: ticks,
      onsetTicksFromFirstRecord: ticks,
      onsetRaw: `+${i}`,
      durationSeconds: undefined,
      durationTicks: undefined,
      durationRaw: undefined,
      text: `event ${i}`,
      channelLabel: undefined,
      signalIndex: 1,
      recordIndex: 0,
      byteOffsetInRecord: 0,
      textEncoding: 'utf-8',
    } as EdfAnnotation;
  });
}

function report(count: number): ValidationReport {
  return {
    ok: false,
    diagnostics: diagnostics(count),
    recordsScanned: 1,
    bytesRead: 0,
    signalStats: [],
  };
}

/** How many of the fifty items a rendered listing actually shows. */
const rows = (text: string, needle: string): number =>
  text.split('\n').filter((line) => line.includes(needle)).length;

const CALLS = [
  {
    name: 'formatDiagnostics',
    all: (maxItems: number) => rows(formatDiagnostics(diagnostics(50), { maxItems }), 'problem '),
    call: (maxItems: number) => formatDiagnostics(diagnostics(50), { maxItems }),
  },
  {
    name: 'formatAnnotations',
    all: (maxItems: number) => rows(formatAnnotations(annotations(50), { maxItems }), 'event '),
    call: (maxItems: number) => formatAnnotations(annotations(50), { maxItems }),
  },
  {
    name: 'formatValidationReport',
    all: (maxItems: number) => rows(formatValidationReport(report(50), { maxItems }), 'problem '),
    call: (maxItems: number) => formatValidationReport(report(50), { maxItems }),
  },
] as const;

describe('the option this covers', () => {
  it('is mentioned in the files this file was written against, and no others', () => {
    expect(filesMentioningMaxItems()).toEqual([
      'cli-run.ts',
      'diagnostics/format.ts',
      'format-annotations.ts',
      'format-report.ts',
      'options.ts',
      'types.ts',
    ]);
  });

  it('reaches three public functions, so a passing run is not a vacuous one', () => {
    expect(CALLS).toHaveLength(3);
    for (const { all } of CALLS) expect(all(7)).toBe(7);
  });
});

describe.each(CALLS)('$name', ({ all, call }) => {
  it('refuses NaN, naming the option rather than the file', () => {
    expect(() => call(Number.NaN)).toThrow(RangeError);
    expect(() => call(Number.NaN)).toThrow(/options\.maxItems must be a number, but was NaN/);
  });

  it('ends that refusal with a Next: clause, like every other thrown message', () => {
    let message = '';
    try {
      call(Number.NaN);
    } catch (error) {
      message = String((error as Error).message);
    }
    expect(message).toContain('Next: ');
    // The advice is the one that works: an omitted option means the default, which for
    // formatValidationReport is twenty rather than all fifty.
    expect(message).toContain('Pass Infinity for no cap.');
  });

  it('still reads Infinity as no cap, which is the spelling the refusal recommends', () => {
    expect(all(Number.POSITIVE_INFINITY)).toBe(50);
  });

  it('does not confuse the two: NaN used to give exactly what Infinity gives', () => {
    // The whole defect in one line. Before this, both were `!Number.isFinite` and both returned
    // the total, so the two were indistinguishable from the outside.
    expect(all(Number.POSITIVE_INFINITY)).toBe(50);
    expect(() => call(Number.NaN)).toThrow(RangeError);
  });

  it('caps at a finite number and shows the rest are missing', () => {
    expect(all(3)).toBe(3);
  });

  it('shows none for a cap below zero rather than throwing', () => {
    // -Infinity floors to itself and clamps to 0. Refusing it would be a second behaviour change
    // riding on this one, and a negative cap is not ambiguous the way NaN is.
    expect(all(-1)).toBe(0);
    expect(all(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe('undefined, which is not the same question', () => {
  it('is still the default each function had', () => {
    // Two of the three mean "all of them"; formatValidationReport means twenty. That difference is
    // the reason `Infinity` had to survive.
    expect(rows(formatDiagnostics(diagnostics(50)), 'problem ')).toBe(50);
    expect(rows(formatAnnotations(annotations(50)), 'event ')).toBe(50);
    expect(rows(formatValidationReport(report(50)), 'problem ')).toBe(20);
  });
});

describe('the CLI flag these functions sit under', () => {
  it('refuses the same value, which is where the rule was already written down', () => {
    expect(() => parseArgs(['header', 'f.edf', '--limit', 'twenty'])).toThrow(CliUsageError);
    expect(() => parseArgs(['header', 'f.edf', '--limit', 'twenty'])).toThrow(/whole number/);
  });

  it('and passes a good one through, so the two layers agree rather than both refusing', () => {
    expect(parseArgs(['header', 'f.edf', '--limit', '3']).limit).toBe(3);
  });
});
