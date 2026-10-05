/**
 * The describer that spoke for three arguments and named a Promise for none of them.
 *
 * `describeValue` has a branch for a pending Promise and gives the reason `assertRecording` coined
 * in 0.6.89: a forgotten `await` is told "nothing about the one keyword that fixes it". `recording.ts`
 * has its own describer — `describeSelection`, written in 0.6.230 because an article "needs to know
 * that `Uint8Array` is said 'yoo-int'" — and it speaks for three arguments: the recording, the
 * selection, and `signalIndices`.
 *
 * Only the recording had a Promise branch, and it sits in `assertRecording` ahead of the describer.
 * The other two answered "an object", which is true of the thing the caller meant to pass.
 *
 * `signalIndices` is the one that matters, and this package has already written down why it arrives
 * async. 0.6.274 closed an async predicate in `matchSignals` and named the route: "A montage lookup
 * is where it comes from: `matchSignals(header, async (label) => isInMontage(label))` against
 * IndexedDB, a config file or a server." A montage lookup that resolves to the indices is the same
 * call one keyword short — `signalIndices: loadMontage(header)` — and it was told its channel list
 * was an object, by a message that then recommends passing an array.
 *
 * A TYPED ARRAY comes with it, for the reason the Set branch above it already gives: a Set "is the
 * wrong container chosen for a right reason, and `[...indices]` is the whole fix". `new
 * Int32Array(montage)` is that sentence with a different reason — a numeric list, in the shape every
 * array this package hands out has — and the same one-expression fix. `describeValue` has named
 * typed arrays by tag since 0.6.116 (0.6.293).
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfRecording } from '../../src/types.js';
import { minimalEdfPlus } from '../support/writer.js';

const settle = async (drive: () => unknown): Promise<string> =>
  Promise.resolve()
    .then(drive)
    .then(
      () => '',
      (error: unknown) => (error as Error).message,
    );

function reads(recording: EdfRecording): ReadonlyArray<readonly [string, (v: unknown) => unknown]> {
  return [
    [
      'readWindow',
      (signalIndices) =>
        readWindow(recording, {
          signalIndices: signalIndices as readonly number[],
          startSeconds: 0,
          durationSeconds: 1,
        }),
    ],
    [
      'readRecords',
      (signalIndices) =>
        readRecords(recording, {
          signalIndices: signalIndices as readonly number[],
          records: { start: 0, count: 1 },
        }),
    ],
    [
      'readEnvelope',
      (signalIndices) =>
        readEnvelope(recording, {
          signalIndices: signalIndices as readonly number[],
          startSeconds: 0,
          durationSeconds: 1,
          buckets: 2,
        }),
    ],
    [
      'streamRecords',
      async (signalIndices) => {
        for await (const piece of streamRecords(recording, {
          signalIndices: signalIndices as readonly number[],
          startSeconds: 0,
          durationSeconds: 1,
        }))
          void piece;
      },
    ],
  ];
}

const opened = async (): Promise<EdfRecording> =>
  openEdf(byteSource(minimalEdfPlus({ recordCount: 2, recordDurationSeconds: 1 })));

describe('a montage the lookup had not awaited', () => {
  it('is named as a pending Promise at every read that takes a selection', async () => {
    const recording = await opened();
    for (const [name, drive] of reads(recording)) {
      const message = await settle(() => drive(Promise.resolve([0])));
      expect(message, name).toContain('signalIndices is a pending Promise');
      expect(message, name).not.toContain('signalIndices is an object');
    }
  });

  it('keeps the rest of that sentence, which is the reason for the option', async () => {
    const recording = await opened();
    const message = await settle(() =>
      readWindow(recording, {
        signalIndices: Promise.resolve([0]) as never,
        startSeconds: 0,
        durationSeconds: 1,
      }),
    );
    expect(message).toContain('256-channel file');
    expect(message).toMatch(/Next: pass header\.dataSignalIndices/);
  });

  it('names a typed array by its tag, as the Set and the Map already were', async () => {
    const recording = await opened();
    for (const [name, drive] of reads(recording)) {
      expect(await settle(() => drive(new Int32Array([0]))), name).toContain(
        'signalIndices is Int32Array',
      );
      expect(await settle(() => drive(new Uint8Array([0]))), name).toContain(
        'signalIndices is Uint8Array',
      );
    }
  });

  it('does not reach the SELECTION, which a Promise passes before the describer runs', async () => {
    const recording = await opened();
    // `assertSelection` tests `typeof selection === 'object'`, which a Promise satisfies, and then
    // the two shape pairs it checks need `records` or `startSeconds` — a Promise has neither. So
    // the selection form of this mistake is still blamed on the field read after it, and closing
    // that needs a branch in the assertion rather than in this describer. Pinned so the gap is on
    // the record rather than implied.
    const message = await settle(() => readWindow(recording, Promise.resolve({}) as never));
    expect(message).toContain('signalIndices is missing');
  });

  it('leaves the recording branch alone, which has said this since 0.6.89', async () => {
    const recording = await opened();
    const message = await settle(() =>
      readWindow(Promise.resolve(recording) as never, {
        signalIndices: [0],
        startSeconds: 0,
        durationSeconds: 1,
      }),
    );
    // `assertRecording` answers first, and names the call that resolves to one.
    expect(message).toContain('the recording is a pending Promise');
    expect(message).toContain('await openEdf(source)');
  });

  it('still answers for everything that was already right', async () => {
    const recording = await opened();
    const refusal = async (value: unknown): Promise<string> =>
      settle(() =>
        readWindow(recording, {
          signalIndices: value as readonly number[],
          startSeconds: 0,
          durationSeconds: 1,
        }),
      );
    expect(await refusal(undefined)).toContain('signalIndices is missing');
    expect(await refusal(null)).toContain('signalIndices is null');
    expect(await refusal(new Set([0]))).toContain('signalIndices is a Set');
    expect(await refusal(new Map())).toContain('signalIndices is a Map');
    expect(await refusal(0)).toContain('signalIndices is a number');
    expect(await refusal('0')).toContain('signalIndices is a string');
    expect(await refusal({ 0: 1 })).toContain('signalIndices is an object');
    // And a real selection still reads.
    expect(await refusal([0])).toBe('');
  });
});
