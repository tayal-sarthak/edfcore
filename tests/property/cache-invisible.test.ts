/**
 * The cache is invisible, at every size it can be configured to.
 *
 * `api-sources.md` describes `cachedSource` as "removed by deleting one wrapper from the
 * expression that built the source". That is the property a caller relies on when they add it:
 * the reads get cheaper and nothing else changes. `cache.test.ts` demonstrates it for one script
 * of six reads at the default block size, where the 1 MiB block swallows the fixture whole — so
 * the demonstration is of a cache that never evicts, never stitches and never splits.
 *
 * The interesting sizes are the other ones. A block smaller than a read makes every answer a
 * stitch across two or more blocks; a budget smaller than a few blocks makes the cache evict
 * mid-sequence and re-read what it just discarded; a read wider than the whole budget bypasses
 * the cache entirely. Each of those is a different path to the same bytes, and each is reachable
 * from an ordinary configuration — a caller sizing blocks to a record and a budget to a phone.
 *
 * The failure is not a crash. Stitching arithmetic that is off by a block start returns the right
 * NUMBER of bytes from the right file, taken from the wrong offset: a header that parses, samples
 * that plot, and a recording quietly shifted. So the property is byte equality against the same
 * source unwrapped, over arbitrary sizes and arbitrary read sequences.
 *
 * The copy rule is checked here too rather than only by example. A cache RETAINS its blocks, so a
 * result that is a view into one lets a caller's write change what the next reader sees — and the
 * next reader is usually a different part of the same program, which is what makes it impossible
 * to find from the symptom.
 *
 * The seed is constant, so a failure is reproducible from the terminal output alone.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';

const SEED = 0x3c07;
const SIZE = 2048;

/** Every byte distinct within a 251-long cycle, so a read from the wrong offset cannot match. */
const pattern = (): Uint8Array =>
  Uint8Array.from({ length: SIZE }, (_, at) => (at * 37 + (at >> 8)) % 251);

/**
 * The truth, held apart from anything a test can reach.
 *
 * Each property builds its own `byteSource` over a FRESH copy: `byteSource().read` hands back a
 * `subarray` of the bytes it was given, so a property that writes into a result would otherwise
 * edit the fixture — and then compare the damage against itself and pass.
 */
const EXPECTED = pattern();

interface Range {
  readonly offset: number;
  readonly length: number;
}

const range = fc
  .tuple(fc.integer({ min: 0, max: SIZE - 1 }), fc.integer({ min: 1, max: 512 }))
  .map(([offset, want]) => ({ offset, length: Math.min(want, SIZE - offset) }) as Range);

const sizes = fc.record({
  blockBytes: fc.constantFrom(1, 7, 16, 64, 256, 1024, 4096),
  maxBytes: fc.constantFrom(1, 32, 128, 1024, 8192, 1024 * 1024),
});

describe('a cached source and the same source unwrapped', () => {
  it('answer every read with the same bytes, at every size', async () => {
    await fc.assert(
      fc.asyncProperty(
        sizes,
        fc.array(range, { minLength: 1, maxLength: 12 }),
        async (of, reads) => {
          const plain = byteSource(pattern());
          const cached = cachedSource(byteSource(pattern()), of);
          for (const one of reads) {
            expect(
              [...(await cached.read(one.offset, one.length))],
              `${one.offset}+${one.length} at block ${of.blockBytes}, budget ${of.maxBytes}`,
            ).toEqual([...(await plain.read(one.offset, one.length))]);
          }
        },
      ),
      { seed: SEED, numRuns: 120 },
    );
  });

  it('answer the same when the reads arrive at once rather than in turn', async () => {
    // Concurrent readers share one underlying block read, which is a different code path from
    // the sequential one and the place a shared buffer would be handed to two callers.
    await fc.assert(
      fc.asyncProperty(
        sizes,
        fc.array(range, { minLength: 2, maxLength: 10 }),
        async (of, reads) => {
          const cached = cachedSource(byteSource(pattern()), of);
          const together = await Promise.all(
            reads.map((one) => cached.read(one.offset, one.length)),
          );
          for (let at = 0; at < reads.length; at += 1) {
            const one = reads[at] as Range;
            expect([...(together[at] ?? [])]).toEqual([
              ...EXPECTED.subarray(one.offset, one.offset + one.length),
            ]);
          }
        },
      ),
      { seed: SEED, numRuns: 80 },
    );
  });

  it('hand back a copy of a CACHED read, so one reader cannot rewrite the next one bytes', async () => {
    await fc.assert(
      fc.asyncProperty(sizes, range, async (of, one) => {
        // Only where the read is actually cached. A read wider than the whole budget bypasses the
        // cache and returns the wrapped source's own array, and `cached.ts` says so in as many
        // words: the copy rule exists because a cache RETAINS its blocks, and that path retains
        // nothing. Asserting it there would be asserting against the documented design.
        fc.pre(one.length <= of.maxBytes);
        const cached = cachedSource(byteSource(pattern()), of);
        const mine = await cached.read(one.offset, one.length);
        mine.fill(0xff);
        expect([...(await cached.read(one.offset, one.length))]).toEqual([
          ...EXPECTED.subarray(one.offset, one.offset + one.length),
        ]);
      }),
      { seed: SEED, numRuns: 80 },
    );
  });

  it('agree about the length of the file, whatever the cache is sized to', async () => {
    await fc.assert(
      fc.property(sizes, (of) => {
        expect(cachedSource(byteSource(pattern()), of).byteLength).toBe(SIZE);
      }),
      { seed: SEED, numRuns: 40 },
    );
  });
});
