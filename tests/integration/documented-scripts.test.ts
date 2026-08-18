/**
 * Every `npm run …` the documentation gives is a script that exists.
 *
 * `AGENTS.md` opens with a Commands block, the README tells you how to build the site,
 * `tests/README.md` explains `test:scratch`, and the changelog names scripts in the entries that
 * changed them. None of that is checked, and scripts here do move: `format` was rewritten in
 * 0.4.225, `verify:package` was added in 0.4.233, and `lint` changed shape in 0.4.210.
 *
 * A wrong one is a bad first minute for a contributor — `npm run <name>` on a script that does
 * not exist prints a missing-script error and a list, which reads as a broken checkout rather
 * than a stale page. Cheap to check, since both manifests are right here.
 *
 * `--prefix website` is followed: the two workspaces have different scripts and `npm run build`
 * means a different thing in each.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCS_PAGES } from '../support/docs-pages.js';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const SCRIPTS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['root', new Set(Object.keys(JSON.parse(read('package.json')).scripts as object))],
  ['website', new Set(Object.keys(JSON.parse(read('website/package.json')).scripts as object))],
]);

interface Mention {
  readonly page: string;
  readonly script: string;
  readonly workspace: 'root' | 'website';
}

const TEXTS: ReadonlyArray<{ readonly name: string; readonly text: string }> = [
  ...[...DOCS_PAGES].map(([name, text]) => ({ name, text })),
  { name: 'README.md', text: read('README.md') },
  { name: 'AGENTS.md', text: read('AGENTS.md') },
  { name: 'tests/README.md', text: read('tests/README.md') },
];

/** `npm run <script>`, and the `--prefix website` that may follow it. */
const MENTIONS: readonly Mention[] = TEXTS.flatMap(({ name, text }) =>
  [...text.matchAll(/npm run ([a-z][a-z:-]*)((?:\s+--prefix\s+website)?)/g)].map((match) => ({
    page: name,
    script: match[1] as string,
    workspace: (match[2] as string).includes('website') ? ('website' as const) : ('root' as const),
  })),
);

describe('the documented scripts were found', () => {
  it('read enough of them that a passing run is not a vacuous one', () => {
    expect(MENTIONS.length).toBeGreaterThan(8);
    expect(MENTIONS.some(({ script }) => script === 'check')).toBe(true);
    // Both workspaces are represented, which is what makes following `--prefix` worth doing.
    expect(MENTIONS.some(({ workspace }) => workspace === 'website')).toBe(true);
  });

  it('reads the manifests, not a list written here', () => {
    expect(SCRIPTS.get('root')).toContain('check');
    expect(SCRIPTS.get('website')).toContain('dev');
    // `dev` is a website script and not a root one, so the prefix genuinely changes the answer.
    expect(SCRIPTS.get('root')?.has('dev')).toBe(false);
  });
});

describe('every documented script exists', () => {
  it('names none that npm would refuse', () => {
    const missing = MENTIONS.filter(
      ({ script, workspace }) => SCRIPTS.get(workspace)?.has(script) !== true,
    ).map(({ page, script, workspace }) => `${page}: npm run ${script} (${workspace})`);
    expect(missing, 'documented scripts that are not in the manifest').toEqual([]);
  });
});
