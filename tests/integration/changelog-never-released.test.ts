/**
 * A version number that never reached npm says so at the heading, and says where its work went.
 *
 * Nineteen of the six hundred-odd headings in this file name a version nobody can install. They
 * exist because the alternative is worse: a reader comparing `npm view edfcore versions` against
 * this file finds a hole and cannot tell a lost number from a missing note.
 *
 * `changelog-continuity.test.ts` checks the SEQUENCE — that every number between the first and the
 * last has a heading. What it cannot see is whether a heading tells the truth about itself, and
 * that is the half 0.4.307 was about: fourteen entries had been written before their release
 * failed, so each read exactly like one that shipped, with the correction living in a different
 * entry further up. A reader who lands on `## 0.4.288` never sees that entry. They get a
 * normal-looking changelog for a version `npm install` refuses.
 *
 * So the marker has to be the first thing under the heading, and it has to point forward. Both
 * halves are load-bearing and neither is enforced by anything else:
 *
 *  - **First.** A note further down is a note a reader scrolling to a version does not read.
 *  - **Forward.** "Never released" on its own strands the reader: the work exists, under a number
 *    they now have to search for. Every one of them names it.
 *
 * There are two forms, and they are not stylistic. A version whose number was consumed BEFORE a
 * tag was cut never became public at all; a version that was TAGGED and whose publish run then
 * failed is public on GitHub and absent from npm, which is a different thing to be told. The
 * distinguishing phrase is required of each, so the two cannot quietly merge into one.
 *
 * What this does NOT check: that the named versions really are absent from npm, or that the
 * released ones really are present. The suite is offline, and `changelog-continuity.test.ts`
 * explains why checking against a registry or against `git tag` would assert nothing in CI.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CHANGELOG = readFileSync(new URL('../../docs/CHANGELOG.md', import.meta.url), 'utf8');

interface Entry {
  readonly version: string;
  readonly body: string;
}

/** Every `## X.Y.Z` heading with the text under it, in file order. */
const ENTRIES: readonly Entry[] = (() => {
  const parts = CHANGELOG.split(/^## (\d+\.\d+\.\d+)$/m);
  const found: Entry[] = [];
  for (let at = 1; at < parts.length; at += 2) {
    found.push({ version: parts[at] as string, body: (parts[at + 1] ?? '').trim() });
  }
  return found;
})();

const order = (version: string): number => {
  const [major, minor, patch] = version.split('.').map(Number);
  return (major as number) * 1_000_000 + (minor as number) * 1_000 + (patch as number);
};

const KNOWN = new Set(ENTRIES.map((entry) => entry.version));

/**
 * An entry that opens by saying the version was never released.
 *
 * Deliberately anchored to the START of the body. An entry that merely mentions the phrase — the
 * 0.4.307 entry describes the work of marking the other fourteen — is a released entry, and
 * treating it as one of them is the same mistake in the opposite direction.
 */
const isNever = (entry: Entry): boolean =>
  entry.body.startsWith('Never released') || entry.body.startsWith('> **Never released.**');

const NEVER = ENTRIES.filter(isNever);

/**
 * The marker as a line of its own, wherever it appears in an entry.
 *
 * This matches all nineteen and nothing else, which is what makes it usable as the "is it first?"
 * check below: prose that merely mentions the phrase — the 0.4.307 entry describes the work of
 * marking the other fourteen — says "were never released" mid-sentence and does not match.
 */
const MARKER = /(^|\n)>?\s*\*{0,2}Never released\./;

/**
 * The next version this entry names after its own, if it is close enough to be a pointer.
 *
 * "Where the work went" is always the next release or one a few after it — six is the largest
 * gap in the file, from the run of six consecutive tagged-and-unpublished versions that all
 * shipped in 0.4.293. Twenty is a bound that keeps every real pointer and rejects an incidental
 * mention of some later version, which is what an unbounded search accepts: the 0.2.29 entry
 * names 0.4.194 as the release that wrote it down, and that is not where its work went.
 */
const POINTER_REACH = 20;
const pointsAt = (entry: Entry): readonly string[] =>
  [...entry.body.matchAll(/(\d+\.\d+\.\d+)/g)]
    .map((match) => match[1] as string)
    .filter(
      (version) =>
        order(version) > order(entry.version) &&
        order(version) - order(entry.version) <= POINTER_REACH,
    );

describe('the file was read', () => {
  it('found the headings, so a passing run is not a vacuous one', () => {
    expect(ENTRIES.length).toBeGreaterThan(600);
    expect(NEVER.length).toBeGreaterThan(15);
    // Both forms are in use, which is what the two checks below are about.
    expect(NEVER.filter((entry) => entry.body.startsWith('> ')).length).toBeGreaterThan(5);
    expect(NEVER.filter((entry) => !entry.body.startsWith('> ')).length).toBeGreaterThan(3);
  });

  it('leaves no heading with nothing under it', () => {
    const blank = ENTRIES.filter((entry) => entry.body === '').map((entry) => entry.version);
    expect(blank, 'a version heading with no entry').toEqual([]);
  });

  it('does not mistake the entry that describes the marking for one of the marked', () => {
    // 0.4.307 is the release that added the fourteen notices. It talks about them at length.
    const marker = ENTRIES.find((entry) => entry.version === '0.4.307');
    expect(marker?.body).toContain('never released');
    expect(isNever(marker as Entry)).toBe(false);
  });
});

describe('every version that never reached npm', () => {
  it('says so before anything else, where a reader lands', () => {
    // Scanned by the marker rather than by `NEVER`, which is defined as "starts with it": an
    // entry whose notice sat below its bullets would be absent from `NEVER` and so invisible to
    // a check written in terms of it. Every entry carrying the marker anywhere must open with it.
    const buried = ENTRIES.filter((entry) => MARKER.test(entry.body) && !isNever(entry));
    expect(
      buried.map((entry) => entry.version),
      'the notice is somewhere other than the first thing under the heading',
    ).toEqual([]);
  });

  it('is found by the marker and by the opening alike, so neither check is idle', () => {
    // The two ways of recognising one agree today. If they ever stop, the check above is the one
    // that has become vacuous, and this says so rather than leaving it silently passing.
    expect(ENTRIES.filter((entry) => MARKER.test(entry.body)).length).toBe(NEVER.length);
  });

  it('names a nearby later version that this file also has an entry for', () => {
    const stranded = NEVER.filter((entry) => {
      const forward = pointsAt(entry).filter((version) => KNOWN.has(version));
      return forward.length === 0;
    }).map((entry) => entry.version);
    expect(stranded, 'never released, and no forward pointer to where the work went').toEqual([]);
  });

  it('does so within the reach the bound allows, which is what makes the bound honest', () => {
    // Every pointer in the file is at most six patches ahead. Stated so that raising the bound
    // to accommodate a vague entry is a visible decision rather than a quiet one.
    const distances = NEVER.map((entry) =>
      Math.min(
        ...pointsAt(entry)
          .filter((version) => KNOWN.has(version))
          .map((version) => order(version) - order(entry.version)),
      ),
    );
    expect(Math.max(...distances)).toBeLessThanOrEqual(6);
  });
});

describe('and says which kind of never it was', () => {
  it('tells a tagged failure apart from a consumed number', () => {
    for (const entry of NEVER) {
      // Collapsed: these sentences wrap at 100 columns, and the wrap is not the claim.
      const said = entry.body.replace(/\s+/g, ' ').toLowerCase();
      if (entry.body.startsWith('> ')) {
        // Public on GitHub, absent from npm: the reader may already have the tag in hand.
        expect(said, entry.version).toContain('tagged');
        expect(said, entry.version).toContain('not on npm');
      } else {
        // Never public at all: the bump happened, the checks stopped it, no tag was cut.
        expect(said, entry.version).toMatch(/consumed the number|the bump was already public/);
      }
    }
  });
});
