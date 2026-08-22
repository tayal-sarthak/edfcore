/**
 * The checks that sit outside `npm run check` are run by something.
 *
 * `AGENTS.md`:
 *
 * > Three checks are deliberately outside `npm run check`, because each needs the network or an
 * > artifact that check does not build. CI runs all three; run them by hand when you touch what
 * > they cover.
 *
 * That is a sound arrangement and a fragile one. `verify:package` packs the tarball and asks
 * publint and `@arethetypeswrong/cli` what a consumer would resolve; `verify:tarball` asks what
 * npm would ship and what it must not — the rule that keeps a real person's polysomnogram out of
 * the published package; `verify:site` reads `website/dist` for the generated endpoints. None of
 * them can run inside the suite, so the suite cannot notice when one stops running at all.
 *
 * Deleting a `- run:` line from `ci.yml` is a one-line edit that turns a check into a script
 * nobody invokes, leaves every test here green, and leaves that paragraph saying CI runs it. The
 * gap would surface the next time the thing it guards broke, which is exactly when nobody is
 * looking at CI configuration.
 *
 * So the set is taken from `package.json` rather than from the prose — every `verify:*` script
 * there has to appear as a step in `ci.yml` — and the prose is then checked against the same set,
 * which is what makes "three" a number this file can be wrong about.
 *
 * What this does NOT check: that the jobs pass, or that a step's `run:` is reached rather than
 * skipped by an `if:`. It checks that each script is named by a workflow that runs on every push
 * and pull request.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const MANIFEST = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
const CI = read('.github/workflows/ci.yml');
const AGENTS = read('AGENTS.md');

/** The `verify:*` scripts, which are the ones with nowhere else to run. */
const VERIFICATIONS = Object.keys(MANIFEST.scripts).filter((name) => name.startsWith('verify:'));

/** Every `npm run <name>` reachable from `npm run check`, following scripts that call scripts. */
const REACHED_BY_CHECK: ReadonlySet<string> = (() => {
  const seen = new Set<string>();
  const walk = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const match of (MANIFEST.scripts[name] ?? '').matchAll(/npm run ([\w:]+)/g)) {
      walk(match[1] as string);
    }
  };
  walk('check');
  return seen;
})();

/** The `npm run …` steps of `ci.yml`, whatever job they sit in. */
const CI_STEPS: ReadonlySet<string> = new Set(
  [...CI.matchAll(/run:\s*npm(?:\s+--prefix\s+\S+)?\s+run\s+([\w:]+)/g)].map(
    (match) => match[1] as string,
  ),
);

describe('the scan found something to check', () => {
  it('has the scripts, the workflow steps and the reachable set', () => {
    expect(VERIFICATIONS.length).toBeGreaterThan(2);
    expect(CI_STEPS.size).toBeGreaterThan(3);
    expect([...REACHED_BY_CHECK]).toContain('test');
  });
});

describe('every verification runs somewhere', () => {
  it.each(VERIFICATIONS)('%s is a step in ci.yml', (name) => {
    expect(CI_STEPS.has(name)).toBe(true);
  });

  it.each(VERIFICATIONS)('%s is not reachable from npm run check', (name) => {
    // The premise of the arrangement: if one of these became part of `check`, the suite would
    // pack a tarball on every run — and packing runs `prepublishOnly`, which runs `check`.
    expect(REACHED_BY_CHECK.has(name)).toBe(false);
  });
});

describe('and AGENTS.md describes that arrangement', () => {
  it('says CI runs them', () => {
    expect(AGENTS.replace(/\s+/g, ' ')).toContain('CI runs all three');
  });

  it('lists exactly the scripts that exist, so the count stays true', () => {
    // The fenced block under that paragraph. A fourth `verify:` script added to the manifest and
    // to CI but not here leaves the page saying "three" about a set of four.
    const at = AGENTS.indexOf('CI runs all three');
    const block = AGENTS.slice(at).split('```')[1] ?? '';
    const listed = [...block.matchAll(/npm run ([\w:]+)/g)].map((match) => match[1] as string);
    expect(listed).toEqual(VERIFICATIONS);
  });
});
