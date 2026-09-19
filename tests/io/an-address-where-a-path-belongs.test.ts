/**
 * `fileSource` given a URL that names something other than a file on disk.
 *
 * A URL object is an accepted argument — the guard above it says so in as many words — and `fs.open`
 * takes one only when its scheme is `file:`. Anything else came back as Node's own
 * `TypeError: The URL must be of scheme file`: no `Next:` clause, not an `EdfSourceError`, so
 * `isEdfError` was false, and nothing naming the adapter that does read an address. A string spelled
 * `https://…` fared no better — it became a relative filename and came back as `ENOENT`, naming a
 * path nobody meant.
 *
 * `http://` is the mistake this argument invites, because `httpSource` is the sibling one subpath
 * over and both take "where the file is". 0.6.184 made exactly this courtesy in the other direction:
 * `httpSource` refuses a `file:` address and names `fileSource`. This side of the pair said nothing.
 *
 * Nothing here opens anything: every address below is refused before the syscall.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EdfSourceError, isEdfError } from '../../src/errors.js';
import { fileSource } from '../../src/node.js';
import { openEdf } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const DIRECTORY = mkdtempSync(join(tmpdir(), 'edfcore-file-source-'));
const PATH = join(DIRECTORY, 'study.edf');
writeFileSync(PATH, FILE);

const NOT_A_PATH: ReadonlyArray<readonly [string, string | URL]> = [
  ['an https string', 'https://example.org/study.edf'],
  ['an http string', 'http://example.org/study.edf'],
  ['a URL object over http', new URL('http://example.org/study.edf')],
  ['a URL object over https', new URL('https://example.org/study.edf')],
  ['an ftp string', 'ftp://example.org/study.edf'],
];

describe.each(NOT_A_PATH)('given %s', (_name, address) => {
  it('is refused in edfcore\u2019s own voice, with a next step', async () => {
    const thrown = await fileSource(address as never).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown, 'the address reached the syscall').toBeDefined();
    expect(thrown?.message).toContain('reads a file on disk');
    expect(thrown?.message).toContain('Next:');
    // Neither of the two raw errors it used to produce.
    expect(thrown?.message).not.toContain('must be of scheme file');
    expect(thrown?.message).not.toContain('ENOENT');
  });

  it('names the adapter that does read an address', async () => {
    const thrown = await fileSource(address as never).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown?.message).toContain('httpSource(url)');
    expect(thrown?.message).toContain('blobSource(file)');
  });

  it('is an EdfSourceError, as every other refusal from this adapter is', async () => {
    const thrown = await fileSource(address as never).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown).toBeInstanceOf(EdfSourceError);
    expect(isEdfError(thrown)).toBe(true);
    expect(thrown).not.toBeInstanceOf(TypeError);
  });
});

describe('a path that really is one', () => {
  it('still opens a plain filesystem path', async () => {
    const source = await fileSource(PATH);
    expect(source.byteLength).toBe(FILE.byteLength);
    expect((await openEdf(source)).header.recordCount).toBe(4);
    await source.close();
  });

  it('still opens a file: URL, which fs.open accepts', async () => {
    const source = await fileSource(pathToFileURL(PATH) as never);
    expect(source.byteLength).toBe(FILE.byteLength);
    await source.close();
  });

  it('is unbothered by a Windows-style drive letter, which is not a scheme', async () => {
    // `C:\\study.edf` has a colon but no `//`, so it is a path and must reach the syscall.
    const thrown = await fileSource('C:\\study.edf').then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown?.message).not.toContain('reads a file on disk');
  });

  it('still refuses bytes handed in where the path belongs, which 0.6.116 added', async () => {
    await expect(fileSource(FILE as never)).rejects.toThrow(/fileSource\(\) needs a path/);
  });
});
