/**
 * A Blob handed to `fileSource`.
 *
 * `fs.openAsBlob(path)` is Node's own way of opening a file as a Blob, and `fileSource` answered
 * the Blob it resolves to with "pass the path as a string" — when the caller had already opened the
 * file, and the adapter that reads it is `blobSource`.
 */

import { openAsBlob } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fileSource } from '../../src/node.js';

async function refusal(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a refusal');
}

describe('a Blob passed to fileSource', () => {
  it('names it, and the adapter that reads one', async () => {
    const blob = await openAsBlob(new URL(import.meta.url));
    const thrown = await refusal(() => fileSource(blob as never));
    expect(thrown.message).toContain('that is a Blob — what fs.openAsBlob() resolves to');
    expect(thrown.message).toContain('blobSource(blob)');
    expect(thrown.message).not.toContain('pass the path as a string');
  });

  it('keeps the byteSource advice for bytes', async () => {
    const thrown = await refusal(() => fileSource(new Uint8Array(8) as never));
    expect(thrown.message).toContain('byteSource(bytes)');
  });
});
