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
import { DOCS_PAGES } from '../support/docs-pages.js';

const TYPES = readFileSync(new URL('../../src/types.ts', import.meta.url), 'utf8');

/** The body of `interface ByteSource { … }` wherever it is written, as its member lines. */
function members(source: string): readonly string[] {
  const at = source.indexOf('interface ByteSource {');
  if (at === -1) throw new Error('no ByteSource declaration here');
  const body = source.slice(at + 'interface ByteSource {'.length);
  const end = body.indexOf('\n}');
  if (end === -1) throw new Error('unterminated ByteSource declaration');
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
