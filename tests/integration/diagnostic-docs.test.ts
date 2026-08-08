/**
 * The published diagnostic tables agree with `codes.ts`.
 *
 * `docs-coverage.test.ts` proves every export is MENTIONED somewhere. This proves something
 * stronger about the one table a consumer branches on: that a code documented as fatal is fatal,
 * that a code documented as a warning is a warning, and that the counts in the prose are the
 * counts in the code.
 *
 * They had drifted in five places at once. `DATE_CLIPPED_TO_1985_2084` — which nearly every EDF
 * file carries, because the mandated `dd.mm.yy` startdate cannot express a year outside 1985-2084
 * — is `info` in `codes.ts` and has been since the first commit, but two pages listed it under
 * Warnings, a third called it "a warning" in prose, and two more printed a sample
 * `formatDiagnostics` block reading `warning [DATE_CLIPPED_TO_1985_2084]` where the function
 * prints `info [...]`. `SCALE_UNAVAILABLE` was missing from the deferred table entirely. And the
 * prose counts said eight always-fatal codes where there are nine, two info codes where there are
 * three, and thirty-one warnings where there are twenty-nine.
 *
 * Every number below is DERIVED from the source, so adding a code fails this test until the page
 * is updated (added in 0.3.39).
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { minimalEdf } from '../support/writer.js';

interface RawModuleGlob {
  glob(
    pattern: string,
    options: { query: string; import: string; eager: true },
  ): Record<string, string>;
}

/**
 * Each call writes the pattern AND the options out as literals: `import.meta.glob` is replaced at
 * transform time, so neither can come from a variable.
 */
const first = (modules: Record<string, string>): string => Object.values(modules)[0] ?? '';

const CODES_SOURCE = first(
  (import.meta as unknown as RawModuleGlob).glob('../../src/diagnostics/codes.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
);
const API_ERRORS = first(
  (import.meta as unknown as RawModuleGlob).glob('../../website/src/content/docs/api-errors.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
);
const DIAGNOSTICS_PAGE = first(
  (import.meta as unknown as RawModuleGlob).glob('../../website/src/content/docs/diagnostics.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
);
const ALL_PAGES = (import.meta as unknown as RawModuleGlob).glob(
  '../../website/src/content/docs/*.md',
  { query: '?raw', import: 'default', eager: true },
);

type Disposition = 'fatal' | 'deferred' | 'warning' | 'info';

/** Every code and its disposition, read straight out of the `DISPOSITIONS` table. */
function dispositions(): ReadonlyMap<string, Disposition> {
  const table = CODES_SOURCE.slice(CODES_SOURCE.indexOf('const DISPOSITIONS'));
  const found = new Map<string, Disposition>();
  for (const match of table.matchAll(/^\s*([A-Z_0-9]+): '(fatal|deferred|warning|info)',/gm)) {
    found.set(match[1] as string, match[2] as Disposition);
  }
  return found;
}

/** The code rows of one `## ` section of api-errors.md, in order. */
function sectionCodes(heading: string): readonly string[] {
  const start = API_ERRORS.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`api-errors.md has no "## ${heading}" section`);
  const rest = API_ERRORS.slice(start + 1);
  const end = rest.indexOf('\n## ', 1);
  const section = end === -1 ? rest : rest.slice(0, end);
  return [...section.matchAll(/^\| `([A-Z_0-9]+)` \|/gm)].map((m) => m[1] as string);
}

const SECTIONS: ReadonlyArray<{ heading: string; disposition: Disposition }> = [
  { heading: 'Always fatal', disposition: 'fatal' },
  { heading: 'Deferred-fatal', disposition: 'deferred' },
  { heading: 'Warnings', disposition: 'warning' },
  { heading: 'Info', disposition: 'info' },
];

/**
 * Names the page documents that carry no disposition, because nothing emits them.
 *
 * The page says so itself, in a note under the I/O table. They are listed because a reader
 * grepping for them from an error message needs to land somewhere.
 */
const RESERVED = new Set(['SOURCE_SHORT_READ_RECOVERED', 'HTTP_RANGE_IGNORED']);

describe('the diagnostic tables in api-errors.md', () => {
  const byCode = dispositions();

  it('reads a non-empty disposition table out of the source', () => {
    // A regex that silently matched nothing would make every assertion below vacuous.
    expect(byCode.size).toBeGreaterThan(30);
    expect(byCode.get('NOT_AN_EDF_FILE')).toBe('fatal');
    expect(byCode.get('DATE_CLIPPED_TO_1985_2084')).toBe('info');
  });

  it.each(SECTIONS)(
    'lists only $disposition codes under "$heading"',
    ({ heading, disposition }) => {
      const misfiled = sectionCodes(heading)
        .filter((code) => !RESERVED.has(code))
        .filter((code) => byCode.get(code) !== disposition)
        .map((code) => `${code} is ${byCode.get(code) ?? 'not a code at all'}`);
      expect(misfiled).toEqual([]);
    },
  );

  it('documents every code exactly once', () => {
    const documented = SECTIONS.flatMap(({ heading }) => sectionCodes(heading));
    const missing = [...byCode.keys()].filter((code) => !documented.includes(code));
    const duplicated = documented.filter((code, i) => documented.indexOf(code) !== i);
    expect(missing).toEqual([]);
    expect(duplicated).toEqual([]);
  });

  it('states counts in its prose that match the source', () => {
    const spelled: Readonly<Record<number, string>> = {
      2: 'Two',
      3: 'Three',
      4: 'Four',
      5: 'Five',
      8: 'Eight',
      9: 'Nine',
      28: 'Twenty-eight',
      29: 'Twenty-nine',
      30: 'Thirty',
      31: 'Thirty-one',
    };
    for (const { heading, disposition } of SECTIONS) {
      const count = [...byCode.values()].filter((d) => d === disposition).length;
      const word = spelled[count];
      if (word === undefined) throw new Error(`no spelling for ${count}; add one`);
      const section = API_ERRORS.slice(API_ERRORS.indexOf(`\n## ${heading}\n`));
      expect(section.slice(0, 400), `"## ${heading}" should say ${word}`).toContain(word);
    }
  });
});

describe('diagnostics.md agrees with the same source', () => {
  const byCode = dispositions();

  it('states the always-fatal and info counts correctly', () => {
    const fatal = [...byCode.values()].filter((d) => d === 'fatal').length;
    const info = [...byCode.values()].filter((d) => d === 'info').length;
    expect(fatal).toBe(9);
    expect(info).toBe(3);
    expect(DIAGNOSTICS_PAGE).toContain('Nine codes are always fatal');
    expect(DIAGNOSTICS_PAGE).toContain('Three codes are `info`');
  });

  it('lists every always-fatal code in the table under that count', () => {
    /*
     * The prose count was checked and the table under it was not, so the page said "Nine codes are
     * always fatal", listed eight, and then said "All eight throw". `RECORDING_SPAN_UNREPRESENTABLE`
     * was the missing row, and it is in api-errors.md's own always-fatal table — so the two pages
     * disagreed about how many there are (fixed in 0.3.63).
     */
    const fatalCodes = [...byCode.entries()].filter(([, d]) => d === 'fatal').map(([c]) => c);
    const section = DIAGNOSTICS_PAGE.slice(DIAGNOSTICS_PAGE.indexOf('codes are always fatal'));
    const table = section.slice(0, section.indexOf('\n\n', section.indexOf('| code |')));
    const rows = [...table.matchAll(/^\| `([A-Z_0-9]+)` \|/gm)].map((m) => m[1] as string);

    expect(rows.length).toBeGreaterThan(5);
    expect(fatalCodes.filter((code) => !rows.includes(code))).toEqual([]);
    expect(rows.filter((code) => byCode.get(code) !== 'fatal')).toEqual([]);
  });

  it('says "All N throw" with the N the table actually has', () => {
    const fatal = [...byCode.values()].filter((d) => d === 'fatal').length;
    const spelled: Readonly<Record<number, string>> = { 8: 'eight', 9: 'nine', 10: 'ten' };
    const word = spelled[fatal];
    if (word === undefined) throw new Error(`no spelling for ${fatal}; add one`);
    expect(DIAGNOSTICS_PAGE).toContain(`All ${word} throw \`EdfFormatError\``);
  });

  it('does not claim strict throws on an info code, or empties the list', async () => {
    /*
     * `collector.ts` gates on `this.strict && diagnostic.severity !== 'info'`, so a strict parse of
     * a file whose only note is `info` RESOLVES, with that note still present. Three places said
     * otherwise: `api-reading.md` said such a note "is a thrown EdfFormatError all the same,
     * because strict exempts nothing that names a real deviation", and it, `design-decisions.md`
     * and the published `ParseOptions` docblock all said every `diagnostics` array is
     * "consequently empty" under strict (fixed in 0.3.76; `concepts.md` was 0.3.62).
     */
    for (const [path, text] of Object.entries(ALL_PAGES)) {
      const where = path.split('/').pop();
      expect(text, `${where} should not say strict empties the list`).not.toContain(
        'consequently empty',
      );
      expect(text, `${where} should not say strict exempts nothing`).not.toContain(
        'exempts nothing',
      );
    }
    // The behaviour those sentences described, so this test is anchored to the code and not only
    // to two strings that could be reworded back into the same falsehood.
    const bytes = minimalEdf({ startDate: '01.01.20' });
    const strict = await openEdf(byteSource(bytes), { strict: true });
    expect(strict.header.diagnostics.map((d) => d.code)).toEqual(['DATE_CLIPPED_TO_1985_2084']);
    expect(strict.header.diagnostics[0]?.severity).toBe('info');
  });

  it('names every info code where it explains them', () => {
    const infoCodes = [...byCode.entries()].filter(([, d]) => d === 'info').map(([c]) => c);
    const explanation = DIAGNOSTICS_PAGE.slice(DIAGNOSTICS_PAGE.indexOf('codes are `info`'));
    for (const code of infoCodes) expect(explanation.slice(0, 1200)).toContain(code);
  });
});

describe('no page prints a severity the formatter would not print', () => {
  /**
   * The sample `formatDiagnostics` blocks in the docs are copied output, and two of them showed
   * `warning [DATE_CLIPPED_TO_1985_2084]`. The formatter prints `${severity} [${code}]`, so a
   * sample with the wrong severity is a sample of output the package cannot produce.
   */
  const PAGES = ALL_PAGES;

  it('matches every printed "// severity CODE offset" against the source', () => {
    /*
     * The other shape a page prints a severity in. `concepts.md` teaches diagnostics with
     * `console.log(diagnostic.severity, diagnostic.code, diagnostic.byteOffset)` and showed the
     * output as `warning DATE_CLIPPED_TO_1985_2084 168`; that code is `info`. The assertion below
     * only ever looked for `severity [CODE]` with brackets, which is what `formatDiagnostics`
     * emits, so it could not see this one (fixed in 0.3.62).
     */
    const byCode = dispositions();
    const severityOf: Readonly<Record<Disposition, string>> = {
      fatal: 'error',
      deferred: 'error',
      warning: 'warning',
      info: 'info',
    };
    const wrong: string[] = [];
    for (const [path, text] of Object.entries(ALL_PAGES)) {
      for (const match of text.matchAll(/^\/\/ (error|warning|info) ([A-Z_0-9]+)\b/gm)) {
        const disposition = byCode.get(match[2] as string);
        if (disposition === undefined) continue;
        const expected = severityOf[disposition];
        if (match[1] !== expected) {
          wrong.push(
            `${path.split('/').pop()}: ${match[2]} printed as ${match[1]}, is ${expected}`,
          );
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('matches every printed "severity [CODE]" against the source', () => {
    const byCode = dispositions();
    const severityOf: Readonly<Record<Disposition, string>> = {
      fatal: 'error',
      deferred: 'error',
      warning: 'warning',
      info: 'info',
    };
    const wrong: string[] = [];
    for (const [path, text] of Object.entries(PAGES)) {
      for (const match of text.matchAll(/^(error|warning|info) \[([A-Z_0-9]+)\]/gm)) {
        const disposition = byCode.get(match[2] as string);
        if (disposition === undefined) continue;
        const expected = severityOf[disposition];
        if (match[1] !== expected) {
          wrong.push(
            `${path.split('/').pop()}: ${match[2]} printed as ${match[1]}, is ${expected}`,
          );
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
