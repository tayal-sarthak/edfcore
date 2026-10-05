/**
 * The form 0.6.293 left open, and said so.
 *
 * That release gave `signalIndices` a pending-Promise branch and recorded what it did not reach:
 * "`assertSelection` tests `typeof selection === 'object'`, which a Promise satisfies, so that form
 * is still blamed on the field read after it." A test pinned the gap rather than leaving it implied.
 * This closes it.
 *
 * A Promise passed the object guard, and neither shape pair below it fires — those need a `records`
 * or a `startSeconds`, and a Promise has neither. So it reached `resolveSignals` and came back as
 * "signalIndices is missing, not an array of signal indices... Next: pass header.dataSignalIndices
 * for all of the data signals": a field the caller never left out, and advice to build a list they
 * already had. `assertReadOptions` gives the same sentence about the same blind spot one argument
 * over — "`typeof options === 'object'` is true of an `AbortSignal`".
 *
 * The selection is the likelier of the two to arrive async, because the whole object is what gets
 * stored and reloaded: a saved viewport, a view restored from IndexedDB, a montage and its bounds
 * fetched together. `signalIndices` alone is the montage half of that; this is the thing a viewer
 * actually persists.
 *
 * Checked ahead of the records-versus-window pairs so the subject is the argument rather than
 * whichever field those two read first. A `.then` property read, never a call (0.6.294).
 */

import { describe, expect, it } from 'vitest';
import { readTriggers } from '../../src/biosemi.js';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const settle = async (drive: () => unknown): Promise<string> =>
  Promise.resolve()
    .then(drive)
    .then(
      () => '',
      (error: unknown) => (error as Error).message,
    );

/** Every call that takes a selection, which is the claim `assertSelection` exists to make. */
function calls(
  recording: EdfRecording,
  bdf: EdfRecording,
): ReadonlyArray<readonly [string, (selection: unknown) => unknown]> {
  return [
    ['readWindow', (selection) => readWindow(recording, selection as never)],
    ['readRecords', (selection) => readRecords(recording, selection as never)],
    ['readEnvelope', (selection) => readEnvelope(recording, selection as never)],
    [
      'readEnvelopeAtResolution',
      (selection) => readEnvelopeAtResolution(recording, selection as never),
    ],
    [
      'streamRecords',
      async (selection) => {
        for await (const piece of streamRecords(recording, selection as never)) void piece;
      },
    ],
    ['readTriggers', (selection) => readTriggers(bdf, selection as never)],
  ];
}

const EDF = minimalEdfPlus({ recordCount: 4, recordDurationSeconds: 1 });
const BDF = buildEdf({
  format: 'BDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 8 },
    { label: 'Status', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 24 }],
});

/** What a viewer actually persists: the montage and its bounds, as one object. */
/** Typed `never` so each call site reads as the mistake itself rather than as a cast. */
const savedView = (): never =>
  Promise.resolve({
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 1,
    buckets: 2,
  }) as unknown as never;

describe('a selection the view had not awaited', () => {
  it('is named as a pending Promise at every call that takes one', async () => {
    const recording = await openEdf(byteSource(EDF));
    const bdf = await openEdf(byteSource(BDF));
    for (const [name, drive] of calls(recording, bdf)) {
      const message = await settle(() => drive(savedView()));
      expect(message, name).toContain(`${name}(): the selection is a pending Promise`);
      expect(message, name).not.toContain('signalIndices is missing');
    }
  });

  it('says what it cost, and ends naming the shape to pass', async () => {
    const recording = await openEdf(byteSource(EDF));
    const message = await settle(() => readWindow(recording, savedView()));
    expect(message).toContain('every field is read off it rather than awaited');
    expect(message).toContain('no signals and no bounds');
    expect(message).toMatch(
      /Next: await it, then pass \{ signalIndices, startSeconds, durationSeconds \}\./,
    );
  });

  it('names each call its own shape, as the other refusals here do', async () => {
    const recording = await openEdf(byteSource(EDF));
    expect(await settle(() => readRecords(recording, savedView()))).toContain(
      '{ records, signalIndices }',
    );
    expect(await settle(() => readEnvelope(recording, savedView()))).toContain('buckets }');
    expect(await settle(() => readEnvelopeAtResolution(recording, savedView()))).toContain(
      'secondsPerBucket }',
    );
  });

  it('reads normally once awaited, so the advice is the whole fix', async () => {
    const recording = await openEdf(byteSource(EDF));
    const chunks = await readWindow(recording, (await savedView()) as never);
    expect(chunks[0]?.signals.map((signal) => signal.signalIndex)).toEqual([0]);
  });

  it('still answers for every other wrong selection it did before', async () => {
    const recording = await openEdf(byteSource(EDF));
    const refusal = async (value: unknown): Promise<string> =>
      settle(() => readWindow(recording, value as never));
    expect(await refusal(undefined)).toContain('the selection is missing, not an object');
    expect(await refusal(null)).toContain('the selection is null, not an object');
    expect(await refusal(7)).toContain('the selection is a number, not an object');
    expect(await refusal([0])).toContain('the selection is an array');
    // And the two shape pairs, which the new branch sits in front of.
    expect(await refusal({ records: { start: 0, count: 1 } })).toContain(
      'has a `records` range, and this call takes a time window',
    );
    expect(
      await settle(() =>
        readRecords(recording, {
          startSeconds: 0,
          durationSeconds: 1,
          signalIndices: [0],
        } as never),
      ),
    ).toContain('is a time window, and this call takes a `records` range');
  });
});
