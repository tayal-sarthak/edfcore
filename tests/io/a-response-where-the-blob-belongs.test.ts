/**
 * A fetch `Response` handed to `blobSource`.
 *
 * It is the object in hand on the line after `fetch()`, and it has a `.blob()` rather than a
 * `size` and a `slice()`, so it was refused as "an object" and sent to "the File an
 * <input type="file"> or a drop event hands you" — a route it never came from. A pending
 * `response.blob()` already had its own sentence (0.6.296); the Response one step before it did not.
 */

import { describe, expect, it } from 'vitest';
import { blobSource } from '../../src/io/blob.js';

describe('a Response where the Blob belongs', () => {
  it('names it a Response and gives both routes to the bytes', () => {
    const response = new Response(new Uint8Array(8));
    expect(() => blobSource(response as never)).toThrow('that is a fetch Response');
    expect(() => blobSource(response as never)).toThrow('await response.blob()');
    expect(() => blobSource(response as never)).toThrow('httpSource(url)');
  });

  it('still takes the Blob the Response resolves to', async () => {
    const blob = await new Response(new Uint8Array(8)).blob();
    expect(blobSource(blob).byteLength).toBe(8);
  });
});
