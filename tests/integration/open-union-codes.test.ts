/**
 * Every code edfcore emits is registered, or is one of six that deliberately are not.
 *
 * `EdfDiagnosticCode` is `EdfKnownDiagnosticCode | (string & {})`, an open union, and that is a
 * design decision with a stated reason: `validate.ts` emits four recommendations from EDF+
 * additional specification 9 that are not core vocabulary, and `inspect.ts` needs a name for "the
 * header did not fail its grammar, some other rule refused it" without borrowing a wrong one.
 *
 * The cost of an open union is that a TYPO is also a valid code. `code: 'TRUNCATED_FIL'` compiles,
 * and `dispositionOf` ends `?? 'warning'` — so a misspelled fatal code becomes a warning, on a
 * file that should have thrown, and nothing anywhere says otherwise. The six intentional ones and
 * a seventh nobody meant are indistinguishable at runtime.
 *
 * They are distinguishable here. The registry is the default, the six are listed with where they
 * come from, and a code that is neither fails. Listing them also fixes the accounting: `validate.ts`
 * says "four codes here are not in the core vocabulary", which is true of its own four and has
 * been read as the whole set — `inspect.ts` adds two more, and no single place said so (0.4.285).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DIAGNOSTIC_DISPOSITIONS, dispositionOf } from '../../src/diagnostics/codes.js';

const SRC = new URL('../../src/', import.meta.url);

/**
 * Codes emitted outside the registry, on purpose, and why.
 *
 * All six take `dispositionOf`'s `?? 'warning'` fallback, which is right for every one of them:
 * a recommendation is advice, and a triage note describes what was not attempted rather than what
 * was wrong with the file.
 */
const OPEN_UNION: ReadonlyMap<string, string> = new Map([
  ['LABEL_CONVENTION_NONCONFORMANT', 'validate.ts — EDF+ additional specification 9'],
  ['PREFILTERING_NONCONFORMANT', 'validate.ts — EDF+ additional specification 9'],
  ['TRANSDUCER_TYPE_BLANK', 'validate.ts — EDF+ additional specification 9'],
  ['DATE_IMPLAUSIBLE', 'validate.ts — EDF+ additional specification 9'],
  ['INSPECTION_FAILED', 'inspect.ts — refused for a reason that is not a grammar failure'],
  ['HEADER_EXCEEDS_INSPECTION_BUDGET', 'inspect.ts — triage is bounded by design'],
]);

const SOURCES: ReadonlyArray<{ readonly name: string; readonly text: string }> = (function walk(
  dir: URL,
  prefix: string,
  into: Array<{ name: string; text: string }>,
) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) walk(child, `${prefix}${entry.name}/`, into);
    else if (entry.name.endsWith('.ts')) {
      into.push({ name: `${prefix}${entry.name}`, text: readFileSync(child, 'utf8') });
    }
  }
  return into;
})(SRC, '', []);

/** `code: 'X'` at every emission site, with the module that wrote it. */
const EMITTED: ReadonlyArray<{ readonly code: string; readonly from: string }> = SOURCES.filter(
  ({ name }) => name !== 'diagnostics/codes.ts',
).flatMap(({ name, text }) =>
  [...text.matchAll(/code: '([A-Z][A-Z0-9_]*)'/g)].map((match) => ({
    code: match[1] as string,
    from: name,
  })),
);

describe('the emission sites were found', () => {
  it('read enough of them that a passing run is not a vacuous one', () => {
    expect(new Set(EMITTED.map((one) => one.code)).size).toBeGreaterThan(30);
    expect(Object.keys(DIAGNOSTIC_DISPOSITIONS).length).toBeGreaterThan(40);
  });

  it('shows what an unregistered code gets', () => {
    // The fallback that makes a typo invisible: not an error, not a refusal, a warning.
    expect(dispositionOf('NOT_A_REAL_CODE')).toBe('warning');
  });
});

describe('every emitted code is accounted for', () => {
  it('is registered, or recorded as deliberately open', () => {
    const stray = [
      ...new Set(
        EMITTED.filter(
          ({ code }) => !(code in DIAGNOSTIC_DISPOSITIONS) && !OPEN_UNION.has(code),
        ).map(({ code, from }) => `${from}: ${code}`),
      ),
    ];
    expect(
      stray,
      'codes with no disposition and no recorded reason — a typo takes the warning fallback',
    ).toEqual([]);
  });

  it('lists no open-union code that has since been registered', () => {
    // So the list shrinks if one is promoted, rather than outliving the decision.
    const stale = [...OPEN_UNION.keys()].filter((code) => code in DIAGNOSTIC_DISPOSITIONS);
    expect(stale, 'now in the registry — remove from OPEN_UNION').toEqual([]);
  });

  it('lists no open-union code that nothing emits', () => {
    const emitted = new Set(EMITTED.map((one) => one.code));
    const unused = [...OPEN_UNION.keys()].filter((code) => !emitted.has(code));
    expect(unused, 'recorded as deliberate but emitted nowhere').toEqual([]);
  });

  it('names the module each one comes from, and is right', () => {
    for (const [code, note] of OPEN_UNION) {
      const sites = EMITTED.filter((one) => one.code === code).map((one) => one.from);
      const module = note.split(' ')[0] as string;
      expect(
        sites.some((site) => site.endsWith(module)),
        `${code} is not emitted by ${module}`,
      ).toBe(true);
    }
  });
});
