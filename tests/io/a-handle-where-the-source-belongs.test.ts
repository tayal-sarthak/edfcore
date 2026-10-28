/**
 * An open file handle handed to an entry point that takes a source.
 *
 * A handle from `fs.open` has a `read()` and no `byteLength`, so it fails the structural check by
 * one field, and was described as "Object" and answered with the four-adapter list. The adapter
 * for exactly this object, `fileHandleSource`, was not among them.
 */

import { open } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { openEdf, readHeader } from '../../src/index.js';

async function refusal(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a refusal');
}

describe('an fs.open handle passed where the source belongs', () => {
  it.each([
    ['openEdf', (given: unknown) => openEdf(given as never)],
    ['readHeader', (given: unknown) => readHeader(given as never)],
  ])('%s() sends it to fileHandleSource with the size it needs', async (_call, run) => {
    const handle = await open(new URL(import.meta.url), 'r');
    try {
      const thrown = await refusal(() => run(handle));
      expect(thrown.message).toContain('that is an open file handle');
      expect(thrown.message).toContain('fileHandleSource(handle, (await handle.stat()).size)');
    } finally {
      await handle.close();
    }
  });

  it('does not take a source that merely has a read() for a handle', async () => {
    const thrown = await refusal(() => openEdf({ read: () => undefined } as never));
    expect(thrown.message).not.toContain('file handle');
  });
});
