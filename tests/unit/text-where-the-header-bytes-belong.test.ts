/**
 * A string handed to `decodeHeaderLatin1`.
 *
 * Its output is a string, so a value that has already been through it — or through a
 * `TextDecoder`, or read with `readFile(path, 'latin1')` — comes back to it easily. It was told
 * about ArrayBuffers and Int8Arrays, neither of which it was given.
 */

import { expect, it } from 'vitest';
import { decodeHeaderLatin1 } from '../../src/bytes/latin1.js';

it('decodeHeaderLatin1() says a string is text already', () => {
  const thrown = (() => {
    try {
      decodeHeaderLatin1('0       ' as never);
    } catch (error) {
      return error as Error;
    }
    throw new Error('expected a refusal');
  })();
  expect(thrown.message).toContain('received a string, which is text already');
  expect(thrown.message).toContain('Next: use the string as it is.');
  expect(thrown.message).not.toContain('ArrayBuffer');
});
