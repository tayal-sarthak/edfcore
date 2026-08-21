/**
 * The regeneration instructions in `scripts/golden/README.md` describe what is actually there.
 *
 * Those instructions are run rarely — only when a reference library's output needs refreshing —
 * which is exactly why they rot. Nobody notices a renamed script until the one moment somebody
 * needs it, and at that moment they are trying to do something else.
 *
 * Three claims underneath them are load-bearing rather than incidental.
 *
 * "Nothing in `tests/corpus/golden/` is produced by edfcore" is the entire value of the harness:
 * a golden regenerated with this package's own writer would compare edfcore against edfcore and
 * pass no matter what either did. The `producer` field is how a file says who wrote it, and the
 * README says the tests assert it is present.
 *
 * "The venv is not committed and CI never builds it" is why the suite stays offline and Python-free
 * on a fresh clone. A workflow step that quietly installed pyedflib would make the goldens
 * regenerable in CI, which is the beginning of them being regenerated there — by the same package
 * being tested.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const GOLDEN_README = read('scripts/golden/README.md');
const FLAT = GOLDEN_README.replace(/\s+/g, ' ');

/** The `.venv/bin/python scripts/golden/<name>.py` lines of the regeneration block. */
const SCRIPTS = [
  ...GOLDEN_README.matchAll(/\.venv\/bin\/python (scripts\/golden\/[\w-]+\.py)/g),
].map(([, path = '']) => path);

const GOLDEN_DIR = 'tests/corpus/golden';

const GOLDEN_JSON = readdirSync(new URL(`${GOLDEN_DIR}/`, ROOT))
  .filter((name) => name.endsWith('.json'))
  .map((name) => `${GOLDEN_DIR}/${name}`);

describe('the regeneration block', () => {
  it('names four scripts, and every one of them is there', () => {
    expect(SCRIPTS).toHaveLength(4);
    const present = readdirSync(new URL('scripts/golden/', ROOT));
    for (const script of SCRIPTS) {
      expect(present, script).toContain(script.split('/').pop());
    }
  });

  it('names every script in the directory, so none is undocumented', () => {
    // The other direction: a generator nobody mentions is one nobody knows to run.
    const onDisk = readdirSync(new URL('scripts/golden/', ROOT)).filter((name) =>
      name.endsWith('.py'),
    );
    expect(onDisk.sort()).toEqual(SCRIPTS.map((path) => path.split('/').pop()).sort());
  });
});

describe('who wrote the goldens', () => {
  it('says nothing in the directory came from edfcore', () => {
    expect(FLAT).toContain('Nothing in `tests/corpus/golden/` is produced by edfcore');
  });

  it('records a producer in every one of them', () => {
    // "the `producer` field in every golden file records it, and the tests assert it is present."
    expect(GOLDEN_JSON.length).toBeGreaterThan(5);
    for (const file of GOLDEN_JSON) {
      const golden = JSON.parse(read(file)) as { producer?: string };
      expect(golden.producer, file).toBeTypeOf('string');
      expect((golden.producer ?? '').length, file).toBeGreaterThan(0);
    }
  });

  it('names a producer that is not this package', () => {
    // The claim the harness rests on, read off the files themselves rather than trusted.
    for (const file of GOLDEN_JSON) {
      const golden = JSON.parse(read(file)) as { producer?: string };
      expect((golden.producer ?? '').toLowerCase(), file).not.toContain('edfcore');
    }
  });

  it('is asserted by a test, as the README says it is', () => {
    const harness = read('tests/corpus/golden-values.test.ts');
    expect(harness).toContain('producer');
  });
});

describe('Python stays out of the loop', () => {
  it('keeps the venv out of the repository', () => {
    // "Needs Python. The venv is not committed and CI never builds it."
    expect(FLAT).toContain('The venv is not committed and CI never builds it');
    expect(read('.gitignore')).toMatch(/^\.venv\/?$/m);
  });

  it('has no workflow step that installs or runs it', () => {
    // A step that quietly installed pyedflib would make the goldens regenerable in CI, which is
    // the beginning of them being regenerated there — by the same package being tested.
    for (const name of readdirSync(new URL('.github/workflows/', ROOT))) {
      const workflow = read(`.github/workflows/${name}`);
      const code = workflow
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n');
      expect(code, name).not.toMatch(/\bpip\b|\bpython3?\b|\bvenv\b|pyedflib/);
    }
  });

  it('is not needed by the default test run either', () => {
    // `tests/README.md` promises `git clone && npm test` is green and offline; the goldens being
    // committed is what makes that true despite the harness existing.
    expect(read('tests/README.md')).toContain('`git clone && npm test` is green and offline');
    expect(GOLDEN_JSON.length).toBeGreaterThan(0);
  });
});
