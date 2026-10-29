/**
 * What `byteSource` calls the argument it refuses.
 *
 * Every object that was not bytes was "a plain object" — a Blob, a fetch Response, a URL, a
 * pending Promise — so the one word that says which mistake was made was the one left out. The
 * built-in tag says it, as `describeValue` and `assertByteSource` already do.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/index.js';

describe('byteSource names the object it was given', () => {
  it.each([
    ['Blob', new Blob([new Uint8Array(4)])],
    ['Response', new Response('x')],
    ['URL', new URL('https://example.org/a.edf')],
    ['Map', new Map()],
  ])('calls a %s by its name', (name, value) => {
    expect(() => byteSource(value as never)).toThrow(`received ${name}.`);
    expect(() => byteSource(value as never)).not.toThrow('a plain object');
  });

  it('tells a pending Promise to be awaited, which is the readFile() line less a keyword', () => {
    const pending = Promise.resolve(new Uint8Array(4));
    expect(() => byteSource(pending as never)).toThrow('received Promise. Next: await it');
    expect(() => byteSource(pending as never)).toThrow('readFile from "node:fs/promises"');
  });

  it('still calls a plain object one', () => {
    expect(() => byteSource({} as never)).toThrow('received a plain object.');
  });
});
