/**
 * `tests/README.md` describes this suite, and nothing checked that it still does.
 *
 * It is the page a contributor is sent to — the root README links to it, and the fixture policy
 * it states is the reason six binary files are committed to a repository that otherwise builds
 * every fixture in memory. Two of its claims are inventories, which is the shape this project
 * keeps having to fix: a table with one row per directory under `tests/`, and a count of the
 * files under `corpus/golden/` stated four times across two READMEs.
 *
 * Neither was derived. A new directory would appear in the suite and not in the table, and the
 * one number that justifies committing binaries would drift the way the README's page count did
 * (0.4.238) and the API surface table did before it was checked.
 *
 * The counts are spelled out in the prose, so they are read through a small word list rather than
 * rewritten as digits. That is the right way round here: `tests/README.md` is prose a person
 * reads start to finish, unlike the one-line parenthetical 0.4.238 turned into a numeral.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');

const TESTS_README = read('../README.md');
const ROOT_README = read('../../README.md');

const NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
]);

/** Directories under `tests/`, which is what the layout table has one row per. */
const DIRECTORIES = readdirSync(new URL('../', import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `${entry.name}/`)
  .sort();

/** The `| \`unit/\` | … |` rows of the layout table, first column only. */
const TABLE_ROWS = [...TESTS_README.matchAll(/^\| `([a-z]+\/)` \| /gm)].map(
  (match) => match[1] as string,
);

/** The committed EDF/BDF fixtures. Everything else under `golden/` is a JSON expectation file. */
const GOLDEN_FIXTURES = readdirSync(new URL('../corpus/golden/', import.meta.url)).filter(
  (name) => !name.endsWith('.json'),
);

/** Every "six … `corpus/golden/`" style claim, from both READMEs, as a number. */
const CLAIMED_COUNTS: ReadonlyArray<{ readonly where: string; readonly count: number }> = [
  { name: 'tests/README.md', text: TESTS_README },
  { name: 'README.md', text: ROOT_README },
].flatMap(({ name, text }) => {
  // Whitespace-flattened first: every one of these claims wraps across two lines in the source.
  // Anchored on the mention and read BACKWARDS to the nearest number word, rather than forwards
  // from a word: a forward search matches at the earliest position that can reach the mention,
  // which is some ordinary word in between and never the count.
  const flat = text.replace(/\s+/g, ' ');
  const found: Array<{ where: string; count: number }> = [];
  // The trailing slash matters: `corpus/golden-values.test.ts` is a different thing, mentioned
  // twice in the root README, and both times a stray "one ULP is a failure" sits behind it.
  for (const mention of flat.matchAll(/corpus\/golden\//g)) {
    const window = flat.slice(Math.max(0, (mention.index ?? 0) - 100), mention.index);
    // One sentence only. "…so one ULP is a failure. Nothing in `tests/corpus/golden/`" counts
    // nothing, and reading past the full stop would take the previous sentence's number.
    const before = window.slice(window.lastIndexOf('. ') + 1);
    const words = [...before.matchAll(/\b([a-z]+)\b/g)]
      .map((word) => word[1] as string)
      .filter((word) => NUMBER_WORDS.has(word));
    const nearest = words[words.length - 1];
    if (nearest === undefined) continue;
    found.push({
      where: `${name}: "${nearest} … corpus/golden"`,
      count: NUMBER_WORDS.get(nearest) as number,
    });
  }
  return found;
});

describe('the layout table has one row per directory', () => {
  it('found the table, so a passing run is not a vacuous one', () => {
    expect(TABLE_ROWS.length).toBeGreaterThan(4);
    expect(DIRECTORIES.length).toBeGreaterThan(4);
  });

  it('names every directory and no directory that is gone', () => {
    expect([...TABLE_ROWS].sort()).toEqual(DIRECTORIES);
  });
});

describe('the committed fixture count', () => {
  it('found the fixtures and the claims', () => {
    expect(GOLDEN_FIXTURES.length).toBeGreaterThan(0);
    // Stated three times in tests/README.md and once in the root README.
    expect(CLAIMED_COUNTS.length).toBeGreaterThanOrEqual(4);
  });

  it('is what is actually committed', () => {
    const wrong = CLAIMED_COUNTS.filter(({ count }) => count !== GOLDEN_FIXTURES.length).map(
      ({ where }) => where,
    );
    expect(wrong, `corpus/golden/ holds ${GOLDEN_FIXTURES.length} EDF/BDF files`).toEqual([]);
  });
});
