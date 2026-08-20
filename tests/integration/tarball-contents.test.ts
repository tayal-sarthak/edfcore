/**
 * What `npm publish` would actually send, checked against what this repository says it sends.
 *
 * `publint` runs in CI and checks the manifest is well formed — that the exports map resolves,
 * that the types line up. It says nothing about MEMBERSHIP, and membership is where the claims
 * are: `tests/README.md` says "nothing under `tests/` ever ships", the fixture policy explains
 * that the six committed binaries are "excluded from the published package", and `files` names
 * exactly three entries.
 *
 * Getting that wrong is quiet in both directions. A stray `tests/` in the tarball ships 2.1 MB of
 * other people's EDF files to every consumer, with the licence questions the fixture policy exists
 * to avoid. A missing `dist/` ships a package that installs and cannot be imported. Neither shows
 * up until someone downloads it, and by then the version is immutable.
 *
 * `npm pack --dry-run --json` is the same code path a publish takes, so this asks npm rather than
 * reimplementing its ignore rules — which is the whole difficulty of the question.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);

const MANIFEST = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8')) as {
  files: readonly string[];
  main?: string;
  exports: Record<string, unknown>;
  bin: Record<string, string>;
};

/** Every path npm would put in the tarball. */
const PACKED: readonly string[] = (() => {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: fileURLToPath(ROOT),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return (JSON.parse(out) as Array<{ files: Array<{ path: string }> }>)[0]?.files.map(
    (file) => file.path,
  ) as string[];
})();

const under = (prefix: string): readonly string[] =>
  PACKED.filter((path) => path.startsWith(prefix));

describe('the tarball was built', () => {
  it('has files in it, so a passing run is not a vacuous one', () => {
    expect(PACKED.length).toBeGreaterThan(100);
    expect(PACKED).toContain('package.json');
  });
});

describe('it carries what the package needs', () => {
  it('ships the build, so an install can be imported', () => {
    expect(under('dist/').length).toBeGreaterThan(50);
    for (const target of Object.values(MANIFEST.exports)) {
      if (typeof target !== 'object' || target === null) continue;
      for (const path of Object.values(target as Record<string, string>)) {
        expect(PACKED, `${path} is in the exports map`).toContain(path.replace(/^\.\//, ''));
      }
    }
    expect(PACKED).toContain(MANIFEST.bin.edfcore?.replace(/^\.\//, '') as string);
  });

  it('ships the sources the sourcemaps point at', () => {
    // `files` lists `src` so `dist/*.js.map` resolves `../src/x.ts` inside the tarball.
    expect(under('src/').length).toBeGreaterThan(40);
  });

  it('ships the changelog, and only the changelog, from docs', () => {
    expect(under('docs/')).toEqual(['docs/CHANGELOG.md']);
  });
});

describe('and nothing it should not', () => {
  it.each(['tests/', 'website/', 'config/', 'scripts/', '.github/', 'node_modules/'])(
    'leaves out %s',
    (prefix) => {
      // `tests/` is the one with teeth: it holds 2.1 MB of committed EDF/BDF files whose licences
      // the fixture policy is written around, and `tests/README.md` promises none of it ships.
      expect(under(prefix), `${prefix} reached the tarball`).toEqual([]);
    },
  );

  it('leaves out the corpus and the throwaway probes wherever they live', () => {
    const strays = PACKED.filter((path) => /(^|\/)(corpus|scratch)\//.test(path));
    expect(strays).toEqual([]);
  });
});
