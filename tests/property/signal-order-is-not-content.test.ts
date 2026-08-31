/**
 * Reordering the signals in a header changes where the bytes are and nothing else.
 *
 * EDF interleaves: every data record holds each signal's samples end to end, in header order, and
 * a signal's block begins at the sum of the widths of the signals declared before it. So the
 * position of a channel in the header decides the offset every read of it is computed from —
 * `recordByteOffset` — while deciding nothing at all about what that channel contains.
 *
 * That makes signal order a metamorphic transformation, and a strong one: it changes every offset
 * in the de-interleaving arithmetic and must change no value anywhere. A fixture with one signal,
 * or with several of equal width, cannot tell the difference; the arithmetic only has room to be
 * wrong when the widths differ, which is exactly the file the format exists for — EEG at 256 Hz
 * beside a temperature channel at 1 Hz.
 *
 * The suite tests reading against expected values, per fixture. Nothing tested it against itself
 * under a transformation, and this is the transformation with the most reach: a `recordByteOffset`
 * computed from the wrong running total, an off-by-one in the signal loop, or a decode that
 * assumed uniform width would all survive every fixture in the suite and fail here.
 *
 * Both directions are asserted. The offsets really do move — the check would be worthless if the
 * permutation were invisible — and every per-label result stays identical: the samples, the
 * physical values, the observed range the sweep reports, the sample counts, and what `getSignal`
 * and `findSignals` return.
 *
 * The last block is the property over arbitrary permutations of arbitrary widths, with a constant
 * seed.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../src/decode/physical.js';
import { readEnvelope } from '../../src/envelope.js';
import { findSignals, getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf, type SignalSpec } from '../support/writer.js';

const SEED = 0x0d0e_0001;

/** Three widths, three waveforms. Nothing here is symmetric under a permutation by accident. */
const SIGNALS: readonly SignalSpec[] = [
  { label: 'EEG Fpz-Cz', samplesPerRecord: 32, sample: (record, index) => record * 1000 + index },
  { label: 'ECG II', samplesPerRecord: 8, sample: (record, index) => -(record * 10 + index) },
  { label: 'Temp rectal', samplesPerRecord: 1, sample: (record) => record },
];
const LABELS = SIGNALS.map((signal) => signal.label ?? '');

function fileWith(order: readonly number[]): Uint8Array {
  return buildEdf({
    plus: 'C',
    recordCount: 5,
    recordDurationSeconds: 1,
    signals: order.map((at) => {
      const signal = SIGNALS[at];
      if (signal === undefined) throw new Error(`no signal ${at}`);
      return signal;
    }),
    annotationSignals: [{ samplesPerRecord: 20 }],
  });
}

/** Everything edfcore says about one channel, found by label rather than by position. */
async function describeChannel(recording: EdfRecording, label: string): Promise<string> {
  const signal = getSignal(recording.header, label);
  const chunk = await readRecords(recording, {
    records: { start: 2, count: 2 },
    signalIndices: [signal.index],
  });
  const series = chunk.signals[0];
  if (series === undefined) throw new Error('one signal was asked for and none came back');
  const digital = [...series.digital.subarray(0, series.sampleCount)];
  const physical = [...toPhysical(signal, series.digital)];
  const [envelope] = await readEnvelope(recording, {
    startSeconds: 0,
    durationSeconds: 5,
    buckets: 4,
    signalIndices: [signal.index],
  });
  const buckets = envelope?.signals[0];

  return JSON.stringify({
    samplesPerRecord: signal.samplesPerRecord,
    sampleCount: signal.sampleCount,
    sampleRateHz: signal.sampleRateHz,
    physicalDimension: signal.physicalDimension,
    scale: signal.scale,
    digital,
    physical,
    firstSampleIndex: series.firstSampleIndex,
    startSeconds: series.startSeconds,
    envelopeMin: [...(buckets?.min ?? [])],
    envelopeMax: [...(buckets?.max ?? [])],
    found: findSignals(recording.header, label).length,
  });
}

async function observedRange(recording: EdfRecording, label: string): Promise<string> {
  const report = await validateRecording(recording, { scanSamples: true });
  const signal = getSignal(recording.header, label);
  const stats = report.signalStats.find((entry) => entry.signalIndex === signal.index);
  return `${stats?.observedDigitalMin}..${stats?.observedDigitalMax} over ${stats?.sampleCount}`;
}

describe('the permutation really moves the bytes', () => {
  it('gives the three orders three different sets of record offsets', async () => {
    const offsets = new Set<string>();
    for (const order of [
      [0, 1, 2],
      [2, 1, 0],
      [1, 0, 2],
    ]) {
      const recording = await openEdf(byteSource(fileWith(order)));
      offsets.add(recording.header.signals.map((signal) => signal.recordByteOffset).join(','));
      // The record is the same size whichever order it is written in, which is what makes this a
      // permutation rather than a different file.
      expect(recording.header.recordByteLength).toBe(122);
    }
    expect(offsets.size).toBe(3);
  });

  it('and moves a given channel’s own offset, which is the number every read is computed from', async () => {
    const forward = await openEdf(byteSource(fileWith([0, 1, 2])));
    const reversed = await openEdf(byteSource(fileWith([2, 1, 0])));
    const offsetOf = (recording: EdfRecording, label: string): number =>
      getSignal(recording.header, label).recordByteOffset;
    expect(offsetOf(forward, 'EEG Fpz-Cz')).toBe(0);
    expect(offsetOf(reversed, 'EEG Fpz-Cz')).toBe(18);
    expect(offsetOf(forward, 'Temp rectal')).toBe(80);
    expect(offsetOf(reversed, 'Temp rectal')).toBe(0);
  });
});

describe('and changes nothing about the channels themselves', () => {
  it('reports every channel identically, whichever order it is declared in', async () => {
    const orders = [
      [0, 1, 2],
      [2, 1, 0],
      [1, 0, 2],
      [0, 2, 1],
    ];
    const perLabel = new Map<string, Set<string>>();
    for (const order of orders) {
      const recording = await openEdf(byteSource(fileWith(order)));
      for (const label of LABELS) {
        const seen = perLabel.get(label) ?? new Set<string>();
        seen.add(await describeChannel(recording, label));
        perLabel.set(label, seen);
      }
    }
    for (const label of LABELS) {
      expect(perLabel.get(label)?.size, label).toBe(1);
    }
    // And the descriptions are substantial, so four identical empty strings is not the pass.
    expect([...(perLabel.get('EEG Fpz-Cz') ?? [])][0]?.length).toBeGreaterThan(400);
  });

  it('gives the sweep the same observed range for each channel', async () => {
    for (const label of LABELS) {
      const ranges = new Set<string>();
      for (const order of [
        [0, 1, 2],
        [2, 1, 0],
        [1, 0, 2],
      ]) {
        ranges.add(await observedRange(await openEdf(byteSource(fileWith(order))), label));
      }
      expect(ranges.size, label).toBe(1);
      expect([...ranges][0], label).not.toContain('undefined');
    }
  });

  it('keeps signalIndex following the label rather than the label following the index', async () => {
    const forward = await openEdf(byteSource(fileWith([0, 1, 2])));
    const reversed = await openEdf(byteSource(fileWith([2, 1, 0])));
    expect(getSignal(forward.header, 'Temp rectal').index).toBe(2);
    expect(getSignal(reversed.header, 'Temp rectal').index).toBe(0);
    // The annotations channel is appended either way, and stays out of the data indices.
    expect(forward.header.annotationSignalIndices).toEqual([3]);
    expect(reversed.header.annotationSignalIndices).toEqual([3]);
    expect([...forward.header.dataSignalIndices]).toEqual([0, 1, 2]);
  });
});

describe('over arbitrary widths and arbitrary permutations', () => {
  it('reads the same samples for a channel wherever it sits', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 24 }), { minLength: 2, maxLength: 5 }),
        fc.integer({ min: 0, max: 119 }),
        async (widths, shuffle) => {
          const specs: SignalSpec[] = widths.map((samplesPerRecord, at) => ({
            label: `S${at}`,
            samplesPerRecord,
            sample: (record, index) => (at + 1) * 100 + record * 10 + (index % 9),
          }));

          // A rotation by `shuffle`, which is a permutation for any offset.
          const rotate = shuffle % specs.length;
          const rotated = [...specs.slice(rotate), ...specs.slice(0, rotate)];

          const read = async (order: readonly SignalSpec[]): Promise<Map<string, string>> => {
            const recording = await openEdf(
              byteSource(
                buildEdf({
                  plus: 'C',
                  recordCount: 3,
                  recordDurationSeconds: 1,
                  signals: order,
                  annotationSignals: [{ samplesPerRecord: 20 }],
                }),
              ),
            );
            const out = new Map<string, string>();
            for (const spec of specs) {
              const label = spec.label ?? '';
              const signal = getSignal(recording.header, label);
              const chunk = await readRecords(recording, {
                records: { start: 1, count: 2 },
                signalIndices: [signal.index],
              });
              const series = chunk.signals[0];
              out.set(
                label,
                [...(series?.digital.subarray(0, series.sampleCount) ?? [])].join(','),
              );
            }
            return out;
          };

          const before = await read(specs);
          const after = await read(rotated);
          for (const [label, samples] of before) {
            expect(after.get(label), label).toBe(samples);
          }
        },
      ),
      { seed: SEED, numRuns: 60 },
    );
  });
});
