/**
 * The two places a caller DECLARES a source's size, and what they say about a size they refuse.
 *
 * `httpSource(url, { byteLength })` skips the HEAD probe, and `fileHandleSource(handle, byteLength)`
 * has no other way to learn it — so both take a number from the caller, and both interpolated it
 * straight into the refusal. A string interpolates as its digits, so a `'1024'` out of an
 * environment variable, a `Content-Length` header read as text, or a JSON manifest was refused
 * with "was given options.byteLength 1024, which is not a non-negative safe integer". 1024 is one.
 *
 * These are exactly the values most likely to arrive as text: a resource size comes from a
 * header, a manifest or a config file far more often than it is written as a literal.
 *
 * 0.6.114 fixed this shape for `maxMaterializeBytes`, 0.6.131 for a record index, and 0.6.139 for
 * the offset and length of every read. These two are the pair that names a whole source.
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import { httpSource } from '../../src/io/http.js';
import { fileHandleSource } from '../../src/node.js';

/** Enough of a handle to get past the shape check that runs before the size check. */
const HANDLE = { read: async () => ({ bytesRead: 0 }), close: async () => {} };

async function thrownByHttp(byteLength: unknown): Promise<Error> {
  try {
    await (httpSource as unknown as (u: string, o: unknown) => Promise<unknown>)(
      'https://example.invalid/x.edf',
      { byteLength, fetch: async () => ({ status: 500, headers: new Map() }) },
    );
  } catch (error) {
    return error as Error;
  }
  throw new Error('the call was accepted');
}

function thrownByHandle(byteLength: unknown): Error {
  try {
    (fileHandleSource as unknown as (h: unknown, b: unknown) => unknown)(HANDLE, byteLength);
  } catch (error) {
    return error as Error;
  }
  throw new Error('the call was accepted');
}

describe('a declared byteLength that arrived as text', () => {
  it('is not described by httpSource as the number its digits spell', async () => {
    const { message } = await thrownByHttp('1024');
    expect(message).not.toContain('options.byteLength 1024');
    expect(message).toContain('was given the string "1024" as options.byteLength');
    expect(message).toContain('which is not a non-negative safe integer');
  });

  it('is not described by fileHandleSource as the number its digits spell', () => {
    const { message } = thrownByHandle('1024');
    expect(message).not.toContain('a byteLength of 1024');
    expect(message).toContain('was given the string "1024" as its byteLength');
    expect(message).toContain('which is not a byte count edfcore can address');
  });

  it('is still an EdfSourceError from both, which is what a source refusal has always been', async () => {
    expect(isEdfError(await thrownByHttp('1024'))).toBe(true);
    expect(isEdfError(thrownByHandle('1024'))).toBe(true);
  });

  it('still says what to pass', async () => {
    expect((await thrownByHttp('1024')).message).toContain('Next: pass the real resource size');
    expect(thrownByHandle('1024').message).toContain('(await handle.stat()).size');
  });
});

describe('the numeric refusals, which were already true', () => {
  it.each([-1, 1.5, Number.NaN])('httpSource still names %s as itself', async (value) => {
    expect((await thrownByHttp(value)).message).toContain(
      `was given ${value} as options.byteLength`,
    );
  });

  it.each([-1, 1.5, Number.NaN])('fileHandleSource still names %s as itself', (value) => {
    expect(thrownByHandle(value).message).toContain(`was given ${value} as its byteLength`);
  });

  it('names an omitted byteLength on the handle, which has no other way to learn one', () => {
    expect(thrownByHandle(undefined).message).toContain('was given undefined as its byteLength');
  });
});
