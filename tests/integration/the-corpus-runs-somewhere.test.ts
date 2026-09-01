/**
 * The corpus suite is executed by something other than a developer remembering to.
 *
 * `tests/corpus/` is the only place this library is checked against bytes it did not write
 * itself — EDFlib's generator, a PhysioNet polysomnogram, a CHB-MIT seizure recording, and the
 * parity goldens generated from pyEDFlib and MNE. Every test in it skips when
 * `tests/corpus/files/` is empty, and that default is correct: `git clone && npm test` must not
 * reach the network, and the files are gitignored because one of them is a real person's
 * overnight recording.
 *
 * The consequence was that they ran nowhere at all. `ci.yml` never fetched, `scripts/release.mjs`
 * runs `npm run check`, and neither downloads anything — so a hundred-odd tests written to catch
 * exactly the failures a synthetic writer cannot produce executed only on a machine where someone
 * had happened to run `corpus:fetch`. 0.4.219 records the workaround: one check there is
 * deliberately ungated "because CI never fetches, so a gated version would have been the one check
 * that runs nowhere". That sentence is the bug report.
 *
 * `corpus.yml` is where they run now — weekly, cached on the manifest hash, and gating nothing.
 * This file checks that such a workflow exists, that it runs the suite after fetching rather than
 * only fetching, and that the suite still cannot reach the network on its own.
 *
 * What this does NOT check: that the job passes, or that a scheduled workflow is enabled on the
 * repository. It checks that the script has somewhere to run and that something runs the tests
 * after it, which is the half that was missing.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const WORKFLOWS = new URL('.github/workflows/', ROOT);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const MANIFEST = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

const workflows = readdirSync(WORKFLOWS)
  .filter((name) => name.endsWith('.yml'))
  .map((name) => [name, readFileSync(new URL(name, WORKFLOWS), 'utf8')] as const);

/** The workflows that fetch the corpus. */
const fetchers = workflows.filter(([, body]) => body.includes('npm run corpus:fetch'));

/** Every `npm run <name>` reachable from `npm run check`, following scripts that call scripts. */
const reachedByCheck = ((): ReadonlySet<string> => {
  const seen = new Set<string>();
  const visit = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const match of (MANIFEST.scripts[name] ?? '').matchAll(/npm run ([\w:]+)/g)) {
      visit(match[1] as string);
    }
  };
  visit('check');
  return seen;
})();

describe('the scan found something to check', () => {
  it('has the workflows and the script', () => {
    expect(workflows.length).toBeGreaterThan(1);
    expect(MANIFEST.scripts).toHaveProperty('corpus:fetch');
  });
});

describe('the corpus', () => {
  it('is fetched by a workflow', () => {
    expect(fetchers.map(([name]) => name)).not.toEqual([]);
  });

  it.each(fetchers)('%s runs the test suite after fetching, not only the fetch', (_name, body) => {
    const fetchAt = body.indexOf('npm run corpus:fetch');
    const testAt = body.indexOf('npm test', fetchAt);
    expect(testAt).toBeGreaterThan(fetchAt);
  });

  it('is still not reachable from npm run check, which is the premise', () => {
    // If it were, `git clone && npm test` would download 102 MB from three third-party hosts, and
    // `scripts/release.mjs` would do it again on every version.
    expect(reachedByCheck.has('corpus:fetch')).toBe(false);
    expect(reachedByCheck.has('test')).toBe(true);
  });

  it('is fetched by no workflow that runs on a push or a pull request', () => {
    // The download is weekly on purpose: the files come from servers that owe this project
    // nothing, and a corpus host being down is not a broken library.
    for (const [name, body] of fetchers) {
      const triggers = body.slice(body.indexOf('\non:'), body.indexOf('\npermissions:'));
      expect({ name, onPush: /^\s+push:/m.test(triggers) }).toEqual({ name, onPush: false });
      expect({ name, onPr: /pull_request/.test(triggers) }).toEqual({ name, onPr: false });
    }
  });
});

describe('what it is there to run', () => {
  const CORPUS = new URL('tests/corpus/', ROOT);
  const files = readdirSync(CORPUS).filter((name) => name.endsWith('.test.ts'));
  const body = (name: string): string => readFileSync(new URL(name, CORPUS), 'utf8');

  /**
   * Names the download directory to assert that git tracks nothing in it — a licence and privacy
   * rule about the directory, not a read from it. One entry, named rather than pattern-matched.
   */
  const ABOUT_THE_DIRECTORY = new Set(['fixture-policy.test.ts']);

  /** The ones that address the download directory in order to open something in it. */
  const reads = files.filter(
    (name) => !ABOUT_THE_DIRECTORY.has(name) && /['"`]files['"`]|corpus\/files/.test(body(name)),
  );

  it('is a directory of tests, several of which address the download directory', () => {
    expect(files.length).toBeGreaterThan(5);
    expect(reads.length).toBeGreaterThan(4);
  });

  it.each(reads)('%s asks whether the file is there before reading it', (name) => {
    // `existsSync(FILE) ? it : it.skip` is the shape. It is what makes the offline default work,
    // and it is the reason these tests need a workflow rather than a green local run.
    expect({ name, gated: body(name).includes('existsSync') }).toEqual({ name, gated: true });
  });

  it('leaves the rest reading only what git tracks, so they run everywhere', () => {
    // The manifest, the committed goldens and the policy checks. Those are live in every run,
    // which is why 0.4.219 moved one check into that group rather than leaving it gated.
    for (const name of files.filter((one) => !reads.includes(one))) {
      expect({ name, downloads: /['"`]files['"`]/.test(body(name)) }).toEqual({
        name,
        downloads: false,
      });
    }
  });
});
