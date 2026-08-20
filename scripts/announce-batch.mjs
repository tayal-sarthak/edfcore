#!/usr/bin/env node
/**
 * One GitHub release for a whole batch of versions.
 *
 * Until 0.4.326 every version got its own, because `publish.yml` triggered on a published release
 * and so a release was a mandatory step in shipping a patch. That is not what a release is for: a
 * hundred of them for changes of two or three lines each buries anything worth announcing, and the
 * tag was already the per-version record. Publishing now runs off the tag, which leaves this free
 * to do the job properly.
 *
 * The range runs from the newest tag that already has a release, exclusive, to the newest tag —
 * so running it twice in a row is a no-op rather than a duplicate, and a batch interrupted halfway
 * is picked up by the next run. The notes are the changelog entries for those versions, verbatim,
 * because they are already written for a reader who wants to know whether they were affected.
 *
 * `--through` closes a batch early, at a version that is not the newest tag. Batches are defined
 * by what was asked for, not by what happens to be tagged, so two of them can be in flight at once
 * — which is exactly how 0.4.328 came to sit above a range that ended at 0.4.327.
 *
 *     npm run announce                          # everything since the last release
 *     npm run announce -- --through 0.4.327     # …up to and including that version
 *     npm run announce -- --dry-run             # print what it would cut
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = new URL('../', import.meta.url);
const dryRun = process.argv.includes('--dry-run');

/** `--through 0.4.327`, the last version of the batch. Defaults to the newest tag. */
const through = (() => {
  const at = process.argv.indexOf('--through');
  if (at === -1) return undefined;
  const value = process.argv[at + 1];
  if (value === undefined || !/^\d+\.\d+\.\d+$/.test(value)) {
    console.error('\n  --through needs a version, as in `--through 0.4.327`.\n');
    process.exit(1);
  }
  return value;
})();

const die = (message) => {
  console.error(`\n  ${message}\n`);
  process.exit(1);
};

const capture = (command, args) =>
  execFileSync(command, args, { cwd: fileURLToPath(REPO), encoding: 'utf8' }).trim();

/** `0.4.309` -> `[0, 4, 309]`, for an ordering that is not lexical. */
const parts = (version) => version.split('.').map(Number);

const compare = (a, b) => {
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < 3; i += 1) {
    if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) - (right[i] ?? 0);
  }
  return 0;
};

// Tags, not the changelog: a version is shipped when its tag is public, and an entry can be
// written for a version whose run has not finished yet.
const tags = capture('git', ['tag', '--list', 'v*'])
  .split('\n')
  .filter((line) => /^v\d+\.\d+\.\d+$/.test(line))
  .map((line) => line.slice(1))
  .sort(compare);

if (tags.length === 0) die('No version tags here, so there is nothing to announce.');

/** The newest version that already carries a GitHub release, or undefined for none. */
const lastAnnounced = (() => {
  let published;
  try {
    published = capture('gh', ['release', 'list', '--limit', '200', '--json', 'tagName']);
  } catch {
    die('`gh release list` failed. Is the GitHub CLI authenticated for this repository?');
  }
  const released = new Set(
    JSON.parse(published)
      .map((entry) => entry.tagName)
      .filter((name) => /^v\d+\.\d+\.\d+$/.test(name))
      .map((name) => name.slice(1)),
  );
  return tags.filter((version) => released.has(version)).at(-1);
})();

if (through !== undefined && !tags.includes(through)) {
  die(`--through ${through}, but there is no v${through} tag here. Nothing was announced.`);
}

const batch = tags.filter(
  (version) =>
    (lastAnnounced === undefined || compare(version, lastAnnounced) > 0) &&
    (through === undefined || compare(version, through) <= 0),
);

if (batch.length === 0) {
  const newest = through ?? tags.at(-1);
  console.log(`\n  Nothing to announce up to ${newest}: it already carries a release.\n`);
  process.exit(0);
}

// ---------------------------------------------------------------- the notes
//
// Verbatim from the changelog, newest first, which is the order it is written in. A version in the
// batch with no entry is a real problem — `changelog-continuity.test.ts` exists for exactly that —
// so it is reported rather than skipped over.
const CHANGELOG = readFileSync(new URL('docs/CHANGELOG.md', REPO), 'utf8');

/** The body of `## <version>`, up to the next heading. */
const entryFor = (version) => {
  const heading = `## ${version}\n`;
  const start = CHANGELOG.indexOf(heading);
  if (start === -1) return undefined;
  const rest = CHANGELOG.slice(start + heading.length);
  const end = rest.indexOf('\n## ');
  return (end === -1 ? rest : rest.slice(0, end)).trim();
};

const missing = batch.filter((version) => entryFor(version) === undefined);
if (missing.length > 0) {
  die(
    `These tags have no changelog entry: ${missing.join(', ')}.\n\n` +
      '  Every released version has one, so this is a gap to fill rather than to announce past.',
  );
}

const first = batch[0];
const last = batch.at(-1);
const title = first === last ? `edfcore ${first}` : `edfcore ${first}–${last}`;
const notes = [
  batch.length === 1
    ? `One version, \`${first}\`.`
    : `${batch.length} versions, \`${first}\` through \`${last}\`, each one commit and one tag.`,
  '',
  ...[...batch].reverse().map((version) => `## ${version}\n\n${entryFor(version)}`),
].join('\n');

if (dryRun) {
  console.log(`\n  Would cut one release on v${last}: ${title}\n`);
  console.log(notes.replace(/^/gm, '  '));
  process.exit(0);
}

// Cut on the NEWEST tag of the batch, so the release points at the code the range ends with.
execFileSync('gh', ['release', 'create', `v${last}`, '--title', title, '--notes', notes], {
  cwd: fileURLToPath(REPO),
  stdio: 'inherit',
});

console.log(`
  Announced ${batch.length} version${batch.length === 1 ? '' : 's'} as one release on v${last}.

      https://github.com/tayal-sarthak/edfcore/releases/tag/v${last}
`);
