/**
 * The four normalisations `api-sources.md` states for `cachedSource`'s two options.
 *
 * "`blockBytes` — floored, never below 1, and clamped down to `maxBytes`, since a block wider than
 * the whole budget evicts itself on every insert. `maxBytes` — floored, never below 0." Four rules
 * in a table, and each one exists because a caller computes these numbers rather than typing them:
 * a block size derived from `header.recordByteLength` divided by something, a budget read from an
 * environment variable, a fraction of `navigator.deviceMemory`.
 *
 * None was checked. `hardening.test.ts` covers the NaN refusals — a different rule, and the one
 * with an error attached — and `cache.test.ts` passes whole numbers throughout. So the flooring
 * could have become rounding, or the floors could have moved, and nothing would have said so.
 *
 * What that costs is not obvious from the table, which is why the table is worth executing. A block
 * size that rounded up instead of down fetches more than the caller budgeted for on every miss; a
 * `blockBytes` of 0 that was not floored to 1 divides by zero when it computes which block an
 * offset falls in.
 *
 * Each rule is checked through what the wrapped source is ASKED for, because that is the only place
 * the block size is observable — the cache has no accessor for it, deliberately.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { spySource } from '../support/spy-source.js';

const PAGE = DOCS_PAGES.get('api-sources.md') ?? '';
const ramp = (byteLength: number): Uint8Array =>
  Uint8Array.from({ length: byteLength }, (_, at) => at & 0xff);

/** The lengths the wrapped source was asked for, in order. */
async function fetchesFor(options: { blockBytes?: number; maxBytes?: number }): Promise<number[]> {
  const spy = spySource(byteSource(ramp(256)));
  const cached = cachedSource(spy, options);
  await cached.read(0, 1);
  return spy.reads.map((read) => read.length);
}

describe('the table was read', () => {
  it('states the four rules this file checks', () => {
    const prose = PAGE.replace(/\s+/g, ' ');
    expect(prose).toContain('Floored, never below 1, and clamped down to `maxBytes`');
    expect(prose).toContain('Floored, never below 0');
  });
});

describe('blockBytes', () => {
  it('is floored, not rounded', async () => {
    // 4.9 is four bytes a block. Rounding up would fetch five on every miss, which is a caller's
    // memory budget exceeded by 25 % on a number they did not type.
    expect(await fetchesFor({ blockBytes: 4.9, maxBytes: 4096 })).toEqual([4]);
  });

  it('is never below one, whatever it is asked for', async () => {
    // Zero would be a division by zero when the cache works out which block an offset is in.
    for (const blockBytes of [0, 0.4, -8]) {
      expect(await fetchesFor({ blockBytes, maxBytes: 4096 })).toEqual([1]);
    }
  });

  it('is clamped down to the budget, so a block can always be held', async () => {
    // "a block wider than the whole budget evicts itself on every insert" — the reason given in
    // the table, and the behaviour is the clamp rather than the eviction.
    expect(await fetchesFor({ blockBytes: 4096, maxBytes: 8 })).toEqual([8]);
  });
});

describe('maxBytes', () => {
  it('is floored, not rounded', async () => {
    // The budget also caps the block, so a floored 8.9 gives an eight-byte block and a ceiled one
    // would give nine. Same observation point, different option.
    expect(await fetchesFor({ blockBytes: 4096, maxBytes: 8.9 })).toEqual([8]);
  });

  it('is never below zero, and zero is a pass-through rather than a broken cache', async () => {
    // A negative budget floors to 0, the block cannot be 1, and `cachedSource` degenerates to a
    // delegating wrapper — the same object `maxBytes: 0` produces. The read is served whole
    // instead of by block.
    for (const maxBytes of [0, -1]) {
      const spy = spySource(byteSource(ramp(256)));
      const cached = cachedSource(spy, { maxBytes });
      expect(Array.from(await cached.read(8, 8))).toEqual(Array.from(ramp(256).subarray(8, 16)));
      expect(spy.reads.map((read) => read.length)).toEqual([8]);
    }
  });
});
