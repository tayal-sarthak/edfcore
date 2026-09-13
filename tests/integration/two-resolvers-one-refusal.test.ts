/**
 * The refusal for a signal index the file does not have, from both resolvers.
 *
 * `envelope.ts` keeps its own copy of the selection loop, and the comment beside this error says
 * what that copy is for: the identical mistake once "threw a typed error carrying `selector` and
 * `availableLabels` from `readWindow` and a bare `RangeError` from here, so `isEdfError` answered
 * differently depending on which read the caller had reached for".
 *
 * The class was made to match. The message was not. `readWindow` ends "Next: pass an index from
 * header.dataSignalIndices, or resolve one with getSignal(header, label)"; the envelope's copy
 * stopped at `header.dataSignalIndices`, without the clause naming the function that takes a
 * label.
 *
 * That clause is the half that matters here. `getSignal(header, selector)` accepts a label, so
 * naming channels is the habit the rest of the package teaches, and a label is the commonest thing
 * to find in a `signalIndices` that does not resolve. `readEnvelope` and `readEnvelopeAtResolution`
 * withheld the advice that fixes it — for the same file, the same selection and the same error
 * class as `readWindow`.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { EdfChannelNotFoundError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 8 },
    { label: 'Fp2', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

const READS: ReadonlyArray<readonly [string, (r: EdfRecording, i: unknown) => Promise<unknown>]> = [
  [
    'readWindow',
    (r, signalIndices) =>
      readWindow(r, { signalIndices: signalIndices as never, startSeconds: 0, durationSeconds: 1 }),
  ],
  [
    'readRecords',
    (r, signalIndices) =>
      readRecords(r, { signalIndices: signalIndices as never, records: { start: 0, count: 1 } }),
  ],
  [
    'readEnvelope',
    (r, signalIndices) =>
      readEnvelope(r, {
        signalIndices: signalIndices as never,
        startSeconds: 0,
        durationSeconds: 1,
        buckets: 4,
      }),
  ],
  [
    'readEnvelopeAtResolution',
    (r, signalIndices) =>
      readEnvelopeAtResolution(r, {
        signalIndices: signalIndices as never,
        startSeconds: 0,
        durationSeconds: 1,
        secondsPerBucket: 0.5,
      }),
  ],
  [
    'streamRecords',
    async (r, signalIndices) =>
      (
        await streamRecords(r, {
          signalIndices: signalIndices as never,
          startSeconds: 0,
          durationSeconds: 1,
        }).next()
      ).value,
  ],
];

async function thrownBy(
  call: (r: EdfRecording, i: unknown) => Promise<unknown>,
  indices: unknown,
): Promise<Error> {
  try {
    await call(await opened(), indices);
  } catch (error) {
    return error as Error;
  }
  throw new Error('the selection was accepted');
}

describe.each(READS)('%s given an index the file does not have', (_name, call) => {
  it('is an EdfChannelNotFoundError carrying the selector and the labels', async () => {
    const thrown = await thrownBy(call, [9]);
    expect(thrown).toBeInstanceOf(EdfChannelNotFoundError);
    expect((thrown as EdfChannelNotFoundError).selector).toBe(9);
    expect((thrown as EdfChannelNotFoundError).availableLabels).toEqual([
      'Fp1',
      'Fp2',
      expect.any(String),
    ]);
  });

  it('names the function that takes a label, which is what a label-shaped selector needs', async () => {
    expect((await thrownBy(call, ['Fp1'])).message).toContain(
      'Next: pass an index from header.dataSignalIndices, or resolve one with getSignal(header, label).',
    );
  });
});

describe('the two resolvers', () => {
  it('produce the identical message for the identical mistake', async () => {
    const messages = await Promise.all(
      READS.map(async ([, call]) => (await thrownBy(call, [9])).message),
    );
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toContain('signalIndex 9 is outside the 3 signals this file declares');
  });
});
