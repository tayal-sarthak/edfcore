/**
 * One browser floor, written down in three places, resting on one compiler setting.
 *
 * `node-floor.test.ts` does this for Node, where `engines.node` is a field a package manager
 * reads and everything else is prose checked against it. The browser floor has no such field.
 * Nothing in `package.json` records it, there is no browserslist, and the three statements of it
 * — the README's compatibility line, the Runtimes table on `installation.md`, and the summary
 * string `llms.txt` hands to an agent — are three independent sentences that happen to agree.
 *
 * So the table is taken as the source, because it is the one with the reasoning printed under it,
 * and the other two are checked against it. A floor raised in one place and not the others tells
 * a reader their browser is supported on one page and unsupported on the next.
 *
 * The last check is the one with teeth. The table's stated basis is "ES2022 syntax, `BigInt`,
 * `Blob.prototype.slice`, and `TextDecoder`", and the first of those is not an observation about
 * the code — it is `target` and `lib` in `config/tsconfig.build.json`. Raising either to ES2023 is
 * a one-word edit that compiles, ships and passes every other test here, and it invalidates all
 * three published floors at once: `Array.prototype.findLast` and `toSorted` arrive in ES2023, and
 * a browser old enough to be on this table is old enough to be without them.
 *
 * What this does NOT check: that 94, 93 and 15.4 are the correct versions for those four features.
 * That is a claim about browser release history, which nothing in this repository can settle —
 * `browser-safety.test.ts` executes the part that is checkable here, which is which globals the
 * shipped bundle touches.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCS_PAGES } from '../support/docs-pages.js';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const INSTALLATION = DOCS_PAGES.get('installation.md') ?? '';
const README = read('README.md');
const LLMS = read('website/src/pages/llms.txt.ts');
const BUILD_CONFIG = read('config/tsconfig.build.json');

/** The `| Runtime | Minimum |` table, as `Chrome, Edge` → `94`. */
const RUNTIMES: ReadonlyMap<string, string> = (() => {
  const at = INSTALLATION.indexOf('| Runtime | Minimum |');
  if (at === -1) throw new Error('installation.md no longer tabulates the runtimes');
  const rows = new Map<string, string>();
  for (const line of INSTALLATION.slice(at).split('\n').slice(2)) {
    if (!line.startsWith('|')) break;
    const cells = line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    if (cells[0] !== undefined && cells[1] !== undefined) rows.set(cells[0], cells[1]);
  }
  return rows;
})();

describe('the table the other two are checked against', () => {
  it('names every runtime, so a missing row cannot pass as agreement', () => {
    expect([...RUNTIMES.keys()]).toEqual(['Node', 'Chrome, Edge', 'Firefox', 'Safari']);
    expect(RUNTIMES.get('Node')).toBe('22.12.0');
  });

  it('says what the numbers rest on', () => {
    expect(INSTALLATION.replace(/\s+/g, ' ')).toContain(
      'ES2022 syntax, `BigInt`, `Blob.prototype.slice`, and `TextDecoder`',
    );
  });
});

describe('the same three browsers, everywhere they are stated', () => {
  const chrome = () => RUNTIMES.get('Chrome, Edge') ?? '';
  const firefox = () => RUNTIMES.get('Firefox') ?? '';
  const safari = () => RUNTIMES.get('Safari') ?? '';

  it('is the README compatibility line', () => {
    // `- **Node** ≥ 22.12.0 · **Chrome/Edge** 94+ · **Firefox** 93+ · **Safari** 15.4+`
    expect(README).toContain(`**Chrome/Edge** ${chrome()}+`);
    expect(README).toContain(`**Firefox** ${firefox()}+`);
    expect(README).toContain(`**Safari** ${safari()}+`);
  });

  it('is the summary llms.txt hands an agent', () => {
    // The summary is an array of lines joined with newlines, and the floor happens to straddle
    // two of them — `…/Safari` ends one and `15.4+ in the browser` opens the next. Adjacent
    // literals are stitched back together so the check is about the sentence rather than about
    // where it wraps.
    const prose = LLMS.replace(/',\s*\n\s*'/g, ' ');
    expect(prose).toContain(`Chrome ${chrome()}+/Firefox ${firefox()}+/Safari ${safari()}+`);
  });
});

describe('the ES2022 half of that basis is a compiler setting', () => {
  it('is what the published build is compiled to and against', () => {
    const config = JSON.parse(BUILD_CONFIG) as {
      compilerOptions: { target: string; lib: readonly string[] };
    };
    expect(config.compilerOptions.target.toLowerCase()).toBe('es2022');
    expect(config.compilerOptions.lib).toEqual(['ES2022']);
  });
});
