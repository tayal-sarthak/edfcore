/**
 * The second argument of the two converters in `decode/physical.ts`.
 *
 * 0.6.104 guarded the first argument of `toPhysical`, `physicalRangeOf` and `clampToDigitalRange`,
 * and 0.6.117 guarded the mirror of that mistake in `envelopeOfSamples`. Every one of those is
 * about the SIGNAL. The samples — the argument both converters read a `.length` off — had no
 * guard at all.
 *
 * A caller narrowing a chunk holds `header.signals[i]` and `chunk.signals[i]` at once, and the
 * samples live one field deeper: `toPhysical(signal, chunkSignal.digital)` is right and
 * `toPhysical(signal, chunkSignal)` is what gets written. The wrong one read `undefined` as the
 * length, multiplied it by eight, and handed `NaN` to the materialisation budget — where
 * `NaN <= budget` is false, so the call was refused as too large.
 *
 * Three things were then wrong at once, and only the first is cosmetic:
 *
 *   - the message printed "Producing undefined physical samples needs a NaN-byte array";
 *   - it advised converting at most 33,554,432 samples per call or raising
 *     `options.maxMaterializeBytes`, neither of which can help a call that asked for nothing;
 *   - it threw `EdfBudgetError`, so `isEdfError` answered `true`. That is the distinction
 *     `errors.ts` exists to keep — a file or budget condition a program handles, against a caller
 *     mistake a programmer fixes — and a wrong argument was sorted into the wrong one.
 */

import { describe, expect, it } from 'vitest';
import { clampToDigitalRange, toPhysical } from '../../src/decode/physical.js';
import { isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import type { EdfChunkSignal, EdfSignal } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'A1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function read(): Promise<{ signal: EdfSignal; chunkSignal: EdfChunkSignal }> {
  const recording = await openEdf(byteSource(FILE));
  const chunk = await readRecords(recording, {
    signalIndices: [0],
    records: { start: 0, count: 2 },
  });
  return {
    signal: recording.header.signals[0] as EdfSignal,
    chunkSignal: chunk.signals[0] as EdfChunkSignal,
  };
}

type Converter = (signal: EdfSignal, digital: unknown) => unknown;

const CONVERTERS: ReadonlyArray<readonly [string, Converter]> = [
  ['toPhysical', toPhysical as unknown as Converter],
  ['clampToDigitalRange', clampToDigitalRange as unknown as Converter],
];

describe.each(CONVERTERS)('%s given the chunk signal instead of its samples', (name, convert) => {
  it('throws a RangeError, not an EdfBudgetError', async () => {
    const { signal, chunkSignal } = await read();
    expect(() => convert(signal, chunkSignal)).toThrow(RangeError);
  });

  it('is a caller mistake, so isEdfError says false', async () => {
    const { signal, chunkSignal } = await read();
    let thrown: unknown;
    try {
      convert(signal, chunkSignal);
    } catch (error) {
      thrown = error;
    }
    expect(isEdfError(thrown)).toBe(false);
  });

  it('names the call, says which field carries the samples, and points at it', async () => {
    const { signal, chunkSignal } = await read();
    expect(() => convert(signal, chunkSignal)).toThrow(
      new RegExp(
        `^${name}\\(\\): the samples are a chunk signal, which carries them on \\.digital`,
      ),
    );
    expect(() => convert(signal, chunkSignal)).toThrow(/Next: pass chunkSignal\.digital/);
  });

  it('does not print a number it never had, or blame a budget', async () => {
    const { signal, chunkSignal } = await read();
    expect(() => convert(signal, chunkSignal)).not.toThrow(/undefined|NaN|maxMaterializeBytes/);
  });

  it('names an absent argument as itself rather than as a chunk signal', async () => {
    const { signal } = await read();
    expect(() => convert(signal, undefined)).toThrow(
      /the samples are undefined, which has no length/,
    );
    expect(() => convert(signal, undefined)).not.toThrow(TypeError);
  });

  it('still converts the samples themselves', async () => {
    const { signal, chunkSignal } = await read();
    const result = convert(signal, chunkSignal.digital) as { length: number };
    expect(result.length).toBe(chunkSignal.digital.length);
  });
});
