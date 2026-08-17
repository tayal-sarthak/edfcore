/**
 * Every exported symbol is documented somewhere. No exceptions — the list is empty.
 *
 * That sentence was qualified from 0.4.221 to 0.4.250, because it had to be: fourteen exported
 * types were on the `UNDOCUMENTED_TYPES` list and an unqualified claim over a check that did not
 * have it would have been the defect this file exists to catch, one level up. The list is empty
 * now, so the claim is plain again — and the empty set stays, because it is what makes the next
 * undocumented export a failure rather than a new entry.
 *
 * 0.1.16 added the other half of this: an export nobody listed in `public-api.test.ts` is a
 * failure, so adding one is a deliberate act. That stopped exports from arriving unnoticed. It did
 * not stop them from arriving undocumented — the list is in a test file, and adding a line to a
 * test file is not writing a doc.
 *
 * This closes it. A name in the barrel that appears nowhere in `website/src/content/docs` fails
 * here, which makes "document it" part of shipping it rather than a separate intention.
 *
 * The check is deliberately shallow: it asserts the name is MENTIONED, not that the prose is any
 * good. A mention is mechanically checkable and its absence is unambiguous; prose quality is
 * neither, and a test that pretends to judge it would be a test that lies.
 *
 * The match is on word boundaries, not on substrings. `readEnvelope` is a prefix of
 * `readEnvelopeAtResolution`, so a substring check would let a page that documents only the second
 * one vouch for the first — which is the exact class of gap this file exists to find.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as edfcore from '../../src/index.js';
import * as edfcoreNode from '../../src/node.js';
import * as edfcoreValidate from '../../src/validate.js';
import { exportedTypes } from '../support/barrel-types.js';
import { ALL_DOCS, DOCS_PAGES as DOCS } from '../support/docs-pages.js';

interface RawModuleGlob {
  glob(
    pattern: string,
    options: { query: string; import: string; eager: true },
  ): Record<string, string>;
}

function mentioned(name: string): boolean {
  return new RegExp(`\\b${name}\\b`).test(ALL_DOCS);
}

const RUNTIME_EXPORTS = Object.keys(edfcore).filter((name) => name !== 'default');

/** The three barrels as text, because a type has no runtime value to enumerate. */
const BARREL_SOURCES = (import.meta as unknown as RawModuleGlob).glob('../../src/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * Type names exported by the barrels. Parsed by `tests/support/barrel-types.ts`, which is shared
 * with `api-surface.test.ts` — this file's copy was written by reading that one and inherited its
 * blind spot along with it (0.4.220, fixed in 0.4.223).
 */
const EXPORTED_TYPES: readonly string[] = [
  ...new Set(
    Object.entries(BARREL_SOURCES)
      .filter(([path]) => /\/(index|node|validate)\.ts$/.test(path))
      .flatMap(([, source]) => [...exportedTypes(source)]),
  ),
];

/**
 * Exported types that no page mentions. Empty, and kept.
 *
 * This half of the check did not exist before 0.4.220, and the comment where it should have been
 * asserted the opposite — "types are documented under their own names too". Fourteen were not.
 * They were listed rather than tolerated so that a fifteenth would fail, and the third test below
 * fails once a listed one IS documented, so the list could only shrink. It did, over six
 * releases: 0.4.234 took the three formatter options types, 0.4.235 the three selections, 0.4.247
 * the three envelope results, 0.4.248 the two BioSemi ones, 0.4.249 the two summary ones, and
 * 0.4.250 the last, `EdfAnnotationWindow`.
 *
 * The empty set is not dead code. It is the seam a future exception would go in, and while it
 * holds nothing the check above it is unconditional — which is the state worth defending.
 */
const UNDOCUMENTED_TYPES = new Set<string>([]);

/** What `./validate` and `./node` publish that the universal barrel does not re-export. */
const SUBPATH_EXPORTS = [...Object.keys(edfcoreValidate), ...Object.keys(edfcoreNode)].filter(
  (name) => name !== 'default' && !RUNTIME_EXPORTS.includes(name),
);

describe('the documentation set is the one being checked', () => {
  it('loaded the pages, so a passing run is not a vacuous one', () => {
    // Without this, a glob that silently matched nothing would make every assertion below pass.
    expect(DOCS.size).toBeGreaterThan(15);
    expect(DOCS.has('api-helpers.md')).toBe(true);
    expect(ALL_DOCS.length).toBeGreaterThan(50_000);
  });

  it('reads the same set the site publishes', () => {
    /*
     * The reader in `tests/support/docs-pages.ts` and the collection loader are two patterns that
     * have to mean the same thing, and until 0.4.231 they did not: the loader takes
     * `**\/*.{md,mdx}` and every check here took `*.md`, so a nested page or an `.mdx` one was
     * published and unswept. Comparing the two strings is what keeps the fix from being a one-off
     * — narrowing either side again fails here rather than in a year.
     */
    /*
     * `readFileSync`, not `import.meta.glob`. A `?raw` glob still hands the path to vite's
     * transform, which resolves the file's nearest tsconfig — and `website/tsconfig.json` extends
     * `astro/tsconfigs/strict`, which lives in `website/node_modules`. The CI `check` job installs
     * the root workspace only, so globbing this file passed on any machine with the site's
     * dependencies present and failed with `[TSCONFIG_ERROR] Tsconfig not found` on one without.
     * Reading bytes involves no transform and no tsconfig (fixed in 0.4.237).
     */
    const config = readFileSync(
      new URL('../../website/src/content.config.ts', import.meta.url),
      'utf8',
    );
    const reader = readFileSync(
      new URL('../../tests/support/docs-pages.ts', import.meta.url),
      'utf8',
    );
    const loaderPattern = /pattern:\s*'([^']+)'/.exec(config)?.[1];
    // The `glob(...)` CALL, not the file text: a pattern quoted in the reader's own docblock would
    // otherwise vouch for a narrower one in the code beneath it.
    const readerPattern = /\.glob\(\s*'([^']+)'/.exec(reader)?.[1];
    expect(loaderPattern, 'no glob pattern in website/src/content.config.ts').toBeDefined();
    expect(readerPattern, 'no glob call in tests/support/docs-pages.ts').toBeDefined();
    expect(readerPattern).toBe(`../../website/src/content/docs/${loaderPattern}`);
  });

  it('can tell a documented name from an undocumented one', () => {
    expect(mentioned('openEdf')).toBe(true);
    expect(mentioned('thisNameIsNotInTheDocs')).toBe(false);
    // The boundary is what makes the check honest: a prefix does not vouch for its extension.
    expect(mentioned('readEnvelopeAtResolutionXYZ')).toBe(false);
  });
});

describe("the README's description of the documentation set", () => {
  /**
   * "an Astro build with 22 pages" — the one number the README states about the site.
   *
   * It said "twenty pages" while the collection held twenty-two, which is the same shape of
   * defect as the API surface table two sections above it, and that one has been checked since
   * 0.1.x. Written as digits on purpose: a number a test has to read should be written the way a
   * test can read it, and this paragraph is not prose anyone reads for its rhythm.
   *
   * The sentence after it used to name the eight guides, and there are nine. It now says the
   * sidebar is the list, because a hand-written inventory of pages in a file that is not the
   * pages is the thing this repository keeps deleting.
   */
  const CLAIM = /an Astro build with\s+(\d+)\s+pages/.exec(
    readFileSync(new URL('../../README.md', import.meta.url), 'utf8'),
  );

  it('states a page count', () => {
    // Without this the assertion below would pass on a sentence that had been reworded away.
    expect(CLAIM, 'no "an Astro build with N pages" in README.md').not.toBeNull();
  });

  it('counts the pages the collection holds', () => {
    expect(Number(CLAIM?.[1])).toBe(DOCS.size);
  });

  it('no longer hand-lists the guides', () => {
    // The parenthetical it replaced named eight of the nine, and nothing would have said so.
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    expect(readme).toContain('There is no inventory of them');
  });
});

describe('every exported type is mentioned in the docs', () => {
  it('read the type names out of the barrels, so a passing run is not a vacuous one', () => {
    expect(EXPORTED_TYPES.length).toBeGreaterThan(40);
    expect(EXPORTED_TYPES).toContain('EdfHeader');
  });

  it('leaves nothing undocumented but the recorded exceptions', () => {
    const missing = EXPORTED_TYPES.filter(
      (name) => !mentioned(name) && !UNDOCUMENTED_TYPES.has(name),
    );
    expect(missing, 'exported types no documentation page mentions').toEqual([]);
  });

  it('lists no exception that is in fact documented', () => {
    // Without this the list would outlive the gap: a type documented later would stay on it, and
    // the next undocumented type could be waved through by an entry that no longer means anything.
    const stale = [...UNDOCUMENTED_TYPES].filter((name) => mentioned(name));
    expect(stale, 'now documented — remove from UNDOCUMENTED_TYPES').toEqual([]);
  });
});

describe('every runtime export is mentioned in the docs', () => {
  it('leaves nothing undocumented', () => {
    expect(RUNTIME_EXPORTS.length).toBeGreaterThan(40);
    const undocumented = RUNTIME_EXPORTS.filter((name) => !mentioned(name));
    expect(undocumented).toEqual([]);
  });
});

describe('the two entries that are not in the universal barrel', () => {
  it('documents edfcore/validate and edfcore/node too', () => {
    // Derived from the modules, not hand-listed. The list here used to name five symbols, which
    // covered what `./validate` and `./node` exported on the day it was written and nothing added
    // after — the same shape of gap this file exists to close for the universal barrel.
    expect(SUBPATH_EXPORTS.length).toBeGreaterThanOrEqual(5);
    const undocumented = SUBPATH_EXPORTS.filter((name) => !mentioned(name));
    expect(undocumented).toEqual([]);
  });
});
