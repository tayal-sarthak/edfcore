/**
 * The README's story, end to end, through the PUBLIC barrel.
 *
 * Everything here imports from `src/index.ts` rather than from the module that owns it. That is
 * the point: DESIGN section 3 is the product surface, and a promise that only holds when you
 * reach past the barrel is not a promise this package can ship.
 *
 * Four claims are pinned, each of which every existing JS EDF reader gets wrong:
 *
 * - Each signal keeps its OWN sample rate. There is no universal `sampleRateHz` anywhere in the
 *   API, so the same time window returns a DIFFERENT sample count per signal, and the counts are
 *   asserted against `samplesPerRecord` (authoritative) rather than against a rate.
 * - `readWindow` always returns an ARRAY, including on a continuous file where it always has
 *   exactly one element (DESIGN "Gap policy"). `readRecords` returns exactly ONE chunk, because
 *   the caller named the records.
 * - `EdfChunk.byteLength` is the bytes actually read, so the record-aligned overread that EDF
 *   forces on any single-channel request is VISIBLE rather than hidden (DESIGN decision 7).
 * - `recordDuration = 0` is legal. `sampleRateHz` is then `undefined` for every signal and
 *   nothing in the read path divides by it (DESIGN section 5, header bytes 244-251).
 */

import { describe, expect, it } from 'vitest';
import {
  byteSource,
  type EdfChunk,
  type EdfChunkSignal,
  getSignal,
  openEdf,
  readRecords,
  readWindow,
  toPhysical,
  trimToWindow,
} from '../../src/index.js';
import { spySource } from '../support/spy-source.js';
import { buildEdf, minimalEdf, sineSampler } from '../support/writer.js';

/** `noUncheckedIndexedAccess` is on, and a missing element is a test bug, not an assertion. */
function defined<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}

function onlySignal(chunk: EdfChunk): EdfChunkSignal {
  expect(chunk.signals).toHaveLength(1);
  return defined(chunk.signals[0], 'the chunk signal');
}

/**
 * EDFlib's expression, spelled out here rather than imported.
 *
 * DESIGN section 5 pins `physical = bitValue * (offset + digital)` with
 * `bitValue = (physMax - physMin) / (digMax - digMin)` and
 * `offset = physMax / bitValue - digMax`. Recomputing it in the test from the header's declared
 * numbers is what makes the assertions below about VALUES rather than about `src/`.
 */
function expectedPhysical(
  digital: number,
  physicalMinimum: number,
  physicalMaximum: number,
  digitalMinimum: number,
  digitalMaximum: number,
): number {
  const bitValue = (physicalMaximum - physicalMinimum) / (digitalMaximum - digitalMinimum);
  const offset = physicalMaximum / bitValue - digitalMaximum;
  return bitValue * (offset + digital);
}

// ---------------------------------------------------------------------------
// The headline usage from DESIGN section 3
// ---------------------------------------------------------------------------

describe('openEdf -> getSignal -> readWindow -> toPhysical', () => {
  const PHYSICAL_MINIMUM = -500;
  const PHYSICAL_MAXIMUM = 500;
  const DIGITAL_MINIMUM = -32768;
  const DIGITAL_MAXIMUM = 32767;

  /** Record r holds digital samples r*100 .. r*100+9, so every value names its own record. */
  const bytes = buildEdf({
    signals: [
      {
        label: 'EEG Fpz-Cz',
        physicalDimension: 'uV',
        physicalMinimum: PHYSICAL_MINIMUM,
        physicalMaximum: PHYSICAL_MAXIMUM,
        digitalMinimum: DIGITAL_MINIMUM,
        digitalMaximum: DIGITAL_MAXIMUM,
        samplesPerRecord: 10,
        sample: (recordIndex, sampleIndex) => recordIndex * 100 + sampleIndex,
      },
    ],
    recordCount: 3,
    recordDurationSeconds: 1,
  });

  it('resolves a channel by label and returns the physical values EDFlib would', async () => {
    const recording = await openEdf(byteSource(bytes));
    const eeg = getSignal(recording.header, 'EEG Fpz-Cz');

    expect(eeg.index).toBe(0);
    expect(eeg.kind).toBe('data');
    expect(eeg.unit).toBe('uV');
    expect(eeg.samplesPerRecord).toBe(10);
    expect(eeg.sampleRateHz).toBe(10);
    expect(eeg.sampleCount).toBe(30);

    const chunks = await readWindow(recording, {
      startSeconds: 1,
      durationSeconds: 1,
      signalIndices: [eeg.index],
    });
    const chunkSignal = onlySignal(defined(chunks[0], 'the only chunk'));

    // Record 1, so the digital values are 100..109 and nothing else.
    expect(Array.from(chunkSignal.digital)).toEqual([
      100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
    ]);

    const physical = toPhysical(eeg, chunkSignal.digital);
    expect(physical).toBeInstanceOf(Float64Array);
    expect(physical).toHaveLength(10);
    expect(physical[0]).toBe(
      expectedPhysical(100, PHYSICAL_MINIMUM, PHYSICAL_MAXIMUM, DIGITAL_MINIMUM, DIGITAL_MAXIMUM),
    );
    expect(physical[9]).toBe(
      expectedPhysical(109, PHYSICAL_MINIMUM, PHYSICAL_MAXIMUM, DIGITAL_MINIMUM, DIGITAL_MAXIMUM),
    );
    // The offset term is 0.5 for this symmetric-physical / asymmetric-digital pair, which is
    // exactly why the "simplified" physMin-anchored form disagrees. bitValue is 1000/65535.
    expect(physical[0]).toBeCloseTo(1.534, 3);
  });

  it('returns an ARRAY from readWindow even though this file is continuous', async () => {
    const recording = await openEdf(byteSource(bytes));
    const chunks = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: 3,
      signalIndices: [0],
    });

    // DESIGN "Gap policy": one shape, always. If a bare-chunk shape existed for continuous
    // files, consumers would write against it and misbehave on the first EDF+D they met.
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks).toHaveLength(1);
    expect(defined(chunks[0], 'the only chunk').records).toEqual({ start: 0, count: 3 });
  });

  it('returns exactly one chunk from readRecords, not an array', async () => {
    const recording = await openEdf(byteSource(bytes));
    const chunk = await readRecords(recording, {
      records: { start: 0, count: 2 },
      signalIndices: [0],
    });

    expect(Array.isArray(chunk)).toBe(false);
    expect(chunk.records).toEqual({ start: 0, count: 2 });
    expect(onlySignal(chunk).sampleCount).toBe(20);
    expect(onlySignal(chunk).firstSampleIndex).toBe(0);
  });

  it('reports the chunk byte offset and length of the records it actually read', async () => {
    const recording = await openEdf(byteSource(bytes));
    const chunk = await readRecords(recording, {
      records: { start: 1, count: 1 },
      signalIndices: [0],
    });

    // One signal, 10 samples, 2 bytes each.
    expect(recording.header.recordByteLength).toBe(20);
    expect(recording.header.headerByteLength).toBe(512);
    expect(chunk.byteOffset).toBe(512 + 20);
    expect(chunk.byteLength).toBe(20);
    expect(chunk.startSeconds).toBe(1);
    expect(chunk.durationSeconds).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Per-signal sample rates: the thing the API must never flatten
// ---------------------------------------------------------------------------

describe('a file whose signals sample at three different rates', () => {
  const EEG_SAMPLES_PER_RECORD = 256;
  const ECG_SAMPLES_PER_RECORD = 512;
  const TEMPERATURE_SAMPLES_PER_RECORD = 1;
  const RECORD_COUNT = 4;

  /** The writer's own sine, restated so the assertions do not read `src/` to know the answer. */
  const eegSample = (recordIndex: number, sampleIndex: number): number =>
    Math.round(
      1000 * Math.sin((2 * Math.PI * 4 * sampleIndex) / EEG_SAMPLES_PER_RECORD + recordIndex),
    );

  const bytes = buildEdf({
    recordDurationSeconds: 1,
    recordCount: RECORD_COUNT,
    signals: [
      {
        label: 'EEG Fpz-Cz',
        samplesPerRecord: EEG_SAMPLES_PER_RECORD,
        sample: sineSampler(1000, 4, EEG_SAMPLES_PER_RECORD),
      },
      {
        label: 'ECG',
        samplesPerRecord: ECG_SAMPLES_PER_RECORD,
        sample: (_recordIndex, sampleIndex) => sampleIndex,
      },
      {
        label: 'Temp Rectal',
        physicalDimension: 'degC',
        samplesPerRecord: TEMPERATURE_SAMPLES_PER_RECORD,
        sample: (recordIndex) => 3700 + recordIndex,
      },
    ],
  });

  it('gives every signal its own rate and never publishes a file-wide one', async () => {
    const recording = await openEdf(byteSource(bytes));
    const { header } = recording;

    expect(header.signals.map((signal) => signal.sampleRateHz)).toEqual([256, 512, 1]);
    expect(header.signals.map((signal) => signal.samplesPerRecord)).toEqual([256, 512, 1]);

    // There is no header-level sample rate to be tempted by: `samplesPerRecord` is the
    // authoritative quantity and `sampleRateHz` is derived per signal (DESIGN section 3).
    expect('sampleRateHz' in header).toBe(false);
    expect('sampleRate' in header).toBe(false);
  });

  it('returns a different sample count per signal over the SAME two-second window', async () => {
    const recording = await openEdf(byteSource(bytes));
    const chunks = await readWindow(recording, {
      startSeconds: 1,
      durationSeconds: 2,
      signalIndices: [0, 1, 2],
    });

    expect(chunks).toHaveLength(1);
    const chunk = defined(chunks[0], 'the only chunk');
    expect(chunk.records).toEqual({ start: 1, count: 2 });

    expect(chunk.signals.map((signal) => signal.sampleCount)).toEqual([512, 1024, 2]);
    // Each signal indexes on its OWN grid, so the first sample index differs too.
    expect(chunk.signals.map((signal) => signal.firstSampleIndex)).toEqual([256, 512, 1]);
    // The chunk covers one span in time; the per-signal starts agree because it is one run.
    expect(chunk.signals.map((signal) => signal.startSeconds)).toEqual([1, 1, 1]);
  });

  it('de-interleaves each signal out of the same record bytes', async () => {
    const recording = await openEdf(byteSource(bytes));
    const chunks = await readWindow(recording, {
      startSeconds: 1,
      durationSeconds: 2,
      signalIndices: [0, 1, 2],
    });
    const chunk = defined(chunks[0], 'the only chunk');
    const [eeg, ecg, temperature] = chunk.signals;

    const eegDigital = defined(eeg, 'the EEG chunk signal').digital;
    expect(eegDigital[0]).toBe(eegSample(1, 0));
    expect(eegDigital[255]).toBe(eegSample(1, 255));
    // Crossing the record boundary inside one chunk: sample 256 is record 2's sample 0.
    expect(eegDigital[256]).toBe(eegSample(2, 0));

    const ecgDigital = defined(ecg, 'the ECG chunk signal').digital;
    expect(ecgDigital[0]).toBe(0);
    expect(ecgDigital[511]).toBe(511);
    expect(ecgDigital[512]).toBe(0);

    expect(Array.from(defined(temperature, 'the temperature chunk signal').digital)).toEqual([
      3701, 3702,
    ]);
  });

  it('makes the record-aligned overread visible through chunk.byteLength', async () => {
    const source = spySource(byteSource(bytes));
    const recording = await openEdf(source);
    source.reset();

    // Two seconds of the 1 Hz temperature channel: 2 samples, 4 bytes of interest.
    const chunks = await readWindow(recording, {
      startSeconds: 1,
      durationSeconds: 2,
      signalIndices: [2],
    });
    const chunk = defined(chunks[0], 'the only chunk');

    const recordByteLength = 2 * (256 + 512 + 1);
    expect(recording.header.recordByteLength).toBe(recordByteLength);
    expect(onlySignal(chunk).sampleCount).toBe(2);
    // DESIGN decision 7: there is no cheap single-channel read in EDF, and the API says so
    // instead of hiding it. 3076 bytes were read to deliver 4 bytes of samples.
    expect(chunk.byteLength).toBe(2 * recordByteLength);
    expect(chunk.byteOffset).toBe(recording.header.headerByteLength + recordByteLength);

    // And it was ONE contiguous read covering every signal, not one read per channel.
    expect(source.reads).toEqual([
      {
        offset: recording.header.headerByteLength + recordByteLength,
        length: 2 * recordByteLength,
        sequence: 0,
      },
    ]);
    expect(source.bytesRead).toBe(chunk.byteLength);
  });
});

// ---------------------------------------------------------------------------
// BDF: 24-bit sign extension, end to end
// ---------------------------------------------------------------------------

describe('a BDF file read through the barrel', () => {
  const PHYSICAL_MINIMUM = -1000;
  const PHYSICAL_MAXIMUM = 1000;
  const BDF_DIGITAL_MINIMUM = -8388608;
  const BDF_DIGITAL_MAXIMUM = 8388607;

  /** The two 24-bit extremes plus two values whose sign extension is easy to get wrong. */
  const SAMPLES: readonly number[] = [BDF_DIGITAL_MINIMUM, BDF_DIGITAL_MAXIMUM, -1, 0];

  const bytes = buildEdf({
    format: 'BDF',
    recordCount: 1,
    recordDurationSeconds: 1,
    signals: [
      {
        label: 'EEG A1-A2',
        physicalMinimum: PHYSICAL_MINIMUM,
        physicalMaximum: PHYSICAL_MAXIMUM,
        digitalMinimum: BDF_DIGITAL_MINIMUM,
        digitalMaximum: BDF_DIGITAL_MAXIMUM,
        samplesPerRecord: SAMPLES.length,
        sample: (_recordIndex, sampleIndex) => SAMPLES[sampleIndex] ?? 0,
      },
    ],
  });

  it('sign-extends 0x800000 from bit 23 and scales it in float64', async () => {
    const recording = await openEdf(byteSource(bytes));
    const { header } = recording;

    expect(header.variant).toBe('BDF');
    expect(header.bytesPerSample).toBe(3);
    expect(header.recordByteLength).toBe(12);

    // The bytes on disk really are 0x800000, little-endian (DESIGN section 5, data records).
    const firstSampleOffset = header.headerByteLength;
    expect(bytes[firstSampleOffset]).toBe(0x00);
    expect(bytes[firstSampleOffset + 1]).toBe(0x00);
    expect(bytes[firstSampleOffset + 2]).toBe(0x80);

    const chunk = await readRecords(recording, {
      records: { start: 0, count: 1 },
      signalIndices: [0],
    });
    const chunkSignal = onlySignal(chunk);
    expect(Array.from(chunkSignal.digital)).toEqual([...SAMPLES]);
    expect(chunkSignal.outOfDigitalRangeCount).toBe(0);

    const signal = getSignal(header, 'EEG A1-A2');
    const physical = toPhysical(signal, chunkSignal.digital);
    for (let i = 0; i < SAMPLES.length; i += 1) {
      expect(physical[i]).toBe(
        expectedPhysical(
          defined(SAMPLES[i], `sample ${i}`),
          PHYSICAL_MINIMUM,
          PHYSICAL_MAXIMUM,
          BDF_DIGITAL_MINIMUM,
          BDF_DIGITAL_MAXIMUM,
        ),
      );
    }
    // The negative extreme maps to the negative end of the physical range, not to +1000.
    expect(physical[0]).toBeLessThan(-999.9);
    expect(physical[1]).toBe(PHYSICAL_MAXIMUM);
  });
});

// ---------------------------------------------------------------------------
// recordDuration = 0 — legal, and the landmine PhysioNet hypnograms ship
// ---------------------------------------------------------------------------

describe('a file whose record duration is 0', () => {
  const bytes = minimalEdf({
    signals: [{ label: 'Fp1', samplesPerRecord: 10, sample: (r, i) => r * 10 + i }],
    recordCount: 2,
    recordDurationSeconds: 0,
  });

  it('leaves sampleRateHz undefined and divides by nothing', async () => {
    const recording = await openEdf(byteSource(bytes));
    const { header, timeline } = recording;

    // EDF specification, header bytes 244-251: the duration may legitimately be 0.
    expect(header.recordDurationSeconds).toBe(0);
    expect(header.recordDurationTicks).toBe(0n);
    expect(header.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'ZERO_RECORD_DURATION',
    );

    const signal = getSignal(header, 'Fp1');
    expect(signal.sampleRateHz).toBeUndefined();
    // The key is present and the value is undefined — reading a result never requires an `in`
    // check (DESIGN section 3, `types.ts` convention 1).
    expect('sampleRateHz' in signal).toBe(true);
    // `samplesPerRecord` still indexes the file exactly.
    expect(signal.samplesPerRecord).toBe(10);
    expect(signal.sampleCount).toBe(20);

    for (const value of [
      timeline.recordDurationSeconds,
      timeline.startOffsetSeconds,
      timeline.spanSeconds,
      timeline.coveredSeconds,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(timeline.spanSeconds).toBe(0);
    expect(timeline.coveredSeconds).toBe(0);
  });

  it('still reads records and windows without producing NaN or Infinity', async () => {
    const recording = await openEdf(byteSource(bytes));

    const chunk = await readRecords(recording, {
      records: { start: 0, count: 2 },
      signalIndices: [0],
    });
    expect(Array.from(onlySignal(chunk).digital)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
    expect(chunk.startSeconds).toBe(0);
    expect(chunk.durationSeconds).toBe(0);
    expect(Number.isNaN(chunk.durationSeconds)).toBe(false);

    // Every record sits at the same instant, so a window containing that instant contains them
    // all and a window that does not contains none.
    const chunks = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: 1,
      signalIndices: [0],
    });
    expect(chunks).toHaveLength(1);
    expect(defined(chunks[0], 'the only chunk').records).toEqual({ start: 0, count: 2 });

    await expect(
      readWindow(recording, { startSeconds: 5, durationSeconds: 1, signalIndices: [0] }),
    ).resolves.toEqual([]);

    // And the exact trim agrees rather than dividing by the zero duration.
    const trimmed = trimToWindow(recording.header, onlySignal(chunk), 0, 1);
    expect(trimmed.sampleCount).toBe(20);
    expect(Number.isFinite(trimmed.startSeconds)).toBe(true);
  });
});
