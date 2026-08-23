/**
 * The announce script cuts one release, and a dry run cuts none.
 *
 * `npm run announce` is the last step of every batch and the only command in this repository that
 * writes to GitHub. Everything else — the version bump, the commit, the tag, the publish — is
 * either reversible or already gated by `npm run check`. A GitHub release is neither: it is
 * public the moment it exists, it notifies watchers, and cutting a second one over the same range
 * is not an error anyone can undo quietly.
 *
 * Three properties keep that safe, and none of them was checked:
 *
 *  - **One mutating call.** The script reads tags with `git`, reads existing releases with
 *    `gh release list`, and creates exactly one release. A second `gh release create` anywhere in
 *    it — in a retry, in a per-version loop someone reintroduced — is the failure mode the whole
 *    script exists to prevent, since one release per version is what it replaced.
 *  - **A dry run cannot reach it.** `--dry-run` prints the notes and exits. If the gate ever
 *    became a branch that falls through, the flag people use to check a batch before announcing it
 *    would announce it.
 *  - **It refuses to announce past a gap.** A tag with no changelog entry stops the run, because
 *    the notes ARE the changelog entries: a missing one would silently produce a release whose
 *    body skips a version, which is the one artefact a reader trusts to be complete.
 *
 * The release title is checked too. Every batch this repository has cut is titled
 * `edfcore <first>–<last>` with an en dash, and a single-version batch drops the range entirely.
 * That is a small thing to get wrong and a permanent one: release titles are what the repository's
 * release list looks like forever.
 *
 * What this does NOT check: that `gh` does what it is asked, or that the range is computed
 * correctly. Both need a repository with releases in it, and the suite is offline —
 * `release-model.test.ts` covers the ordering this script sits at the end of.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const SCRIPT = read('scripts/announce-batch.mjs');

/** The script without its comments, so a mention in prose cannot stand for a call. */
const CODE = SCRIPT.split('\n')
  .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
  .join('\n');

/** Every `gh` invocation, as the subcommand it runs. */
const GH_CALLS: readonly string[] = [
  ...CODE.matchAll(/execFileSync\(\s*'gh'\s*,\s*\[([^\]]*)\]/g),
  ...CODE.matchAll(/capture\(\s*'gh'\s*,\s*\[([^\]]*)\]/g),
].map((match) =>
  (match[1] as string)
    .split(',')
    .map((argument) => argument.trim().replace(/^'|'$/g, ''))
    .filter((argument) => !argument.startsWith('-') && !argument.startsWith('`'))
    .slice(0, 2)
    .join(' '),
);

describe('the calls it makes', () => {
  it('were found, so a passing run is not a vacuous one', () => {
    expect(GH_CALLS.length).toBeGreaterThan(1);
    expect(GH_CALLS).toContain('release list');
  });

  it('create exactly one release', () => {
    const creates = GH_CALLS.filter((call) => call === 'release create');
    expect(creates, 'a batch must cut one release, not one per version').toHaveLength(1);
  });

  it('are otherwise read-only', () => {
    const mutating = GH_CALLS.filter((call) => !['release list', 'release create'].includes(call));
    expect(mutating, 'an unexpected gh subcommand').toEqual([]);
  });
});

describe('the dry run', () => {
  it('is a flag the script reads, and the one the usage block documents', () => {
    expect(CODE).toContain("process.argv.includes('--dry-run')");
    expect(SCRIPT).toContain('npm run announce -- --dry-run');
  });

  it('exits rather than falling through to the release', () => {
    const gate = CODE.indexOf('if (dryRun)');
    const exit = CODE.indexOf('process.exit(0)', gate);
    const create = CODE.indexOf("'release', 'create'");
    expect(gate, 'no dry-run gate').toBeGreaterThan(-1);
    expect(exit, 'the dry-run branch does not exit').toBeGreaterThan(gate);
    // And the exit is inside the branch, not after the release it was meant to skip.
    expect(exit).toBeLessThan(create);
  });
});

describe('the batch it will not announce past', () => {
  it('stops on a tag with no changelog entry, and says why', () => {
    expect(CODE).toContain('missing.length > 0');
    expect(SCRIPT.replace(/\s+/g, ' ')).toContain('These tags have no changelog entry');
    expect(SCRIPT.replace(/\s+/g, ' ')).toContain('a gap to fill rather than to announce past');
  });
});

describe('the title it will cut', () => {
  it('is a range with an en dash, or a single version with none', () => {
    // Not a hyphen. Every release in the list is titled this way, and the list is permanent.
    // Matched rather than quoted: a placeholder inside a plain string is a lint error here, and
    // rightly — it is almost always a template literal someone forgot to mark.
    expect(CODE).toMatch(/`edfcore \$\{first\}–\$\{last\}`/);
    expect(CODE).toMatch(/`edfcore \$\{first\}`/);
  });

  it('sits on the newest tag of the batch, so it points at the code the range ends with', () => {
    expect(CODE).toMatch(/'release',\s*'create',\s*`v\$\{last\}`/);
  });
});

describe('and the way it is invoked', () => {
  it('is the script package.json exposes and AGENTS.md documents', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> })
      .scripts;
    expect(scripts.announce).toBe('node scripts/announce-batch.mjs');
    expect(read('AGENTS.md')).toContain('npm run announce');
  });
});
