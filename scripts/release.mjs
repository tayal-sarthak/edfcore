/**
 * Cut a release.
 *
 * Publishing happens in CI, not here. This script only moves the version forward and creates
 * the GitHub Release; `.github/workflows/publish.yml` sees that release and publishes to npm with
 * the NPM_TOKEN repository secret, so no npm credential is needed on this machine. Trusted
 * publishing would be better and is not available here — see the note in that workflow.
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
const CHANGELOG = join(ROOT, 'docs', 'CHANGELOG.md');
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
// expects to get. A release that failed after bumping used to consume that number — the next run
// produced a different one while the heading still named the old one, and every entry after it
// inherited the drift. Since 0.4.200 the bump is put back when the checks fail, so this heading
// check now guards the cases that revert cannot reach: a heading typed wrong by hand, and a run
// that dies after the commit is already made.
//
// This has happened four times: 0.2.29, 0.2.36, 0.2.59 and 0.4.176 were all consumed that way. The
// first two took every heading after them off by one until someone compared
// `git show <tag>:docs/CHANGELOG.md` against the tags by hand — `<tag>:CHANGELOG.md` for anything
// before v0.4.1, which is where the file moved. The later two were written down as never released
// at the time. Catching it here costs one file read and turns a silent documentation defect into a
// message before anything is committed.
//
// That by-hand comparison no longer works everywhere. 0.4.150 through 0.4.244 were squashed into
// 43 commits, so 51 of those tags share a commit with a later version and `git show <tag>:` hands
// back that version's changelog rather than their own. Every tag before 0.4.150 is unaffected, and
// the originals are on the `archive/pre-squash-2026-08-16` branch — read the tag from there when
// the range matters. Which is the argument for this check: a guard that runs before the commit
// does not depend on the history being reconstructible afterwards.

const changelog = readFileSync(CHANGELOG, 'utf8');
const firstHeading = /^## (\d+\.\d+\.\d+.*)$/m.exec(changelog);
if (!firstHeading) {
  die('docs/CHANGELOG.md has no "## <version>" heading. Add the entry for this release first.');
}
if (firstHeading[1] !== next) {
  die(
    `docs/CHANGELOG.md's top entry is "## ${firstHeading[1]}" but this release is ${next}.\n\n` +
      `  Fix the heading to "## ${next}" and run again. If a number really was skipped, record it\n` +
      '  as never released, the way 0.2.29, 0.2.36, 0.2.59 and 0.4.176 are — though since 0.4.200\n' +
      '  a failed check puts the bump back rather than consuming the number.',
  );
}

// ---------------------------------------------------------------- bump, in both places

const constantsBefore = readFileSync(CONSTANTS, 'utf8');
const VERSION_LINE = /^export const VERSION = '[^']*';$/m;
if (!VERSION_LINE.test(constantsBefore)) {
  die(
    `Could not find the VERSION line in src/constants.ts. Bump it by hand and check this script.`,
  );
}

manifest.version = next;
writeFileSync(PACKAGE_JSON, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  CONSTANTS,
  constantsBefore.replace(VERSION_LINE, `export const VERSION = '${next}';`),
);

// ---------------------------------------------------------------- prove it before shipping it
//
// The bump is already on disk here, and everything below can fail. A run that stops now without
// putting it back CONSUMES the number: the next run reads the bumped version and produces the one
// after it. That is how 0.2.29, 0.2.36, 0.2.59 and 0.4.176 were lost, and each cost an entry in
// the changelog explaining a hole rather than a release. Undoing the bump costs one git checkout
// and leaves the number available for the run that fixes whatever failed.
//
// The lockfile sync is inside this too. It reaches the registry, so it fails for reasons that have
// nothing to do with the code — and it runs after the bump, which is the only thing that matters
// for whether the number survives.

// From HEAD, not from the index — the index would hand back the bump being undone.
const restoreVersionFiles = () =>
  run('git', ['checkout', 'HEAD', '--', 'package.json', 'package-lock.json', 'src/constants.ts']);

try {
  console.log('  Syncing the lockfile');
  run('npm', ['install', '--package-lock-only', '--silent']);
  console.log('  Running lint, typecheck and tests');
  run('npm', ['run', 'check']);
  console.log('  Building');
  run('npm', ['run', 'build']);
} catch {
  restoreVersionFiles();
  die(
    `The checks failed, so ${tag} was not cut and the bump has been undone.\n\n` +
      `  ${current} is still the version on disk and ${next} is still free — fix what failed\n` +
      '  above and run again to get it.',
  );
}

// ---------------------------------------------------------------- commit, tag, release

run('git', ['add', 'package.json', 'package-lock.json', 'src/constants.ts']);
run('git', ['commit', '-m', `Release ${tag}`]);
run('git', ['tag', '-a', tag, '-m', tag]);
run('git', ['push', 'origin', 'main']);
run('git', ['push', 'origin', tag]);

// ---------------------------------------------------------------- CI, on this exact commit
//
// `npm run check` above ran on THIS machine, and that is not the same question as whether it
// passes. Twice now a check has been green here and red on every runner: one read a file whose
// tsconfig lives in `website/node_modules`, which CI does not install, and one required
// `tests/scratch/` to exist, which is gitignored and never on a fresh clone. Between them,
// 0.4.231 through 0.4.236 and 0.4.241 through 0.4.242 were tagged and never published — eight
// numbers, each of which the publish run refused for the same reason, silently, because
// publish.yml fails long after this script has exited 0.
//
// So the release waits for the runners before it opens the door to npm. CI runs on the push
// above; this polls the check runs for that commit and refuses to create the GitHub release if
// any of them fails. A failure now leaves the tag pushed and no release, which is recoverable —
// fix, then `gh release create` — rather than a version that exists in git and nowhere else.

const CI_POLL_SECONDS = 15;
const CI_TIMEOUT_MINUTES = 20;

/** Synchronous, and no subprocess: the script is a straight line and has nothing else to do. */
const sleepSeconds = (seconds) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);

/** `{ total, pending, failed }` for a commit's check runs, or undefined if gh could not say. */
const checkRuns = (sha) => {
  try {
    return JSON.parse(
      capture('gh', [
        'api',
        `repos/{owner}/{repo}/commits/${sha}/check-runs`,
        '--jq',
        '{total: .total_count,' +
          ' pending: [.check_runs[] | select(.status != "completed")] | length,' +
          ' failed: [.check_runs[] | select(.conclusion == "failure" or' +
          ' .conclusion == "timed_out" or .conclusion == "cancelled")] | map(.name)}',
      ]),
    );
  } catch {
    return undefined;
  }
};

const releaseSha = capture('git', ['rev-parse', 'HEAD']);
if (!dryRun) {
  console.log(`  Waiting for CI on ${releaseSha.slice(0, 7)}`);
  const deadline = CI_TIMEOUT_MINUTES * 60;
  let waited = 0;
  for (;;) {
    const status = checkRuns(releaseSha);
    if (status !== undefined && status.failed.length > 0) {
      die(
        `${tag} is tagged and pushed, but CI failed on this commit: ${status.failed.join(', ')}.\n\n` +
          '  No GitHub release was created, so nothing has gone to npm. The tag is public and\n' +
          '  cannot be undone; fix what failed, push the fix, and finish this version by hand:\n\n' +
          `      gh release create ${tag} --title "edfcore ${next}" --generate-notes\n\n` +
          '  Re-running this script instead would cut the NEXT version and leave this one a hole,\n' +
          '  which is how eight numbers were lost before this check existed.',
      );
    }
    // `total: 0` means the runners have not registered yet, which is not the same as green.
    if (status !== undefined && status.total > 0 && status.pending === 0) break;
    if (waited >= deadline) {
      die(
        `${tag} is tagged and pushed, but CI has not finished after ${CI_TIMEOUT_MINUTES} minutes.\n\n` +
          '  No GitHub release was created and nothing has gone to npm. Watch it with\n' +
          '  `gh run watch`, and once it is green finish this version by hand:\n\n' +
          `      gh release create ${tag} --title "edfcore ${next}" --generate-notes`,
      );
    }
    sleepSeconds(CI_POLL_SECONDS);
    waited += CI_POLL_SECONDS;
  }
  console.log('  CI is green');
}

// The one step whose failure the revert above cannot reach. By here the bump is committed and the
// tag is pushed, so there is nothing local left to undo — and publish.yml triggers on a PUBLISHED
// release, not on a tag, so stopping here leaves a version that exists in git and never reaches
// npm. That is a hole nothing else in this repository would notice: `changelog-continuity.test.ts`
// checks this file against itself, and the entry would be present and correct.
try {
  run('gh', ['release', 'create', tag, '--title', `edfcore ${next}`, '--generate-notes']);
} catch {
  die(
    `${tag} is committed, tagged and pushed, but creating the GitHub release failed.\n\n` +
      '  Nothing has gone to npm: publish.yml runs on a published release. The bump cannot be\n' +
      '  undone now that the tag is public, so finish the release rather than repeating it:\n\n' +
      `      gh release create ${tag} --title "edfcore ${next}" --generate-notes\n\n` +
      '  Re-running this script instead would cut the NEXT version and leave this one a hole.',
  );
}

if (dryRun) {
  console.log('\n  Dry run: reverting the local version bump.\n');
  restoreVersionFiles();
  process.exit(0);
}

console.log(`
  Released ${tag}.

  publish.yml is now running and will publish to npm with a provenance attestation.
  Watch it with:   gh run watch
  Confirm with:    npm view edfcore version
`);
