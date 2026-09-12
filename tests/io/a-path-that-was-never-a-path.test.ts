/**
 * The two Node adapters, given the wrong first argument.
 *
 * `fs.open` accepts a `Uint8Array` as a path — the BYTES OF a filename — so `fileSource(bytes)`,
 * which is the mistake a caller with a file already in memory makes, reached the syscall and came
 * back as `ENOENT: no such file or directory, open '0       X X X X                 '`: the EDF
 * header's own bytes rendered as a filename, in an error that also names `Uint8Array` as an accepted
 * type. `assertByteSource` recognises a path string and names `fileSource`; this is that courtesy in
 * the other direction.
 *
 * `fileHandleSource` was worse, because it succeeded. 0.6.85 checked the size and not the handle, so
 * `fileHandleSource(path, size)` — the two arguments in the order `fileSource(path)` teaches, with
 * the size this function is named for — returned a source advertising the right `byteLength` and
 * failed later on `handle.read is not a function`. `byteSource` states the rule: refuse at
 * CONSTRUCTION, because a source built over something that cannot serve bytes surfaces later as a
 * complaint about the file (fixed in 0.6.116).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import { fileHandleSource, fileSource } from '../../src/node.js';

const FIXTURE = new URL('../corpus/golden/edf-annotations.edf', import.meta.url);
const BYTES = new Uint8Array(readFileSync(FIXTURE));

/** The cast a JavaScript caller does not need to write. */
const loosely = <T>(value: unknown) => value as T;

async function refusal(run: () => unknown): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error('the argument was accepted');
}

describe('fileSource', () => {
  it('names the bytes as bytes rather than opening them as a filename', async () => {
    const error = await refusal(() => fileSource(loosely<string>(BYTES)));
    expect(error.message).toContain('fileSource() needs a path, and received Uint8Array');
    expect(error.message).toContain('byteSource(bytes)');
    expect(isEdfError(error)).toBe(true);
  });

  it('says what Node would have done with them', async () => {
    const { message } = await refusal(() => fileSource(loosely<string>(BYTES)));
    expect(message).toContain('would be opened as the bytes of a filename');
  });

  it('never puts the file content in the message', async () => {
    const { message } = await refusal(() => fileSource(loosely<string>(BYTES)));
    expect(message).not.toContain('ENOENT');
    expect(message).not.toContain('EDF Annotations');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['a number', 3],
  ])('refuses %s', async (_described, given) => {
    expect((await refusal(() => fileSource(loosely<string>(given)))).message).toContain(
      'fileSource() needs a path',
    );
  });

  it('still opens a path, and still opens a file URL', async () => {
    for (const path of [FIXTURE, FIXTURE.pathname]) {
      const source = await fileSource(loosely<string>(path));
      expect(source.byteLength).toBe(BYTES.byteLength);
      await source.close();
    }
  });
});

describe('fileHandleSource', () => {
  it('refuses a path at construction rather than failing on the first read', async () => {
    const error = await refusal(() => fileHandleSource(loosely('recording.edf'), 10));
    expect(error.message).toContain('fileHandleSource() needs an open file handle');
    expect(error.message).toContain('received the string "recording.edf"');
    expect(error.message).toContain('fileSource(path)');
  });

  it('checks the handle before the size, so the first wrong argument is the one reported', async () => {
    const { message } = await refusal(() => fileHandleSource(loosely('recording.edf'), Number.NaN));
    expect(message).toContain('needs an open file handle');
    expect(message).not.toContain('byteLength of NaN');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['an object with only a read()', { read: () => undefined }],
  ])('refuses %s', async (_described, given) => {
    expect((await refusal(() => fileHandleSource(loosely(given), 10))).message).toContain(
      'needs an open file handle',
    );
  });

  it('still wraps a real handle', async () => {
    const opened = await fileSource(FIXTURE.pathname);
    expect(opened.byteLength).toBe(BYTES.byteLength);
    await opened.close();
  });
});
