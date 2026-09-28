/**
 * `cachedSource` options handed over as the Promise that will produce them.
 *
 * Both `requireFiniteOption` calls read their field off the object rather than awaiting it, so both
 * took their defaults at once — and the guard above states what that is: "the wrapper cached up to
 * 64 MiB in 1 MiB blocks — sixteen times the budget asked for, on the one wrapper a caller reaches
 * for to bound memory".
 *
 * Of the five families this shape has now been closed in, this is the one where the route is most
 * ordinary, because a cache budget is a SETTING. It comes out of a config file, a stored preference,
 * or a probe of how much memory the device will give up — and every one of those is behind an async
 * call of the caller's own. The other families' options are usually literals at the call site.
 *
 * Nothing about the returned wrapper says so. It reads correctly, caches correctly, and holds sixteen
 * times what it was asked to, which is the failure a memory bound is supposed to make impossible.
 *
 * A property read, never a call. A Promise that never settles is refused rather than awaited.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import type { CacheOptions } from '../../src/types.js';
import { minimalEdf } from '../support/writer.js';

const bytes = minimalEdf();
const source = () => byteSource(bytes);

/** What a caller's own async settings lookup hands back if the await is left off. */
const pendingOptions = (): unknown =>
  Promise.resolve({ maxBytes: 4 * 1024 * 1024, blockBytes: 64 * 1024 });

type Cached = (source: unknown, options: unknown) => unknown;
const wrap = cachedSource as unknown as Cached;

describe('a cache given the Promise its budget is behind', () => {
  it('is refused rather than wrapping under the defaults', () => {
    expect(() => wrap(source(), pendingOptions())).toThrow(RangeError);
  });

  it('names both fields and the budget it would have taken', () => {
    let message = '';
    try {
      wrap(source(), pendingOptions());
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('the options are a pending Promise');
    expect(message).toContain('blockBytes and maxBytes are read off the object');
    expect(message).toContain('default 64 MiB in 1 MiB blocks');
    expect(message).toContain('Next: await them');
  });

  it('is a caller mistake, so it is a plain RangeError', () => {
    expect(() => wrap(source(), pendingOptions())).toThrow(RangeError);
  });

  it('is never awaited, settled or subscribed to', () => {
    const neverSettles = new Promise<never>(() => {});
    expect(() => wrap(source(), neverSettles)).toThrow(/a pending Promise/);
  });
});

describe('the budget that was always right', () => {
  it('still wraps, and still reads the same bytes as the source under it', async () => {
    const options = (await (pendingOptions() as Promise<CacheOptions>)) satisfies CacheOptions;
    const cached = cachedSource(source(), options);
    expect(cached.byteLength).toBe(bytes.byteLength);
    const got = await cached.read(8, 32);
    expect([...got]).toEqual([...bytes.slice(8, 40)]);
  });

  it('is still optional', async () => {
    expect(() => cachedSource(source())).not.toThrow();
    expect(() => cachedSource(source(), undefined)).not.toThrow();
    expect(() => cachedSource(source(), {})).not.toThrow();
  });
});

describe('the branches that were already there', () => {
  it('keep their own sentences', () => {
    expect(() => wrap(source(), [4 * 1024 * 1024])).toThrow(/the options are an array/);
    expect(() => wrap(source(), 4 * 1024 * 1024)).toThrow(/not an object/);
    expect(() => wrap(source(), { blockBytes: 0 })).toThrow(/must be at least 1 byte/);
  });
});
