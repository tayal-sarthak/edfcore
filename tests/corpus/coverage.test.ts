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
    // biome-ignore lint/suspicious/noConsole: the whole purpose of this test is to say this once.
    console.log(summary);

    expect(summary).toContain('corpus:');
  });

  it('has a parity golden for every corpus file that carries data', () => {
    if (present.length === 0) {
      // Nothing fetched: there is nothing to be out of sync with, and saying so is the answer.
      expect(corpusGoldens().length).toBeGreaterThanOrEqual(0);
      return;
    }

    // Every fetched file should have a golden, or the parity suite is quietly narrower than the
    // corpus it claims to cover. `SC4001EC-Hypnogram.edf` included — it has no signals, and its
    // golden holds its 154 annotations.
    const goldens = new Set(
      corpusGoldens().map((file) => file.slice('corpus-'.length, -'.json'.length)),
    );
    const uncovered = present.map((entry) => entry.name).filter((name) => !goldens.has(name));
    expect(
      uncovered,
      'fetched corpus files with no parity golden — run scripts/golden/generate-corpus.py',
    ).toEqual([]);
  });
});
