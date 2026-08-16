/**
 * Every exported symbol is documented somewhere, bar fourteen types that are written down.
 *
 * The exceptions are real and listed at `UNDOCUMENTED_TYPES`, not swept up in this sentence. An
 * unqualified title here would be the same defect this file exists to catch, one level up: a claim
 * of total coverage standing over a check that does not have it.
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

import { describe, expect, it } from 'vitest';
import * as edfcore from '../../src/index.js';
import * as edfcoreNode from '../../src/node.js';
import * as edfcoreValidate from '../../src/validate.js';
import { exportedTypes } from '../support/barrel-types.js';

interface RawModuleGlob {
  glob(
    pattern: string,
    options: { query: string; import: string; eager: true },
  ): Record<string, string>;
}

const DOC_SOURCES = (import.meta as unknown as RawModuleGlob).glob(
  '../../website/src/content/docs/*.md',
  { query: '?raw', import: 'default', eager: true },
);

/** Keyed by file name, e.g. `api-helpers.md`. */
const DOCS = new Map<string, string>(
  Object.entries(DOC_SOURCES).map(([path, source]) => [path.split('/').pop() ?? path, source]),
);

const ALL_DOCS = [...DOCS.values()].join('\n');

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
 * Exported types that no page mentions today. Debt, written down.
 *
 * This half of the check did not exist before 0.4.220, and the comment where it should have been
 * asserted the opposite — "types are documented under their own names too". Fourteen are not. They
 * are listed rather than tolerated so that a fifteenth fails, and the second test below fails once
 * one of these is documented, so the list shrinks as the gap closes instead of outliving it.
 */
const UNDOCUMENTED_TYPES = new Set([
  'EdfAnnotationWindow',
  'EdfCodeCount',
  'EdfDiagnosticSummary',
  'EdfEnvelopeChunk',
  'EdfEnvelopeSignal',
  'EdfPhysicalEnvelope',
  'EdfStatusWord',
  'EdfTriggerEvent',
  'EnvelopeSelection',
  'FormatAnnotationsOptions',
  'FormatHeaderOptions',
  'FormatReportOptions',
  'StreamSelection',
  'TriggerSelection',
]);

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

  it('can tell a documented name from an undocumented one', () => {
    expect(mentioned('openEdf')).toBe(true);
    expect(mentioned('thisNameIsNotInTheDocs')).toBe(false);
    // The boundary is what makes the check honest: a prefix does not vouch for its extension.
    expect(mentioned('readEnvelopeAtResolutionXYZ')).toBe(false);
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
