/**
 * The `validateHeader` table on `api-validate.md` says which codes come from where.
 *
 * Ten rows, and one sentence under them doing real work: four of the ten "exist nowhere else in
 * edfcore", and "the other six are also emitted by the parser, so a report stands on its own
 * instead of only making sense next to `header.diagnostics`."
 *
 * That is a claim about where code lives, and it is the kind that rots silently in both
 * directions. Moving one of the four into the parser would make a validation report redundant
 * with the header's own diagnostics for that code, and the page would still say it was exclusive.
 * Moving one of the six out would break the sentence the other way: a report that no longer stands
 * on its own, still advertised as one that does.
 *
 * Both halves are settled by asking which modules under `src/` name each code. `validate.ts` is
 * the entry point the page documents; a code named anywhere else is one the parser can reach.
 *
 * `diagnostic-docs.test.ts` covers the severity tables across every page. This is the narrower
 * question that file does not ask: not how severe a code is, but who is entitled to emit it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dispositionOf } from '../../src/diagnostics/codes.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

const PAGE = DOCS_PAGES.get('api-validate.md') ?? '';
const FLAT = PAGE.replace(/\s+/g, ' ');
const SRC = new URL('../../src/', import.meta.url);

/** Every `.ts` under `src/`, keyed by path relative to it. */
function modules(directory = SRC, prefix = ''): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const [name, source] of modules(
        new URL(`${entry.name}/`, directory),
        `${prefix}${entry.name}/`,
      )) {
        found.set(name, source);
      }
    } else if (entry.name.endsWith('.ts')) {
      found.set(`${prefix}${entry.name}`, readFileSync(new URL(entry.name, directory), 'utf8'));
    }
  }
  return found;
}

const MODULES = modules();

/**
 * The modules naming `code`, excluding the two that only catalogue codes rather than emit them.
 * `codes.ts` holds the union and the disposition map; `format.ts` renders whatever it is handed.
 */
function emittedBy(code: string): readonly string[] {
  return [...MODULES]
    .filter(([name]) => name !== 'diagnostics/codes.ts' && name !== 'diagnostics/format.ts')
    .filter(([, source]) => source.includes(`'${code}'`))
    .map(([name]) => name);
}

/** The first column of every row in the table under `## validateHeader`. */
const TABLE_CODES = (() => {
  const at = PAGE.indexOf('## validateHeader');
  if (at === -1) throw new Error('api-validate.md no longer documents validateHeader');
  const rows: string[] = [];
  for (const line of PAGE.slice(at).split('\n')) {
    if (!line.startsWith('|')) {
      if (rows.length > 0) break;
      continue;
    }
    rows.push((line.split('|')[1] ?? '').trim().replaceAll('`', ''));
  }
  return rows.slice(2);
})();

/** The codes the prose calls exclusive to this entry point. */
const CLAIMED_EXCLUSIVE = (() => {
  const sentence = /Four of those exist nowhere else in edfcore: (.+?)\. `EdfDiagnosticCode`/.exec(
    FLAT,
  );
  if (sentence === null) throw new Error('the exclusivity sentence is gone from api-validate.md');
  return [...(sentence[1] ?? '').matchAll(/`([A-Z_]+)`/g)].map(([, code = '']) => code);
})();

describe('the validateHeader code table', () => {
  it('has rows, and every one names a code the package knows', () => {
    expect(TABLE_CODES.length).toBeGreaterThan(0);
    for (const code of TABLE_CODES) {
      expect(emittedBy(code), code).not.toHaveLength(0);
    }
  });

  it('claims four are exclusive, and names four', () => {
    expect(CLAIMED_EXCLUSIVE).toHaveLength(4);
    for (const code of CLAIMED_EXCLUSIVE) expect(TABLE_CODES).toContain(code);
  });

  it('gives those four no emitter but validate.ts', () => {
    for (const code of CLAIMED_EXCLUSIVE) {
      expect(emittedBy(code), code).toEqual(['validate.ts']);
    }
  });

  it('gives every other row an emitter outside validate.ts, so a report stands on its own', () => {
    // "The other six are also emitted by the parser."
    const shared = TABLE_CODES.filter((code) => !CLAIMED_EXCLUSIVE.includes(code));
    expect(shared).toHaveLength(TABLE_CODES.length - CLAIMED_EXCLUSIVE.length);
    expect(FLAT).toContain('The other six are also emitted by the parser');
    expect(shared).toHaveLength(6);
    for (const code of shared) {
      expect(
        emittedBy(code).filter((name) => name !== 'validate.ts'),
        code,
      ).not.toHaveLength(0);
    }
  });

  it('makes none of them fatal, as the page promises', () => {
    // "None of them can ever be fatal." A fatal code here would mean `validateHeader` could
    // condemn a file the parser opened without complaint.
    for (const code of TABLE_CODES) {
      expect(dispositionOf(code), code).not.toBe('fatal');
    }
  });
});

describe('the label convention the page spells out', () => {
  it('lists exactly the types the check accepts, in order', () => {
    // "a type from `EEG`, `ECG`, `EOG`, `ERG`, `EMG`, `MEG`, `MCG`, `EP`, `Temp`, `Resp`, `SaO2`,
    //  `Light`, `Sound` and `Event`, matched case-sensitively"
    const published = /wants a type from ((?:`\w+`(?:, | and )?)+), matched case-sensitively/.exec(
      FLAT,
    );
    expect(published).not.toBeNull();
    const names = [...(published?.[1] ?? '').matchAll(/`(\w+)`/g)].map(([, name = '']) => name);

    const declared =
      /const STANDARD_LABEL_TYPES: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\)/.exec(
        MODULES.get('validate.ts') ?? '',
      );
    expect(declared).not.toBeNull();
    const actual = [...(declared?.[1] ?? '').matchAll(/'([^']+)'/g)].map(([, name = '']) => name);

    expect(names).toEqual(actual);
  });
});
