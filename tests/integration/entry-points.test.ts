/**
 * What `installation.md` says each entry point contains, and the exports map it prints verbatim.
 *
 * The page names roughly twenty functions across three paragraphs — the parser, the time layer,
 * the convenience layer, the runtime-independent adapters — as the answer to "what do I get if I
 * import this". A name in that list that is not an export sends a reader to an import error on
 * their first line, which is the worst possible first minute with a package.
 *
 * The exports map is printed as JSON, which is the strongest form of a copy and the easiest to let
 * drift: it is not a description of `package.json`, it is `package.json`, retyped. `publint` and
 * `packaging-claims.test.ts` check the real map for shape and for the absence of environment
 * conditions; neither can see that the page prints the same three entries.
 *
 * "Two functions" for `edfcore/node` is checked as an exact count rather than a floor. That entry
 * point exists to be the only thing a browser build must not reach, and every name added to it is
 * another thing a bundler has to be kept away from.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as edfcore from '../../src/index.js';
import * as edfcoreNode from '../../src/node.js';
import * as edfcoreValidate from '../../src/validate.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

const PAGE = DOCS_PAGES.get('installation.md') ?? '';
const FLAT = PAGE.replace(/\s+/g, ' ');
const MANIFEST = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { exports: Record<string, unknown> };

describe('the universal entry point', () => {
  /** Every backticked name in the paragraph listing what `edfcore` gives you. */
  const NAMED = (() => {
    const at = FLAT.indexOf('It gives you the parser');
    if (at === -1)
      throw new Error('installation.md no longer lists what the universal entry gives');
    const sentence = FLAT.slice(at, FLAT.indexOf('### `edfcore/node`'));
    return [...sentence.matchAll(/`(\w+)`/g)].map(([, name = '']) => name);
  })();

  it('names a substantial number of them', () => {
    expect(NAMED.length).toBeGreaterThan(12);
  });

  it('names only things the universal entry exports', () => {
    for (const name of NAMED) {
      expect(Object.keys(edfcore), name).toContain(name);
    }
  });

  it('names nothing that lives behind edfcore/node', () => {
    // The claim the whole browser story rests on: this list is safe to import in a tab.
    const nodeOnly = Object.keys(edfcoreNode).filter(
      (name) => !Object.keys(edfcore).includes(name),
    );
    expect(nodeOnly.length).toBeGreaterThan(0);
    for (const name of nodeOnly) expect(NAMED, name).not.toContain(name);
  });
});

describe('the node entry point', () => {
  it('is the two functions the page counts', () => {
    // "Two functions." Exact rather than a floor: this is the only module a browser build must not
    // reach, so every name added to it is another thing a bundler has to be kept away from.
    expect(FLAT).toContain('### `edfcore/node` (filesystem adapters) Two functions.');
    const own = Object.keys(edfcoreNode).filter((name) => !Object.keys(edfcore).includes(name));
    expect(own.sort()).toEqual(['fileHandleSource', 'fileSource']);
  });

  it('names both of them in the import the page prints', () => {
    // Scoped to the section: the page imports `fileSource` alone in an earlier example, and a
    // page-wide match finds that one first.
    const section = PAGE.slice(PAGE.indexOf('### `edfcore/node`'));
    const printed = /import \{ ([^}]+) \} from 'edfcore\/node';/.exec(section);
    expect(printed).not.toBeNull();
    expect(
      (printed?.[1] ?? '')
        .split(',')
        .map((name) => name.trim())
        .sort(),
    ).toEqual(['fileHandleSource', 'fileSource']);
  });
});

describe('the validate entry point', () => {
  it('exports the two functions the page imports', () => {
    const section = PAGE.slice(PAGE.indexOf('### `edfcore/validate`'));
    const printed = /import \{ ([^}]+) \} from 'edfcore\/validate';/.exec(section);
    expect(printed).not.toBeNull();
    for (const name of (printed?.[1] ?? '').split(',').map((entry) => entry.trim())) {
      expect(Object.keys(edfcoreValidate), name).toContain(name);
    }
  });

  it('changes no sample, which is the dividing line the page draws', () => {
    // "A consumer who never imports this module reads exactly the same samples." Structural: the
    // universal entry does not reach this module, so nothing on the read path can be affected by
    // whether it was imported.
    expect(FLAT).toContain(
      'A consumer who never imports this module reads exactly the same samples',
    );
    const validateOnly = Object.keys(edfcoreValidate).filter(
      (name) => !Object.keys(edfcore).includes(name),
    );
    expect(validateOnly.length).toBeGreaterThan(0);
    for (const name of validateOnly) expect(Object.keys(edfcore), name).not.toContain(name);
  });
});

describe('the exports map the page prints', () => {
  /** The JSON block, parsed. It is `package.json` retyped, so it parses or the page is broken. */
  const PRINTED = (() => {
    const block = /```json\n([\s\S]*?)```/.exec(PAGE);
    if (block === null) throw new Error('installation.md no longer prints the exports map');
    return JSON.parse(block[1] ?? '{}') as Record<string, unknown>;
  })();

  it('is the map the manifest declares, entry for entry', () => {
    for (const [subpath, target] of Object.entries(PRINTED)) {
      expect(MANIFEST.exports[subpath], subpath).toEqual(target);
    }
  });

  it('prints every subpath a consumer imports', () => {
    // `./package.json` is deliberately not in the block and is mentioned in prose beneath it.
    expect(Object.keys(PRINTED).sort()).toEqual(['.', './node', './validate']);
    expect(FLAT).toContain('`./package.json` is also exported');
    expect(Object.keys(MANIFEST.exports)).toContain('./package.json');
  });

  it('carries none of the six conditions the page names', () => {
    const named = /has no ((?:`"\w+"`(?:, | or )?)+) conditions/.exec(FLAT);
    expect(named).not.toBeNull();
    const conditions = [...(named?.[1] ?? '').matchAll(/`"(\w+)"`/g)].map(([, name = '']) => name);
    expect(conditions).toHaveLength(6);
    const serialised = JSON.stringify(MANIFEST.exports);
    for (const condition of conditions) {
      expect(serialised, condition).not.toContain(`"${condition}"`);
    }
  });
});
