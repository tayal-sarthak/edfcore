/**
 * `fileHandleSource`'s `byteLength`, which the caller supplies and nothing checked.
 *
 * `fileSource` validates the size it reads off the handle it just opened — "the operating system
 * reported a size of X bytes … which is not a byte count edfcore can address". `fileHandleSource`
 * exists precisely so a caller can supply that number themselves, "a range it intends to expose, a
 * size it verified", and it took whatever it was given. The guard was on the path that cannot go
 * wrong and absent from the path that can (fixed in 0.6.85).
 *
 * A `NaN` or an omitted size did not fail — it disabled the range guard. `assertReadRange`
 * compares the read against `byteLength`, every comparison against `NaN` is false, so the check
 * silently stopped happening; `options.ts` names this exact shape, that "a guard written as
 * `if (value < 1)` simply does not fire". The source then advertised `byteLength: NaN` to
 * everything downstream, and the first thing to notice was `parseHeader`, which does guard it —
 * so the failure named a caller who had passed `parseHeader` the right arguments.
 *
 * Run against a real file handle, because the point is what the adapter accepts rather than what
 * the types say.
 */

import { existsSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import { fileHandleSource } from '../../src/node.js';

const FILE = fileURLToPath(new URL('../corpus/files/calib.rec', import.meta.url));
const PRESENT = existsSync(FILE);

let handle: Awaited<ReturnType<typeof open>>;

beforeAll(async () => {
  if (PRESENT) handle = await open(FILE, 'r');
});
afterAll(async () => {
  if (PRESENT) await handle.close();
});

const wrap = (byteLength: unknown): unknown =>
  (fileHandleSource as unknown as (h: unknown, b: unknown) => unknown)(handle, byteLength);

/** Sizes that are not byte counts, and what the refusal should call them. */
const NOT_A_SIZE: ReadonlyArray<readonly [string, unknown]> = [
  ['omitted', undefined],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['negative', -5],
  ['fractional', 1.5],
  ['a string', '4096'],
];

describe.skipIf(!PRESENT).each(NOT_A_SIZE)('a byteLength that is %s', (_name, value) => {
  it('is refused when the source is built, not later', () => {
    expect(() => wrap(value)).toThrow();
  });

  it('is an EdfSourceError naming the adapter and the value', () => {
    try {
      wrap(value);
    } catch (error) {
      expect(isEdfError(error)).toBe(true);
      // Named as the value ITSELF, not interpolated: the string `'4096'` interpolated as its
      // digits, so a size out of an environment variable or a manifest was refused with "was
      // given a byteLength of 4096, which is not a byte count edfcore can address" — and 4096 is
      // one (fixed in 0.6.142).
      expect((error as Error).message).toMatch(
        /fileHandleSource\(\) was given (\S+|the string "4096") as its byteLength/,
      );
      expect((error as Error).message).toContain('Next: pass the size of the file');
    }
  });
});

describe.skipIf(!PRESENT)('a byteLength that is a byte count', () => {
  it('is accepted, and bounds the reads', async () => {
    const source = fileHandleSource(handle, 4096);
    expect(source.byteLength).toBe(4096);
    expect((await source.read(0, 16)).length).toBe(16);
  });

  it('accepts zero, which is a legal size for an empty range', () => {
    expect(() => fileHandleSource(handle, 0)).not.toThrow();
  });

  it('still refuses a read past the size it was given', async () => {
    const source = fileHandleSource(handle, 64);
    await expect(source.read(60, 16)).rejects.toThrow();
  });
});
