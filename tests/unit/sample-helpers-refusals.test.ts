/**
 * The sample helpers refuse the questions that have no answer, and say which one you asked.
 *
 * `sampleAt`, `sampleStartTicksOf` and `gridSampleIndexAt` all map between a time and a sample
 * index, and all three sit behind a guard that rejects the three signals and files where no such
 * mapping exists. Each refusal is a `RangeError` with a `Next:` clause naming a different way to
 * get what the caller wanted, and none of them was executed.
 *
 * They are not exotic inputs. Every one is a shape a caller arrives at by iterating:
 *
 *  - **An annotations channel.** `header.signals` includes it, so `signals.map((s, i) => sampleAt(
 *    recording, i, t))` reaches it on the first EDF+ file. Its region holds TAL text, and a grid
 *    over it would index into the bytes of an event description.
 *  - **A signal declaring zero samples per record.** Legal enough to open with a
 *    `ZERO_SAMPLES_PER_RECORD` warning, and a division by it is the mapping.
 *  - **A file whose records do not advance in time.** Also legal, also warned about, and the same
 *    division. `api-errors.md` calls a scoring file the reason it exists.
 *
 * The three messages differ because the ways out differ: an annotations channel sends you to
 * `onsetTicksFromFirstRecord`, a zero-sample signal to the diagnostic that explains it, and a
 * zero-duration file to `readRecords`. A caller who gets the wrong one is sent to a call that
 * cannot help them, so the pairing is checked rather than the type.
 *
 * `sample-grid.ts` and `sample-locate.ts` carry the same three refusals, deliberately: one takes a
 * recording and one takes a signal and a duration. They are checked side by side here, because
 * 0.3.78 was the two disagreeing about which onset field to recommend.
 *
 * What this does NOT check: the bounds inside `sampleAt`'s segment branch. The source states them
 * as invariants that `segmentAt` has already established rather than as guards, and reaching one
 * would need a segment its own resolver contradicts.
 */

import { describe, expect, it } from 'vitest';
import { EdfChannelNotFoundError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { gridSampleIndexAt, gridSampleStartTicks } from '../../src/sample-grid.js';
import { sampleAt, sampleStartSecondsOf, sampleStartTicksOf } from '../../src/sample-locate.js';
import type { EdfRecording, EdfSignal } from '../../src/types.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

/** EDF+ with one data channel and one annotations channel, so both kinds are on one header. */
const withAnnotations = (): Promise<EdfRecording> =>
  openEdf(byteSource(minimalEdfPlus({ recordCount: 2, recordDurationSeconds: 1 })));

const open = (bytes: Uint8Array): Promise<EdfRecording> => openEdf(byteSource(bytes));

const throws = (call: () => unknown): Error | undefined => {
  try {
    call();
    return undefined;
  } catch (thrown) {
    return thrown as Error;
  }
};

describe('a signal index that is not a signal', () => {
  it('is a channel error carrying the labels there are', async () => {
    const recording = await withAnnotations();
    const failure = throws(() => sampleAt(recording, 99, 0.5));
    expect(failure).toBeInstanceOf(EdfChannelNotFoundError);
    expect(failure?.message).toContain('signalIndex 99');
    expect((failure as EdfChannelNotFoundError).selector).toBe(99);
    expect((failure as EdfChannelNotFoundError).availableLabels).toEqual(
      recording.header.signals.map((one) => one.label),
    );
    // Not a RangeError: a caller catching by kind is asking a different question here.
    expect(failure?.message).toContain('getSignal(header, label)');
  });
});

describe('an annotations channel', () => {
  it('has no sample grid, and is sent to the annotations themselves', async () => {
    const recording = await withAnnotations();
    const index = recording.header.annotationSignalIndices[0] as number;
    const failure = throws(() => sampleAt(recording, index, 0.5));
    expect(failure).toBeInstanceOf(RangeError);
    expect(failure?.message).toContain('annotations');
    expect(failure?.message).toContain('TAL text rather than samples');
    // The rebased axis, not the header's. The two differ by record 0's sub-second offset, and
    // naming the wrong one sends a caller to a number that is off by it (0.3.78).
    expect(failure?.message).toContain('onsetTicksFromFirstRecord');
    expect(failure?.message).not.toContain('use onsetTicks on');
  });

  it('is refused identically by the grid form, which has no recording to consult', async () => {
    const recording = await withAnnotations();
    const signal = recording.header.signals[
      recording.header.annotationSignalIndices[0] as number
    ] as EdfSignal;
    const viaGrid = throws(() => gridSampleIndexAt(signal, 0.5, 10_000_000n));
    const viaRecording = throws(() =>
      sampleAt(recording, recording.header.annotationSignalIndices[0] as number, 0.5),
    );
    expect(viaGrid).toBeInstanceOf(RangeError);
    // The same way out from both, which is the thing 0.3.78 was about.
    expect(viaGrid?.message).toContain('onsetTicksFromFirstRecord');
    expect(viaGrid?.message).toBe(viaRecording?.message);
  });
});

describe('a signal with no samples in a record', () => {
  it('has no grid to index, and is sent to the diagnostic that says why', async () => {
    const recording = await open(
      buildEdf({
        recordCount: 2,
        recordDurationSeconds: 1,
        // One dead channel beside a live one, which is the shape this actually arrives in. A
        // file where EVERY signal declares zero is fatal on open (`RECORD_SIZE_ZERO`): the
        // records would have no size to step by.
        signals: [
          { label: 'Fp1', samplesPerRecord: 0 },
          { label: 'Fp2', samplesPerRecord: 4 },
        ],
      }),
    );
    expect(recording.header.diagnostics.map((one) => one.code)).toContain(
      'ZERO_SAMPLES_PER_RECORD',
    );
    for (const failure of [
      throws(() => sampleAt(recording, 0, 0.5)),
      throws(() => sampleStartTicksOf(recording, 0, 0)),
      throws(() => gridSampleIndexAt(recording.header.signals[0] as EdfSignal, 0.5, 10_000_000n)),
    ]) {
      expect(failure).toBeInstanceOf(RangeError);
      expect(failure?.message).toContain('0 samples per record');
      expect(failure?.message).toContain('ZERO_SAMPLES_PER_RECORD');
    }
  });
});

describe('a file whose records do not advance in time', () => {
  const zeroDuration = (): Promise<EdfRecording> =>
    open(
      buildEdf({
        recordCount: 3,
        recordDurationSeconds: 0,
        signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
      }),
    );

  it('maps no elapsed time to a sample, and is sent to reading by record', async () => {
    const recording = await zeroDuration();
    for (const failure of [
      throws(() => sampleAt(recording, 0, 0)),
      throws(() => sampleStartTicksOf(recording, 0, 0)),
      throws(() => sampleStartSecondsOf(recording, 0, 0)),
      throws(() => gridSampleIndexAt(recording.header.signals[0] as EdfSignal, 0, 0n)),
      throws(() => gridSampleStartTicks(recording.header.signals[0] as EdfSignal, 0, 0n)),
    ]) {
      expect(failure).toBeInstanceOf(RangeError);
      expect(failure?.message).toContain('record duration of zero');
      expect(failure?.message).toContain('readRecords()');
    }
  });

  it('says the file is legal rather than broken, because it is', async () => {
    const recording = await zeroDuration();
    expect(throws(() => sampleAt(recording, 0, 0))?.message).toContain('This is legal EDF');
  });
});

describe('a time that is not a time', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'is refused: %p',
    async (seconds) => {
      const recording = await withAnnotations();
      const failure = throws(() => sampleAt(recording, 0, seconds));
      expect(failure).toBeInstanceOf(RangeError);
      expect(failure?.message).toContain(`received ${seconds}`);
      // Names the axis, because "a time" is ambiguous on a file with a start offset.
      expect(failure?.message).toContain('t = 0 is the start of record 0');
    },
  );

  it('and so is a sample index that is not whole', async () => {
    const recording = await withAnnotations();
    const failure = throws(() => sampleStartTicksOf(recording, 0, 1.5));
    expect(failure).toBeInstanceOf(RangeError);
    // The way a fractional index is actually produced, named in the advice.
    expect(failure?.message).toContain('float sampleRateHz');
  });
});
