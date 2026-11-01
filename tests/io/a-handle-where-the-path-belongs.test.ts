/**
 * An open file handle handed to `fileSource` where the path belongs.
 *
 * `fs.open(path)` resolves to a handle, and a caller who already opened the file passes that.
 * It was told to pass the path as a string, or `byteSource(bytes)` — not the adapter in this same
 * module that takes exactly the object in hand.
 */

import { open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { fileSource } from '../../src/node.js';

it('fileSource() sends an open handle to fileHandleSource', async () => {
  const handle = await open(fileURLToPath(import.meta.url));
  try {
    await expect(fileSource(handle as never)).rejects.toThrow(
      'Next: that is an open file handle — pass it to fileHandleSource(handle, (await ' +
        'handle.stat()).size), or pass the path it was opened from here.',
    );
  } finally {
    await handle.close();
  }
});
