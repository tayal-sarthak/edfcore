/**
 * One licence, said in five places, and the file that makes it binding.
 *
 * `package.json` declares `"license": "MIT"`, which is the string npm indexes, GitHub's sidebar
 * reads, and every corporate approval process greps for. `LICENSE` is the only one of the five
 * that grants anything — the other four describe it. A hospital IT department that will not
 * install unvetted code reads the manifest field; the lawyer they escalate to reads the file.
 *
 * The failure is not that someone changes the licence. It is that someone changes one copy: a
 * relicensing that updates `LICENSE` and leaves the manifest saying MIT ships a package whose two
 * statements of its own terms disagree, which is worse than either being wrong on its own.
 *
 * The holder is the same shape of coupling. `package.json` names an `author`, `LICENSE` names a
 * copyright holder, and the README's licence line names one too. They are three hand-typed copies
 * of one name.
 *
 * The body is checked as well as the heading, because a truncated `LICENSE` is still a `LICENSE`:
 * the grant and the warranty disclaimer are the two clauses that make it MIT rather than a
 * heading over an empty file. A `LICENSE` that lost its disclaimer is a licence someone could
 * argue carries a warranty.
 *
 * What this does NOT check: the copyright year. There is no `Date` in this repository — see
 * `date-ban.test.ts` — and a year assertion is a test that fails on the first of January for no
 * reason anyone would want.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const LICENCE = read('LICENSE');
const README = read('README.md');
const MANIFEST = JSON.parse(read('package.json')) as { license: string; author: string };

/** The four clauses that make the MIT text what it is, rather than a heading over nothing. */
const MIT_CLAUSES = [
  'Permission is hereby granted, free of charge',
  'without restriction, including without limitation the rights',
  'The above copyright notice and this permission notice shall be included in all',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND',
] as const;

describe('the file that grants it', () => {
  it('names the licence the manifest declares', () => {
    // SPDX `MIT` in the manifest, the human heading in the file.
    expect(MANIFEST.license).toBe('MIT');
    expect(LICENCE.split('\n')[0]).toBe(`${MANIFEST.license} License`);
  });

  it('names the holder the manifest names as author', () => {
    expect(MANIFEST.author.length).toBeGreaterThan(0);
    expect(LICENCE).toMatch(new RegExp(`^Copyright \\(c\\) \\d{4} ${MANIFEST.author}$`, 'm'));
  });

  it.each(MIT_CLAUSES)('carries the clause: %s', (clause) => {
    expect(LICENCE).toContain(clause);
  });

  it('is the whole text rather than a summary of it', () => {
    // The MIT licence is about 1,070 characters. Anything much shorter has lost a clause the
    // list above does not happen to name.
    expect(LICENCE.length).toBeGreaterThan(1000);
  });
});

describe('and the four places that describe it', () => {
  it('is what the README tells a reader before they install', () => {
    const section = README.slice(README.indexOf('\n## License'));
    expect(section, 'no "## License" section in the README').not.toBe('');
    expect(section).toContain(`${MANIFEST.license} © ${MANIFEST.author}`);
  });

  it('is what the site says on the front page and in every footer', () => {
    expect(read('website/src/pages/index.astro')).toContain(`${MANIFEST.license} licensed.`);
    expect(read('website/src/components/Footer.astro')).toContain(`${MANIFEST.license} licensed.`);
  });

  it('is what the package description does not contradict', () => {
    // The one place a second licence name would be invisible: npm renders the description above
    // the licence badge, so "GPL" in there reads as authoritative to a skimming reader.
    const other = /\b(GPL|LGPL|AGPL|Apache|BSD|MPL|proprietary)\b/i.exec(
      JSON.parse(read('package.json')).description as string,
    );
    expect(other?.[0], 'a second licence named in the package description').toBeUndefined();
  });
});
