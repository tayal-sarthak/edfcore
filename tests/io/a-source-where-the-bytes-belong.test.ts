/**
 * What a source adapter MAKES, handed back to one as what it takes.
 *
 * `byteSource(bytes)` returns a `ByteSource`, and `openEdf` is the call that takes it — so
 * `byteSource(source)` is one wrap too many, written when a source is passed down through a helper
 * that wraps whatever it is given. It was refused as "a plain object" and told to pass
 * `new Uint8Array(await blob.arrayBuffer())` or `await readFile(path)`: advice to go back for bytes
 * the caller had already turned into the very thing this call makes.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';

describe('a ByteSource where the bytes belong', () => {
  it('is named a ByteSource and sent to openEdf as it is', () => {
    const source = byteSource(new Uint8Array(8));
    expect(() => byteSource(source as never)).toThrow('byteSource() received a ByteSource');
    expect(() => byteSource(source as never)).toThrow('pass it to openEdf() as it is');
  });

  it('still refuses a plain object as a plain object', () => {
    expect(() => byteSource({} as never)).toThrow('received a plain object');
  });
});
