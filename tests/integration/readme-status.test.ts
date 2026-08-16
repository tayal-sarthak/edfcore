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
import { DOCS_PAGES } from '../support/docs-pages.js';

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');

const README = read('../../README.md');
const VERSION = (JSON.parse(read('../../package.json')) as { version: string }).version;

/**
 * Every documentation page, from the shared reader rather than from a `readdirSync` of `*.md`.
 * The collection loads `**\/*.{md,mdx}`, and both sweeps below used to take the narrower set —
 * see `tests/support/docs-pages.ts`.
 */
const PAGES = [...DOCS_PAGES].map(([name, text]) => ({ name, text }));

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

describe('the shipped .d.ts states no version this package is not at', () => {
  /**
   * `config/tsconfig.build.json` sets `removeComments: false`, so every docblock in `src/` is copied
   * verbatim into `dist/*.d.ts` and becomes the hover text an editor shows. `src/node.ts` said
   * "edfcore has no other lifetime mechanism in v0.1" — the exact scoping 0.3.64 removed from three
   * website pages, still shipping to every consumer of `edfcore/node` (fixed in 0.3.84).
   *
   * The website sweep above cannot see these, so this is the same rule applied to the other half of
   * what is published.
   */
  const SOURCES = (function collect(dir: URL, into: Array<{ name: string; text: string }>) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) collect(child, into);
      else if (entry.name.endsWith('.ts'))
        into.push({ name: entry.name, text: read(child.pathname) });
    }
    return into;
  })(new URL('../../src/', import.meta.url), []);

  it('finds the sources', () => {
    expect(SOURCES.length).toBeGreaterThan(20);
  });

  it('scopes no present-tense claim to a past series', () => {
    const [major, minor] = VERSION.split('.');
    const offenders: string[] = [];
    for (const { name, text } of SOURCES) {
      // "in v0.1", "in 0.2" — a claim about what the package currently is, tied to a dead series.
      for (const match of text.matchAll(/\bin v?(\d+\.\d+)\b(?!\.\d)/g)) {
        if (match[1] !== `${major}.${minor}`) offenders.push(`${name}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the node subpath states the reachability invariant the right way round', () => {
  /**
   * The packaging invariant is that NOTHING the universal entry can reach imports `node:` — that is
   * what lets `edfcore` bundle for a browser. 0.3.84 replaced one wrong sentence with another that
   * asserted the opposite ("the only module REACHABLE FROM THE UNIVERSAL ENTRY that imports
   * anything from `node:`"), contradicting the paragraph four lines below it (fixed in 0.3.103).
   */
  const NODE_SRC = read('../../src/node.ts');

  /**
   * The HEADLINE only — the paragraph before the history note.
   *
   * The note quotes both retired sentences on purpose, so a whole-file match finds the quotation
   * rather than the claim. The first version of this guard did exactly that, which is the same trap
   * 0.3.78 fell into.
   */
  const headline = NODE_SRC.slice(0, NODE_SRC.indexOf('Two wordings have been wrong here'));

  it('finds the headline', () => {
    expect(headline).not.toBe('');
    expect(headline).toContain('The Node adapters');
  });

  it('does not describe itself as reachable from the universal entry', () => {
    expect(headline).not.toMatch(/REACHABLE FROM THE UNIVERSAL ENTRY/i);
    expect(headline).toMatch(/NOT reachable from the universal/i);
  });

  it('and nothing the universal entry reaches imports this module', () => {
    // The invariant itself, checked against the source rather than against the sentence.
    const files: Array<{ name: string; text: string }> = [];
    const collect = (dir: URL, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) collect(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
        else if (entry.name.endsWith('.ts')) {
          files.push({
            name: `${prefix}${entry.name}`,
            text: read(new URL(entry.name, dir).pathname),
          });
        }
      }
    };
    collect(new URL('../../src/', import.meta.url), '');
    expect(files.length).toBeGreaterThan(20);

    // `node.ts` is the module itself; `cli.ts` is the `bin` entry, which no import path reaches.
    const importers = files
      .filter(({ name }) => name !== 'node.ts' && name !== 'cli.ts')
      .filter(({ text }) => /from '\.{1,2}\/(?:[\w./-]*\/)?node\.js'/.test(text))
      .map(({ name }) => name);
    expect(importers).toEqual([]);
  });
});

describe('nothing claims one file in the PACKAGE holds every node: import', () => {
  /*
   * The true statement is about REACHABILITY, and 0.3.84 corrected four places to say so. It
   * missed two pages saying the package-wide version instead — "the only module in the package
   * that imports a Node built-in (`node:fs/promises`, and nothing else)" and "the only module in
   * the package that imports anything from `node:`" — plus `src/index.ts`, which ships in
   * `dist/index.d.ts`. `src/cli.ts` imports two Node built-ins and is the package's `bin`, inside
   * the published `files` list, so all three were false (fixed in 0.3.109).
   *
   * Anchored to the code below, not only to three sentences: the premise is that two modules in
   * `src/` import `node:` and that the second is unreachable from the universal entry.
   */
  const SOURCES = (() => {
    const found: Array<{ name: string; text: string }> = [];
    const walk = (dir: URL, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
        else if (entry.name.endsWith('.ts')) {
          found.push({
            name: `${prefix}${entry.name}`,
            text: read(new URL(entry.name, dir).pathname),
          });
        }
      }
    };
    walk(new URL('../../src/', import.meta.url), '');
    return found;
  })();

  it('is a claim about more than one module, in the source', () => {
    // The premise. If a future refactor really did leave one importer, this test says so and the
    // sentences below become sayable again.
    const importers = SOURCES.filter(({ text }) =>
      /^\s*import[^;]*from '(node:[\w/]+)'/m.test(text),
    ).map(({ name }) => name);
    expect(importers.sort()).toEqual(['cli.ts', 'node.ts']);
  });

  it('says none of it in a doc page or a shipped docblock', () => {
    // Whitespace-normalised, so a wrapped docblock and a prose line are matched the same way.
    const claim =
      /only (?:module|file) in (?:the|this) package[^.]{0,60}imports|(?:keeping|keep) (?:that|the) import in exactly one file/i;
    for (const { name, text } of [...PAGES, ...SOURCES]) {
      const flat = text.replace(/^\s*\*\s?/gm, ' ').replace(/\s+/g, ' ');
      expect(flat, `${name} states the package-wide version`).not.toMatch(claim);
    }
  });
});

/**
 * The site's own source is the surface nothing else sweeps: `PAGES` above reads only the markdown
 * under `content/docs/`, and `astro check` validates types and content collections rather than
 * prose. The footer therefore read "MIT licensed. Version 0.1.0." through the whole 0.2, 0.3 and
 * 0.4 history, and no run of `npm run check` could have said so (fixed in 0.4.26 by rendering
 * `VERSION`). A version belongs in a site file only as that import.
 *
 * `.astro` was too narrow for that sentence. `website/src/pages/` also holds seven `.ts` routes,
 * and they emit prose the same way a component does: `llms.txt` is the map an agent is handed,
 * `[...slug].md.ts` is the markdown twin of every page, `robots.txt` and `api.json` are served
 * verbatim. A stale version in one of those reaches a reader exactly as the footer did.
 *
 * Comments are excluded, and that is the whole reason this could not simply be widened.
 * `api.json.ts` quotes the footer defect — "the site footer that said 'Version 0.1.0' through
 * three minor series" — as the reason it counts the surface instead of stating it. A whole-file
 * match finds the quotation rather than a claim, which is the trap the node-subpath guard above
 * documents. What a file EMITS is the claim; what it says about the past is history.
 */
describe('the site states no version of its own', () => {
  /** JS-style comments only. HTML comments are left alone: those ship to the browser. */
  const withoutComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  const SITE = (function collect(dir: URL, into: Array<{ name: string; text: string }>) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) collect(child, into);
      else if (/\.(astro|ts)$/.test(entry.name))
        into.push({ name: entry.name, text: withoutComments(read(child.pathname)) });
    }
    return into;
  })(new URL('../../website/src/', import.meta.url), []);

  it('finds the components and the routes', () => {
    expect(SITE.length).toBeGreaterThan(10);
    expect(SITE.map(({ name }) => name)).toContain('llms.txt.ts');
    // The stripper must remove comments and nothing else: the footer still renders `VERSION`.
    expect(SITE.find(({ name }) => name === 'Footer.astro')?.text).toContain('VERSION');
  });

  it.each(SITE.map(({ name }) => ({ name })))('$name hard-codes no version', ({ name }) => {
    const text = SITE.find((one) => one.name === name)?.text ?? '';
    expect(text).not.toMatch(/\bv(?:ersion)?[\s:]*\d+\.\d+\.\d+/i);
  });
});
