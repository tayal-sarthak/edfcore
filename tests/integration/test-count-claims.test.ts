/**
 * One number for the size of this suite, and it has to keep up with the suite.
 *
 * Three places say how many tests there are: the README's status line, the note at the foot of
 * `installation.md`, and the docblock of `browser-safety.test.ts` explaining why a bare Node
 * global needs a realm of its own. Until 0.4.388 they gave three different figures for one fact,
 * and the smallest of them was eight hundred behind the suite.
 *
 * None of the three was ever false, which is why nothing caught them. A claim of the form "N or
 * more" stays true forever once it is true, and the property that makes it safe is the property
 * that makes it worthless: it can never be wrong, so it is never re-read. What a reader takes
 * from it is a sense of scale, and half the real scale is a wrong impression conveyed in a true
 * sentence.
 *
 * So the figure is checked against the suite in the direction it actually rots — a number left
 * behind while tests are added — and checked for being one figure rather than three.
 *
 * What this does NOT check: that the figure is not an overstatement. The count here is of
 * `it(...)` and `test(...)` declarations read out of the files, and four dozen of them are
 * `it.each(...)`, each expanding at run time to one case per row. So this knows a floor and not
 * the total: vitest reports several hundred more than are written out. A floor is the right side
 * to be wrong on, because a claim that clears it is true of the real total as well — but nothing
 * here would notice a figure inflated past both.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCS_PAGES } from '../support/docs-pages.js';

const ROOT = new URL('../../', import.meta.url);
const TESTS = new URL('../', import.meta.url);

/** Every `it(`, `test(` and `it.each(` in the suite. `scratch/` is gitignored and is not the suite. */
const DECLARED: number = (function count(dir: URL): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name !== 'scratch') total += count(new URL(`${entry.name}/`, dir));
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    const source = readFileSync(new URL(entry.name, dir), 'utf8');
    total += source.match(/^\s*(?:it|test)(?:\.[a-zA-Z]+)*\s*[(`]/gm)?.length ?? 0;
  }
  return total;
})(TESTS);

interface Claim {
  readonly where: string;
  readonly claimed: number;
  readonly text: string;
}

/** A figure, a hedge and the word: `2,000+ tests`, `2,000-odd tests`. */
const CLAIMS: readonly Claim[] = (() => {
  const sources: Array<{ where: string; text: string }> = [
    { where: 'README.md', text: readFileSync(new URL('README.md', ROOT), 'utf8') },
    ...[...DOCS_PAGES].map(([name, text]) => ({ where: name, text })),
  ];
  for (const name of readdirSync(new URL('integration/', TESTS))) {
    if (!name.endsWith('.ts')) continue;
    sources.push({
      where: `tests/integration/${name}`,
      text: readFileSync(new URL(`integration/${name}`, TESTS), 'utf8'),
    });
  }

  const found: Claim[] = [];
  for (const { where, text } of sources) {
    for (const match of text.matchAll(/([\d,]{3,})(?:\+|-odd) tests/g)) {
      found.push({
        where,
        claimed: Number((match[1] as string).replaceAll(',', '')),
        text: match[0],
      });
    }
  }
  return found;
})();

describe('the suite was counted and the claims were found', () => {
  it('found both, so a passing run is not a vacuous one', () => {
    expect(DECLARED).toBeGreaterThan(1_000);
    expect(CLAIMS.length).toBeGreaterThanOrEqual(3);
    expect(new Set(CLAIMS.map((claim) => claim.where)).size).toBeGreaterThanOrEqual(3);
    // One in the README, one on the site, one in a test's own docblock: the three kinds of place
    // this claim gets made, and the last is the one nobody would think to look at.
    expect(CLAIMS.some((claim) => claim.where === 'README.md')).toBe(true);
    expect(CLAIMS.some((claim) => claim.where.startsWith('tests/'))).toBe(true);
  });
});

describe('how many tests there are', () => {
  it('is one figure, wherever it is stated', () => {
    const distinct = new Set(CLAIMS.map((claim) => claim.claimed));
    expect(
      [...distinct],
      CLAIMS.map((claim) => `${claim.where}: ${claim.text}`).join('\n'),
    ).toHaveLength(1);
  });

  it.each(CLAIMS.map((claim) => [claim.where, claim.claimed] as const))(
    '%s says %d, which the suite has not yet outgrown',
    (_where, claimed) => {
      // The direction that rots. When the written-out cases pass the figure, this fails and says
      // which page to raise — rather than the figure quietly describing a smaller repository.
      expect(claimed).toBeGreaterThanOrEqual(DECLARED);
    },
  );
});
