/**
 * The SIGNALS a lookup returned, where the selection wants their indices.
 *
 * `signalIndices` is the one required option with no default, and the package's own answer to
 * "which channels?" is a lookup by name: `getSignal(header, label)` and `matchSignals(header,
 * pattern)`. Both return `EdfSignal`s. So
 * `readWindow(recording, { signalIndices: matchSignals(header, /EEG/), … })` is the selection a
 * reader writes out of two calls this library taught them, and it is wrong by exactly one field.
 *
 * `assertSignalIndices` cannot see it — an array of signals is an array — so it reached
 * `header.signals[signal]`, found nothing, and was refused with
 *
 *     signalIndex [object Object] is outside the 3 signals this file declares.
 *     Next: pass an index from header.dataSignalIndices, or resolve one with getSignal(header, label).
 *
 * Both halves fail the reader. `[object Object]` is the raw interpolation `describeValue` exists to
 * remove (0.6.94) and names nothing they can act on; and the next step points at `getSignal`, which
 * returns a signal — the very value being refused. A caller who follows the advice literally writes
 * the same mistake a second time, one channel at a time.
 *
 * All five reading entry points share this refusal, by design — `readWindow`, `readRecords`,
 * `streamRecords` and both envelope calls come through `channelNotFound`, which 0.6.136 made the
 * single home for it. One message, so one fix.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { EdfChannelNotFoundError, isEdfError } from '../../src/errors.js';
import { getSignal, matchSignals } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fpz-Cz', samplesPerRecord: 8 },
    { label: 'EEG Pz-Oz', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

type Call = (recording: EdfRecording, signalIndices: unknown) => Promise<unknown>;

const CALLS: ReadonlyArray<readonly [string, Call]> = [
  [
    'readWindow',
    (recording, signalIndices) =>
      readWindow(recording, {
        signalIndices: signalIndices as never,
        startSeconds: 0,
        durationSeconds: 2,
      }),
  ],
  [
    'readRecords',
    (recording, signalIndices) =>
      readRecords(recording, {
        signalIndices: signalIndices as never,
        records: { start: 0, count: 2 },
      }),
  ],
  [
    'streamRecords',
    async (recording, signalIndices) => {
      for await (const chunk of streamRecords(recording, {
        signalIndices: signalIndices as never,
        startSeconds: 0,
        durationSeconds: 2,
      })) {
        return chunk;
      }
      return undefined;
    },
  ],
  [
    'readEnvelope',
    (recording, signalIndices) =>
      readEnvelope(recording, {
        signalIndices: signalIndices as never,
        startSeconds: 0,
        durationSeconds: 2,
        buckets: 4,
      }),
  ],
  [
    'readEnvelopeAtResolution',
    (recording, signalIndices) =>
      readEnvelopeAtResolution(recording, {
        signalIndices: signalIndices as never,
        startSeconds: 0,
        durationSeconds: 2,
        secondsPerBucket: 1,
      }),
  ],
];

describe.each(CALLS)('%s, given the signals a lookup returned', (_name, call) => {
  it('names the signal rather than printing [object Object]', async () => {
    const recording = await opened();
    const matched = matchSignals(recording.header, /EEG/);
    expect(matched.length).toBe(2);
    const thrown = await call(recording, matched).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown, 'the selection was read as indices').toBeDefined();
    expect(thrown?.message).not.toContain('[object Object]');
    expect(thrown?.message).toContain('holds a signal rather than an index');
  });

  it('points at the index field instead of back at the call that returned the signal', async () => {
    const recording = await opened();
    const thrown = await call(recording, [getSignal(recording.header, 'EEG Fpz-Cz')]).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    // The old advice named getSignal(), which is where the value came from.
    expect(thrown?.message).toContain('signal.index');
    expect(thrown?.message).toContain('Next:');
  });

  it('stays the typed error a handler already branches on', async () => {
    const recording = await opened();
    const thrown = await call(recording, matchSignals(recording.header, /EEG/)).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown).toBeInstanceOf(EdfChannelNotFoundError);
    expect(isEdfError(thrown)).toBe(true);
  });

  it('still reads when the indices are taken off those same signals', async () => {
    const recording = await opened();
    const indices = matchSignals(recording.header, /EEG/).map((signal) => signal.index);
    await expect(call(recording, indices)).resolves.toBeDefined();
  });
});

describe('an index the file really does not have', () => {
  it('keeps saying so in its own words', async () => {
    const recording = await opened();
    await expect(
      readWindow(recording, { signalIndices: [9], startSeconds: 0, durationSeconds: 2 }),
    ).rejects.toThrow(/signalIndex 9 is outside the 3 signals this file declares/);
  });
});
