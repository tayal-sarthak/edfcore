/**
 * Every exported symbol is documented somewhere.
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

/** Types are documented under their own names too, but only runtime exports are enumerable. */
const RUNTIME_EXPORTS = Object.keys(edfcore).filter((name) => name !== 'default');

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

describe('every runtime export is mentioned in the docs', () => {
  it('leaves nothing undocumented', () => {
    expect(RUNTIME_EXPORTS.length).toBeGreaterThan(40);
    const undocumented = RUNTIME_EXPORTS.filter((name) => !mentioned(name));
    expect(undocumented).toEqual([]);
  });
});

describe('the two entries that are not in the universal barrel', () => {
  it('documents edfcore/validate and edfcore/node too', () => {
    for (const name of [
      'validateHeader',
      'validateRecording',
      'formatValidationReport',
      'fileSource',
      'fileHandleSource',
    ]) {
      expect(mentioned(name), `${name} is exported but not documented`).toBe(true);
    }
  });
});
