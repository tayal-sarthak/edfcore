/**
 * The changelog accounts for every version number, including the ones that were never released.
 *
 * A release run that failed after bumping used to consume a number: the version moved, a check
 * stopped the run, and the next one produced a different version. Four numbers went that way before
 * 0.4.200 began putting the bump back. Each still gets an entry saying so, because a reader
 * comparing `npm view` against this file otherwise finds a hole and cannot tell a lost number from
 * a missing note.
 *
 * 0.2.29 broke that rule for months (0.4.194). It was the first of the four and the only one with
 * no entry — while the 0.2.36 entry cited it as the precedent for its own, and the guidance printed
 * by `scripts/release.mjs` listed it among the numbers that had been recorded. Two places pointed
 * at it as an example of the rule being followed, and it was the counter-example.
 *
 * This is checked against the file alone rather than against `git tag`, deliberately. CI checks out
 * at depth 1 and fetches no tags, so a tag-based version would find none and pass while asserting
 * nothing — the vacuous-guard failure this repository has already shipped once.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CHANGELOG = readFileSync(new URL('../../docs/CHANGELOG.md', import.meta.url), 'utf8');

type Version = readonly [number, number, number];

const VERSIONS: readonly Version[] = [...CHANGELOG.matchAll(/^## (\d+)\.(\d+)\.(\d+)$/gm)].map(
  (match) => [Number(match[1]), Number(match[2]), Number(match[3])] as const,
);

const show = (version: Version): string => version.join('.');

describe('the changelog version sequence', () => {
  it('parsed the file, so a passing run is not a vacuous one', () => {
    // A regex that stopped matching would make every assertion below trivially true.
    expect(VERSIONS.length).toBeGreaterThan(400);
    expect(show(VERSIONS[VERSIONS.length - 1] as Version)).toBe('0.1.0');
  });

  it('runs newest to oldest with no repeats', () => {
    const outOfOrder = VERSIONS.flatMap((version, i) => {
      const next = VERSIONS[i + 1];
      if (next === undefined) return [];
      const descends =
        version[0] > next[0] ||
        (version[0] === next[0] &&
          (version[1] > next[1] || (version[1] === next[1] && version[2] > next[2])));
      return descends ? [] : [`${show(version)} then ${show(next)}`];
    });
    expect(outOfOrder).toEqual([]);
  });

  it('skips no number, so a consumed one has to be written down', () => {
    const holes = VERSIONS.flatMap((version, i) => {
      const older = VERSIONS[i + 1];
      if (older === undefined) return [];
      const sameLine = version[0] === older[0] && version[1] === older[1];
      // Within a minor line the patch steps by one; a new line opens at .0.
      const contiguous = sameLine ? version[2] === older[2] + 1 : version[2] === 0;
      return contiguous ? [] : [`${show(older)} -> ${show(version)}`];
    });
    expect(holes).toEqual([]);
  });
});
