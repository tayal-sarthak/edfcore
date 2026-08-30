/**
 * The table on `diagnostics.md` that says which calls take `strict`.
 *
 * Eleven functions in two columns, and nothing read it. `strict-decision.test.ts` covers what
 * `strict` DOES — the info exemption, the four always-fatal conditions — and `strict-reaches.test.ts`
 * covers how far it reaches into a file. Which entry points accept it at all was a table.
 *
 * It is the kind of table that goes stale silently, in both directions. A function that grows a
 * `ParseOptions` parameter joins the left column without anyone editing the page, and a caller
 * reading the right column concludes it cannot be made strict. A function whose options type is
 * narrowed leaves the left column the same way, and a caller passing `strict` to it gets a
 * `strict` that is quietly ignored — an option that type-checks, runs, and does nothing.
 *
 * So both columns are checked, by different means, because they are different claims:
 *
 * - The six on the left are DRIVEN. Each is given a file with a real non-`info` defect, and each
 *   must throw `EdfFormatError` carrying that code with `strict: true` and collect the same
 *   diagnostic without it. That is the only way to catch a `strict` that is accepted and dropped.
 * - The five on the right are checked STRUCTURALLY, out of `src/`: the options parameter of each is
 *   resolved to its declared type, that type's `extends` and `&` chain is followed, and `strict`
 *   must not be reachable through it. A behavioural check cannot prove a negative here — passing an
 *   option a signature does not declare is a compile error, not a runtime one.
 *
 * The same resolver is then pointed at the left column, which is what keeps the two halves honest:
 * every function the page says accepts `strict` must reach `ParseOptions`, and every one it says
 * does not must not.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EdfFormatError } from '../../src/errors.js';
import { parseHeader } from '../../src/header/parse.js';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader, readRecordBytes } from '../../src/io/read.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { decodeAnnotations } from '../../src/tal/annotations.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('diagnostics.md') ?? '';

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/** The rows between the `| accepts `strict` | does not |` heading and the blank line after it. */
function tableColumns(): { accepts: readonly string[]; refuses: readonly string[] } {
  const start = PAGE.indexOf('| accepts `strict` | does not |');
  const block = PAGE.slice(start).split('\n\n')[0] ?? '';
  const rows = block
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2);
  const names = (cell: string): readonly string[] =>
    [...cell.matchAll(/`([A-Za-z]+)`/g)].map((match) => match[1] ?? '');
  const accepts: string[] = [];
  const refuses: string[] = [];
  for (const row of rows) {
    const cells = row.split('|').map((cell) => cell.trim());
    accepts.push(...names(cells[1] ?? ''));
    refuses.push(...names(cells[2] ?? ''));
  }
  return { accepts, refuses };
}

const { accepts: ACCEPTS, refuses: REFUSES } = tableColumns();

describe('the table itself', () => {
  it('reads as two columns of function names, so a passing run is not a vacuous one', () => {
    expect(ACCEPTS).toEqual([
      'openEdf',
      'readHeader',
      'parseHeader',
      'readAnnotations',
      'decodeAnnotations',
      'buildRecordIndex',
    ]);
    expect(REFUSES).toEqual([
      'readRecords',
      'readWindow',
      'inspectEdf',
      'readRecordBytes',
      'decodeDigital',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Resolving an options type out of src/
// ---------------------------------------------------------------------------

function sourceFiles(dir: URL, prefix: string, into: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      sourceFiles(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`, into);
      continue;
    }
    if (entry.name.endsWith('.ts')) into.push(`${prefix}${entry.name}`);
  }
  return into;
}

const SRC = new URL('../../src/', import.meta.url);
const SOURCE = sourceFiles(SRC, '', [])
  .map((name) => readFileSync(new URL(name, SRC), 'utf8'))
  .join('\n');

/** `options?: Foo & Bar` on the declaration of `name` — the type as written. */
function optionsTypeOf(name: string): string {
  const declaration = new RegExp(
    `export (?:async )?function ${name}\\(([\\s\\S]*?)\\)(?::|\\s*\\{)`,
  ).exec(SOURCE);
  const parameters = declaration?.[1] ?? '';
  return /options\?:\s*([^,\n)]+)/.exec(parameters)?.[1]?.trim() ?? '';
}

/** Follows `extends` and `&` until it finds a declared `strict` member, or runs out. */
function reachesStrict(type: string, seen = new Set<string>()): boolean {
  for (const part of type.split('&').map((piece) => piece.trim())) {
    if (part === '' || seen.has(part)) continue;
    seen.add(part);

    const alias = new RegExp(`export type ${part} = ([^;]+);`).exec(SOURCE);
    if (alias?.[1] !== undefined && reachesStrict(alias[1], seen)) return true;

    const declaration = new RegExp(
      `export interface ${part}\\s*(?:extends ([^{]+))?\\{([\\s\\S]*?)\\n\\}`,
    ).exec(SOURCE);
    if (declaration === null) continue;
    if (/^\s*readonly strict\?:/m.test(declaration[2] ?? '')) return true;
    if (declaration[1] !== undefined && reachesStrict(declaration[1].replace(/,/g, '&'), seen)) {
      return true;
    }
  }
  return false;
}

describe('the resolver these assertions are built on', () => {
  it('finds an options type for every function in the table', () => {
    for (const name of [...ACCEPTS, ...REFUSES]) {
      expect(optionsTypeOf(name), name).not.toBe('');
    }
  });

  it('sees strict on ParseOptions and not on ReadOptions, which is the whole distinction', () => {
    expect(reachesStrict('ParseOptions')).toBe(true);
    expect(reachesStrict('ReadOptions')).toBe(false);
    // And through one level of aliasing and one of extension.
    expect(reachesStrict('OpenOptions')).toBe(true);
    expect(reachesStrict('BuildIndexOptions')).toBe(true);
  });
});

describe('the right column does not declare it', () => {
  it.each(REFUSES)('%s takes an options type that cannot reach strict', (name) => {
    expect(reachesStrict(optionsTypeOf(name))).toBe(false);
  });
});

describe('the left column does', () => {
  it.each(ACCEPTS)('%s takes an options type that reaches ParseOptions', (name) => {
    expect(reachesStrict(optionsTypeOf(name))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// And honours it
// ---------------------------------------------------------------------------

/** A non-standard fixed-header reserved field: one `NONSTANDARD_RESERVED_FIELD`, severity warning. */
const HEADER_DEFECT = buildEdf({
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  raw: { reserved: 'ZZZ' },
});

/** A malformed TAL in every record: `TAL_MALFORMED`, severity warning, on the annotation path. */
const TAL_DEFECT = buildEdf({
  plus: 'C',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [{ samplesPerRecord: 40, tals: () => [{ onset: '+1x', texts: ['e'] }] }],
});

interface Driven {
  readonly code: string;
  readonly strictly: () => Promise<unknown>;
  readonly leniently: () => Promise<readonly string[]>;
}

const HEADER_BLOCK = HEADER_DEFECT.subarray(0, 512);

async function talBytes(): Promise<{
  header: Awaited<ReturnType<typeof readHeader>>;
  bytes: Uint8Array;
}> {
  const recording = await openEdf(byteSource(TAL_DEFECT));
  const bytes = await readRecordBytes(recording.source, recording.header, { start: 0, count: 2 });
  return { header: recording.header, bytes };
}

const DRIVEN: Readonly<Record<string, Driven>> = {
  openEdf: {
    code: 'NONSTANDARD_RESERVED_FIELD',
    strictly: () => openEdf(byteSource(HEADER_DEFECT), { strict: true }),
    leniently: async () =>
      (await openEdf(byteSource(HEADER_DEFECT))).header.diagnostics.map((d) => d.code),
  },
  readHeader: {
    code: 'NONSTANDARD_RESERVED_FIELD',
    strictly: () => readHeader(byteSource(HEADER_DEFECT), { strict: true }),
    leniently: async () =>
      (await readHeader(byteSource(HEADER_DEFECT))).diagnostics.map((d) => d.code),
  },
  parseHeader: {
    code: 'NONSTANDARD_RESERVED_FIELD',
    strictly: async () => parseHeader(HEADER_BLOCK, HEADER_DEFECT.byteLength, { strict: true }),
    leniently: async () =>
      parseHeader(HEADER_BLOCK, HEADER_DEFECT.byteLength).diagnostics.map((d) => d.code),
  },
  readAnnotations: {
    code: 'TAL_MALFORMED',
    strictly: async () =>
      readAnnotations(
        await openEdf(byteSource(TAL_DEFECT)),
        { start: 0, count: 2 },
        {
          strict: true,
        },
      ),
    leniently: async () =>
      (
        await readAnnotations(await openEdf(byteSource(TAL_DEFECT)), { start: 0, count: 2 })
      ).diagnostics.map((d) => d.code),
  },
  decodeAnnotations: {
    code: 'TAL_MALFORMED',
    strictly: async () => {
      const { header, bytes } = await talBytes();
      return decodeAnnotations(header, bytes, { start: 0, count: 2 }, { strict: true });
    },
    leniently: async () => {
      const { header, bytes } = await talBytes();
      return decodeAnnotations(header, bytes, { start: 0, count: 2 }).diagnostics.map(
        (d) => d.code,
      );
    },
  },
  buildRecordIndex: {
    code: 'TAL_MALFORMED',
    strictly: async () => buildRecordIndex(await openEdf(byteSource(TAL_DEFECT)), { strict: true }),
    leniently: async () => {
      // The index itself carries no diagnostics; the recording it was built from does.
      const recording = await openEdf(byteSource(TAL_DEFECT));
      await buildRecordIndex(recording);
      return recording.timeline.diagnostics.map((d) => d.code);
    },
  },
};

describe('and every one of the six honours it', () => {
  it('covers the whole left column, so none of them is silently untested', () => {
    expect(Object.keys(DRIVEN).sort()).toEqual([...ACCEPTS].sort());
  });

  it.each(ACCEPTS)('%s throws EdfFormatError carrying the code', async (name) => {
    const driven = DRIVEN[name];
    if (driven === undefined) throw new Error(`no driver for ${name}`);
    const thrown = await Promise.resolve()
      .then(driven.strictly)
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(thrown).toBeInstanceOf(EdfFormatError);
    expect((thrown as EdfFormatError).code).toBe(driven.code);
  });

  it.each(ACCEPTS)('%s collects the same code when strict is left off', async (name) => {
    const driven = DRIVEN[name];
    if (driven === undefined) throw new Error(`no driver for ${name}`);
    expect(await driven.leniently()).toContain(driven.code);
  });
});
