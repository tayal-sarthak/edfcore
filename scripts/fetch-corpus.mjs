#!/usr/bin/env node

/**
 * Download the real-world EDF/BDF corpus described in tests/corpus/manifest.json.
 *
 *   npm run corpus:fetch
 *
 * Files land in tests/corpus/files/, which is gitignored. Nothing here is redistributed:
 * the manifest records where each file came from and under what terms, and the hash is
 * checked on arrival so a silently changed upstream file fails loudly instead of quietly
 * altering what the tests mean.
 *
 * The corpus tests skip when the files are absent, so `git clone && npm test` stays offline.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'tests', 'corpus', 'files');
const manifest = JSON.parse(readFileSync(join(root, 'tests', 'corpus', 'manifest.json'), 'utf8'));

mkdirSync(dir, { recursive: true });

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

let ok = 0;
let failed = 0;

for (const entry of manifest.files) {
  const target = join(dir, entry.name);

  if (existsSync(target)) {
    const actual = sha256(readFileSync(target));
    if (actual === entry.sha256) {
      console.log(`  have  ${entry.name}`);
      ok += 1;
      continue;
    }
    console.log(`  stale ${entry.name} (hash changed) — refetching`);
  }

  process.stdout.write(`  get   ${entry.name} … `);
  // A host that cannot be reached is one failed file, as an HTTP error status already was — not
  // a thrown rejection that ends the run before the files after it and before the summary.
  let payload;
  try {
    const response = await fetch(entry.url);
    if (!response.ok) {
      console.log(`HTTP ${response.status}`);
      failed += 1;
      continue;
    }
    payload = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    console.log(`unreachable: ${error?.cause?.code ?? error?.cause?.message ?? error?.message}`);
    failed += 1;
    continue;
  }

  let bytes = payload;
  if (entry.archiveEntry) {
    // The teuniz files ship as zips. Unpacking with the system tool keeps this script
    // dependency-free, which matters because the package itself has no dependencies.
    const unpack = join(dir, '.unpack');
    const tmp = join(unpack, `${entry.name}.zip`);
    mkdirSync(unpack, { recursive: true });
    writeFileSync(tmp, payload);
    execFileSync('unzip', ['-o', '-j', tmp, entry.archiveEntry, '-d', unpack], { stdio: 'ignore' });
    bytes = readFileSync(join(unpack, entry.archiveEntry));
    rmSync(unpack, { recursive: true });
  }

  const actual = sha256(bytes);
  if (actual !== entry.sha256) {
    console.log(`HASH MISMATCH\n        expected ${entry.sha256}\n        actual   ${actual}`);
    failed += 1;
    continue;
  }
  // Only once verified. The corpus tests run on any file that EXISTS, so a mismatched download
  // left under its real name would be read as the corpus and fail as if the library were wrong.
  writeFileSync(target, bytes);
  console.log(`ok (${(bytes.length / 1e6).toFixed(2)} MB)`);
  ok += 1;
}

console.log(`\n${ok} file(s) ready in tests/corpus/files/${failed ? `, ${failed} failed` : ''}`);
if (failed) process.exitCode = 1;
else console.log('Run `npm test` — the corpus tests will now execute instead of skipping.');

// Leave a breadcrumb so the directory is self-explanatory if someone finds it later.
if (ok > 0) {
  writeFileSync(
    join(dir, 'README.txt'),
    [
      'Downloaded EDF/BDF test files. NOT part of this repository and never committed.',
      'Provenance and licence for each file are in ../manifest.json.',
      'Regenerate with: npm run corpus:fetch',
      '',
      readdirSync(dir)
        .filter((f) => f !== 'README.txt')
        .sort()
        .join('\n'),
      '',
    ].join('\n'),
  );
}
