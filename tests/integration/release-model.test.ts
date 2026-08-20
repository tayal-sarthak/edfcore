/**
 * The release model the repository describes is the one the workflows implement.
 *
 * A version here is one commit, one tag and one npm publish, and since 0.4.327 the tag is what
 * publishes: `publish.yml` triggers on `push: tags`, and `scripts/release.mjs` pushes main, waits
 * for CI on that exact commit, and only then creates and pushes the tag. A GitHub release is an
 * announcement cut afterwards for a whole batch by `scripts/announce-batch.mjs`, not a step in
 * shipping a patch version.
 *
 * Three files state that and none of them enforces it. The dangerous edit is small and looks like
 * a revert: putting `release: types: [published]` back on `publish.yml` leaves every test green,
 * every workflow valid, and `release.mjs` pushing tags that trigger nothing. That is not a
 * hypothetical failure mode — it is precisely how 0.4.287 through 0.4.292 were lost, six versions
 * tagged with green CI and nothing on npm, found only by looking at the registry.
 *
 * So the trigger is asserted from the outside, along with the two orderings the gate depends on:
 * that CI runs on a push to main at all, since the release waits for check runs that would
 * otherwise never appear, and that `release.mjs` pushes main before it tags.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const PUBLISH = read('.github/workflows/publish.yml');
const CI = read('.github/workflows/ci.yml');
const RELEASE = read('scripts/release.mjs');
const ANNOUNCE = read('scripts/announce-batch.mjs');
const AGENTS = read('AGENTS.md');
const MANIFEST = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

/** The `on:` block of a workflow, up to the next top-level key. */
function triggers(workflow: string): string {
  const start = workflow.search(/^on:$/m);
  if (start === -1) throw new Error('no `on:` block');
  const rest = workflow.slice(start + 'on:'.length);
  const end = rest.search(/^[a-z]/m);
  return end === -1 ? rest : rest.slice(0, end);
}

describe('a pushed tag is what publishes', () => {
  it('triggers publish.yml on a version tag', () => {
    expect(triggers(PUBLISH)).toMatch(/push:\s*\n\s*tags:\s*\['v\*'\]/);
  });

  it('does not trigger it on a published release', () => {
    // The revert that would look harmless. With this back, `release.mjs` pushes a tag, exits
    // reporting success, and the version never reaches npm.
    expect(triggers(PUBLISH)).not.toContain('release:');
  });

  it('keeps the manual trigger, which is the only recovery once a number is spent', () => {
    expect(triggers(PUBLISH)).toContain('workflow_dispatch:');
  });
});

describe('the gate in front of it', () => {
  it('runs CI on a push to main, which is what the release waits for', () => {
    // `release.mjs` polls the check runs of the commit it just pushed. If CI stopped running on
    // pushes to main those checks would never register and every release would hang for twenty
    // minutes and then refuse to tag.
    expect(triggers(CI)).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
  });

  it('pushes main, then waits, then tags — in that order', () => {
    const pushMain = RELEASE.indexOf("run('git', ['push', 'origin', 'main'])");
    const wait = RELEASE.indexOf('Waiting for CI on');
    const tag = RELEASE.indexOf("run('git', ['tag', '-a', tag");
    const pushTag = RELEASE.indexOf("run('git', ['push', 'origin', tag])");
    for (const [name, at] of Object.entries({ pushMain, wait, tag, pushTag })) {
      expect(at, name).toBeGreaterThan(-1);
    }
    // Tagging before the wait would put the version number back at risk, which is the whole
    // reason the order changed in 0.4.327.
    expect(pushMain).toBeLessThan(wait);
    expect(wait).toBeLessThan(tag);
    expect(tag).toBeLessThan(pushTag);
  });

  it('waits for npm before it reports success', () => {
    // The CI wait asks about the commit; publish.yml runs its own check afterwards and can fail
    // on something the commit's own runners passed.
    // As a pattern rather than the literal: the line in `release.mjs` is a template string, and
    // a `${…}` inside a plain quoted string here reads as a mistake to both a linter and a person.
    expect(RELEASE).toMatch(/Waiting for \$\{next\} to appear on npm/);
  });
});

describe('a GitHub release is not part of shipping a version', () => {
  it('is never created by the release script', () => {
    // Grepping `release.mjs`, not this file, so the invocation can be written out plainly.
    expect(RELEASE).not.toContain("'release', 'create'");
    expect(RELEASE).not.toContain('gh release create');
  });

  it('is created for a batch instead, by a script npm knows about', () => {
    expect(MANIFEST.scripts.announce).toBe('node scripts/announce-batch.mjs');
    expect(ANNOUNCE).toContain("'release', 'create'");
  });

  it('covers every tag since the last one, so running it twice is a no-op', () => {
    // The range is derived from what is already announced rather than passed in, which is what
    // makes an interrupted batch recoverable by running it again.
    expect(ANNOUNCE).toContain("capture('gh', ['release', 'list'");
    expect(ANNOUNCE).toContain('lastAnnounced');
  });

  it('refuses to announce a tag that has no changelog entry', () => {
    expect(ANNOUNCE).toContain('have no changelog entry');
  });
});

describe('the model AGENTS.md states', () => {
  it('says the tag is what publishes', () => {
    expect(AGENTS.replace(/\s+/g, ' ')).toContain(
      'A version is one commit, one tag and one npm publish.',
    );
    expect(AGENTS.replace(/\s+/g, ' ')).toContain('`publish.yml` triggers on the pushed tag');
  });

  it('names the command that cuts the batch release', () => {
    expect(AGENTS).toContain('npm run announce');
  });
});
