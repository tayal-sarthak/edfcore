/**
 * `migrating-to-0-3.md` is a set of instructions, and instructions can be run.
 *
 * The page is one table and one `sed` recipe: three functions were renamed in 0.3.0 and, for a
 * contiguous recording, a find-and-replace is the whole migration. Nothing in the suite read it.
 *
 * Both halves can go stale in a way a reader cannot detect. The table names six symbols, and a
 * page that still advertises an old name — or a barrel that quietly kept one alive — turns the
 * migration into a no-op that looks like it worked. And the recipe is a script someone will paste:
 * the page warns in the very next paragraph that `sampleStartTicks` is a prefix of
 * `sampleStartTicksOf` and that a substring replace would damage the second, so the `\b` anchors
 * are load-bearing rather than stylistic.
 *
 * So the replacements are lifted out of the page's own fence and run, over text containing exactly
 * the collision the page warns about. As regexes rather than by shelling out to `sed`, whose `-i`
 * takes an argument on BSD and not on GNU — the claim being checked is what the substitution does,
 * not which sed is installed.
 */

import { describe, expect, it } from 'vitest';
import * as edfcore from '../../src/index.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

const PAGE = DOCS_PAGES.get('migrating-to-0-3.md') ?? '';
const EXPORTS = new Set(Object.keys(edfcore));

/** The `| `old` | `new` |` rows of the rename table. */
const RENAMES = [...PAGE.matchAll(/^\| `(\w+)` \| `(\w+)` \|$/gm)].map(
  ([, from = '', to = '']) => ({
    from,
    to,
  }),
);

describe('the rename table', () => {
  it('lists the three the page says were renamed', () => {
    expect(RENAMES).toHaveLength(3);
    expect(PAGE).toContain('Three functions were renamed in 0.3.0');
  });

  it('names a new symbol that the package exports', () => {
    for (const { to } of RENAMES) expect(EXPORTS.has(to), to).toBe(true);
  });

  it('names an old symbol that the package no longer exports', () => {
    // The half that makes the migration real. A barrel still carrying `sampleIndexAt` would let
    // an unmigrated call site keep working, so nobody would migrate and the page would be fiction.
    for (const { from } of RENAMES) expect(EXPORTS.has(from), from).toBe(false);
  });

  it('renamed only these, and removed nothing else', () => {
    // "No other export is removed or renamed." The recording-aware forms the page sends EDF+D
    // callers to are the ones most easily mistaken for the renamed grid functions.
    expect(PAGE).toContain('No other export is removed or renamed.');
    for (const name of ['sampleAt', 'sampleStartTicksOf', 'sampleStartSecondsOf', 'contiguityOf']) {
      expect(EXPORTS.has(name), name).toBe(true);
    }
  });
});

describe('the find-and-replace the page hands you', () => {
  /** The `s/\bfrom\b/to/g` expressions inside the page's `sed` fence. */
  const SUBSTITUTIONS = [...PAGE.matchAll(/-e 's\/\\b(\w+)\\b\/(\w+)\/g'/g)].map(
    ([, from = '', to = '']) => ({ from, to }),
  );

  /** The recipe, applied the way sed would apply it. */
  const migrate = (source: string): string =>
    SUBSTITUTIONS.reduce(
      (text, { from, to }) => text.replaceAll(new RegExp(`\\b${from}\\b`, 'g'), to),
      source,
    );

  it('has one substitution per row of the table, in the same direction', () => {
    expect(SUBSTITUTIONS).toEqual(RENAMES);
  });

  it('migrates a call site to a name the package exports', () => {
    const before = RENAMES.map(({ from }) => `${from}(signal, 12, d);`).join('\n');
    const after = migrate(before);
    for (const { from, to } of RENAMES) {
      expect(after).toContain(`${to}(signal, 12, d);`);
      expect(after).not.toContain(`${from}(`);
      expect(EXPORTS.has(to)).toBe(true);
    }
  });

  it('leaves the longer name the page warns about untouched', () => {
    // "`sampleStartTicks` and `sampleStartTicksOf` are distinct names and a substring replace
    //  would damage the second. The `\\b` word boundaries above are what prevent that."
    const source = [
      'sampleStartTicksOf(recording, eeg.index, 940);',
      'sampleStartSecondsOf(recording, eeg.index, 940);',
    ].join('\n');
    expect(migrate(source)).toBe(source);
    // And the collision is real rather than imagined: both names exist in this package.
    expect(EXPORTS.has('sampleStartTicksOf')).toBe(true);
    expect(EXPORTS.has('gridSampleStartTicks')).toBe(true);
  });

  it('would damage it without the boundaries, which is why they are there', () => {
    // The same recipe with `\\b` dropped, to show the warning is about this recipe rather than a
    // general caution. `sampleStartTicksOf` becomes `gridSampleStartTicksOf`, which is not a name.
    const naive = SUBSTITUTIONS.reduce(
      (text, { from, to }) => text.replaceAll(from, to),
      'sampleStartTicksOf(recording, eeg.index, 940);',
    );
    expect(naive).toContain('gridSampleStartTicksOf');
    expect(EXPORTS.has('gridSampleStartTicksOf')).toBe(false);
  });
});
