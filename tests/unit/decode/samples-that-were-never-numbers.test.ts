/**
 * Samples that have a length but are not numbers.
 *
 * 0.6.128 guarded the second argument of `toPhysical` and `clampToDigitalRange` by asking whether
 * it had a `length`. A string has one. So does `{ length: 3 }`, which is what a mocked or
 * half-built chunk signal looks like.
 *
 * Every element then read back as something other than a number, and `bitValue * (offset + 'a')`
 * is `NaN`. The call returned a full-length `Float64Array` of `NaN` and reported nothing — and a
 * plotting library draws `NaN` as a break in the line, which is exactly what
 * `toPhysicalEnvelope` reserves `NaN` to mean: a bucket no sample landed in. A caller looking at
 * the result sees a hole in the recording rather than a mistake in the call.
 *
 * `ArrayLike<number>` says what the elements are, so the first of them is the whole test. An empty
 * array has nothing to convert either way and is still accepted.
 */

import { describe, expect, it } from 'vitest';
import { clampToDigitalRange, toPhysical } from '../../../src/decode/physical.js';
import { isEdfError } from '../../../src/errors.js';
import { byteSource } from '../../../src/io/bytes.js';
import { openEdf, readRecords } from '../../../src/recording.js';
import type { EdfSignal } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'A1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function read(): Promise<{ signal: EdfSignal; digital: Int32Array }> {
  const recording = await openEdf(byteSource(FILE));
  const chunk = await readRecords(recording, {
    signalIndices: [0],
    records: { start: 0, count: 2 },
  });
  return {
    signal: recording.header.signals[0] as EdfSignal,
    digital: (chunk.signals[0] as { digital: Int32Array }).digital,
  };
}

type Converter = (signal: EdfSignal, digital: unknown) => unknown;

const CONVERTERS: ReadonlyArray<readonly [string, Converter]> = [
  ['toPhysical', toPhysical as unknown as Converter],
  ['clampToDigitalRange', clampToDigitalRange as unknown as Converter],
];

describe.each(CONVERTERS)('%s given a string', (name, convert) => {
  it('no longer returns an array of NaN', async () => {
    const { signal } = await read();
    expect(() => convert(signal, 'abc')).toThrow(RangeError);
  });

  it('says how long it was, what the first element is, and what that would have produced', async () => {
    const { signal } = await read();
    expect(() => convert(signal, 'abc')).toThrow(
      new RegExp(
        `^${name}\\(\\): the samples have a length of 3, but the first of them is the string "a" rather than a number, so every value this produced would be NaN\\.`,
      ),
    );
    expect(() => convert(signal, 'abc')).toThrow(/Next: pass chunkSignal\.digital/);
  });

  it('is a caller mistake, so isEdfError says false', async () => {
    const { signal } = await read();
    let thrown: unknown;
    try {
      convert(signal, 'abc');
    } catch (error) {
      thrown = error;
    }
    expect(isEdfError(thrown)).toBe(false);
  });

  it('catches the bare length object a half-built chunk signal looks like', async () => {
    const { signal } = await read();
    expect(() => convert(signal, { length: 3 })).toThrow(
      /the first of them is undefined rather than a number/,
    );
  });

  it('still converts a real typed array, and a plain array of numbers', async () => {
    const { signal, digital } = await read();
    expect((convert(signal, digital) as { length: number }).length).toBe(digital.length);
    expect((convert(signal, [1, 2, 3]) as { length: number }).length).toBe(3);
  });

  it('still accepts an empty one, which has nothing to convert either way', async () => {
    const { signal } = await read();
    expect((convert(signal, []) as { length: number }).length).toBe(0);
  });
});
