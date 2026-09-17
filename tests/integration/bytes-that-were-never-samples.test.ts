/**
 * Raw record bytes handed to the physical converters as though they were samples.
 *
 * The reading pipeline this package documents is three calls:
 * `readRecordBytes(source, header, records)` → `decodeDigital(header, bytes, records, signalIndex)`
 * → `toPhysical(signal, digital)`. All three are published primitives, and leaving the middle one
 * out gives `toPhysical(signal, recordBytes)` — which is what a reader writes when the variable in
 * hand is called `bytes` and the parameter is called `digital`.
 *
 * `assertSamples` could not see it. 0.6.128 checked the argument had a `length`, and the check after
 * it reads the first element and requires a number — a `Uint8Array` has both. So the call returned a
 * full-length `Float64Array` with no error at all, scaling each BYTE of the record as if it were a
 * sample: on a two-record read of a sixteen-samples-per-record signal, 192 values where the signal
 * has 32, drawn from the low and high halves of 16-bit words and from the annotation region.
 *
 * Numbers that look exactly like a signal, which is the failure `resolveSignals` names as the reason
 * this library exists. Every other wrong second argument here already fails loudly.
 *
 * One byte per element is the whole test, and it is a fact rather than a heuristic: an EDF digital
 * value is a signed 16-bit integer and a BDF one signed 24-bit, so neither fits in a byte array, and
 * `decodeDigital` returns an `Int32Array` by contract.
 */

import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../src/decode/digital.js';
import { clampToDigitalRange, toPhysical } from '../../src/decode/physical.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf } from '../../src/recording.js';
import type { EdfHeader, EdfSignal } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const SAMPLES_PER_RECORD = 16;
const RECORDS = { start: 0, count: 2 } as const;

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 8,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: SAMPLES_PER_RECORD }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function pieces(): Promise<{
  header: EdfHeader;
  signal: EdfSignal;
  bytes: Uint8Array;
  digital: Int32Array;
}> {
  const recording = await openEdf(byteSource(FILE));
  const header = recording.header;
  const bytes = await readRecordBytes(recording.source, header, RECORDS);
  return {
    header,
    signal: header.signals[0] as EdfSignal,
    bytes,
    digital: decodeDigital(header, bytes, RECORDS, 0),
  };
}

const BYTE_VIEWS: ReadonlyArray<readonly [string, (bytes: Uint8Array) => ArrayBufferView]> = [
  ['a Uint8Array, as readRecordBytes returns it', (bytes) => bytes],
  ['an Int8Array over the same bytes', (bytes) => new Int8Array(bytes)],
  ['a Uint8ClampedArray', (bytes) => new Uint8ClampedArray(bytes)],
];

describe('the record bytes a read resolved to', () => {
  it('are longer than the samples they contain, which is what made the answer plausible', async () => {
    const { bytes, digital } = await pieces();
    expect(digital.length).toBe(RECORDS.count * SAMPLES_PER_RECORD);
    expect(bytes.byteLength).toBeGreaterThan(digital.length);
  });

  describe.each(BYTE_VIEWS)('given %s', (_name, asView) => {
    it('are refused by toPhysical rather than scaled one byte at a time', async () => {
      const { signal, bytes } = await pieces();
      let thrown: Error | undefined;
      try {
        toPhysical(signal, asView(bytes) as never);
      } catch (error) {
        thrown = error as Error;
      }
      expect(thrown, 'every byte of the record was returned as a physical value').toBeDefined();
      expect(thrown).toBeInstanceOf(RangeError);
      expect(thrown?.message).toContain('one byte per element');
      expect(thrown?.message).toContain('Next:');
    });

    it('are refused by clampToDigitalRange too, which shares the guard', async () => {
      const { signal, bytes } = await pieces();
      expect(() => clampToDigitalRange(signal, asView(bytes) as never)).toThrow(
        /one byte per element/,
      );
    });

    it('name the call that turns them into samples', async () => {
      const { signal, bytes } = await pieces();
      expect(() => toPhysical(signal, asView(bytes) as never)).toThrow(/decodeDigital\(\)/);
    });
  });
});

describe('the samples themselves', () => {
  it('still convert, from the Int32Array decodeDigital returned', async () => {
    const { signal, digital } = await pieces();
    const physical = toPhysical(signal, digital);
    expect(physical).toBeInstanceOf(Float64Array);
    expect(physical.length).toBe(digital.length);
    expect(Number.isFinite(physical[0])).toBe(true);
  });

  it('still convert from a plain array of numbers, which is an ArrayLike<number>', async () => {
    const { signal } = await pieces();
    expect(toPhysical(signal, [0, 1, 2]).length).toBe(3);
  });

  it('still convert from a wider typed array, which can hold a digital value', async () => {
    const { signal, digital } = await pieces();
    expect(toPhysical(signal, new Int16Array(digital)).length).toBe(digital.length);
    expect(toPhysical(signal, new Float64Array(digital)).length).toBe(digital.length);
  });

  it('still refuse a chunk signal in its own words, which 0.6.128 added', async () => {
    const { signal } = await pieces();
    expect(() => toPhysical(signal, { signalIndex: 0 } as never)).toThrow(
      /carries them on \.digital rather than being them/,
    );
  });
});
