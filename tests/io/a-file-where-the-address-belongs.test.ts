/**
 * A file handed to `httpSource`.
 *
 * The browser demo's two inputs are a URL field and a file picker, and the File from the picker
 * passed to the adapter for the field was told "pass the address as a string, or as new
 * URL(address)" — a conversion that does not exist, for a file that has no address.
 */

import { describe, expect, it } from 'vitest';
import { byteSource, httpSource } from '../../src/index.js';

// Offline: every refusal here comes before a request, and a stub proves none was made.
const fetch = (() => {
  throw new Error('no request should be made');
}) as never;

describe('a Blob passed to httpSource', () => {
  it('sends it to blobSource', async () => {
    for (const file of [new Blob([new Uint8Array(4)]), new File([new Uint8Array(4)], 'a.edf')]) {
      await expect(httpSource(file as never, { fetch })).rejects.toThrow(
        'Next: that is a Blob, which holds the file rather than an address of one — pass it to ' +
          'blobSource(file).',
      );
    }
  });

  it('names a source handed back to it, as every other adapter does', async () => {
    const source = byteSource(new Uint8Array(4));
    await expect(httpSource(source as never, { fetch })).rejects.toThrow(
      'Next: that is a ByteSource — the object this call makes, not the address it makes one ' +
        'from — so pass it to openEdf() as it is.',
    );
  });

  it('keeps the generic advice for an object that is neither', async () => {
    await expect(httpSource({} as never, { fetch })).rejects.toThrow(
      'Next: pass the address as a string, or as new URL(address).',
    );
  });
});
