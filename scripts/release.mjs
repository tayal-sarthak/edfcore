/**
 * Cut a release.
 *
 * Publishing happens in CI, not here. This script only moves the version forward and creates
 * the GitHub Release; `.github/workflows/publish.yml` sees that release and publishes to npm
 * through trusted publishing, which needs no npm credential on this machine.
 *
 *   node scripts/release.mjs patch          0.1.1 -> 0.1.2
 *   node scripts/release.mjs minor          0.1.1 -> 0.2.0
 *   node scripts/release.mjs major          0.1.1 -> 1.0.0
 *   node scripts/release.mjs 0.3.0-rc.1     an exact version
 *   node scripts/release.mjs patch --dry-run
 *
 * The version lives in two places on purpose: `package.json`, and `VERSION` in
 * src/constants.ts so the built library can report its own version without importing JSON.
 * A test asserts they match, which means `npm version` alone leaves the repo failing its own
 * checks. Keeping the bump here is what stops that from happening again.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_JSON = join(ROOT, 'package.json');
const CHANGELOG = join(ROOT, 'CHANGELOG.md');
const CONSTANTS = join(ROOT, 'src/constants.ts');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const bump = args.find((a) => !a.startsWith('--')) ?? 'patch';

const run = (command, commandArgs, { capture = false } = {}) => {
  if (dryRun && command === 'git' && ['add', 'commit', 'tag', 'push'].includes(commandArgs[0])) {
    console.log(`  [dry-run] git ${commandArgs.join(' ')}`);
    return '';
  }
  if (dryRun && command === 'gh') {
    console.log(`  [dry-run] gh ${commandArgs.join(' ')}`);
    return '';
  }
  return execFileSync(command, commandArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
};

const capture = (command, commandArgs) =>
  run(command, commandArgs, { capture: true }).toString().trim();

const die = (message) => {
  console.error(`\n  ${message}\n`);
  process.exit(1);
};

// ---------------------------------------------------------------- preconditions

const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') die(`Releases are cut from main. You are on "${branch}".`);

if (capture('git', ['status', '--porcelain'])) {
  die('Working tree is dirty. Commit or stash first — a release must match a real commit.');
}

run('git', ['fetch', 'origin', 'main', '--quiet']);
const ahead = capture('git', ['rev-list', '--count', 'origin/main..HEAD']);
const behind = capture('git', ['rev-list', '--count', 'HEAD..origin/main']);
if (behind !== '0') die(`Local main is ${behind} commit(s) behind origin. Pull first.`);
if (ahead !== '0') die(`Local main is ${ahead} commit(s) ahead of origin. Push those first.`);

try {
  capture('gh', ['auth', 'status']);
} catch {
  die('The gh CLI is not authenticated. Run: gh auth login');
}

// ---------------------------------------------------------------- work out the new version

const manifest = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
const current = manifest.version;

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const parsed = SEMVER.exec(current);
if (!parsed) die(`Cannot parse the current version "${current}".`);
const [major, minor, patch] = [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])];

let next;
if (bump === 'patch') next = `${major}.${minor}.${patch + 1}`;
else if (bump === 'minor') next = `${major}.${minor + 1}.0`;
else if (bump === 'major') next = `${major + 1}.0.0`;
else if (SEMVER.test(bump)) next = bump;
else die(`"${bump}" is not "patch", "minor", "major", or a semver version.`);

const tag = `v${next}`;
const existingTags = capture('git', ['tag', '--list', tag]);
if (existingTags) die(`Tag ${tag} already exists. Versions are never reused on npm.`);

console.log(`\n  edfcore ${current} -> ${next}${dryRun ? '  (dry run)' : ''}\n`);

// ---------------------------------------------------------------- the changelog must agree
//
// The changelog entry is written by hand BEFORE the release runs, against the version the author
// expects to get. When a release fails after bumping — a lint error, a flaky test, an agent's
// scratch file in the tree — that number is consumed and the next run produces a different one,
// while the heading still names the old one. Every entry after it then inherits the drift.
//
// This has happened twice: 0.2.29 and 0.2.36 were both consumed that way, and both times every
// heading after them was off by one until someone compared `git show <tag>:CHANGELOG.md` against
// the tags by hand. Catching it here costs one file read and turns a silent documentation defect
// into a message before anything is committed.

const changelog = readFileSync(CHANGELOG, 'utf8');
const firstHeading = /^## (\d+\.\d+\.\d+.*)$/m.exec(changelog);
if (!firstHeading) {
  die('CHANGELOG.md has no "## <version>" heading. Add the entry for this release first.');
}
if (firstHeading[1] !== next) {
  die(
    `CHANGELOG.md's top entry is "## ${firstHeading[1]}" but this release is ${next}.\n\n` +
      `  Fix the heading to "## ${next}" and run again. If a number was skipped — a release that\n` +
      '  failed after bumping consumes one — record it as never released, the way 0.2.29, 0.2.36\n' +
      '  and 0.2.59 are.',
  );
}

// ---------------------------------------------------------------- bump, in both places

const constantsBefore = readFileSync(CONSTANTS, 'utf8');
const VERSION_LINE = /^export const VERSION = '[^']*';$/m;
if (!VERSION_LINE.test(constantsBefore)) {
  die(`Could not find the VERSION line in src/constants.ts. Bump it by hand and check this script.`);
}

manifest.version = next;
writeFileSync(PACKAGE_JSON, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(CONSTANTS, constantsBefore.replace(VERSION_LINE, `export const VERSION = '${next}';`));

console.log('  Syncing the lockfile');
run('npm', ['install', '--package-lock-only', '--silent']);

// ---------------------------------------------------------------- prove it before shipping it

console.log('  Running lint, typecheck and tests');
run('npm', ['run', 'check']);
console.log('  Building');
run('npm', ['run', 'build']);

// ---------------------------------------------------------------- commit, tag, release

run('git', ['add', 'package.json', 'package-lock.json', 'src/constants.ts']);
run('git', ['commit', '-m', `Release ${tag}`]);
run('git', ['tag', '-a', tag, '-m', tag]);
run('git', ['push', 'origin', 'main']);
run('git', ['push', 'origin', tag]);

run('gh', [
  'release',
  'create',
  tag,
  '--title',
  `edfcore ${next}`,
  '--generate-notes',
]);

if (dryRun) {
  console.log('\n  Dry run: reverting the local version bump.\n');
  // From HEAD, not from the index — the index would hand back the bump we are undoing.
  run('git', ['checkout', 'HEAD', '--', 'package.json', 'package-lock.json', 'src/constants.ts']);
  process.exit(0);
}

console.log(`
  Released ${tag}.

  publish.yml is now running and will publish to npm with a provenance attestation.
  Watch it with:   gh run watch
  Confirm with:    npm view edfcore version
`);
