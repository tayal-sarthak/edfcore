/**
 * `fileSource` against the filesystem.
 *
 * The size refusal used to carry, as its "Next:", a check it never performed: "check that the path
 * names a regular file rather than a directory, a pipe or a device". None of the three can reach
 * it. A directory's `st_size` is its allocation (64 on macOS) and a FIFO's and a character device's
 * is 0 — all ordinary safe integers — so `fileSource(dir)` returned a working-looking `ByteSource`
 * and the first read failed with a raw `EISDIR` from Node instead (fixed in 0.3.98).
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EdfSourceError } from '../../src/errors.js';
import { fileSource } from '../../src/node.js';

const DIR = mkdtempSync(join(tmpdir(), 'edfcore-file-source-'));

describe('fileSource refuses what it cannot read from', () => {
  it('refuses a directory by name, rather than failing on the first read', async () => {
    const error = await fileSource(DIR).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(EdfSourceError);
    expect(error?.message).toContain('is not a regular file');
    // The premise: the OS reports a perfectly ordinary size for it, which is why the size guard
    // alone never fired.
    expect(error?.message).not.toContain('not a byte count');
  });

  it('opens a regular file and reads from it', async () => {
    const path = join(DIR, 'plain.bin');
    writeFileSync(
      path,
      Uint8Array.from({ length: 32 }, (_, i) => i),
    );
    const source = await fileSource(path);
    try {
      expect(source.byteLength).toBe(32);
      expect(Array.from(await source.read(4, 4))).toEqual([4, 5, 6, 7]);
    } finally {
      await source.close?.();
    }
  });
});
