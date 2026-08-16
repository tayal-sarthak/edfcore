/**
 * The two corpus sizes in `tests/README.md` are measured, not remembered.
 *
 * Both went stale the same way and neither was catchable by reading the sentence. `~59 MB` was
 * exact for the five-file manifest written on 2026-08-01, and read 42 MB light once CHB-MIT landed
 * six days later (corrected in 0.4.191). `about 1.4 MB` was exact for the 21 files under
 * `corpus/golden/` at aa476d6, and read light once two more goldens were committed (0.4.192). In
 * both cases someone added a file to a set and left the sentence describing that set behind.
 *
 * A reader uses the first number to decide whether to run a download on a metered connection, so
 * being wrong by 42 MB is the kind of wrong that costs someone something.
 *
 * The tolerance is 10% because both figures are hedged — "~" and "about". The point is to fail
 * when the SET changes, not to demand a rewrite because one fixture gained a few hundred bytes.
 * Both drifts above were over 30%, and both would have failed here.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const MANIFEST = JSON.parse(
  readFileSync(new URL('../corpus/manifest.json', import.meta.url), 'utf8'),
) as { files: ReadonlyArray<{ bytes: number }> };

const GOLDEN_DIR = fileURLToPath(new URL('../corpus/golden', import.meta.url));

/** Decimal MB, the unit both sentences are written in. */
const mb = (bytes: number): number => bytes / 1e6;

function statedMb(pattern: RegExp): number {
  const match = pattern.exec(README);
  if (match?.[1] === undefined) throw new Error(`tests/README.md no longer matches ${pattern}`);
  return Number(match[1]);
}

/** Within 10% of each other. */
const close = (stated: number, actual: number): boolean =>
  Math.abs(stated - actual) / actual < 0.1;

describe('the corpus sizes in tests/README.md', () => {
  it('states the download size the manifest actually adds up to', () => {
    const actual = mb(MANIFEST.files.reduce((sum, file) => sum + file.bytes, 0));
    const stated = statedMb(/corpus:fetch\s+# ~([\d.]+) MB/);
    expect(MANIFEST.files.length).toBeGreaterThan(0);
    expect(
      close(stated, actual),
      `README says ~${stated} MB, manifest totals ${actual.toFixed(1)} MB`,
    ).toBe(true);
  });

  it('states the weight the committed goldens actually come to', () => {
    const names = readdirSync(GOLDEN_DIR);
    const actual = mb(
      names.reduce((sum, name) => sum + statSync(`${GOLDEN_DIR}/${name}`).size, 0),
    );
    const stated = statedMb(/about ([\d.]+) MB with their/);
    expect(names.length).toBeGreaterThan(0);
    expect(
      close(stated, actual),
      `README says about ${stated} MB, corpus/golden is ${actual.toFixed(2)} MB`,
    ).toBe(true);
  });
});
