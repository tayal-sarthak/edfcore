/**
 * A machine that has not downloaded the corpus still gets a green suite.
 *
 * `tests/README.md` opens with it: "`git clone && npm test` is green and offline." The offline half
 * is a property rather than a description — `tests/support/offline.ts` replaces `fetch` with a trap
 * and `offline.test.ts` proves the trap is armed. The other half, that a fresh clone passes without
 * the ~59 MB `npm run corpus:fetch` has never fetched, was enforced by convention.
 *
 * It is the half a contributor meets first, and the failure is unwelcoming in a specific way: they
 * clone, run the suite, and watch it fail on files they were never told to download, in tests named
 * after recordings they have never heard of. The fix is a command in a README they have not reached
 * yet.
 *
 * CI is what makes the convention load-bearing rather than theoretical. `ci.yml` runs `npm ci` and
 * `npm run check` and never fetches the corpus, so every CI run is a run in the skipping state —
 * which means an unguarded corpus test does not fail quietly. It fails every job, on every push,
 * blocking every release, and it looks like a problem with the corpus rather than with the guard.
 *
 * So the rule is checked mechanically: a test file that builds a path into the downloaded
 * directory has to ask whether the file is there. Both halves are needed — `fixture-policy.test.ts`
 * lives in the same folder, names `tests/corpus/files/` in a git check, reads nothing from it and
 * must not be required to guard.
 *
 * What this does NOT check: that a guarded test is guarded CORRECTLY — that the path it probes is
 * the path it reads. That is a per-file question, and the eight files here each answer it in the
 * shape their own fixtures need.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

/** Every test file in the corpus directory, with its source. */
const CORPUS_TESTS: ReadonlyArray<{ readonly name: string; readonly source: string }> = readdirSync(
  new URL('tests/corpus/', ROOT),
)
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => ({ name, source: read(`tests/corpus/${name}`) }));

/**
 * Builds a path into the downloaded directory, which is the only thing that needs a guard.
 *
 * Matched on the path SEGMENT — `, 'files'` — rather than on the whole `join(…)` call: the calls
 * here nest (`join(dirname(fileURLToPath(import.meta.url)), 'files', 'chb01_01.edf')`) and a
 * pattern that tries to span one stops at the first inner bracket. `fixture-policy.test.ts` names
 * the directory as the string `'tests/corpus/files/'` and does not match, which is the point.
 */
const readsTheCorpus = (source: string): boolean => /,\s*'files'/.test(source);

/** Asks whether the file is there, however the answer is then used. */
const asksFirst = (source: string): boolean => source.includes('existsSync');

describe('the promise', () => {
  it('is still made, in the README a contributor reads first', () => {
    expect(read('tests/README.md')).toContain('`git clone && npm test` is green and offline.');
  });

  it('is still stated inside the corpus directory too', () => {
    expect(read('tests/corpus/coverage.test.ts').replace(/\s+/g, ' ')).toContain(
      'Every other file in this directory skips when `tests/corpus/files/` is empty',
    );
  });

  it('is what CI runs, which is what makes the guard load-bearing', () => {
    // No fetch step: every CI job is a run in the skipping state.
    expect(read('.github/workflows/ci.yml')).not.toContain('corpus:fetch');
    expect(read('package.json')).toContain('"corpus:fetch"');
  });

  it('keeps the downloaded files out of the repository', () => {
    expect(read('.gitignore')).toContain('tests/corpus/files/');
  });
});

describe('every corpus test that reads a downloaded file', () => {
  it('was found, so a passing run is not a vacuous one', () => {
    const reading = CORPUS_TESTS.filter((one) => readsTheCorpus(one.source));
    expect(CORPUS_TESTS.length).toBeGreaterThan(10);
    expect(reading.length).toBeGreaterThan(6);
    // And at least one file in the folder reads nothing from it, or the rule below is trivial.
    expect(CORPUS_TESTS.length).toBeGreaterThan(reading.length);
  });

  it('asks whether the file is there before reading it', () => {
    const unguarded = CORPUS_TESTS.filter(
      (one) => readsTheCorpus(one.source) && !asksFirst(one.source),
    ).map((one) => one.name);
    expect(
      unguarded,
      'a corpus test would fail rather than skip on a machine without the corpus',
    ).toEqual([]);
  });

  it('does not require a guard of a file that reads nothing downloaded', () => {
    // `fixture-policy.test.ts` names the directory in a git check and reads nothing from it.
    const policy = CORPUS_TESTS.find((one) => one.name === 'fixture-policy.test.ts');
    expect(policy, 'the file this exemption is about has moved').toBeDefined();
    expect(readsTheCorpus(policy?.source ?? '')).toBe(false);
    expect(policy?.source).toContain('tests/corpus/files/');
  });
});
