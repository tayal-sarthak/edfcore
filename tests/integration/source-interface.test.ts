/**
 * The `ByteSource` interface is published three times and has to say the same thing three times.
 *
 * It is the one type a caller implements rather than consumes — the whole extension point of the
 * package, and the reason a file, a blob, an object store and an HTTP range all go down the same
 * path. So it is printed in full on `data-sources.md`, printed again on `api-sources.md`, and
 * declared in `src/types.ts`.
 *
 * Two of those three are hand-typed copies of the third, and a copy that drifts here is worse than
 * a stale sentence: someone writes an implementation against a printed signature, TypeScript
 * disagrees with the page, and the page is what they trusted. A dropped `readonly`, a `close` that
 * quietly stopped being optional, a `ReadOptions` parameter that gained a sibling — each is a
 * one-word edit that neither `astro check` nor `tsc` can see, because a fenced block on a
 * documentation page is not code either of them compiles.
 *
 * `doc-snippets-compile.test.ts` compiles the fences that are complete programs. This block is a
 * declaration rather than a program, so it is compared against the declaration instead.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as edfcore from '../../src/index.js';
import * as edfcoreNode from '../../src/node.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

const TYPES = readFileSync(new URL('../../src/types.ts', import.meta.url), 'utf8');

/** The member lines of `interface <name> { … }` wherever it is written. */
function members(source: string, name = 'ByteSource'): readonly string[] {
  const opening = `interface ${name} {`;
  const at = source.indexOf(opening);
  if (at === -1) throw new Error(`no ${name} declaration here`);
  const body = source.slice(at + opening.length);
  const end = body.indexOf('\n}');
  if (end === -1) throw new Error(`unterminated ${name} declaration`);
  return body
    .slice(0, end)
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line !== '' && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'),
    );
}

const DECLARED = members(TYPES);
const PAGES = ['data-sources.md', 'api-sources.md'] as const;

describe('the published ByteSource', () => {
  it('is declared with the three members the pages call the entire contract', () => {
    expect(DECLARED).toHaveLength(3);
    expect(DECLARED[0]).toContain('byteLength');
    expect(DECLARED[1]).toContain('read(');
    expect(DECLARED[2]).toContain('close?(');
  });

  for (const page of PAGES) {
    it(`is printed on ${page} exactly as it is declared`, () => {
      const source = DOCS_PAGES.get(page) ?? '';
      expect(source, page).not.toBe('');
      expect(members(source)).toEqual(DECLARED);
    });
  }

  it('keeps the two optional things optional, which is what a `?` is doing there', () => {
    // `close` is optional because a byte array has nothing to close, and `options` because most
    // callers never pass one. Both are load-bearing: making either required turns every existing
    // implementation into a compile error.
    expect(DECLARED.some((line) => line.startsWith('close?('))).toBe(true);
    expect(DECLARED.some((line) => line.includes('options?: ReadOptions'))).toBe(true);
  });

  it('keeps byteLength readonly, since a source that resizes has no addressable end', () => {
    // "`byteLength` is the size of the whole resource in bytes, and it has to be known before the
    //  first read." Every record offset is computed from it.
    expect(DECLARED[0]).toBe('readonly byteLength: number;');
  });

  it('agrees with the prose about what a read returns', () => {
    // "A read resolves with exactly `length` bytes or rejects. It never pads, and it never
    //  truncates." A signature promising anything but a Uint8Array would make that unsayable.
    expect(DECLARED[1]).toContain('Promise<Uint8Array>');
    const flat = (DOCS_PAGES.get('data-sources.md') ?? '').replace(/\s+/g, ' ');
    expect(flat).toContain('A read resolves with exactly `length` bytes or rejects');
  });
});

/**
 * The four structural shims, printed on `api-sources.md` and declared in `types.ts`.
 *
 * They exist so neither the DOM nor `@types/node` leaks into the published `.d.ts`: a library that
 * names `Blob` forces `lib.dom` on every consumer, and one that names `Buffer` forces
 * `@types/node` on every browser build. Each shim is the minimum shape edfcore uses, and the real
 * platform type satisfies it.
 *
 * `shim-assignability.test-d.ts` proves the assignability — a `Blob`, a `File`, an `AbortSignal`,
 * a `Response` and `globalThis.fetch` all fit. What it cannot see is whether the page prints the
 * same shape it proves things about, and a shim is exactly the kind of declaration someone copies
 * off a page to build a test double from. A member the page shows and the type does not is a
 * double that compiles against the page and is refused by the library.
 *
 * `FetchLike` is a type alias rather than an interface and is checked separately, for the reason
 * the page spends four paragraphs on: `signal` is deliberately absent from the printed `init` and
 * still passed at runtime, because naming it would break the assignability of `globalThis.fetch`.
 * Its absence is a design decision, so the check is that it stays absent.
 */
describe('the structural platform shims', () => {
  const SOURCES = DOCS_PAGES.get('api-sources.md') ?? '';
  const SHIMS = ['BlobLike', 'AbortSignalLike', 'HttpResponseLike'] as const;

  for (const shim of SHIMS) {
    it(`prints ${shim} exactly as it is declared`, () => {
      expect(members(SOURCES.slice(SOURCES.indexOf(`### ${shim}`)), shim)).toEqual(
        members(TYPES, shim),
      );
    });
  }

  it('found a body for each of them, so a passing run is not a vacuous one', () => {
    for (const shim of SHIMS) {
      expect(members(TYPES, shim).length, shim).toBeGreaterThan(0);
    }
  });

  it('keeps `signal` out of the printed FetchLike, which is the whole design note', () => {
    // "**`signal` is absent from the `init` type, and it is still passed at runtime.**"
    const printed = /type FetchLike = \(([\s\S]*?)\) => Promise<HttpResponseLike>;/.exec(SOURCES);
    expect(printed).not.toBeNull();
    expect(printed?.[1]).not.toContain('signal');

    const declared = /export type FetchLike = \(([\s\S]*?)\) => Promise<HttpResponseLike>;/.exec(
      TYPES,
    );
    expect(declared).not.toBeNull();
    expect(declared?.[1]).not.toContain('signal');
    // And the page still explains why, since the absence looks like an oversight without it.
    expect(SOURCES.replace(/\s+/g, ' ')).toContain('The reason is parameter contravariance');
  });
});

/**
 * The adapter table, whose rows have to name adapters that exist at the entry point they name.
 *
 * A reader picking an adapter from this table is choosing an import, so a row naming `fileSource`
 * without `edfcore/node` sends them to a specifier that does not export it.
 */
describe('choosing an adapter', () => {
  const SOURCES = DOCS_PAGES.get('api-sources.md') ?? '';

  const ROWS = (() => {
    const at = SOURCES.indexOf('| Situation | Adapter |');
    if (at === -1) throw new Error('api-sources.md no longer tabulates the adapters');
    const rows: { readonly situation: string; readonly adapter: string }[] = [];
    for (const line of SOURCES.slice(at).split('\n')) {
      if (!line.startsWith('|')) break;
      const cells = line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim());
      rows.push({ situation: cells[0] ?? '', adapter: cells[1] ?? '' });
    }
    return rows.slice(2);
  })();

  it('has a row per adapter the package ships', () => {
    expect(ROWS.length).toBeGreaterThan(4);
  });

  it('names an export, from the entry point the row names', () => {
    for (const row of ROWS) {
      const name = /`(\w+)`/.exec(row.adapter)?.[1] ?? '';
      expect(name, row.situation).not.toBe('');
      const fromNode = row.adapter.includes('edfcore/node');
      const available = fromNode ? Object.keys(edfcoreNode) : Object.keys(edfcore);
      expect(available, `${name} (${row.adapter})`).toContain(name);
    }
  });

  it('puts the two filesystem adapters behind edfcore/node and nothing else there', () => {
    // The split the whole shim exercise exists to protect: everything else has to be reachable
    // from the universal entry, which imports no Node built-in.
    const nodeRows = ROWS.filter((row) => row.adapter.includes('edfcore/node'));
    expect(nodeRows.map((row) => /`(\w+)`/.exec(row.adapter)?.[1]).sort()).toEqual([
      'fileHandleSource',
      'fileSource',
    ]);
    for (const row of ROWS) {
      if (row.adapter.includes('edfcore/node')) continue;
      const name = /`(\w+)`/.exec(row.adapter)?.[1] ?? '';
      expect(Object.keys(edfcore), name).toContain(name);
    }
  });
});
