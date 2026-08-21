/**
 * The fixture policy in `tests/README.md` is a licence rule, and it is enforced here.
 *
 * "**No file from teuniz.net, PhysioNet or edfplus.info may be committed.** Neither site attaches a
 * licence to its data, and `eeg_recording.zip` is an identifiable patient recording."
 *
 * That is not a tidiness preference. One of those files is a real person's overnight
 * polysomnogram, and committing it would publish it to npm's mirrors and to every fork, permanently
 * — a thing no later commit can undo. The rule is also the reason the corpus is downloaded on
 * demand at all, and the reason `corpus/files/` is gitignored rather than merely empty.
 *
 * It is enforced by one line in `.gitignore` and by nobody adding an exception, which is exactly
 * the shape of rule that survives until the day someone wants a test to run in CI. So it is
 * checked from the manifest: every file the corpus can download is named there with its source,
 * and none of them may exist as a tracked file anywhere in the tree.
 *
 * The six committed goldens are the deliberate exception and are checked to be what the README says
 * they are — generated locally by pyEDFlib from data this repository specifies, not downloaded from
 * anyone — which `golden-readme.test.ts` establishes from the `producer` field.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const TESTS_README = read('tests/README.md').replace(/\s+/g, ' ');

interface ManifestEntry {
  readonly name: string;
  readonly url: string;
  readonly source: string;
  readonly licence: string;
}

/** The manifest is `{ $comment, files }` rather than a bare array. */
const MANIFEST = (
  JSON.parse(read('tests/corpus/manifest.json')) as { files: readonly ManifestEntry[] }
).files;

/** Every path git is tracking, which is what "committed" means. */
const TRACKED: readonly string[] = execFileSync('git', ['ls-files'], {
  cwd: fileURLToPath(ROOT),
  encoding: 'utf8',
})
  .split('\n')
  .filter((line) => line !== '');

/** The three origins the rule names. */
const FORBIDDEN_ORIGINS = ['teuniz.net', 'physionet.org', 'edfplus.info'] as const;

describe('the rule', () => {
  it('is still stated, naming all three origins', () => {
    expect(TESTS_README).toContain(
      '**No file from teuniz.net, PhysioNet or edfplus.info may be committed.**',
    );
    expect(TESTS_README).toContain('is an identifiable patient recording');
  });

  it('describes a corpus that really is downloaded from those origins', () => {
    expect(MANIFEST.length).toBeGreaterThan(4);
    for (const entry of MANIFEST) {
      const host = new URL(entry.url).hostname.toLowerCase();
      expect(
        FORBIDDEN_ORIGINS.some((origin) => host.endsWith(origin)),
        `${entry.name} comes from ${host}`,
      ).toBe(true);
    }
  });
});

describe('nothing from those origins is committed', () => {
  it('tracks none of the files the manifest can fetch', () => {
    const committed = MANIFEST.filter((entry) =>
      TRACKED.some((path) => path.endsWith(`/${entry.name}`) || path === entry.name),
    );
    expect(committed.map((entry) => entry.name)).toEqual([]);
  });

  it('tracks nothing at all under the directory they download into', () => {
    // The other direction: the rule is about the origin, not about thefilenames, so the whole
    // destination is checked rather than the manifest's list alone.
    expect(TRACKED.filter((path) => path.startsWith('tests/corpus/files/'))).toEqual([]);
  });

  it('keeps that directory ignored, which is what makes the rule hold by default', () => {
    expect(read('.gitignore')).toMatch(/^tests\/corpus\/files\/?$/m);
  });

  it('records a licence for every entry, so the reason is written down beside the file', () => {
    // A file whose licence nobody recorded is one nobody can decide about later.
    for (const entry of MANIFEST) {
      expect(entry.licence, entry.name).toBeTypeOf('string');
      expect(entry.licence.length, entry.name).toBeGreaterThan(20);
      expect(entry.source, entry.name).toBeTypeOf('string');
    }
  });
});

describe('the committed exception', () => {
  it('is the golden directory, and nothing else binary is tracked under tests/', () => {
    // "Almost every fixture is built in memory. The exception is six small EDF/BDF files under
    //  `corpus/golden/`."
    const binaries = TRACKED.filter(
      (path) => path.startsWith('tests/') && /\.(edf|bdf|rec)$/i.test(path),
    );
    expect(binaries.length).toBeGreaterThan(0);
    for (const path of binaries) {
      expect(path.startsWith('tests/corpus/golden/'), path).toBe(true);
    }
  });

  it('is generated rather than downloaded, which the README says in as many words', () => {
    expect(TESTS_README).toContain('generated locally by pyEDFlib');
    // No golden shares a name with anything the manifest fetches.
    const goldens = TRACKED.filter((path) => path.startsWith('tests/corpus/golden/'));
    for (const entry of MANIFEST) {
      expect(
        goldens.some((path) => path.endsWith(`/${entry.name}`)),
        entry.name,
      ).toBe(false);
    }
  });
});
