/**
 * A LABEL in `signalIndices`, told it was outside a range it was never in.
 *
 * 0.6.93 drew the distinction in `getSignal`: 1.5 "is not a whole number, so it falls between two
 * signals rather than outside them". 0.6.133 carried it to `sample-locate.ts` and its comment there
 * calls that module "the other copy of that message" — a label "is not outside anything", and
 * `sampleAt(recording, 'A1', t)` is what a caller used to naming channels writes.
 *
 * It was not the other copy. `channelNotFound` is the refusal the five reading calls share, made
 * their single home in 0.6.136, and it still answered
 *
 *     signalIndex EEG Fpz-Cz is outside the 3 signals this file declares.
 *
 * one clause above "resolve one with getSignal(header, label)" — the function that would have taken
 * it. `1.5` got the same sentence, and a bare object got `signalIndex [object Object] is outside`,
 * which is the raw interpolation `describeValue` exists to remove (0.6.94) and which the 0.6.174
 * branch directly above quotes as the defect it was there to fix.
 *
 * The genuinely out-of-range index is unchanged, because for that one the sentence was true.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { EdfChannelNotFoundError, isEdfError } from '../../src/errors.js';
import { matchSignals } from '../../src/header/lookup.js';
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

const refusalFor = async (call: Call, signalIndices: unknown): Promise<Error | undefined> =>
  call(await opened(), signalIndices).then(
    () => undefined,
    (error: unknown) => error as Error,
  );

describe.each(CALLS)('%s', (_name, call) => {
  it('no longer calls a label outside a range it was never in', async () => {
    const thrown = await refusalFor(call, ['EEG Fpz-Cz']);
    expect(thrown, 'the label was read as an index').toBeDefined();
    expect(thrown?.message).not.toContain('is outside the');
    expect(thrown?.message).toContain('not a number this header can be indexed by');
    // Named, so the reader can see WHICH of their channels arrived as text.
    expect(thrown?.message).toContain('"EEG Fpz-Cz"');
  });

  it('says a fraction falls between two signals rather than outside them', async () => {
    const thrown = await refusalFor(call, [1.5]);
    expect(thrown?.message).toContain('1.5 is not a whole number');
    expect(thrown?.message).toContain('falls between two signals rather than outside them');
    expect(thrown?.message).not.toContain('is outside the');
  });

  it('never prints a raw object again, in the branch below the one 0.6.174 fixed', async () => {
    for (const value of [{}, { index: '0' }, null, undefined, Number.NaN]) {
      const thrown = await refusalFor(call, [value]);
      expect(thrown?.message, JSON.stringify(value) ?? 'undefined').not.toContain(
        '[object Object]',
      );
      expect(thrown?.message).toContain('not a number this header can be indexed by');
    }
  });

  it('keeps the sentence for an index that really is out of range', async () => {
    const thrown = await refusalFor(call, [99]);
    expect(thrown?.message).toContain('signalIndex 99 is outside the 3 signals this file declares');
  });

  it('keeps it for the canonical decimal string, which is a spelling of that index', async () => {
    // `the-same-channel-twice.test.ts` and `a-selection-from-json.test.ts` both name this shape as
    // accepted, so `'9'` is an index that is out of range — not a value that is not a number.
    const thrown = await refusalFor(call, ['9']);
    expect(thrown?.message).toContain('signalIndex 9 is outside the 3 signals this file declares');
  });

  it('does not read a number out of a string this header cannot be indexed by', async () => {
    for (const [value, expected] of [
      ['  9  ', 'the string "  9  "'],
      ['', 'the string ""'],
      ['0x10', 'the string "0x10"'],
    ] as const) {
      const thrown = await refusalFor(call, [value]);
      expect(thrown?.message, value).toContain(`signalIndex is ${expected}`);
      expect(thrown?.message, value).not.toContain('is outside the');
    }
  });

  it('keeps the 0.6.174 message for a signal, which is not any of these', async () => {
    const recording = await opened();
    const thrown = await refusalFor(call, matchSignals(recording.header, /EEG/));
    expect(thrown?.message).toContain('holds a signal rather than an index');
    expect(thrown?.message).not.toContain('not a number this header can be indexed by');
  });

  it('stays the typed error a handler already branches on, and keeps its next step', async () => {
    const thrown = await refusalFor(call, ['EEG Fpz-Cz']);
    expect(thrown).toBeInstanceOf(EdfChannelNotFoundError);
    expect(isEdfError(thrown)).toBe(true);
    expect((thrown as EdfChannelNotFoundError).availableLabels).toContain('EEG Fpz-Cz');
    expect(thrown?.message).toContain('Next: pass an index from header.dataSignalIndices');
  });
});
