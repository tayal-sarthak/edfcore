/**
 * Everywhere a stranger learns what this package does, it says it reads.
 *
 * `design-decisions.md` gives the constraint a heading of its own: "edfcore does not write EDF,
 * and will not before 1.0. A writer exists in the test suite and is not exported." It is not a
 * gap waiting to be filled — reading tolerantly and writing correctly are asymmetric commitments,
 * and the page argues the point at length.
 *
 * Four other places carry it, and each reaches a different reader: AGENTS.md tells an agent, the
 * README tells someone deciding whether to install, `comparison.md` tells someone who arrived
 * looking for a writer and sends them to pyEDFlib, and the npm description tells everyone who
 * never opens any of them.
 *
 * The `keywords` array is the one that can quietly say otherwise. It is metadata nobody reviews
 * closely, it exists to be matched against searches, and adding `edf-writer` to it is a plausible
 * thing to do for discoverability. It would work: the package would surface for a search it cannot
 * serve, and the people it brought in are exactly the ones `comparison.md` is written to send
 * somewhere else. There is no code change and no test to fail.
 *
 * So the keywords are checked from both directions — every format the package reads is listed, so
 * a search for `bdf+` finds it, and nothing in the list advertises writing.
 *
 * What this does NOT check: that the package really cannot write. That is `public-api.test.ts`
 * and the export surface, and the writer in `tests/support/` is proof that not exporting one is a
 * decision rather than an absence.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCS_PAGES } from '../support/docs-pages.js';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const MANIFEST = JSON.parse(read('package.json')) as {
  description: string;
  keywords: readonly string[];
};
const README = read('README.md').replace(/\s+/g, ' ');
const AGENTS = read('AGENTS.md').replace(/\s+/g, ' ');

/** The four the package reads, spelled the way a search would spell them. */
const FORMATS = ['edf', 'edf+', 'bdf', 'bdf+'] as const;

/** Words that would advertise producing a file rather than reading one. */
const WRITING = /\b(writer|writing|write|encoder|encode|converter|exporter|export)\b/i;

describe('the keywords, which nobody reviews and everybody searches', () => {
  it('name every format the package reads', () => {
    const lowered = MANIFEST.keywords.map((keyword) => keyword.toLowerCase());
    for (const format of FORMATS) {
      expect(lowered, `no keyword for ${format}`).toContain(format);
    }
  });

  it('advertise nothing the package refuses to do', () => {
    const promising = MANIFEST.keywords.filter((keyword) => WRITING.test(keyword));
    expect(promising, 'a keyword advertising a writer edfcore does not have').toEqual([]);
  });

  it('are shaped the way npm and a reader both want them', () => {
    expect(MANIFEST.keywords.length).toBeGreaterThan(8);
    expect(new Set(MANIFEST.keywords).size).toBe(MANIFEST.keywords.length);
    for (const keyword of MANIFEST.keywords) {
      expect(keyword, 'a keyword with a space or a capital in it').toBe(keyword.toLowerCase());
      expect(keyword).not.toContain(' ');
    }
  });
});

describe('the description, which is the npm page', () => {
  it('calls the package a reader', () => {
    expect(MANIFEST.description.toLowerCase()).toContain('reader');
    expect(WRITING.test(MANIFEST.description)).toBe(false);
  });

  it('names the four formats, so the page says what it opens', () => {
    expect(MANIFEST.description).toContain('EDF, EDF+, BDF and BDF+');
  });
});

describe('and the four places that state the constraint', () => {
  it('is in the design record, with its own heading and its reason', () => {
    const page = (DOCS_PAGES.get('design-decisions.md') ?? '').replace(/\s+/g, ' ');
    expect(page).toContain('## Read-only through 1.0');
    expect(page).toContain('edfcore does not write EDF, and will not before 1.0');
    // The part that stops it reading as an oversight.
    expect(page).toContain('A writer exists in the test suite and is not exported');
  });

  it('is in the comparison, which sends a would-be writer somewhere that can', () => {
    const page = (DOCS_PAGES.get('comparison.md') ?? '').replace(/\s+/g, ' ');
    expect(page).toContain('edfcore does not write EDF either, and will not before 1.0');
    expect(page).toContain('pyEDFlib and EDFlib both write EDF');
  });

  it('is in the README, among the reasons not to install it', () => {
    expect(README).toContain('edfcore is read-only through 1.0');
  });

  it('is in AGENTS.md, where an agent reads it before proposing one', () => {
    expect(AGENTS).toContain('read-only through 1.0');
  });

  it('opens the README by saying what it does instead', () => {
    expect(README).toContain('edfcore reads EDF, EDF+, BDF and BDF+ biosignal files');
  });
});
