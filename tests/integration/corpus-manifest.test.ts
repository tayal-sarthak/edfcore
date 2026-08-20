/**
 * The corpus manifest is a provenance record, and nothing checked its shape.
 *
 * `tests/README.md` describes it precisely — it "records the URL, byte size, SHA-256, licence and
 * purpose of each file", and `npm run corpus:fetch` "downloads them into a gitignored directory
 * and verifies every hash". Those five fields are the entire basis on which this repository is
 * willing to pull 59 MB of other people's recordings onto a contributor's machine: the hash is
 * what makes the download reproducible, and the licence is what makes it redistributable — or, in
 * three of these cases, explicitly not.
 *
 * An entry missing `sha256` does not fail the fetch, it skips the check: `fetch-corpus.mjs`
 * compares the digest against `entry.sha256`, and `undefined` never matches, so the file is
 * rejected rather than silently trusted — but a truncated 64-character digest, or one with a
 * typo, produces the same rejection for a file that is fine, and nobody can tell the two apart
 * from the failure. A missing `licence` is worse: it is a file with no recorded permission, and
 * the manifest is the only place that permission is written down.
 *
 * So the fields are checked here rather than discovered at download time, and the digests are
 * checked for SHAPE rather than value — verifying the value needs the file, which is exactly what
 * this suite refuses to require.
 *
 * Writing it turned up the reason it was needed: five of the seven entries called that last field
 * `exercises` and two called it `purpose`, for the same content, and the README names only
 * `purpose`. Nothing read either — the field exists to be read by a person deciding whether a
 * download is worth its 48 MB — so the split had no symptom until something asked all seven the
 * same question (0.4.282).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Entry {
  readonly name: string;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly source: string;
  readonly licence: string;
  readonly purpose: string;
  readonly archiveEntry?: string;
}

const MANIFEST = JSON.parse(
  readFileSync(new URL('../corpus/manifest.json', import.meta.url), 'utf8'),
) as { readonly $comment?: string; readonly files: readonly Entry[] };

/** The five `tests/README.md` names, plus the two that make an entry usable. */
const REQUIRED = ['name', 'url', 'bytes', 'sha256', 'licence', 'source', 'purpose'] as const;

describe('the manifest was read', () => {
  it('holds entries, so a passing run is not a vacuous one', () => {
    expect(MANIFEST.files.length).toBeGreaterThan(5);
    expect(MANIFEST.files.map((entry) => entry.name)).toContain('SC4001E0-PSG.edf');
  });
});

describe('every entry records what the README says it records', () => {
  it.each(REQUIRED)('has a %s', (field) => {
    const missing = MANIFEST.files
      .filter((entry) => {
        const value = (entry as unknown as Record<string, unknown>)[field];
        return value === undefined || value === null || value === '';
      })
      .map((entry) => entry.name ?? '(unnamed)');
    expect(missing, `entries with no ${field}`).toEqual([]);
  });

  it('gives a digest the fetcher can compare', () => {
    // Shape, not value: checking the value needs the file, which is what the offline rule forbids.
    // A 63-character digest fails the download for a file that is fine, and the failure looks
    // identical to a corrupted one.
    const malformed = MANIFEST.files
      .filter((entry) => !/^[0-9a-f]{64}$/.test(entry.sha256))
      .map((entry) => `${entry.name}: ${entry.sha256}`);
    expect(malformed, 'sha256 values that are not 64 lowercase hex characters').toEqual([]);
  });

  it('gives a byte count that could be a file', () => {
    const wrong = MANIFEST.files
      .filter((entry) => !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0)
      .map((entry) => `${entry.name}: ${String(entry.bytes)}`);
    expect(wrong).toEqual([]);
  });

  it('gives a URL the fetcher can resolve', () => {
    const bad = MANIFEST.files
      .filter((entry) => {
        try {
          return new URL(entry.url).protocol !== 'https:';
        } catch {
          return true;
        }
      })
      .map((entry) => `${entry.name}: ${entry.url}`);
    expect(bad, 'entries whose url is not an https URL').toEqual([]);
  });

  it('says something real about permission', () => {
    // Three of these say "No licence stated" and why that is acceptable — synthetic generator
    // output rather than patient data. That is a recorded decision; an empty string is not.
    const vague = MANIFEST.files
      .filter((entry) => entry.licence.trim().length < 20)
      .map((entry) => `${entry.name}: ${JSON.stringify(entry.licence)}`);
    expect(vague, 'licence fields too short to record a decision').toEqual([]);
  });

  it('names each file once', () => {
    const names = MANIFEST.files.map((entry) => entry.name);
    expect(names).toEqual([...new Set(names)]);
  });
});
