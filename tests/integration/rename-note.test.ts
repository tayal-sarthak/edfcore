/**
 * The 0.3.0 rename note is attached to the functions that were actually renamed.
 *
 * `api-helpers.md` documents two families that answer nearly the same question and differ by the
 * thing this package cares most about: the `grid*` functions measure the signal's own sample grid,
 * and the `*Of` functions measure the recording clock. On a discontinuous file
 * `gridSampleStartSeconds(signal, 12, d)` says `3` and `sampleStartSecondsOf(recording, i, 12)`
 * says `10` for the same sample.
 *
 * The "Renamed in 0.3.0" note sat under the `*Of` family, telling a reader migrating from 0.2 that
 * their `sampleStartSeconds` call had become `sampleStartSecondsOf` and that "the behaviour did not
 * change". The rename table in `migrating-to-0-3.md` and the 0.3.0 CHANGELOG entry both say it
 * became `gridSampleStartSeconds`. Following the note moved every answer by the gaps — the exact
 * confusion the rename existed to prevent (fixed in 0.3.50).
 *
 * Everything below is derived from the migration table, so adding a rename fails this test until
 * the note is updated.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');

const MIGRATING = read('../../website/src/content/docs/migrating-to-0-3.md');
const HELPERS = read('../../website/src/content/docs/api-helpers.md');
const CHANGELOG = read('../../CHANGELOG.md');

/** The `| old | new |` rows of the rename table. */
function renames(page: string): ReadonlyArray<readonly [string, string]> {
  return [...page.matchAll(/^\| `(\w+)` \| `(\w+)` \|$/gm)].map(
    (m) => [m[1] as string, m[2] as string] as const,
  );
}

const TABLE = renames(MIGRATING);

describe('the 0.3.0 rename', () => {
  it('reads a non-empty table out of the migration guide', () => {
    expect(TABLE.length).toBeGreaterThan(0);
    expect(TABLE.map(([, to]) => to)).toContain('gridSampleStartSeconds');
  });

  it('is spelled the same way in the CHANGELOG', () => {
    // Two tables, one fact. They drifted apart once already, in a third place.
    const section = CHANGELOG.slice(CHANGELOG.indexOf('\n## 0.3.0\n'));
    for (const [from, to] of TABLE) {
      expect(section, `CHANGELOG 0.3.0 should map ${from}`).toContain(
        `| \`${from}\` | \`${to}\` |`,
      );
    }
  });

  it('names the new functions in the code block the note is attached to', () => {
    // The note documents whichever family the nearest preceding example imports. If that example
    // is the other family's, the note is telling a migrating reader to call the wrong function.
    const noteAt = HELPERS.indexOf('**Renamed in 0.3.0.**');
    expect(noteAt, 'api-helpers.md should carry the rename note').toBeGreaterThan(-1);

    const before = HELPERS.slice(0, noteAt);
    const fenceStart = before.lastIndexOf('```ts');
    const fence = before.slice(fenceStart, before.indexOf('```', fenceStart + 5));

    const missing = TABLE.map(([, to]) => to).filter((to) => !fence.includes(to));
    expect(missing).toEqual([]);
  });

  it('does not attach the note to the recording-aware family', () => {
    // The `*Of` functions are a different family, not the rename. Saying "the behaviour did not
    // change" about them is false on every discontinuous file.
    const noteAt = HELPERS.indexOf('**Renamed in 0.3.0.**');
    const paragraph = HELPERS.slice(noteAt, HELPERS.indexOf('\n\n', noteAt));
    for (const name of ['sampleStartSecondsOf', 'sampleStartTicksOf', 'sampleAt']) {
      // Naming one to contrast the families is fine; claiming it IS the rename is not.
      expect(paragraph).not.toMatch(new RegExp(`became \`?${name}`));
      expect(paragraph).not.toMatch(new RegExp(`These were[^.]*${name}`));
    }
  });

  it('exports the new name and not the old one', () => {
    // The migration table promises the old spellings are gone, not merely deprecated, and that the
    // new ones exist. A table row naming a function nothing exports is a find-and-replace that
    // leaves the reader with an unresolved import.
    const barrel = read('../../src/index.ts');
    for (const [from, to] of TABLE) {
      expect(barrel, `${to} should be exported`).toMatch(new RegExp(`\\b${to}\\b`));
      expect(barrel, `${from} should be gone`).not.toMatch(new RegExp(`\\b${from}\\b`));
    }
  });
});
