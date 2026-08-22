/**
 * Nothing here tells a crawler to stay away.
 *
 * `robots.txt.ts` opens with a decision and its reasoning: everything is open to every crawler,
 * including the AI training crawlers, which is the opposite of the advice usually given. That
 * advice is written for publishers protecting content they sell. An open-source library wants the
 * reverse — being present in a model's training data is the strongest predictor of whether that
 * model later recommends you — so blocking GPTBot or CCBot would be self-harm.
 *
 * It is a strategic decision, argued at length in a comment, and enforced by nothing. Every way of
 * reversing it is a normal-looking edit that no reviewer would flag as a policy change:
 *
 *  - a `Disallow:` line added to `robots.txt` during a "block the AI scrapers" tidy-up,
 *  - `Google-Extended` or `Applebot-Extended` added to look thorough, whose ONLY effect is to opt
 *    out of model training — which is why the docblock says they are deliberately absent,
 *  - a `<meta name="robots" content="noindex">` copied into a layout from a staging site,
 *  - an `X-Robots-Tag` header in `vercel.json`, which overrides the page and the file both.
 *
 * None of them changes anything a visitor sees. The site keeps working, the pages keep rendering,
 * and edfcore quietly stops being citable — first in answers, then in the next model.
 *
 * `check-site-output.mjs` reads the BUILT `robots.txt` and checks one thing about it: that the
 * sitemap it names was emitted. It runs in CI only, after a site build. This is the source-level
 * half, and it runs in `npm run check`.
 *
 * What this does NOT check: that any crawler obeys any of it, or that the sitemap lists every
 * page. `robots.txt` is a request, and the second is what `verify:site` is for.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const ROBOTS = read('website/src/pages/robots.txt.ts');
/** The same file with its comment wrapping collapsed, for the prose assertions. */
const ROBOTS_PROSE = ROBOTS.replace(/\s*\n\s*\*\s?/g, ' ');

/**
 * Every line the generator can put in the response, taken from the `body` array alone.
 *
 * Scanning the whole file for quoted strings does not work: the docblock above is English, and
 * one apostrophe in "a model's training data" shifts the pairing for everything after it — which
 * is how a `Disallow` line added to the body went unseen while this file was being written.
 */
const EMITTED: readonly string[] = (() => {
  const open = ROBOTS.indexOf('const body = [');
  const close = ROBOTS.indexOf('].join(', open);
  return [...ROBOTS.slice(open, close).matchAll(/'([^']*)'/g)].map((match) => match[1] as string);
})();

/** Every file the site ships, so a directive cannot hide in a component. */
const SITE_FILES: readonly string[] = (() => {
  const found: string[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(new URL(`${relative}/`, ROOT), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${relative}/${entry.name}`);
      else if (/\.(astro|ts|js|html)$/.test(entry.name)) found.push(`${relative}/${entry.name}`);
    }
  };
  walk('website/src');
  return found;
})();

/** The two control tokens whose only effect is to opt out of model training. */
const OPT_OUT_TOKENS = ['Google-Extended', 'Applebot-Extended'] as const;

describe('the file that answers a crawler', () => {
  it('was read, so a passing run is not a vacuous one', () => {
    expect(ROBOTS).toContain("'User-agent: *'");
    expect(ROBOTS).toContain("'Allow: /'");
    // And it still points at the sitemap, which is the one thing it has to get right.
    expect(ROBOTS).toContain('sitemap-index.xml');
  });

  it('never emits a Disallow', () => {
    expect(EMITTED, 'the body array was not found').toContain('Allow: /');
    const refusals = EMITTED.filter((line) => /^\s*Disallow:/i.test(line));
    expect(refusals, 'robots.txt would tell a crawler not to come').toEqual([]);
  });

  it('names neither opt-out token, in a directive or anywhere else', () => {
    // Named in the comment as deliberately absent, so their presence anywhere in the file is
    // either the directive itself or a note that has stopped being true.
    for (const token of OPT_OUT_TOKENS) {
      const mentions = ROBOTS.split('\n').filter(
        (line) => line.includes(token) && !line.includes('deliberately absent'),
      );
      expect(mentions, `${token} appears outside the note explaining its absence`).toEqual([]);
    }
  });

  it('still says why, because the reasoning is the only thing stopping the edit', () => {
    expect(ROBOTS_PROSE).toContain('being present in a model');
    expect(ROBOTS_PROSE).toContain('opt OUT of model training');
  });
});

describe('and the pages themselves', () => {
  it('carry no robots meta telling a crawler to skip them', () => {
    const hidden = SITE_FILES.filter((file) => /noindex|nofollow/i.test(read(file))).map(
      (file) => file,
    );
    expect(hidden, 'a page asks not to be indexed').toEqual([]);
  });

  it('are not hidden by a response header either', () => {
    // `X-Robots-Tag` overrides both the page and robots.txt, and lives where nothing else looks.
    expect(read('vercel.json')).not.toContain('X-Robots-Tag');
  });

  it('are found through a sitemap the site actually generates', () => {
    // The integration that emits `sitemap-index.xml`, which is the file robots.txt names.
    const config = read('website/astro.config.mjs');
    expect(config).toContain('sitemap()');
    expect(config).toContain("import sitemap from '@astrojs/sitemap'");
  });
});
