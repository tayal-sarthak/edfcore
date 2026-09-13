/**
 * The options argument of `cachedSource`.
 *
 * `CacheOptions` is two byte counts and nothing else — `blockBytes` and `maxBytes` — so the number
 * a caller has in mind IS one of them, and `cachedSource(source, 4 * 1024 * 1024)` is what gets
 * written when the intent is a four-megabyte budget. A bare number has neither field, so both
 * `requireFiniteOption` calls took their defaults and the wrapper cached up to 64 MiB in 1 MiB
 * blocks: sixteen times what was asked for, from the one wrapper in the package a caller reaches
 * for to BOUND memory.
 *
 * Nothing said so. The returned source behaves correctly in every other respect, so the only
 * symptom is a resident set that does not match the call — on exactly the large files
 * `large-files.md` exists for.
 *
 * 0.6.130 made this argument for the three formatters' `maxItems`. This is the other option object
 * in the package whose fields are all a caller would plausibly pass on their own.
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../../src/errors.js';
import { byteSource } from '../../../src/io/bytes.js';
import { cachedSource } from '../../../src/io/cached.js';

const BYTES = new Uint8Array(4096);
const wrap =
  (options: unknown): (() => unknown) =>
  () =>
    (cachedSource as unknown as (s: unknown, o: unknown) => unknown)(byteSource(BYTES), options);

describe('cachedSource given a bare number', () => {
  it('refuses it rather than caching the default budget', () => {
    expect(wrap(4 * 1024 * 1024)).toThrow(RangeError);
  });

  it('is a caller mistake, so isEdfError says false', () => {
    let thrown: unknown;
    try {
      wrap(4 * 1024 * 1024)();
    } catch (error) {
      thrown = error;
    }
    expect(isEdfError(thrown)).toBe(false);
  });

  it('names the call, the number, and the budget it would have used instead', () => {
    expect(wrap(4194304)).toThrow(
      /^cachedSource\(\): the options are 4194304, not an object — blockBytes and maxBytes are fields on one, so this call would have cached up to the default 64 MiB rather than that\./,
    );
    expect(wrap(4194304)).toThrow(/Next: pass maxBytes on an options object\.$/);
  });

  it('names a string as itself, which an environment variable produces', () => {
    expect(wrap('4194304')).toThrow(/the options are the string "4194304", not an object/);
  });

  it('still takes no options at all, spelled either way', () => {
    expect(wrap(undefined)).not.toThrow();
    expect(wrap(null)).not.toThrow();
  });

  it('still caches to the budget when it is where it belongs', async () => {
    const cached = cachedSource(byteSource(BYTES), { maxBytes: 4096, blockBytes: 1024 });
    expect((await cached.read(0, 16)).byteLength).toBe(16);
  });
});
