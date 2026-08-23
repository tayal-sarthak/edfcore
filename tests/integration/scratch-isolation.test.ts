/**
 * The throwaway probes are runnable, and cannot reach the suite, the typecheck or a commit.
 *
 * `tests/scratch/` holds reproductions written while chasing a defect. They assert whatever
 * behaviour was current when they were written, which makes them useful for an afternoon and
 * poison afterwards: a committed probe pins a defect as if it were a decision.
 *
 * Four separate mechanisms keep that true, in four different files, and none of them was checked.
 * Each fails in its own direction:
 *
 *  - **`.gitignore`** keeps them out of a commit. Without it a probe reaches `main` on the next
 *    release, because `scripts/release.mjs` stages with `git add -A`.
 *  - **The main vitest config** excludes the directory, so a leftover probe cannot join the suite
 *    that gates a tag. Without it `npm run check` passes or fails on a file nobody meant to keep —
 *    which it did, before 0.4.176's neighbourhood, and is why the exclusion exists.
 *  - **`tsconfig.json`** excludes it too, for the same reason on the other half of `npm run
 *    check`. The vitest config's own comment says "Excluded here and in tsconfig.json"; the two
 *    have to move together, and only one of them is where anyone would look.
 *  - **`config/vitest.scratch.config.ts`** is what makes them runnable anyway, because vitest
 *    applies `exclude` even to an explicit filename filter — so excluding the directory from the
 *    main config also made a probe unrunnable, which is not the goal.
 *
 * The fourth carries a deliberate exemption worth stating: the scratch config does NOT load
 * `tests/support/offline.ts`. A probe reproducing a defect against a real server is a legitimate
 * thing to write, and the offline trap exists for the suite rather than for the workshop. That is
 * an absence, and an absence is what someone adds "for consistency".
 *
 * The strongest check here is the live one: nothing under `tests/scratch/` is tracked by git,
 * asked of git rather than of the ignore file, because that is the property and the rest is
 * mechanism.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const MAIN_CONFIG = read('config/vitest.config.ts');
const SCRATCH_CONFIG = read('config/vitest.scratch.config.ts');

/** A docblock as sentences: the leading `*` goes before the wrapping is collapsed. */
const prose = (source: string): string =>
  source
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');

describe('nothing from the workshop is committed', () => {
  it('is true of the repository right now, asked of git', () => {
    const tracked = execFileSync('git', ['ls-files', 'tests/scratch'], {
      cwd: fileURLToPath(ROOT),
      encoding: 'utf8',
    })
      .split('\n')
      .filter((line) => line !== '');
    expect(tracked, 'a throwaway probe is tracked by git').toEqual([]);
  });

  it('is what .gitignore asks for, and says why', () => {
    const ignore = read('.gitignore');
    expect(ignore).toContain('tests/scratch/');
    // The reason, kept beside the line, because the line looks removable without it.
    expect(ignore.replace(/\s+/g, ' ')).toContain('committing them pins defects');
  });
});

describe('nor can one join the run that gates a tag', () => {
  it('is excluded from the suite', () => {
    expect(MAIN_CONFIG).toContain("'tests/scratch/**'");
    expect(MAIN_CONFIG).toMatch(
      /exclude:\s*\[\.\.\.configDefaults\.exclude,\s*'tests\/scratch\/\*\*'\]/,
    );
  });

  it('is excluded from the typecheck, which is the other half of npm run check', () => {
    const tsconfig = JSON.parse(read('tsconfig.json')) as { exclude?: readonly string[] };
    expect(tsconfig.exclude).toContain('tests/scratch');
  });

  it('still says that both exclusions are needed, so neither reads as spare', () => {
    expect(prose(MAIN_CONFIG)).toContain('Excluded here and in tsconfig.json');
  });
});

describe('and one can still be run on purpose', () => {
  it('has a config of its own that includes only the workshop', () => {
    expect(SCRATCH_CONFIG).toContain("include: ['tests/scratch/**/*.test.ts']");
  });

  it('is reachable through a script, which is the documented way in', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> })
      .scripts;
    expect(scripts['test:scratch']).toBe('vitest run --config config/vitest.scratch.config.ts');
    expect(SCRATCH_CONFIG).toContain('npm run test:scratch');
  });

  it('exists because excluding the directory also made a probe unrunnable', () => {
    // The reason both configs exist rather than one. Without it, deleting the second config looks
    // like removing a duplicate.
    expect(prose(SCRATCH_CONFIG)).toContain(
      'vitest applies `exclude` even to an explicit filename filter',
    );
  });
});

describe('the exemption the workshop is given', () => {
  it('leaves the offline trap out, which the suite loads', () => {
    // The suite is offline by design and `offline.test.ts` proves the trap is armed there. A probe
    // written against a real server is a legitimate thing, and this is the absence that allows it.
    expect(MAIN_CONFIG).toContain("setupFiles: ['tests/support/offline.ts']");
    expect(SCRATCH_CONFIG).not.toContain('setupFiles');
    expect(SCRATCH_CONFIG).not.toContain('offline');
  });

  it('says so where someone would otherwise add it for consistency', () => {
    expect(prose(MAIN_CONFIG)).toContain('Not applied to `vitest.scratch.config.ts`');
  });
});
