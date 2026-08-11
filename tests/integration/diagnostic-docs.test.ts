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
import { summarizeDiagnostics } from '../../src/diagnostics/summary.js';
import { formatStartTimeNaive } from '../../src/header/dates.js';
import { parseHeader } from '../../src/header/parse.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { minimalEdf, minimalEdfPlus } from '../support/writer.js';

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
/**
 * Every source file, because `tsconfig.build.json` keeps comments: a claim in a `src/` docblock is
 * published verbatim in `dist/**\/*.d.ts` and is what an editor shows on hover. 0.3.84 widened the
 * version guard this way for the same reason; the strict-mode claim below needed it too, and did
 * not have it (widened in 0.3.108).
 */
const ALL_SOURCE = (import.meta as unknown as RawModuleGlob).glob('../../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * One line, no comment leaders, so a claim is matched however it happens to be wrapped.
 *
 * Pinning the exact sentence is what let this class come back three times: 0.3.76 pinned two
 * strings and missed three pages, 0.3.90 widened the strings and missed three more, because a
 * markdown table cell, a wrapped docblock and a prose paragraph spell the same claim differently.
 */
function claimText(text: string): string {
  return text
    .replace(/^\s*\*\s?/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

  it('does not offer report.ok as an alternative to errors > 0', async () => {
    /*
     * The callout warns against gating a read on `summarizeDiagnostics(...).errors > 0`, because
     * the deferred group carries `error` severity while the file reads perfectly — and then offered
     * `validateRecording`'s `report.ok` as the alternative. `report.ok` is
     * `diagnostics.every((d) => d.severity !== 'error')` over a SUPERSET of the same array, so it
     * is false on exactly those files (fixed in 0.3.100).
     */
    const bytes = minimalEdfPlus({
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [
        { label: 'Good', samplesPerRecord: 4, physicalMinimum: -500, physicalMaximum: 500 },
        // Degenerate physical range: no scale for this signal, every other signal fine.
        { label: 'Flat', samplesPerRecord: 4, physicalMinimum: 7, physicalMaximum: 7 },
      ],
    });
    const recording = await openEdf(byteSource(bytes));

    // The two gates agree, which is what makes recommending one over the other wrong.
    expect(summarizeDiagnostics(recording.header.diagnostics).errors).toBeGreaterThan(0);
    expect((await validateRecording(recording)).ok).toBe(false);
    // And the file reads.
    const chunks = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: 4,
      signalIndices: [0],
    });
    expect(chunks[0]?.signals[0]?.sampleCount).toBe(16);

    const page = ALL_PAGES[
      Object.keys(ALL_PAGES).find((p) => p.endsWith('diagnostics.md')) ?? ''
    ] as string;
    expect(page).not.toMatch(
      /Gate on the\s*\n?>?\s*thrown `EdfError`, or on `validateRecording`'s `report\.ok`/,
    );
  });

  it('counts the validateHeader table correctly', () => {
    /*
     * The section tables ten codes, names four that exist nowhere else, and then said "The other
     * five are also emitted by the parser". Ten minus four is six, and all six really are parser
     * codes (fixed in 0.3.87).
     *
     * Both numbers are derived from the table, so adding a row fails this until the prose is
     * updated — the same rule 0.3.63 applied to diagnostics.md.
     */
    const page = ALL_PAGES[
      Object.keys(ALL_PAGES).find((p) => p.endsWith('api-validate.md')) ?? ''
    ] as string;
    const start = page.indexOf('| code | condition |');
    expect(start).toBeGreaterThan(-1);
    const rest = page.slice(start);
    const table = rest.slice(0, rest.indexOf('\n\n'));
    const rows = [...table.matchAll(/^\| `([A-Z_0-9]+)` \|/gm)].map((m) => m[1] as string);
    expect(rows.length).toBe(10);

    const spelled: Readonly<Record<number, string>> = {
      3: 'Three',
      4: 'Four',
      5: 'Five',
      6: 'six',
      7: 'seven',
    };
    const prose = rest.slice(0, rest.indexOf('A few details'));
    const exclusiveMatch = /^(Three|Four|Five|Six) of those exist nowhere else/m.exec(prose);
    expect(exclusiveMatch).not.toBeNull();
    const exclusive = { Three: 3, Four: 4, Five: 5, Six: 6 }[exclusiveMatch?.[1] ?? ''] ?? 0;

    const remaining = rows.length - exclusive;
    expect(prose, `the remainder is ${remaining}`).toContain(
      `The other ${spelled[remaining] ?? String(remaining)} are also emitted by the parser`,
    );
  });

  it('names both conditions under which formatStartTimeNaive returns undefined', async () => {
    /*
     * It returns `undefined` for an unresolved DATE and for a refused CLOCK — the second added in
     * 0.3.17, because a file whose starttime reads `23.59.60` otherwise came back as
     * `...T00:00:00.000`, a wall-clock instant the file never gave. `validation.md` and the source
     * docblock both say so; the function's own reference entry stated only the first, as an
     * equivalence ("i.e. the file carries no resolvable date"), so a caller who checked
     * `resolvedDate` and called anyway still got `undefined` (fixed in 0.3.86).
     */
    const reference = ALL_PAGES[
      Object.keys(ALL_PAGES).find((p) => p.endsWith('api-primitives.md')) ?? ''
    ] as string;
    const at = reference.indexOf('formatStartTimeNaive(startTime: EdfStartTime)');
    expect(at).toBeGreaterThan(-1);
    const section = reference.slice(at, at + 1400);
    expect(section).toContain('resolvedDate');
    expect(section).toContain("clockSource === 'none'");

    // The behaviour, so the page is checked against the code and not only against itself.
    const bytes = minimalEdf({ startDate: '11.03.19', raw: { startTime: '23.59.60' } });
    const header = parseHeader(bytes, bytes.byteLength);
    expect(header.startTime.resolvedDate).toBeDefined();
    expect(header.startTime.clockSource).toBe('none');
    expect(formatStartTimeNaive(header.startTime)).toBeUndefined();
  });

  it('does not deny a pyEDFlib comparison the harness performs', () => {
    /*
     * `tests/corpus/golden-values.test.ts` reads fixtures written and read back by pyEDFlib's own
     * writer and compares every physical sample against the IEEE-754 bits pyEDFlib produced, with
     * `Object.is` — a one-ULP difference fails. `mne-parity.test.ts` does the same for MNE. Four
     * pages still described that comparison as something edfcore had not done: `api-primitives.md`
     * called the parity "intent rather than a measured guarantee", and `api-validate.md`,
     * `validation.md` and `comparison.md` said it had not happened (fixed in 0.3.85; 0.3.64 was the
     * same class on other pages).
     */
    for (const [path, text] of Object.entries(ALL_PAGES)) {
      const where = path.split('/').pop();
      expect(text, `${where} denies the harness`).not.toMatch(
        /intent rather than a measured guarantee/,
      );
      expect(text, `${where} denies the comparison`).not.toMatch(
        /(has not|not yet) been compared[\s\S]{0,40}element by element/,
      );
    }
  });

  it('does not call buildRecordIndex the ONLY function that reads the whole file', async () => {
    /*
     * `record-index.ts`'s own docblock says "one of only two functions that read the whole file,
     * the other being `validateRecording`", and the source is right: on an EDF+/BDF+ file with no
     * supplied index, `validateRecording` reads every record to derive the annotation onsets — even
     * with `scanSamples: false`, which is what 0.3.77 is about. Two pages said "the only"
     * (fixed in 0.3.83).
     */
    for (const [path, text] of Object.entries(ALL_PAGES)) {
      // Any spelling of "only one function reads the whole file", not just the one 0.3.83 saw.
      // `large-files.md` said "the one call in edfcore that does traverse the whole file" and the
      // narrower pattern walked straight past it.
      expect(text, `${path.split('/').pop()} overstates it`).not.toMatch(
        /\b(only|one) (function|call)[^.\n]{0,40}(reads|traverse[sd]?)[^.\n]{0,20}whole file/,
      );
    }

    // The behaviour behind the correction: a full-file read from the other function.
    const bytes = minimalEdfPlus({
      recordCount: 6,
      recordDurationSeconds: 1,
      signals: [{ label: 'A', samplesPerRecord: 2 }],
    });
    const recording = await openEdf(byteSource(bytes));
    const report = await validateRecording(recording, { scanSamples: false });
    expect(report.recordsScanned).toBe(6);
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
    /*
     * Matched by CLAIM, not by phrasing, and over `src/` as well as the pages.
     *
     * 0.3.76 pinned the two exact sentences it had found and missed three pages saying the same
     * thing in other words; 0.3.90 widened those strings and missed three MORE — "the first defect
     * of any severity", "the first diagnostic of any severity", "Empty under `strict`, because the
     * first one threw" — plus the module docblock in `collector.ts` itself, which the page glob
     * never looked at and which ships in `dist/diagnostics/collector.d.ts`. A guard that a
     * rewording walks past is a guard that would still pass if the claim came back, which is what
     * happened twice (fixed in 0.3.108).
     */
    const empties = /empty[^.]{0,40}under \*?`?strict|under \*?`?strict`?[^.]{0,60}empty/i;
    const exemptsNothing = /exempts nothing|(?:of|at) \*?any\*? (?:disposition|severity)/i;
    for (const [path, text] of [...Object.entries(ALL_PAGES), ...Object.entries(ALL_SOURCE)]) {
      const where = path.split('/').pop();
      const claim = claimText(text);
      expect(claim, `${where} should not say strict empties the list`).not.toMatch(empties);
      expect(claim, `${where} should not say strict exempts nothing`).not.toMatch(exemptsNothing);
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
