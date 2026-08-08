/**
 * No page states a version this package is not at.
 *
 * The README's status line is the first thing a reader sees on npm. It said "Status: 0.1.x, early"
 * through fifty-one releases and two minor versions, so the front page of the package announced a
 * series nobody could install (fixed in 0.3.53).
 *
 * The website carried the same rot for longer: `installation.md` said "edfcore is at 0.1.0",
 * `api-primitives.md` said "`VERSION` is `'0.1.0'` at the time of writing", and `concepts.md` said
 * the pyEDFlib comparison harness "does not exist yet in 0.1" while linking, in the same sentence,
 * to the page that says it has existed since 0.2.34-0.2.48 (fixed in 0.3.64).
 *
 * Everything is checked against `package.json`, which moves on its own every release. A claim
 * nothing checks is a claim that goes stale silently, which is the entire failure mode here.
 *
 * Historical references — "renamed in 0.3.0", "fixed in 0.2.63", "since 0.2.34-0.2.48" — are past
 * tense and correct forever, so only PRESENT-TENSE assertions are matched below.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');

const README = read('../../README.md');
const VERSION = (JSON.parse(read('../../package.json')) as { version: string }).version;

/** The `**Status: X.Y.x, ...**` line. */
const STATUS = /\*\*Status: (\d+)\.(\d+)\.x/.exec(README);

describe('the README status line', () => {
  it('is present and parses', () => {
    // Without this, the assertion below would be vacuously true if the line were reworded away.
    expect(STATUS).not.toBeNull();
  });

  it('names the series this package actually publishes', () => {
    const [major, minor] = VERSION.split('.');
    expect(STATUS?.[1]).toBe(major);
    expect(STATUS?.[2]).toBe(minor);
  });
});

describe('the docs state no version this package is not at', () => {
  const PAGES = readdirSync(new URL('../../website/src/content/docs/', import.meta.url))
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({
      name,
      text: read(`../../website/src/content/docs/${name}`),
    }));

  it('finds the pages', () => {
    expect(PAGES.length).toBeGreaterThan(10);
  });

  it.each(PAGES.map(({ name }) => ({ name })))(
    '$name says no stale "is at" version',
    ({ name }) => {
      const page = PAGES.find((p) => p.name === name)?.text ?? '';
      const claims = [...page.matchAll(/edfcore is at (\d+\.\d+\.\d+)/g)].map((m) => m[1]);
      expect(claims.filter((claimed) => claimed !== VERSION)).toEqual([]);
    },
  );

  it.each(PAGES.map(({ name }) => ({ name })))(
    '$name scopes no claim to a past series',
    ({ name }) => {
      const page = PAGES.find((p) => p.name === name)?.text ?? '';
      const [major, minor] = VERSION.split('.');
      // "in 0.1", "in 0.2" — a present-tense claim scoped to a series that is no longer this one.
      const scoped = [...page.matchAll(/\bin (\d+\.\d+)\b(?!\.\d)/g)]
        .map((m) => m[1] as string)
        .filter((series) => series !== `${major}.${minor}`);
      expect(scoped).toEqual([]);
    },
  );
});
