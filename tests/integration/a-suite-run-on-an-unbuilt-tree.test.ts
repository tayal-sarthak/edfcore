/**
 * Every workflow that runs `npm test` builds first.
 *
 * `packaging-claims.test.ts` reads the export targets out of `package.json` and asserts each one
 * exists in `dist/` — "./dist/index.js is in package.json but not in dist — run `npm run build`".
 * It is a check about how the package is SHIPPED, so it needs the artifact, and `npm test` does
 * not make one. `npm run check` does, which is why it passes everywhere it is run.
 *
 * `corpus.yml` ran `npm test` on a tree that had never been built, so those seven assertions failed
 * on every scheduled run. The job had been red since the week those assertions were added.
 *
 * That is what made it worth fixing rather than tolerating, and the workflow's own header says why:
 *
 * > Nothing here gates a merge: a corpus host being down is not a broken library, and a red cross
 * > on a scheduled job is the honest way to say so.
 *
 * The cross IS the signal. A permanent one carries nothing, so a corpus host actually going down —
 * the event this job exists to report — had been invisible for weeks. `ci-verifications.test.ts`
 * makes the same argument one file over about a deleted `- run:` line: the gap "would surface the
 * next time the thing it guards broke, which is exactly when nobody is looking at CI
 * configuration".
 *
 * Taken from the workflow files rather than from a list here, so a new workflow that runs the suite
 * is covered the day it is added rather than the day someone remembers this file (0.6.303).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const WORKFLOWS = new URL('../../.github/workflows/', import.meta.url);

/** The ordered `- run:` commands of every job in a workflow, flattened. */
function runSteps(source: string): readonly string[] {
  return [...source.matchAll(/^\s*- run:\s*(.+?)\s*$/gm)].map((match) => match[1] ?? '');
}

const workflows = readdirSync(WORKFLOWS)
  .filter((name) => name.endsWith('.yml'))
  .map((name) => ({ name, steps: runSteps(readFileSync(new URL(name, WORKFLOWS), 'utf8')) }));

/** A step that produces `dist/`: the build itself, or a script that runs it. */
const BUILDS = /^npm run (build|check)$/;

describe('a suite run on an unbuilt tree', () => {
  it('found the workflows, so a passing run is not a vacuous one', () => {
    expect(workflows.length).toBeGreaterThanOrEqual(3);
    expect(workflows.map((w) => w.name)).toContain('corpus.yml');
    expect(workflows.map((w) => w.name)).toContain('ci.yml');
  });

  it('is what packaging-claims.test.ts needs, and npm test does not provide', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> };
    // `check` builds; `test` does not. That asymmetry is the whole reason this file exists.
    expect(manifest.scripts.check).toContain('build');
    expect(manifest.scripts.test).not.toContain('build');
  });

  it('builds before running the suite, in every workflow that runs it', () => {
    const running = workflows.filter((w) => w.steps.some((step) => step === 'npm test'));
    // At least `corpus.yml`, which is the one this was found in.
    expect(running.length).toBeGreaterThanOrEqual(1);
    for (const { name, steps } of running) {
      const build = steps.findIndex((step) => BUILDS.test(step));
      const test = steps.indexOf('npm test');
      expect(build, `${name} runs npm test with no build step`).toBeGreaterThanOrEqual(0);
      expect(build, `${name} builds after it tests`).toBeLessThan(test);
    }
  });

  it('is satisfied in corpus.yml by the step this release added', () => {
    const corpus = workflows.find((w) => w.name === 'corpus.yml');
    expect(corpus?.steps).toContain('npm run build');
    expect(corpus?.steps).toContain('npm test');
    expect(corpus?.steps.indexOf('npm run build')).toBeLessThan(
      corpus?.steps.indexOf('npm test') ?? -1,
    );
    // And after the fetch, so a cache miss still costs one download rather than two.
    expect(corpus?.steps.indexOf('npm run corpus:fetch')).toBeLessThan(
      corpus?.steps.indexOf('npm run build') ?? -1,
    );
  });

  it('keeps actions/cache off the deprecated Node 20 runtime', () => {
    // It sat on v4 while everything beside it was v7, and v4 targets the Node 20 runtime GitHub has
    // deprecated and is currently FORCING onto Node 24 — every run printed "Node.js 20 is
    // deprecated... being forced to run on Node.js 24", so it worked only until the forcing stopped.
    //
    // The floor is v5, because v5.0.0 is exactly that fix upstream ("Upgrade to use node24"). Not
    // "the same major as its siblings": actions version independently, and cache's current major is
    // v6 while checkout and setup-node are v7, so that rule would be false the day it was written.
    //
    // It is the cache step, so the break would have been quiet: the fetch still runs and the job
    // still passes, downloading ~102 MB a week from third-party servers instead of restoring
    // (0.6.304).
    const uses = workflows.flatMap(({ name }) => [
      ...readFileSync(new URL(name, WORKFLOWS), 'utf8').matchAll(
        /^\s*- uses:\s*actions\/cache@v(\d+)/gm,
      ),
    ]);
    expect(uses.length, 'no actions/cache step found, so this check is vacuous').toBeGreaterThan(0);
    for (const match of uses) {
      expect(Number(match[1]), 'actions/cache is on a Node 20 major').toBeGreaterThanOrEqual(5);
    }
  });

  it('leaves the workflows that never run the suite alone', () => {
    for (const { name, steps } of workflows) {
      if (steps.includes('npm test')) continue;
      // Nothing here requires a build it does not need — `publish.yml` and the rest are untouched.
      expect(steps, name).not.toContain('npm test');
    }
  });
});
