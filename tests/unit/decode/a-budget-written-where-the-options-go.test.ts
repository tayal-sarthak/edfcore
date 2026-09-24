/**
 * `toPhysical(signal, digital, out, 64 * 1024 * 1024)` — the byte count written as the options.
 *
 * `ReadOptions` and `ParseOptions` have each been given a guard for this: 0.6.130 for the
 * formatters and the cache, 0.6.154 for a parse, 0.6.166 for a read. The read guard states the
 * reason this family needed one most — "the read options are where the number a caller writes is
 * likeliest to be a byte count, because `maxMaterializeBytes` is one" — and `MaterializeOptions`
 * carries that field and NOTHING else, so the number is the whole of what a caller holds.
 *
 * It had no guard at all. A number, a string, a boolean and an array were each read as `undefined`,
 * `resolveMaterializeBudget` returned the 256 MiB default, and the allocation went ahead — on the
 * option whose entire job, in its own words, is to "refuse before allocating rather than dying
 * inside it". A caller who capped it at four megabytes got that refusal on no call at all.
 *
 * Three published primitives take these options: `decodeDigital`, `toPhysical` and
 * `clampToDigitalRange`. `null` and `undefined` still mean "no options", and a real options object
 * is unchanged.
 */

import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../../src/decode/digital.js';
import { clampToDigitalRange, toPhysical } from '../../../src/decode/physical.js';
import { EdfBudgetError } from '../../../src/errors.js';
import { byteSource } from '../../../src/io/bytes.js';
import { readRecordBytes } from '../../../src/io/read.js';
import { openEdf } from '../../../src/recording.js';
import type { EdfHeader, EdfSignal, RecordRange } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

const RANGE: RecordRange = { start: 0, count: 2 };

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 16 }],
  annotationSignals: [{ samplesPerRecord: 60 }],
});

async function fixture(): Promise<{
  header: EdfHeader;
  signal: EdfSignal;
  bytes: Uint8Array;
  digital: Int32Array;
}> {
  const recording = await openEdf(byteSource(FILE));
  const bytes = await readRecordBytes(recording.source, recording.header, RANGE);
  return {
    header: recording.header,
    signal: recording.header.signals[0] as EdfSignal,
    bytes,
    digital: decodeDigital(recording.header, bytes, RANGE, 0),
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

type Fixture = Awaited<ReturnType<typeof fixture>>;

const CALLS: ReadonlyArray<readonly [string, (all: Fixture, options: unknown) => unknown]> = [
  [
    'decodeDigital',
    (all, options) => decodeDigital(all.header, all.bytes, RANGE, 0, undefined, options as never),
  ],
  [
    'toPhysical',
    (all, options) => toPhysical(all.signal, all.digital, undefined, options as never),
  ],
  [
    'clampToDigitalRange',
    (all, options) => clampToDigitalRange(all.signal, all.digital, undefined, options as never),
  ],
];

describe.each(CALLS)('%s, given the byte count where the options go', (_name, call) => {
  it('refuses a bare number rather than taking the default budget', async () => {
    const all = await fixture();
    const thrown = refusal(() => call(all, 64 * 1024 * 1024));
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown.message).toContain('not an object — maxMaterializeBytes is the field on them');
    expect(thrown.message).toContain('took the default budget rather than that one');
  });

  it.each([
    ['a string', '1024'],
    ['a boolean', true],
  ])('refuses %s the same way', async (_shape, options) => {
    const all = await fixture();
    expect(refusal(() => call(all, options)).message).toContain('not an object');
  });

  it('refuses an array, which the object check cannot see', async () => {
    const all = await fixture();
    const thrown = refusal(() => call(all, []));
    expect(thrown.message).toContain('the options are an array');
    expect(thrown.message).toContain('rather than an entry in a list');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('still means no options when %s', async (_shape, options) => {
    const all = await fixture();
    expect(call(all, options)).toBeDefined();
  });

  it('still honours a budget passed on an object', async () => {
    const all = await fixture();
    const thrown = refusal(() => call(all, { maxMaterializeBytes: 1 }));
    expect(thrown).toBeInstanceOf(EdfBudgetError);
  });

  it('still answers with a budget that fits', async () => {
    const all = await fixture();
    expect(call(all, { maxMaterializeBytes: 1 << 20 })).toBeDefined();
  });
});

describe('the cap that was never applied', () => {
  it('fires on an object and used to fire on nothing else', async () => {
    const all = await fixture();
    // The same cap, spelled the two ways a caller might write it.
    expect(
      refusal(() => toPhysical(all.signal, all.digital, undefined, { maxMaterializeBytes: 1 })),
    ).toBeInstanceOf(EdfBudgetError);
    expect(
      refusal(() => toPhysical(all.signal, all.digital, undefined, 1 as never)).message,
    ).toContain('Next: pass maxMaterializeBytes on an options object');
  });
});
