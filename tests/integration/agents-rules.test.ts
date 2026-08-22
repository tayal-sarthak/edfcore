/**
 * The list AGENTS.md tells an agent not to "fix", and the tests that make it true.
 *
 * "Things that look like bugs and are not" exists because each entry is something a reader
 * improves on sight: the scaling expression has an obviously better rearrangement, `readWindow`
 * returning an array for a continuous file is an obviously unnecessary wrapper, `signal.scale`
 * being optional is an obviously missing default. Every one of them has been proposed, and every
 * one would break something the list names.
 *
 * The section closes with a promise about itself: "Each of the code rules has a test pinning it
 * and a comment explaining why; the last is a fact about the repository rather than about the
 * code, and the offline suite has no way to check a branch on a remote."
 *
 * That sentence is the load-bearing part and nothing checked it. Two ways it stops being true, and
 * both are ordinary:
 *
 *  - A rule is added to the list because someone was bitten by it, and no test comes with it. The
 *    list then reads as if it were enforced, and the next agent removes the thing anyway.
 *  - A test is renamed or folded into another file during a tidy-up. Nothing fails — the rule is
 *    still checked, or it is not, and nobody can tell which from here.
 *
 * So each entry is bound to the file that pins it, and the binding is checked in both directions:
 * a new bullet with no entry fails, and an entry naming a file that no longer exists or no longer
 * mentions the rule fails too. The last bullet is exempt by the sentence's own words, and it is
 * required to STILL be the last one — an exemption that silently covered a code rule would be
 * worse than no check at all.
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const AGENTS = read('AGENTS.md');

/** The bolded opening of each bullet under the section, in the order they appear. */
const RULES: readonly string[] = (() => {
  const section = AGENTS.split('## Things that look like bugs and are not')[1] ?? '';
  const body = section.split('\n## ')[0] ?? '';
  return [...body.matchAll(/^- \*\*(.+?)\*\*/gm)].map((match) => (match[1] as string).trim());
})();

/**
 * Rule → the file that pins it, and a phrase that file has to contain.
 *
 * The phrase is what stops a rename from passing silently: a file can exist and be about something
 * else entirely, and then the binding is a filename rather than a check.
 */
const PINNED: ReadonlyMap<string, { readonly test: string; readonly mentions: string }> = new Map([
  [
    'The scaling expression is `bitValue * (offset + digital)`.',
    { test: 'tests/unit/decode/physical.test.ts', mentions: 'bitValue * (offset + digital)' },
  ],
  [
    '`TextDecoder` is banned outside `src/tal/`.',
    { test: 'tests/integration/text-decoder-ban.test.ts', mentions: 'TextDecoder' },
  ],
  [
    '`readWindow` always returns an array',
    { test: 'tests/integration/discontinuous.test.ts', mentions: 'readWindow' },
  ],
  [
    '`signal.scale` can be `undefined`.',
    { test: 'tests/unit/header/scale.test.ts', mentions: 'scale' },
  ],
  ['No `Date` anywhere.', { test: 'tests/integration/date-ban.test.ts', mentions: 'Date' }],
  [
    'Never `|0`, `<<` or `>>>` on a file offset.',
    { test: 'tests/integration/offset-arithmetic.test.ts', mentions: '>>>' },
  ],
  [
    '`info`-severity diagnostics do not throw under `strict`.',
    { test: 'tests/integration/strict-decision.test.ts', mentions: 'info' },
  ],
]);

/** The one entry the sentence exempts, because it is about a branch on a remote. */
const EXEMPT = 'The `archive/pre-squash-2026-08-16` branch is load-bearing.';

describe('the section', () => {
  it('was found and parsed, so a passing run is not a vacuous one', () => {
    expect(RULES.length).toBeGreaterThan(5);
    expect(RULES).toContain('No `Date` anywhere.');
    expect(RULES).toContain(EXEMPT);
  });

  it('still makes the promise this checks', () => {
    const collapsed = AGENTS.replace(/\s+/g, ' ');
    expect(collapsed).toContain('Each of the code rules has a test pinning it');
    expect(collapsed).toContain(
      'the last is a fact about the repository rather than about the code',
    );
  });

  it('still ends with the entry the promise exempts', () => {
    // Said as "the last", so its position is part of the exemption. A rule appended after it
    // would inherit an excuse written for something else.
    expect(RULES[RULES.length - 1]).toBe(EXEMPT);
  });
});

describe('every code rule on it', () => {
  it('is bound to a test, including any that were added since', () => {
    const unbound = RULES.filter((rule) => rule !== EXEMPT && !PINNED.has(rule));
    expect(unbound, 'a rule on the list with no test bound to it').toEqual([]);
  });

  it('binds nothing that has left the list', () => {
    // A stale entry is a hole: it would let a rule be deleted from AGENTS.md while this file
    // still reports it as covered.
    const orphaned = [...PINNED.keys()].filter((rule) => !RULES.includes(rule));
    expect(orphaned, 'bound here and no longer on the list').toEqual([]);
  });

  it.each([...PINNED.entries()])(
    '%s is pinned by a file that exists and says so',
    (_rule, where) => {
      expect(existsSync(new URL(where.test, ROOT)), `${where.test} is missing`).toBe(true);
      expect(read(where.test)).toContain(where.mentions);
    },
  );
});
