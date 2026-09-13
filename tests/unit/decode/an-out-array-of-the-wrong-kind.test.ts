/**
 * The KIND of a reused `out` array, in the three calls that take one.
 *
 * `out` exists so a viewer redrawing on every pan can decode into memory it already holds, and all
 * three resolvers checked its LENGTH and then wrote straight through it. Nothing checked WHAT it
 * was.
 *
 * `toPhysical(signal, digital, new Int32Array(n))` is the one that costs data. The physical values
 * are fractional — `bitValue * (offset + digital)` — and writing a fraction into an `Int32Array`
 * truncates it. For a channel whose bit value is below 1, which is most EEG in microvolts, every
 * sample truncates to the same integer and the call returns a buffer of zeros AS IF IT WERE THE
 * SIGNAL. No error, no diagnostic, a full-length array of plausible type. A caller reusing two
 * scratch buffers — one `Int32Array` for digital, one `Float64Array` for physical — has exactly
 * two candidates at the call site and only one of them is right.
 *
 * `clampToDigitalRange` and `decodeDigital` return the array they were given, so the wrong kind
 * reached the caller in place of the `Int32Array` their signatures promise.
 *
 * The check is `Object.prototype.toString`, not `instanceof`: a typed array built in another realm
 * is still the right kind, and `a-clone-forgets-the-class.test.ts` holds the package to that.
 */

import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../../src/decode/digital.js';
import { clampToDigitalRange, toPhysical } from '../../../src/decode/physical.js';
import { isEdfError } from '../../../src/errors.js';
import { byteSource } from '../../../src/io/bytes.js';
import { readRecordBytes } from '../../../src/io/read.js';
import { openEdf, readRecords } from '../../../src/recording.js';
import type { EdfHeader, EdfSignal } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'A1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function read(): Promise<{
  header: EdfHeader;
  signal: EdfSignal;
  digital: Int32Array;
  recordBytes: Uint8Array;
}> {
  const recording = await openEdf(byteSource(FILE));
  const chunk = await readRecords(recording, {
    signalIndices: [0],
    records: { start: 0, count: 2 },
  });
  return {
    header: recording.header,
    signal: recording.header.signals[0] as EdfSignal,
    digital: (chunk.signals[0] as { digital: Int32Array }).digital,
    recordBytes: await readRecordBytes(recording.source, recording.header, {
      start: 0,
      count: 1,
    }),
  };
}

describe('toPhysical given an integer out array', () => {
  it('no longer returns a buffer of truncated values', async () => {
    const { signal, digital } = await read();
    expect(() =>
      (toPhysical as unknown as (s: unknown, d: unknown, o: unknown) => unknown)(
        signal,
        digital,
        new Int32Array(digital.length),
      ),
    ).toThrow(RangeError);
  });

  it('says what it was given, and what an integer array would have done to the samples', async () => {
    const { signal, digital } = await read();
    const convert = (): unknown =>
      (toPhysical as unknown as (s: unknown, d: unknown, o: unknown) => unknown)(
        signal,
        digital,
        new Int32Array(digital.length),
      );
    expect(convert).toThrow(/^toPhysical\(\): out is Int32Array, not a Float64Array —/);
    expect(convert).toThrow(/stores every one of them truncated/);
    expect(convert).toThrow(/Next: pass a Float64Array long enough for the samples/);
  });

  it('is a caller mistake, so isEdfError says false', async () => {
    const { signal, digital } = await read();
    let thrown: unknown;
    try {
      (toPhysical as unknown as (s: unknown, d: unknown, o: unknown) => unknown)(
        signal,
        digital,
        new Int32Array(digital.length),
      );
    } catch (error) {
      thrown = error;
    }
    expect(isEdfError(thrown)).toBe(false);
  });

  it('names a plain array rather than reaching for a method it lacks', async () => {
    const { signal, digital } = await read();
    expect(() =>
      (toPhysical as unknown as (s: unknown, d: unknown, o: unknown) => unknown)(
        signal,
        digital,
        new Array(digital.length).fill(0),
      ),
    ).not.toThrow(/subarray is not a function/);
  });

  it('still converts into a Float64Array of its own or the caller’s', async () => {
    const { signal, digital } = await read();
    const own = toPhysical(signal, digital);
    const reused = toPhysical(signal, digital, new Float64Array(digital.length + 8));
    expect(Array.from(reused)).toEqual(Array.from(own));
    expect(own[0]).toBeGreaterThan(0);
  });
});

describe('the two that hand their out array back', () => {
  it('clampToDigitalRange refuses a Float64Array rather than returning one', async () => {
    const { signal, digital } = await read();
    const clamp = (): unknown =>
      (clampToDigitalRange as unknown as (s: unknown, d: unknown, o: unknown) => unknown)(
        signal,
        digital,
        new Float64Array(digital.length),
      );
    expect(clamp).toThrow(/^clampToDigitalRange\(\): out is Float64Array, not an Int32Array —/);
    expect(clamp).toThrow(/in place of the Int32Array the signature promises/);
  });

  it('decodeDigital refuses one too, from the resolver they do not share', async () => {
    const { header, recordBytes } = await read();
    expect(() =>
      (
        decodeDigital as unknown as (
          h: unknown,
          b: unknown,
          r: unknown,
          i: unknown,
          o: unknown,
        ) => unknown
      )(header, recordBytes, { start: 0, count: 1 }, 0, new Float64Array(64)),
    ).toThrow(/^decodeDigital\(\): out is Float64Array, not an Int32Array —/);
  });

  it('both still reuse an Int32Array, and still refuse one that is too short', async () => {
    const { signal, digital } = await read();
    expect(Array.from(clampToDigitalRange(signal, digital, new Int32Array(64)))).toEqual(
      Array.from(clampToDigitalRange(signal, digital)),
    );
    expect(() => clampToDigitalRange(signal, digital, new Int32Array(1))).toThrow(
      /out holds 1 samples but this clamp produces/,
    );
  });
});
