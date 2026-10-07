/**
 * The third adapter with this hole, and the last.
 *
 * 0.6.295 closed it for a Blob and 0.6.296 for an address. A path is the one left, and its advice is
 * the one most likely to be taken literally: "pass the path as a string" is exactly what the caller
 * did — except that what they passed was a Promise OF one.
 *
 * `node:fs/promises` is where it comes from, and this adapter's whole subject is that module.
 * `fs.realpath`, `fs.mkdtemp` and `fs.readdir` all resolve to paths rather than returning them, and a
 * resolved symlink is the commonest of the three: `fileSource(fs.realpath(p))` is a line someone
 * writes when a recording arrives through a symlinked spool directory.
 *
 * `assertByteSource` has named the keyword for `fileSource` itself since 0.6.264 — "fileSource(path)
 * from "edfcore/node" and httpSource(url) are both async, so both need awaiting". That is about this
 * function's RESULT. Its argument is the other half, and it said nothing.
 *
 * `byteSource(bytes)` stays in the other arm, because that is the mistake 0.6.116 wrote it for:
 * `fs.open` accepts a `Uint8Array` as a path, so a file already in memory passed here is opened as
 * the bytes of a filename and comes back as `ENOENT` naming the EDF header's own bytes (0.6.297).
 */

import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileSource } from '../../src/node.js';
import { minimalEdfPlus } from '../support/writer.js';

const refusal = async (path: unknown): Promise<string> =>
  Promise.resolve()
    .then(() => fileSource(path as never))
    .then(
      (source) => source.close().then(() => ''),
      (error: unknown) => (error as Error).message,
    );

describe('a path the realpath had not awaited', () => {
  it('is what fs.realpath really returns, and what it resolves to opens', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'edfcore-fsource-'));
    const file = join(directory, 'a.edf');
    await writeFile(file, minimalEdfPlus());
    const pending = realpath(file);
    expect(typeof (pending as { then?: unknown }).then).toBe('function');
    // And the resolved value opens, so the keyword is the whole difference.
    const source = await fileSource(await pending);
    try {
      expect(source.byteLength).toBeGreaterThan(0);
    } finally {
      await source.close();
    }
  });

  it('is told to await it, and the three calls that resolve to one are named', async () => {
    const message = await refusal(realpath(tmpdir()));
    expect(message).toContain('received a pending Promise');
    expect(message).toMatch(/Next: await it/);
    expect(message).toContain('fs.realpath');
    expect(message).toContain('fs.mkdtemp');
    expect(message).toContain('fs.readdir');
    expect(message).toContain('node:fs/promises');
  });

  it('no longer tells them to pass the path as a string, which they did', async () => {
    const message = await refusal(Promise.resolve('/tmp/a.edf'));
    expect(message).not.toMatch(/Next: pass the path as a string/);
  });

  it('keeps the in-memory advice for everything that is not a Promise', async () => {
    for (const [what, value] of [
      ['undefined', undefined],
      ['a number', 8],
      ['a Uint8Array', new Uint8Array(8)],
      ['a plain object', { path: '/tmp/a.edf' }],
    ] as ReadonlyArray<readonly [string, unknown]>) {
      const message = await refusal(value);
      expect(message, what).toMatch(/Next: pass the path as a string, or byteSource\(bytes\)/);
      expect(message, what).toContain('the bytes of a filename');
      expect(message, what).not.toMatch(/Next: await it/);
    }
  });

  it('still says what it needs, in both arms', async () => {
    for (const value of [Promise.resolve('/tmp/a.edf'), 8]) {
      const message = await refusal(value);
      expect(message).toContain('fileSource() needs a path');
      expect(message).toMatch(/Next:/);
    }
  });

  it('completes the family: all three adapters now name the keyword', async () => {
    const { blobSource } = await import('../../src/io/blob.js');
    const { httpSource } = await import('../../src/io/http.js');
    const messages = [
      await refusal(Promise.resolve('/tmp/a.edf')),
      (() => {
        try {
          blobSource(Promise.resolve(new Blob([])) as never);
          return '';
        } catch (error) {
          return (error as Error).message;
        }
      })(),
      await Promise.resolve()
        .then(() => httpSource(Promise.resolve('https://example.test/f.edf') as never))
        .then(
          () => '',
          (error: unknown) => (error as Error).message,
        ),
    ];
    for (const message of messages) {
      expect(message).toContain('a pending Promise');
      expect(message).toMatch(/Next: await it/);
    }
  });
});
