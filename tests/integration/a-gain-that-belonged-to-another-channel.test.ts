/**
 * `toPhysicalEnvelope(header.signals[i], envelopeChunk.signals[i])`, where `i` is not the same
 * signal twice.
 *
 * The two arrays are indexed differently, and that is the whole mistake. `header.signals` is in FILE
 * order; `chunk.signals` is in the order `signalIndices` was given. So a plot loop pairing index
 * against index is right only when every signal was selected in order, and wrong on every iteration
 * otherwise — `signalIndices: [3, 7]` makes `header.signals[0]` the first channel in the file and
 * `chunk.signals[0]` the fourth.
 *
 * Nothing asked. The two arguments arrive separately and are only ever paired by a caller, which is
 * the shape `resolveTimeWindow` guards for its timeline and index — "not a wrong number but a wrong
 * FILE: the segments and gaps of recording A reported as the structure of recording B". Here it is a
 * wrong CHANNEL, and unlike that one it ANSWERED: a full-length `{ min, max }` pair, every bound a
 * finite number, scaled by the other signal's gain.
 *
 * What it costs is the thing this package exists to prevent. An SaO2 channel declared 0..100 % drawn
 * through an EEG's ±500 µV gain comes back as a flat trace near zero — "numbers that look exactly
 * like a signal", which is how `resolveSignals` names the failure. No exception, no diagnostic, and a
 * plot a reader cannot tell from a quiet channel.
 *
 * Both of this function's existing messages already name the right pairing,
 * `header.signals[envelopeSignal.signalIndex]`. It was advice for getting the shape right that
 * doubled as the fix for this, given only to callers who had already made a different mistake.
 *
 * This is the only published call that takes a header signal and a per-signal result as two
 * arguments without looking the first one up itself. `trimToWindow` resolves it from
 * `chunkSignal.signalIndex`; `toPhysical` is handed a bare array with no index to compare.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope, toPhysicalEnvelope } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfEnvelopeSignal, EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

/** Two channels whose gains differ by a factor of ten, so a swap is visible in the numbers. */
const FILE = buildEdf({
  format: 'EDF',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [
    {
      label: 'EEG Fp1',
      samplesPerRecord: 4,
      physicalMinimum: -500,
      physicalMaximum: 500,
      physicalDimension: 'uV',
    },
    {
      label: 'SaO2',
      samplesPerRecord: 4,
      physicalMinimum: 0,
      physicalMaximum: 100,
      physicalDimension: '%',
    },
  ],
});

async function open(): Promise<EdfRecording> {
  return openEdf(byteSource(FILE));
}

async function envelopes(
  recording: EdfRecording,
  signalIndices: readonly number[],
): Promise<readonly EdfEnvelopeSignal[]> {
  const [chunk] = await readEnvelope(recording, {
    signalIndices,
    startSeconds: 0,
    durationSeconds: 2,
    buckets: 2,
  });
  if (chunk === undefined) throw new Error('no envelope chunk');
  return chunk.signals;
}

describe('a header signal paired with another signal’s envelope', () => {
  it('is refused rather than converted', async () => {
    const recording = await open();
    const [, saO2] = await envelopes(recording, [0, 1]);
    const eeg = recording.header.signals[0];
    if (eeg === undefined || saO2 === undefined) throw new Error('fixture');
    expect(() => toPhysicalEnvelope(eeg, saO2)).toThrow(RangeError);
  });

  it('names both indices and what the wrong gain would have produced', async () => {
    const recording = await open();
    const [, saO2] = await envelopes(recording, [0, 1]);
    const eeg = recording.header.signals[0];
    if (eeg === undefined || saO2 === undefined) throw new Error('fixture');
    let message = '';
    try {
      toPhysicalEnvelope(eeg, saO2);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('the signal is header.signals[0]');
    expect(message).toContain('the envelope is for signal 1');
    expect(message).toContain("another channel's gain");
    expect(message).toContain('numbers that read as measurements');
  });

  it('says why index-for-index is not the pairing', async () => {
    const recording = await open();
    const [, saO2] = await envelopes(recording, [0, 1]);
    const eeg = recording.header.signals[0];
    if (eeg === undefined || saO2 === undefined) throw new Error('fixture');
    expect(() => toPhysicalEnvelope(eeg, saO2)).toThrow(
      /header.signals\[envelopeSignal.signalIndex\]/,
    );
    expect(() => toPhysicalEnvelope(eeg, saO2)).toThrow(/chunk.signals is in the order/);
  });

  it('is a caller mistake, so it is a plain RangeError', async () => {
    const recording = await open();
    const [, saO2] = await envelopes(recording, [0, 1]);
    const eeg = recording.header.signals[0];
    if (eeg === undefined || saO2 === undefined) throw new Error('fixture');
    expect(() => toPhysicalEnvelope(eeg, saO2)).toThrow(RangeError);
  });
});

describe('the selection order that makes index-for-index wrong', () => {
  it('is refused on the first iteration of the loop a reader writes', async () => {
    const recording = await open();
    // The second channel only. chunk.signals[0] is signal 1; header.signals[0] is signal 0.
    const [only] = await envelopes(recording, [1]);
    const first = recording.header.signals[0];
    if (only === undefined || first === undefined) throw new Error('fixture');
    expect(only.signalIndex).toBe(1);
    expect(() => toPhysicalEnvelope(first, only)).toThrow(/the envelope is for signal 1/);
  });

  it('and reversed order is refused both ways round', async () => {
    const recording = await open();
    const reversed = await envelopes(recording, [1, 0]);
    const [a, b] = reversed;
    const [first, second] = recording.header.signals;
    if (a === undefined || b === undefined || first === undefined || second === undefined) {
      throw new Error('fixture');
    }
    expect(() => toPhysicalEnvelope(first, a)).toThrow(RangeError);
    expect(() => toPhysicalEnvelope(second, b)).toThrow(RangeError);
  });
});

describe('the pairing the message names', () => {
  it('still converts, and the bounds land in the channel’s own range', async () => {
    const recording = await open();
    const signals = await envelopes(recording, [0, 1]);
    for (const envelope of signals) {
      const signal = recording.header.signals[envelope.signalIndex];
      if (signal === undefined) throw new Error('fixture');
      const physical = toPhysicalEnvelope(signal, envelope);
      for (const bound of [...physical.min, ...physical.max]) {
        if (Number.isNaN(bound)) continue;
        expect(bound).toBeGreaterThanOrEqual(signal.physicalMinimum);
        expect(bound).toBeLessThanOrEqual(signal.physicalMaximum);
      }
    }
  });

  it('is what the wrong pairing silently broke', async () => {
    const recording = await open();
    const [, saO2] = await envelopes(recording, [0, 1]);
    const signal = recording.header.signals[1];
    if (saO2 === undefined || signal === undefined) throw new Error('fixture');
    const right = toPhysicalEnvelope(signal, saO2);
    // The SaO2 channel reads as a percentage. Through the EEG gain it read as a flat line near zero,
    // which is the quiet-channel plot a reader has no way to question.
    expect(right.min[0]).toBeGreaterThan(1);
  });
});

describe('an envelope with no index on it at all', () => {
  it('is not called a mismatch, because there is nothing to disagree with', async () => {
    const recording = await open();
    const signal = recording.header.signals[0];
    if (signal === undefined) throw new Error('fixture');
    // A `{ min, max, counts }` literal assembled by hand. `EdfEnvelopeSignal` declares
    // `signalIndex`, so nothing readEnvelope() returns looks like this — and "the envelope is for
    // signal undefined" would name a mismatch that was never established.
    const byHand = {
      min: Float64Array.of(0),
      max: Float64Array.of(1),
      counts: Uint32Array.of(1),
    };
    expect(() => toPhysicalEnvelope(signal, byHand as never)).not.toThrow();
  });
});

describe('the guards that were already there', () => {
  it('keep their own sentences, and still run first', async () => {
    const recording = await open();
    const [chunk] = await readEnvelope(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 2,
      buckets: 2,
    });
    const signal = recording.header.signals[0];
    if (chunk === undefined || signal === undefined) throw new Error('fixture');
    expect(() => toPhysicalEnvelope(signal, chunk as never)).toThrow(/an envelope chunk/);
    const physical = toPhysicalEnvelope(signal, chunk.signals[0] as EdfEnvelopeSignal);
    expect(() => toPhysicalEnvelope(signal, physical as never)).toThrow(/has no counts/);
  });
});
