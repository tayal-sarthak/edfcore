/**
 * `decodeDigital` / `decodeDigitalCounted` — sign extension and de-interleaving.
 *
 * Two separate promises are pinned here.
 *
 * 1. A sample value. DESIGN section 5 ("Data records") states the expressions verbatim:
 *    `v = b0 | (b1 << 8)` sign-extended from bit 15 for EDF, `v = b0 | (b1 << 8) | (b2 << 16)`
 *    sign-extended from bit 23 for BDF, little-endian two's complement, never big-endian and
 *    never float.
 * 2. WHICH samples come back. A record holds every signal interleaved, so the answer depends
 *    entirely on `recordByteOffset` and on the record range — the arithmetic that silently
 *    returns a neighbouring channel's samples when it is wrong.
 *
 * Every fixture is built by `tests/support/writer.ts`, which encodes samples from the format
 * specification and imports nothing from `src/`. A reader tested against its own writer would
 * agree with itself; this one cannot.
 */

import { describe, expect, it } from 'vitest';
import { decodeDigital, decodeDigitalCounted } from '../../../src/decode/digital.js';
import {
  EdfBudgetError,
  EdfChannelNotFoundError,
  EdfRangeError,
  isEdfError,
} from '../../../src/errors.js';
import { parseHeader } from '../../../src/header/parse.js';
import type { EdfHeader, EdfSignal, RecordRange } from '../../../src/types.js';
import { appendBytes, patchBytes } from '../../support/corrupt.js';
import { buildEdf, type EdfSpec } from '../../support/writer.js';

interface Fixture {
  readonly bytes: Uint8Array;
  readonly header: EdfHeader;
}

function build(spec: EdfSpec): Fixture {
  const bytes = buildEdf(spec);
  return { bytes, header: parseHeader(bytes, bytes.byteLength) };
}

/** Exactly the bytes of `records`, as `decodeDigital` demands them: no more, no less. */
function recordsOf(fixture: Fixture, records: RecordRange): Uint8Array {
  const { header, bytes } = fixture;
  const start = header.headerByteLength + records.start * header.recordByteLength;
  return bytes.subarray(start, start + records.count * header.recordByteLength);
}

function signalOf(fixture: Fixture, index: number): EdfSignal {
  const signal = fixture.header.signals[index];
  if (signal === undefined) throw new Error(`fixture has no signal ${index}`);
  return signal;
}

// ===========================================================================
// Sign extension, exactly at the format boundaries
// ===========================================================================

interface SignExtensionCase {
  readonly name: string;
  readonly format: 'EDF' | 'BDF';
  readonly bytesPerSample: 2 | 3;
  readonly values: readonly number[];
  /** The on-disk bytes the writer must have produced for `values[probeIndex]`. */
  readonly probeIndex: number;
  readonly probeBytes: readonly number[];
}

const SIGN_EXTENSION_CASES: readonly SignExtensionCase[] = [
  {
    name: 'EDF 16-bit',
    format: 'EDF',
    bytesPerSample: 2,
    // The full 16-bit two's complement boundary set: the most negative value, the all-ones
    // value that a missing sign extension turns into 65535, zero, one, and the most positive.
    values: [-32768, -1, 0, 1, 32767],
    probeIndex: 0,
    probeBytes: [0x00, 0x80],
  },
  {
    name: 'BDF 24-bit',
    format: 'BDF',
    bytesPerSample: 3,
    // DESIGN section 7 calls out 0x800000 and 0x7FFFFF by name. There is no prior art to lean
    // on for this path: no published npm EDF package reads 24-bit BDF at all, so a wrong
    // sign extension here would not be caught by "it agrees with the other library".
    values: [-8388608, -8388607, -1, 0, 1, 8388607],
    probeIndex: 0,
    probeBytes: [0x00, 0x00, 0x80],
  },
];

describe('sign extension at the format boundaries', () => {
  for (const testCase of SIGN_EXTENSION_CASES) {
    it(`${testCase.name}: decodes the extreme two's complement values bit-identically`, () => {
      const fixture = build({
        format: testCase.format,
        recordCount: 1,
        signals: [
          {
            label: 'Fp1',
            samplesPerRecord: testCase.values.length,
            sample: (_recordIndex, sampleIndex) => testCase.values[sampleIndex] ?? 0,
          },
        ],
      });

      expect(fixture.header.bytesPerSample).toBe(testCase.bytesPerSample);

      const records: RecordRange = { start: 0, count: 1 };
      const decoded = decodeDigital(fixture.header, recordsOf(fixture, records), records, 0);

      expect(decoded).toBeInstanceOf(Int32Array);
      expect(decoded).toEqual(Int32Array.from(testCase.values));
    });

    it(`${testCase.name}: reads the two's complement bytes the file really holds`, () => {
      // Guards the test above against a writer that encodes the same misunderstanding as the
      // reader: the boundary sample must be these exact bytes on disk.
      const fixture = build({
        format: testCase.format,
        recordCount: 1,
        signals: [
          {
            label: 'Fp1',
            samplesPerRecord: testCase.values.length,
            sample: (_recordIndex, sampleIndex) => testCase.values[sampleIndex] ?? 0,
          },
        ],
      });

      const at = fixture.header.headerByteLength + testCase.probeIndex * testCase.bytesPerSample;
      const onDisk = Array.from(fixture.bytes.subarray(at, at + testCase.bytesPerSample));
      expect(onDisk).toEqual([...testCase.probeBytes]);
    });
  }

  it('does not widen a BDF sample into the 32-bit sign bit', () => {
    // 0xFFFFFF is -1 as 24-bit two's complement. Sign-extending it as if it were 32-bit wide
    // would still give -1; sign-extending 0x800000 as 32-bit would give 8388608. Both are
    // checked, so neither a missing nor an over-eager extension survives.
    const values = [-1, -8388608, 8388607];
    const fixture = build({
      format: 'BDF',
      recordCount: 1,
      signals: [
        {
          label: 'Fp1',
          samplesPerRecord: values.length,
          sample: (_recordIndex, sampleIndex) => values[sampleIndex] ?? 0,
        },
      ],
    });

    const records: RecordRange = { start: 0, count: 1 };
    const decoded = decodeDigital(fixture.header, recordsOf(fixture, records), records, 0);
    expect(Array.from(decoded)).toEqual([-1, -8388608, 8388607]);
    expect(Array.from(decoded)).not.toContain(0xffffff);
    expect(Array.from(decoded)).not.toContain(0x800000);
  });
});

// ===========================================================================
// Byte order
// ===========================================================================

/** What the same bytes would mean if the decoder read them most-significant byte first. */
function bigEndianSigned(raw: readonly number[]): number {
  let value = 0;
  for (const byte of raw) value = value * 256 + byte;
  const limit = 2 ** (8 * raw.length);
  return value >= limit / 2 ? value - limit : value;
}

function decodeOneSample(format: 'EDF' | 'BDF', raw: readonly number[]): number {
  const fixture = build({
    format,
    recordCount: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 1 }],
  });
  const patched = patchBytes(fixture.bytes, fixture.header.headerByteLength, Uint8Array.from(raw));
  const records: RecordRange = { start: 0, count: 1 };
  const decoded = decodeDigital(
    fixture.header,
    patched.subarray(fixture.header.headerByteLength),
    records,
    0,
  );
  return decoded[0] ?? Number.NaN;
}

interface ByteOrderCase {
  readonly format: 'EDF' | 'BDF';
  readonly raw: readonly number[];
  readonly expected: number;
}

const BYTE_ORDER_CASES: readonly ByteOrderCase[] = [
  { format: 'EDF', raw: [0x34, 0x12], expected: 0x1234 },
  { format: 'EDF', raw: [0x01, 0x00], expected: 1 },
  { format: 'EDF', raw: [0x00, 0x80], expected: -32768 },
  { format: 'EDF', raw: [0xff, 0x7f], expected: 32767 },
  { format: 'BDF', raw: [0x56, 0x34, 0x12], expected: 0x123456 },
  { format: 'BDF', raw: [0x01, 0x00, 0x00], expected: 1 },
  { format: 'BDF', raw: [0x00, 0x00, 0x80], expected: -8388608 },
  { format: 'BDF', raw: [0xff, 0xff, 0x7f], expected: 8388607 },
];

describe('byte order', () => {
  for (const testCase of BYTE_ORDER_CASES) {
    const hex = testCase.raw.map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
    it(`${testCase.format} reads ${hex} low byte first, giving ${testCase.expected}`, () => {
      // DESIGN section 5: samples are little-endian two's complement, never big-endian.
      const decoded = decodeOneSample(testCase.format, testCase.raw);
      expect(decoded).toBe(testCase.expected);
      // Every case is chosen so the two byte orders genuinely disagree; without this the
      // assertion above could pass on a symmetric pattern like ff ff.
      expect(bigEndianSigned(testCase.raw)).not.toBe(testCase.expected);
      expect(decoded).not.toBe(bigEndianSigned(testCase.raw));
    });
  }

  it('puts the sign bit in the LAST byte, not the first', () => {
    // b0 is the low byte: 01 00 is 1 and 00 01 is 256, and the sign lives in b1 (EDF) or
    // b2 (BDF). A big-endian reader would report 256 and 1 respectively.
    expect(decodeOneSample('EDF', [0x01, 0x00])).toBe(1);
    expect(decodeOneSample('EDF', [0x00, 0x01])).toBe(256);
    expect(decodeOneSample('BDF', [0x01, 0x00, 0x00])).toBe(1);
    expect(decodeOneSample('BDF', [0x00, 0x00, 0x01])).toBe(65536);
  });

  it('offers no call shape that selects a byte order', () => {
    // There is no big-endian path to select: the decode expressions are fixed by the format
    // and no argument reaches them. The same bytes therefore mean the same value through
    // every documented call shape.
    const fixture = build({
      format: 'EDF',
      recordCount: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 2 }],
    });
    const patched = patchBytes(
      fixture.bytes,
      fixture.header.headerByteLength,
      Uint8Array.from([0x34, 0x12, 0x00, 0x80]),
    );
    const bytes = patched.subarray(fixture.header.headerByteLength);
    const records: RecordRange = { start: 0, count: 1 };

    const plain = decodeDigital(fixture.header, bytes, records, 0);
    const intoOut = decodeDigital(fixture.header, bytes, records, 0, new Int32Array(2));
    const withOptions = decodeDigital(fixture.header, bytes, records, 0, undefined, {
      maxMaterializeBytes: 1024,
    });

    expect(Array.from(plain)).toEqual([0x1234, -32768]);
    expect(Array.from(intoOut)).toEqual([0x1234, -32768]);
    expect(Array.from(withOptions)).toEqual([0x1234, -32768]);
  });
});

// ===========================================================================
// De-interleaving
// ===========================================================================

/** Encodes the signal, the record and the position in the value itself. */
function tagged(signalTag: number): (recordIndex: number, sampleIndex: number) => number {
  return (recordIndex, sampleIndex) => signalTag * 1000 + recordIndex * 10 + sampleIndex;
}

const DEINTERLEAVE_FORMATS: ReadonlyArray<{ format: 'EDF' | 'BDF'; bytesPerSample: 2 | 3 }> = [
  { format: 'EDF', bytesPerSample: 2 },
  { format: 'BDF', bytesPerSample: 3 },
];

const SAMPLES_PER_RECORD = [4, 3, 5] as const;
const RECORD_COUNT = 6;

function deinterleaveFixture(format: 'EDF' | 'BDF'): Fixture {
  return build({
    format,
    recordCount: RECORD_COUNT,
    signals: [
      { label: 'A', samplesPerRecord: SAMPLES_PER_RECORD[0], sample: tagged(1) },
      { label: 'B', samplesPerRecord: SAMPLES_PER_RECORD[1], sample: tagged(2) },
      { label: 'C', samplesPerRecord: SAMPLES_PER_RECORD[2], sample: tagged(3) },
    ],
  });
}

function expectedFor(
  signalTag: number,
  samplesPerRecord: number,
  records: RecordRange,
): readonly number[] {
  const values: number[] = [];
  for (let r = records.start; r < records.start + records.count; r++) {
    for (let k = 0; k < samplesPerRecord; k++) values.push(tagged(signalTag)(r, k));
  }
  return values;
}

describe('de-interleaving signals with different sample rates', () => {
  for (const { format, bytesPerSample } of DEINTERLEAVE_FORMATS) {
    it(`${format}: derives each signal's block offset from the signals before it`, () => {
      const { header } = deinterleaveFixture(format);
      // DESIGN section 5: recordByteOffset[i] = bytesPerSample * SUM(spr[j] for j < i).
      expect(header.recordByteLength).toBe((4 + 3 + 5) * bytesPerSample);
      expect(header.signals.map((signal) => signal.recordByteOffset)).toEqual([
        0,
        4 * bytesPerSample,
        7 * bytesPerSample,
      ]);
    });

    it(`${format}: returns signal 1's own samples for records 2..4`, () => {
      const fixture = deinterleaveFixture(format);
      const window: RecordRange = { start: 2, count: 3 };
      const decoded = decodeDigital(fixture.header, recordsOf(fixture, window), window, 1);

      expect(Array.from(decoded)).toEqual([...expectedFor(2, SAMPLES_PER_RECORD[1], window)]);
      // Named for what they rule out: a zero recordByteOffset (signal 0's block), and a
      // record range that is off by one. Both produce a plausible-looking array.
      expect(Array.from(decoded)).not.toEqual([...expectedFor(1, SAMPLES_PER_RECORD[1], window)]);
      expect(Array.from(decoded)).not.toEqual([
        ...expectedFor(2, SAMPLES_PER_RECORD[1], { start: 1, count: 3 }),
      ]);
    });

    it(`${format}: a windowed decode equals the same slice of a whole-file decode`, () => {
      const fixture = deinterleaveFixture(format);
      const all: RecordRange = { start: 0, count: RECORD_COUNT };
      const window: RecordRange = { start: 2, count: 3 };
      const spr = SAMPLES_PER_RECORD[1];

      const whole = decodeDigital(fixture.header, recordsOf(fixture, all), all, 1);
      const windowed = decodeDigital(fixture.header, recordsOf(fixture, window), window, 1);

      expect(Array.from(windowed)).toEqual(
        Array.from(whole.subarray(window.start * spr, (window.start + window.count) * spr)),
      );
    });

    it(`${format}: every signal decodes to its own values over the same records`, () => {
      const fixture = deinterleaveFixture(format);
      const window: RecordRange = { start: 1, count: 2 };
      const bytes = recordsOf(fixture, window);

      for (const [index, tag] of [1, 2, 3].entries()) {
        const spr = SAMPLES_PER_RECORD[index] ?? 0;
        const decoded = decodeDigital(fixture.header, bytes, window, index);
        expect(decoded.length).toBe(window.count * spr);
        expect(Array.from(decoded)).toEqual([...expectedFor(tag, spr, window)]);
      }
    });
  }

  it('skips a zero-sample signal exactly, leaving its neighbours addressable', () => {
    // A signal declaring 0 samples per record is a warning, not a fatal error, and it must
    // contribute exactly 0 bytes — otherwise every later signal's offset shifts.
    const fixture = build({
      format: 'EDF',
      recordCount: 2,
      signals: [
        { label: 'A', samplesPerRecord: 2, sample: tagged(1) },
        { label: 'EMPTY', samplesPerRecord: 0 },
        { label: 'C', samplesPerRecord: 3, sample: tagged(3) },
      ],
    });
    const records: RecordRange = { start: 0, count: 2 };
    const bytes = recordsOf(fixture, records);

    expect(fixture.header.recordByteLength).toBe((2 + 0 + 3) * 2);
    expect(signalOf(fixture, 2).recordByteOffset).toBe(4);
    expect(Array.from(decodeDigital(fixture.header, bytes, records, 1))).toEqual([]);
    expect(Array.from(decodeDigital(fixture.header, bytes, records, 2))).toEqual([
      ...expectedFor(3, 3, records),
    ]);
  });

  it('de-interleaves around an annotation signal without decoding its text', () => {
    // The annotation region sizes itself as samplesPerRecord * bytesPerSample like any other
    // block, so a data signal after it must still land on its own bytes.
    const fixture = build({
      format: 'EDF',
      plus: 'C',
      recordCount: 2,
      signals: [{ label: 'A', samplesPerRecord: 2, sample: tagged(1) }],
      annotationSignals: [{ samplesPerRecord: 16 }],
    });
    const records: RecordRange = { start: 0, count: 2 };

    expect(fixture.header.recordByteLength).toBe((2 + 16) * 2);
    expect(
      Array.from(decodeDigital(fixture.header, recordsOf(fixture, records), records, 0)),
    ).toEqual([...expectedFor(1, 2, records)]);
  });
});

// ===========================================================================
// Record range and buffer length
// ===========================================================================

interface RangeCase {
  readonly name: string;
  readonly records: RecordRange;
  /** Built from a fixture whose records are 8 bytes each, 3 of them. */
  readonly bytes: (fixture: Fixture) => Uint8Array;
}

const RANGE_FIXTURE_RECORDS = 3;

function rangeFixture(): Fixture {
  return build({
    format: 'EDF',
    recordCount: RANGE_FIXTURE_RECORDS,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  });
}

const RANGE_CASES: readonly RangeCase[] = [
  {
    name: 'a buffer one byte short of the requested records',
    records: { start: 0, count: 2 },
    bytes: (fixture) => {
      const exact = recordsOf(fixture, { start: 0, count: 2 });
      return exact.subarray(0, exact.length - 1);
    },
  },
  {
    name: 'a buffer one byte longer than the requested records',
    records: { start: 0, count: 2 },
    bytes: (fixture) =>
      appendBytes(recordsOf(fixture, { start: 0, count: 2 }), Uint8Array.of(0x00)),
  },
  {
    name: 'a buffer holding two records when one was requested',
    records: { start: 0, count: 1 },
    bytes: (fixture) => recordsOf(fixture, { start: 0, count: 2 }),
  },
  {
    name: 'an empty buffer for a non-empty range',
    records: { start: 0, count: 1 },
    bytes: () => new Uint8Array(0),
  },
  {
    name: 'a range running past the last record',
    records: { start: 1, count: RANGE_FIXTURE_RECORDS },
    bytes: (fixture) => recordsOf(fixture, { start: 0, count: RANGE_FIXTURE_RECORDS }),
  },
  {
    name: 'a range starting before record 0',
    records: { start: -1, count: 1 },
    bytes: (fixture) => recordsOf(fixture, { start: 0, count: 1 }),
  },
  {
    name: 'a fractional record count',
    records: { start: 0, count: 1.5 },
    bytes: (fixture) => recordsOf(fixture, { start: 0, count: 1 }),
  },
  {
    name: 'a NaN start',
    records: { start: Number.NaN, count: 1 },
    bytes: (fixture) => recordsOf(fixture, { start: 0, count: 1 }),
  },
];

describe('record range and buffer length', () => {
  for (const testCase of RANGE_CASES) {
    it(`refuses ${testCase.name} instead of decoding what it was handed`, () => {
      const fixture = rangeFixture();
      const call = (): Int32Array =>
        decodeDigital(fixture.header, testCase.bytes(fixture), testCase.records, 0);

      expect(call).toThrow(EdfRangeError);
      let thrown: unknown;
      try {
        call();
      } catch (error) {
        thrown = error;
      }
      expect(isEdfError(thrown)).toBe(true);
      expect((thrown as EdfRangeError).edfErrorKind).toBe('range');
    });
  }

  it('reports how many whole records the buffer actually held', () => {
    const fixture = rangeFixture();
    const short = recordsOf(fixture, { start: 0, count: 3 }).subarray(0, 8 * 2 + 3);
    try {
      decodeDigital(fixture.header, short, { start: 0, count: 3 }, 0);
      expect.unreachable('a short buffer must not decode');
    } catch (error) {
      expect(error).toBeInstanceOf(EdfRangeError);
      const rangeError = error as EdfRangeError;
      expect(rangeError.requested).toEqual({ start: 0, count: 3 });
      // 19 bytes is two whole 8-byte records and a fragment; nothing is padded into existence.
      expect(rangeError.available).toEqual({ start: 0, count: 2 });
    }
  });

  it('refuses a signal index the header does not have', () => {
    const fixture = rangeFixture();
    const records: RecordRange = { start: 0, count: 1 };
    expect(() => decodeDigital(fixture.header, recordsOf(fixture, records), records, 1)).toThrow(
      EdfChannelNotFoundError,
    );
  });

  it('accepts an empty range with an empty buffer', () => {
    const fixture = rangeFixture();
    const decoded = decodeDigital(fixture.header, new Uint8Array(0), { start: 1, count: 0 }, 0);
    expect(decoded).toBeInstanceOf(Int32Array);
    expect(decoded.length).toBe(0);
  });

  it('refuses a header whose signal block overflows its own record, as a plain RangeError', () => {
    // Not EdfRangeError: an offset past the end of the record means the header is internally
    // inconsistent, which is never the caller asking for something reasonable.
    const fixture = rangeFixture();
    const broken: EdfHeader = {
      ...fixture.header,
      signals: [{ ...signalOf(fixture, 0), recordByteOffset: fixture.header.recordByteLength }],
    };
    const records: RecordRange = { start: 0, count: 1 };

    let thrown: unknown;
    try {
      decodeDigital(broken, recordsOf(fixture, records), records, 0);
      expect.unreachable('an out-of-record signal block must not decode');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RangeError);
    expect(isEdfError(thrown)).toBe(false);
  });
});

// ===========================================================================
// `out` reuse
// ===========================================================================

describe('out reuse', () => {
  const records: RecordRange = { start: 0, count: 2 };

  function outFixture(): Fixture {
    return build({
      format: 'EDF',
      recordCount: 2,
      signals: [{ label: 'Fp1', samplesPerRecord: 4, sample: tagged(1) }],
    });
  }

  it('writes into an exactly sized out and returns that same array', () => {
    const fixture = outFixture();
    const out = new Int32Array(8);
    const decoded = decodeDigital(fixture.header, recordsOf(fixture, records), records, 0, out);

    expect(decoded).toBe(out);
    expect(Array.from(out)).toEqual([...expectedFor(1, 4, records)]);
  });

  it('narrows a longer out to a view over its own memory, so nothing is allocated', () => {
    const fixture = outFixture();
    const out = new Int32Array(32).fill(-7);
    const decoded = decodeDigital(fixture.header, recordsOf(fixture, records), records, 0, out);

    expect(decoded.length).toBe(8);
    expect(decoded.buffer).toBe(out.buffer);
    expect(Array.from(decoded)).toEqual([...expectedFor(1, 4, records)]);
    // Spare capacity stays untouched and, crucially, is not reachable through the result:
    // a caller can never mistake it for data.
    expect(out[8]).toBe(-7);
  });

  it('refuses a too-small out rather than truncating the decode', () => {
    const fixture = outFixture();
    const call = (): Int32Array =>
      decodeDigital(fixture.header, recordsOf(fixture, records), records, 0, new Int32Array(7));

    expect(call).toThrow(RangeError);
    let thrown: unknown;
    try {
      call();
    } catch (error) {
      thrown = error;
    }
    // A caller bug about an array it owns, not a claim about the file.
    expect(isEdfError(thrown)).toBe(false);
  });

  it('checks the allocation budget only when it has to allocate', () => {
    const fixture = outFixture();
    const bytes = recordsOf(fixture, records);
    const options = { maxMaterializeBytes: 8 };

    expect(() => decodeDigital(fixture.header, bytes, records, 0, undefined, options)).toThrow(
      EdfBudgetError,
    );
    const out = new Int32Array(8);
    expect(decodeDigital(fixture.header, bytes, records, 0, out, options)).toBe(out);
  });
});

// ===========================================================================
// Out-of-declared-range counting
// ===========================================================================

describe('out-of-declared-range counting', () => {
  const OUT_OF_RANGE_SAMPLES = [-32768, -101, -100, 0, 100, 101, 32767];

  function countingFixture(digitalMinimum: number, digitalMaximum: number): Fixture {
    return build({
      format: 'EDF',
      recordCount: 1,
      signals: [
        {
          label: 'Fp1',
          samplesPerRecord: OUT_OF_RANGE_SAMPLES.length,
          digitalMinimum,
          digitalMaximum,
          sample: (_recordIndex, sampleIndex) => OUT_OF_RANGE_SAMPLES[sampleIndex] ?? 0,
        },
      ],
    });
  }

  const records: RecordRange = { start: 0, count: 1 };

  it('counts the samples outside the declared range without clamping any of them', () => {
    const fixture = countingFixture(-100, 100);
    const { digital, outOfDigitalRangeCount } = decodeDigitalCounted(
      fixture.header,
      recordsOf(fixture, records),
      records,
      0,
    );

    // -32768, -101, 101 and 32767 are outside the declared -100..100.
    expect(outOfDigitalRangeCount).toBe(4);
    // The returned values are the TRUE out-of-range values. edfcore never clamps on read;
    // EDFlib's silent clamping is what flattens the peaks of an over-driven channel into a
    // plateau that reads as real signal, and this is the assertion that refuses to copy it.
    expect(Array.from(digital)).toEqual(OUT_OF_RANGE_SAMPLES);
    // Spelled out for the four offenders: a clamping reader would report -100 and 100 here.
    expect(digital[0]).toBe(-32768);
    expect(digital[1]).toBe(-101);
    expect(digital[5]).toBe(101);
    expect(digital[6]).toBe(32767);
  });

  it('counts nothing when every sample sits inside the declared range', () => {
    const fixture = countingFixture(-32768, 32767);
    const { digital, outOfDigitalRangeCount } = decodeDigitalCounted(
      fixture.header,
      recordsOf(fixture, records),
      records,
      0,
    );
    expect(outOfDigitalRangeCount).toBe(0);
    expect(Array.from(digital)).toEqual(OUT_OF_RANGE_SAMPLES);
  });

  it('treats the declared bounds as inclusive', () => {
    const fixture = countingFixture(-101, 101);
    const { outOfDigitalRangeCount } = decodeDigitalCounted(
      fixture.header,
      recordsOf(fixture, records),
      records,
      0,
    );
    // Only -32768 and 32767 remain outside; -101 and 101 are the bounds themselves.
    expect(outOfDigitalRangeCount).toBe(2);
  });

  it('reads an inverted declared range as min/max, not as an empty interval', () => {
    // digitalMinimum > digitalMaximum is a header defect (EDF+ additional specification 5:
    // "Digital maximum must be larger than Digital minimum"). Comparing against the pair as
    // written would report every sample in the file as out of range, which says nothing at
    // all about the samples.
    const inverted = countingFixture(100, -100);
    const upright = countingFixture(-100, 100);

    const invertedCount = decodeDigitalCounted(
      inverted.header,
      recordsOf(inverted, records),
      records,
      0,
    );
    const uprightCount = decodeDigitalCounted(
      upright.header,
      recordsOf(upright, records),
      records,
      0,
    );

    expect(invertedCount.outOfDigitalRangeCount).toBe(uprightCount.outOfDigitalRangeCount);
    expect(invertedCount.outOfDigitalRangeCount).toBe(4);
    expect(invertedCount.outOfDigitalRangeCount).not.toBe(OUT_OF_RANGE_SAMPLES.length);
    // The inverted range costs the signal its scale, and decoding is unaffected — the
    // deferred-fatal contract seen from the digital side.
    expect(signalOf(inverted, 0).scale).toBeUndefined();
    expect(Array.from(invertedCount.digital)).toEqual(OUT_OF_RANGE_SAMPLES);
  });

  it('counts every out-of-range sample across a multi-record decode', () => {
    const fixture = build({
      format: 'BDF',
      recordCount: 3,
      signals: [
        {
          label: 'Fp1',
          samplesPerRecord: 2,
          digitalMinimum: -10,
          digitalMaximum: 10,
          // One sample per record inside the range, one outside it.
          sample: (recordIndex, sampleIndex) => (sampleIndex === 0 ? 5 : 1000 + recordIndex),
        },
      ],
    });
    const all: RecordRange = { start: 0, count: 3 };
    const counted = decodeDigitalCounted(fixture.header, recordsOf(fixture, all), all, 0);

    expect(counted.outOfDigitalRangeCount).toBe(3);
    expect(Array.from(counted.digital)).toEqual([5, 1000, 5, 1001, 5, 1002]);
  });

  it('decodeDigital returns exactly the array decodeDigitalCounted reports on', () => {
    const fixture = countingFixture(-100, 100);
    const bytes = recordsOf(fixture, records);
    const counted = decodeDigitalCounted(fixture.header, bytes, records, 0);
    const plain = decodeDigital(fixture.header, bytes, records, 0);
    expect(Array.from(plain)).toEqual(Array.from(counted.digital));
  });
});
