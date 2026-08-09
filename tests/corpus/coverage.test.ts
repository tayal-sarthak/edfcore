/**
 * Whether the corpus checks actually ran — stated, rather than left to be inferred.
 *
 * Every other file in this directory skips when `tests/corpus/files/` is empty, which is right:
 * a fresh clone must stay green and offline, and the files are not redistributed. But a skipped
 * test is indistinguishable from a passing one in a summary line, and the corpus is where the
 * strongest claims in this project live — bit-for-bit parity with pyEDFlib on a 22-hour clinical
 * recording. "1487 passed" reads the same whether that ran or not.
 *
 * So this file ALWAYS runs, and does two things a skip cannot:
 *
 * 1. Says out loud which state the suite is in, once, in a line a reader will see.
 * 2. Checks the parts that need no corpus at all — that the manifest and the goldens agree. A
 *    golden for a file the manifest no longer lists, or a manifest entry whose golden was never
 *    regenerated, is a real drift that no amount of skipping should hide.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = join(HERE, 'files');
const GOLDEN = join(HERE, 'golden');

interface ManifestEntry {
  readonly name: string;
  readonly url: string;
  readonly sha256: string;
  readonly source: string;
  readonly licence: string;
}

const manifest = JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8')) as {
  readonly files: readonly ManifestEntry[];
};

/** Golden files named `corpus-<manifest name>.json`, which is the naming the generator uses. */
function corpusGoldens(): string[] {
  if (!existsSync(GOLDEN)) return [];
  return readdirSync(GOLDEN).filter((f) => f.startsWith('corpus-') && f.endsWith('.json'));
}

const present = manifest.files.filter((entry) => existsSync(join(FILES, entry.name)));

describe('the corpus manifest is self-consistent, with or without the files', () => {
  it('names a source and a licence for every entry, because none of it is redistributed', () => {
    expect(manifest.files.length).toBeGreaterThan(0);
    for (const entry of manifest.files) {
      expect(entry.name, 'name').toBeTruthy();
      expect(entry.url, `${entry.name} url`).toMatch(/^https:\/\//);
      // A hash is what makes a silently changed upstream file fail loudly rather than quietly
      // altering what these tests mean.
      expect(entry.sha256, `${entry.name} sha256`).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.source, `${entry.name} source`).toBeTruthy();
      expect(entry.licence, `${entry.name} licence`).toBeTruthy();
    }
  });

  it('has a manifest entry for every golden that was committed', () => {
    // The direction that matters. A golden is committed and a corpus file is not, so a golden for
    // a file nobody can fetch any more is dead weight that still looks like coverage.
    const named = new Set(manifest.files.map((entry) => entry.name));
    const orphaned = corpusGoldens()
      .map((file) => file.slice('corpus-'.length, -'.json'.length))
      .filter((name) => !named.has(name));
    expect(orphaned).toEqual([]);
  });
});

describe('corpus coverage', () => {
  it('reports which state this run is in', () => {
    const goldens = corpusGoldens();
    const summary =
      present.length === 0
        ? `corpus: ABSENT — ${manifest.files.length} file(s) not fetched, so every corpus test ` +
          'skipped. Run `npm run corpus:fetch` to exercise them.'
        : `corpus: ${present.length}/${manifest.files.length} file(s) present, ` +
          `${goldens.length} parity golden(s) — corpus tests ran.`;

    // Deliberately a log rather than a failure. Requiring the corpus would break `git clone &&
    // npm test`, which is the property the skipping exists to protect; leaving it unsaid is what
    // this file objects to.
    console.log(summary);

    expect(summary).toContain('corpus:');
  });

  const goldenNames = (): Set<string> =>
    new Set(corpusGoldens().map((file) => file.slice('corpus-'.length, -'.json'.length)));

  it('has no golden for a file the manifest no longer lists', () => {
    /*
     * Needs no corpus at all — both sides are committed — which is why this is its own test.
     *
     * The single test here used to early-return on a fresh clone with
     * `expect(corpusGoldens().length).toBeGreaterThanOrEqual(0)`: a length is never negative, so
     * on the run this file exists to protect — `git clone && npm test`, no corpus — it asserted
     * nothing. That is the half of point 2 of this file's own docblock that needs no corpus, and
     * it was the half that never ran (fixed in 0.3.102).
     */
    const listed = new Set(manifest.files.map((entry) => entry.name));
    const orphaned = [...goldenNames()].filter((name) => !listed.has(name));
    expect(
      orphaned,
      'goldens for files the manifest no longer lists — delete them, or restore the entry',
    ).toEqual([]);

    // And the premise: there really are goldens and manifest entries to compare.
    expect(goldenNames().size).toBeGreaterThan(0);
    expect(listed.size).toBeGreaterThan(0);
  });

  it('has a parity golden for every corpus file that carries data', () => {
    // Every fetched file should have a golden, or the parity suite is quietly narrower than the
    // corpus it claims to cover. `SC4001EC-Hypnogram.edf` included — it has no signals, and its
    // golden holds its 154 annotations.
    //
    // Skipped without the corpus, unlike the test above: this half genuinely needs the files.
    if (present.length === 0) return;

    const goldens = goldenNames();
    const uncovered = present.map((entry) => entry.name).filter((name) => !goldens.has(name));
    expect(
      uncovered,
      'fetched corpus files with no parity golden — run scripts/golden/generate-corpus.py',
    ).toEqual([]);
  });
});
