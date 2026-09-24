/**
 * `cachedSource(source, [])`, and the sixteenfold budget it took.
 *
 * The guard here was written against a BARE value and states the cost: "`cachedSource(source, 4 *
 * 1024 * 1024)` is what gets written when the intent is a four-megabyte budget. A bare number has
 * no `maxBytes`, so both `requireFiniteOption` calls took their defaults and the wrapper cached up
 * to 64 MiB in 1 MiB blocks — sixteen times the budget asked for, on the one wrapper a caller
 * reaches for to bound memory."
 *
 * An array pays that in full without being seen, because an array is an object. `assertSelection`
 * names the shape one argument along — "an ARRAY, which is an object, so the check above let it
 * through" — and 0.6.245 closed it in the read and parse options, 0.6.247 in the formatters, where
 * `redactFields` made the list the caller already holds. Nothing here is array-valued, so the route
 * is plainer: options built by `Object.values`, or a spread of a config that was a list.
 *
 * Both existing guards keep their sentences, and a real options object is unchanged.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import type { ByteSource } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 16 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

/** Records every read, so "did it cache, and in what blocks?" is answerable. */
function counting(): { source: ByteSource; reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    source: {
      byteLength: FILE.byteLength,
      read: (offset: number, length: number) => {
        reads.push(`${offset}+${length}`);
        return Promise.resolve(FILE.subarray(offset, offset + length));
      },
    },
  };
}

const refusal = (call: () => unknown): Error => {
  let thrown: Error | undefined;
  try {
    call();
  } catch (error) {
    thrown = error as Error;
  }
  expect(thrown, 'nothing was refused').toBeDefined();
  return thrown as Error;
};

describe('options wrapped in a list', () => {
  it.each([
    ['empty', []],
    ['one entry', [1024]],
    ['a config spread into a list', [{ maxBytes: 1024 }]],
  ])('is refused rather than defaulted, when %s', (_shape, options) => {
    const thrown = refusal(() => cachedSource(byteSource(FILE), options as never));
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown.message).toContain('the options are an array');
  });

  it('names both fields and the default it would have taken', () => {
    const thrown = refusal(() => cachedSource(byteSource(FILE), [] as never));
    expect(thrown.message).toContain('blockBytes and maxBytes are fields on the options');
    expect(thrown.message).toContain('cached up to the default 64 MiB');
    expect(thrown.message).toContain('Next: pass maxBytes on an options object');
  });
});

describe('the budget an array used to ignore', () => {
  it('is honoured when the same numbers are on an object', async () => {
    const { source, reads } = counting();
    const cached = cachedSource(source, { blockBytes: 512, maxBytes: 1 << 20 });
    await cached.read(0, 16);
    await cached.read(0, 16);
    // One 512-byte block fetched, then a hit.
    expect(reads).toEqual(['0+512']);
  });

  it('and a block size an array would have defaulted past really is applied', async () => {
    const { source, reads } = counting();
    const cached = cachedSource(source, { blockBytes: 256, maxBytes: 1 << 20 });
    await cached.read(0, 16);
    expect(reads).toEqual(['0+256']);
  });
});

describe('everything the guards already covered', () => {
  it('still refuses a bare number', () => {
    const thrown = refusal(() => cachedSource(byteSource(FILE), (4 * 1024 * 1024) as never));
    expect(thrown.message).toContain('not an object — blockBytes and maxBytes are fields on one');
  });

  it('still refuses a block size below one byte', () => {
    const thrown = refusal(() => cachedSource(byteSource(FILE), { blockBytes: 0 }));
    expect(thrown.message).toContain('options.blockBytes must be at least 1 byte');
  });

  it('still refuses a non-finite field', () => {
    const thrown = refusal(() => cachedSource(byteSource(FILE), { maxBytes: Number.NaN }));
    expect(thrown.message).toContain('must be a finite number');
  });

  it('still accepts no options at all', () => {
    expect(cachedSource(byteSource(FILE)).byteLength).toBe(FILE.byteLength);
  });

  it('still refuses a source that is not one', () => {
    const thrown = refusal(() => cachedSource(FILE as never));
    expect(thrown.message).toContain('a ByteSource is needed');
  });
});
