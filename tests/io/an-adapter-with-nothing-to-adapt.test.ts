/**
 * The three adapters `byteSource` left behind.
 *
 * `byteSource` has refused a wrong argument by name since the beginning, and `assertByteSource`
 * carries that courtesy up to `openEdf`. The other three adapters had nothing: `blobSource()` read
 * `blob.size`, `httpSource()` read `url.href`, and `cachedSource()` read `source.byteLength`, each
 * on its first line, so each answered with V8's `Cannot read properties of undefined` naming an
 * internal field (fixed in 0.6.102).
 *
 * `byteSource` states why this belongs at CONSTRUCTION rather than at the first read: a source built
 * over something that is not bytes surfaces later as `[SOURCE_TOO_SMALL] the header is 0 bytes`,
 * "blaming the FILE for a mistake in the caller's argument, which is the one confusion this package
 * works hardest to avoid."
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import { blobSource } from '../../src/io/blob.js';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { httpSource } from '../../src/io/http.js';
import type { BlobLike, ByteSource } from '../../src/types.js';

const BYTES = Uint8Array.of(1, 2, 3, 4);

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

describe('blobSource', () => {
  it.each([
    ['missing', undefined],
    ['null', null],
    ['a path string', '/tmp/recording.edf'],
    ['the bytes themselves', BYTES],
  ])('refuses %s by name rather than reading .size off it', async (_described, given) => {
    const error = await refusal(() => blobSource(loosely<BlobLike>(given)));
    expect(error.message).toContain('blobSource() needs a Blob or a File');
    expect(error.message).not.toContain('Cannot read properties');
    expect(isEdfError(error)).toBe(true);
  });

  it('names the two places a caller gets one, and the alternative', async () => {
    const { message } = await refusal(() => blobSource(loosely<BlobLike>(undefined)));
    expect(message).toContain('Next: pass the File an <input type="file"> or a drop event');
    expect(message).toContain('byteSource(bytes)');
  });

  it('still accepts a structural blob, which is what BlobLike is for', async () => {
    const over = (bytes: Uint8Array): BlobLike => ({
      size: bytes.byteLength,
      slice: (start, end) => over(bytes.slice(start, end)),
      arrayBuffer: () => Promise.resolve(bytes.slice().buffer as ArrayBuffer),
    });
    const blob = over(BYTES);
    const source = blobSource(blob);
    expect(source.byteLength).toBe(4);
    expect([...(await source.read(1, 2))]).toEqual([2, 3]);
  });
});

describe('httpSource', () => {
  it.each([
    ['missing', undefined],
    ['null', null],
    ['an object with no href', { url: 'https://example.test/a.edf' }],
  ])('refuses %s before it issues a request', async (_described, given) => {
    const error = await refusal(() =>
      httpSource(loosely<string>(given), { fetch: () => Promise.reject(new Error('no network')) }),
    );
    expect(error.message).toContain('httpSource() needs a URL string or a URL object');
    expect(error.message).toContain('new URL(address)');
    expect(error.message).not.toContain('no network');
  });

  it('still takes a URL object, which is the shape it was written for', async () => {
    // Refused for its address rather than for its type: this one has an href, so it gets as far as
    // the fetch, and the fetch is what fails.
    const error = await refusal(() =>
      httpSource(new URL('https://example.test/a.edf'), {
        fetch: () => Promise.reject(new Error('no network')),
      }),
    );
    expect(error.message).not.toContain('needs a URL string');
  });
});

describe('cachedSource', () => {
  it('gives the refusal openEdf gives, one call earlier', async () => {
    const error = await refusal(() => cachedSource(loosely<ByteSource>(BYTES)));
    expect(error.message).toContain('a ByteSource is needed');
    expect(error.message).toContain('byteSource(bytes)');
    expect(error.message).not.toContain('Cannot read properties');
  });

  it('still wraps a real source', async () => {
    const cached = cachedSource(byteSource(BYTES));
    expect(cached.byteLength).toBe(4);
    expect([...(await cached.read(0, 2))]).toEqual([1, 2]);
  });
});
