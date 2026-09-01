/**
 * Every stated size of the corpus download is the size of the corpus download.
 *
 * Two pages tell a reader what `npm run corpus:fetch` costs, and they disagreed by 43 MB.
 * `tests/README.md` said ~102 MB and `AGENTS.md` said ~59 MB, which is what the manifest held
 * before `chb01_01.edf` was added to it — so the figure an agent reads before deciding whether to
 * run the command was the one that was wrong, and it was wrong by more than the whole rest of the
 * corpus put together.
 *
 * The number nobody checks is the number that rots, and this one rots on exactly the event that
 * makes it matter: adding a file. `manifest.json` records `bytes` per entry because
 * `fetch-corpus.mjs` verifies the download against it, so the true figure is already in the
 * repository and can simply be read.
 *
 * Megabytes, not mebibytes: `fetch-corpus.mjs` prints `bytes.length / 1e6` as it goes, so the
 * running total a reader watches is in the same unit as the total they were promised. `du` will
 * say 97M for the same files and that is not a contradiction.
 *
 * The tolerance is a whole megabyte in either direction, because these are prose figures written
 * with a `~`. What is not tolerated is a figure that stopped tracking the manifest at all.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const MANIFEST = JSON.parse(read('tests/corpus/manifest.json')) as {
  files: ReadonlyArray<{ readonly name: string; readonly bytes: number }>;
};

/** What `fetch-corpus.mjs` would report having downloaded, in the unit it reports it in. */
const TOTAL_MB = MANIFEST.files.reduce((sum, file) => sum + file.bytes, 0) / 1e6;

/** Every `corpus:fetch` line anywhere in the repository that quotes a size. */
function statedSizes(): ReadonlyArray<readonly [string, number]> {
  const found: Array<readonly [string, number]> = [];
  const skip = new Set(['node_modules', 'dist', '.git', 'files', 'deleted']);
  const walk = (directory: URL, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`);
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;
      const path = `${prefix}${entry.name}`;
      // The changelog quotes what past releases said, which is history rather than a claim.
      if (path === 'docs/CHANGELOG.md') continue;
      for (const line of readFileSync(new URL(entry.name, directory), 'utf8').split('\n')) {
        if (!line.includes('corpus:fetch')) continue;
        const size = /~?([\d.]+)\s*MB/.exec(line);
        if (size?.[1] !== undefined) found.push([`${path}: ${line.trim()}`, Number(size[1])]);
      }
    }
  };
  walk(ROOT, '');
  return found;
}

describe('the manifest this is measured against', () => {
  it('records a byte count for every file, so the total is a real one', () => {
    expect(MANIFEST.files.length).toBeGreaterThan(4);
    for (const file of MANIFEST.files) {
      expect({ name: file.name, counted: Number.isSafeInteger(file.bytes) }).toEqual({
        name: file.name,
        counted: true,
      });
    }
    expect(TOTAL_MB).toBeGreaterThan(50);
  });
});

describe('every page that quotes the download size', () => {
  it('was found, so a passing run is not a vacuous one', () => {
    const stated = statedSizes();
    expect(stated.length).toBeGreaterThanOrEqual(2);
    expect(stated.map(([where]) => where.split(':')[0])).toContain('AGENTS.md');
    expect(stated.map(([where]) => where.split(':')[0])).toContain('tests/README.md');
  });

  it.each(statedSizes())('%s is within a megabyte of the manifest', (_where, stated) => {
    expect(Math.abs(stated - TOTAL_MB)).toBeLessThan(1);
  });
});
