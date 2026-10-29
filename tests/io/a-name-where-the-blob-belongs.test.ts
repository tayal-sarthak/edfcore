/**
 * A string handed to `blobSource`.
 *
 * Every string was told "pass the File an <input type="file"> or a drop event hands you", which
 * sends an address to a file picker, and tells a caller who passed `file.name` to go and get the
 * File they were one property away from.
 */

import { describe, expect, it } from 'vitest';
import { blobSource } from '../../src/index.js';

describe('a string passed to blobSource', () => {
  it('sends an address to httpSource', () => {
    expect(() => blobSource('https://example.org/a.edf' as never)).toThrow(
      'Next: that is an address — pass it to httpSource(url), which reads it by range.',
    );
  });

  it('asks for the File rather than its name, and names fileSource for a path', () => {
    expect(() => blobSource('night.edf' as never)).toThrow(
      'Next: pass the File itself rather than its name — or, in Node, pass the path to ' +
        'fileSource(path) from "edfcore/node".',
    );
    expect(() => blobSource('/tmp/a.edf' as never)).not.toThrow('await it');
  });

  it('keeps the picker advice for an object that is not a Blob', () => {
    expect(() => blobSource({} as never)).toThrow('<input type="file">');
  });
});
