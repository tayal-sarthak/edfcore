/**
 * A source handed to `fileHandleSource`.
 *
 * What `fileSource` resolves to has a `read()` and a `close()`, which is all the handle guard
 * checked, so `fileHandleSource(await fileSource(path), size)` was accepted. Its first read then
 * called the source's `read(offset, length, options)` with a handle's `(buffer, offset, length,
 * position)` and failed on "the read options are 4" — arguments the caller never wrote.
 */

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fileHandleSource, fileSource } from '../../src/node.js';

describe('a ByteSource passed to fileHandleSource', () => {
  it('is refused at construction, by name', async () => {
    const source = await fileSource(fileURLToPath(import.meta.url));
    try {
      expect(() => fileHandleSource(source as never, source.byteLength)).toThrow(
        'fileHandleSource() received a ByteSource — what fileSource() resolves to',
      );
      expect(() => fileHandleSource(source as never, source.byteLength)).toThrow(
        'Next: pass it to openEdf() as it is.',
      );
    } finally {
      await source.close();
    }
  });

  it('still wraps a real handle', async () => {
    const { open } = await import('node:fs/promises');
    const handle = await open(new URL(import.meta.url), 'r');
    const source = fileHandleSource(handle, 4);
    try {
      expect((await source.read(0, 4)).length).toBe(4);
    } finally {
      await source.close();
    }
  });
});
