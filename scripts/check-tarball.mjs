#!/usr/bin/env node

/**
 * What `npm publish` would actually send, checked against what this repository says it sends.
 *
 * `publint` checks the manifest is well formed and says nothing about MEMBERSHIP, which is where
 * the claims are: `tests/README.md` promises "nothing under `tests/` ever ships", and the fixture
 * policy says the six committed binaries are excluded from the published package. Wrong either way
 * is quiet — a stray `tests/` ships 2.1 MB of other people's EDF files with the licence questions
 * that policy exists to avoid, and a missing `dist/` ships a package that installs and cannot be
 * imported. Neither surfaces until someone downloads it, and by then the version is immutable.
 *
 * A script rather than a test, and that is the whole history of this check. It began in the test
 * suite in 0.4.287 and could not work there: packing this
 * package runs `prepublishOnly`, which is `npm run check`, which runs the suite that contains the
 * test — so `npm pack --json` printed the entire test run before its JSON, and `JSON.parse` read
 * `npm notice run biome check` instead. `--ignore-scripts` did not settle it either; the publish
 * runner's npm ran the lifecycle regardless. Seven versions were tagged and never published while
 * that was in the suite (0.4.287 through 0.4.292). Asking the question outside the suite removes
 * the recursion rather than parsing around it.
 *
 *   npm run verify:tarball
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const failures = [];
const fail = (message) => failures.push(message);

const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});
const packed = JSON.parse(out)[0]?.files;
if (packed === undefined) {
  console.error(
    '\n  npm pack --json produced no file list. Run it by hand and look at the shape.\n',
  );
  process.exit(1);
}
const paths = packed.map((file) => file.path);
const under = (prefix) => paths.filter((path) => path.startsWith(prefix));

if (paths.length < 100) fail(`the tarball holds only ${paths.length} files`);

// --- what the package needs -----------------------------------------------

if (under('dist/').length < 50)
  fail('dist/ is missing or nearly empty, so an install cannot import');
if (under('src/').length < 40) fail('src/ is missing, so the sourcemaps resolve to nothing');

for (const target of Object.values(manifest.exports)) {
  if (typeof target !== 'object' || target === null) continue;
  for (const path of Object.values(target)) {
    const relative = path.replace(/^\.\//, '');
    if (!paths.includes(relative)) fail(`${relative} is in the exports map and not in the tarball`);
  }
}
const bin = manifest.bin.edfcore.replace(/^\.\//, '');
if (!paths.includes(bin)) fail(`${bin} is the bin target and is not in the tarball`);

const docs = under('docs/');
if (docs.length !== 1 || docs[0] !== 'docs/CHANGELOG.md') {
  fail(`docs/ holds ${JSON.stringify(docs)}, and files lists only the changelog`);
}

// --- and nothing it should not --------------------------------------------

for (const prefix of ['tests/', 'website/', 'config/', 'scripts/', '.github/', 'node_modules/']) {
  const strays = under(prefix);
  if (strays.length > 0) fail(`${prefix} reached the tarball: ${strays.slice(0, 3).join(', ')}`);
}
const fixtures = paths.filter((path) => /(^|\/)(corpus|scratch)\//.test(path));
if (fixtures.length > 0) fail(`fixtures reached the tarball: ${fixtures.slice(0, 3).join(', ')}`);

// --- report ----------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n  ${failures.length} problem(s) in the tarball:\n`);
  for (const message of failures) console.error(`    ${message}`);
  console.error('');
  process.exit(1);
}

console.log(`  Tarball checked: ${paths.length} files, every export and bin target present.`);
