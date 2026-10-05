/**
 * The last two reads that resolve a window before touching a byte.
 *
 * `readEnvelope`'s docblock promises the empty answer in the same words the reading API uses: a
 * window that "selects nothing — so a caller that already handles gaps handles envelopes for free".
 * Its own comment then names where that promise forces a guard: "Validated before the window is
 * resolved, for the same reason readWindow does it: a bad signalIndices must not read back as an
 * empty stretch of recording."
 *
 * The third argument was not covered by it, in either call. `assertReadOptions` ran inside the read,
 * and these two issue none for a window past the end, a window entirely inside an EDF+D gap, or a
 * window of zero duration — so `[]` came back with the options unexamined, indistinguishable from
 * the right ones.
 *
 * 0.6.288 closed this in `readWindow`, and `stream.ts` in 0.6.166 before it, with the sentence the
 * whole family shares: "An abort that was never wired up and a window with nothing in it both end as
 * a stream that yielded nothing." These are the remaining two, so the family is closed.
 *
 * `readEnvelope(recording, selection, controller.signal)` is the spelling that matters — a viewer
 * redrawing an envelope on every pan is the call most likely to be cancelled, and it is the one
 * whose cancellation was being dropped. `assertReadOptions` was written for it: "`typeof options ===
 * 'object'` is true of an `AbortSignal`".
 *
 * The shape only, as in 0.6.288: an already-aborted signal passed correctly still does not fire on a
 * window that reads nothing (0.6.289).
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { EdfRecording, ReadOptions } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

/** Four one-second records, so every window below is deliberately outside them. */
const CONTINUOUS = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 24 }],
});

/** Each of these resolves to no records at all. */
const EMPTY_WINDOWS: ReadonlyArray<readonly [string, number, number]> = [
  ['past the end of the recording', 1000, 2],
  ['of zero duration', 1, 0],
  ['of negative duration', 1, -5],
];

function wrongOptions(): ReadonlyArray<readonly [string, unknown]> {
  return [
    ['an AbortSignal where the options belong', new AbortController().signal],
    ['a pending Promise', Promise.resolve({})],
    ['an array', []],
    ['a number', 7],
  ];
}

const settle = async (drive: () => unknown): Promise<unknown> =>
  Promise.resolve()
    .then(drive)
    .then(
      () => undefined,
      (error: unknown) => error,
    );

function calls(
  recording: EdfRecording,
): ReadonlyArray<readonly [string, (s: number, d: number, o: unknown) => unknown]> {
  return [
    [
      'readEnvelope',
      (startSeconds, durationSeconds, options) =>
        readEnvelope(
          recording,
          { startSeconds, durationSeconds, buckets: 4, signalIndices: [0] },
          options as ReadOptions,
        ),
    ],
    [
      'readEnvelopeAtResolution',
      (startSeconds, durationSeconds, options) =>
        readEnvelopeAtResolution(
          recording,
          { startSeconds, durationSeconds, secondsPerBucket: 1, signalIndices: [0] },
          options as ReadOptions,
        ),
    ],
  ];
}

describe('the envelope reads check their options before the window', () => {
  it('answer [] for each of these windows, which is why the guard has to come first', async () => {
    const recording = await openEdf(byteSource(CONTINUOUS));
    for (const [name, drive] of calls(recording)) {
      for (const [what, startSeconds, durationSeconds] of EMPTY_WINDOWS) {
        expect(await drive(startSeconds, durationSeconds, undefined), `${name} ${what}`).toEqual(
          [],
        );
      }
    }
  });

  it('refuse every wrong options shape, on a window that reads nothing', async () => {
    const recording = await openEdf(byteSource(CONTINUOUS));
    for (const [name, drive] of calls(recording)) {
      for (const [what, startSeconds, durationSeconds] of EMPTY_WINDOWS) {
        for (const [kind, options] of wrongOptions()) {
          const label = `${name}: ${kind}, on a window ${what}`;
          const thrown = await settle(() => drive(startSeconds, durationSeconds, options));
          expect(thrown, label).toBeInstanceOf(Error);
          expect((thrown as Error).message, label).toMatch(/Next:/);
        }
      }
    }
  });

  it('give the same refusal a window over data gives, for each shape', async () => {
    const recording = await openEdf(byteSource(CONTINUOUS));
    for (const [name, drive] of calls(recording)) {
      for (const [kind, options] of wrongOptions()) {
        const empty = (await settle(() => drive(1000, 2, options))) as Error;
        const reading = (await settle(() => drive(0, 2, options))) as Error;
        expect(empty.message, `${name}: ${kind}`).toBe(reading.message);
      }
    }
  });

  it('agree with readWindow, which 0.6.288 closed and whose reason they both cite', async () => {
    const recording = await openEdf(byteSource(CONTINUOUS));
    for (const [name, drive] of calls(recording)) {
      for (const [kind, options] of wrongOptions()) {
        const mine = (await settle(() => drive(1000, 2, options))) as Error;
        const window = (await settle(() =>
          readWindow(
            recording,
            { startSeconds: 1000, durationSeconds: 2, signalIndices: [0] },
            options as ReadOptions,
          ),
        )) as Error;
        expect(mine.message, `${name}: ${kind}`).toBe(window.message);
      }
    }
  });

  it('leave the already-aborted empty window alone, which is documented', async () => {
    const recording = await openEdf(byteSource(CONTINUOUS));
    const controller = new AbortController();
    controller.abort();
    for (const [name, drive] of calls(recording)) {
      // The signal passed CORRECTLY, on a window that reads nothing: no read, nothing to abort.
      expect(await drive(1000, 2, { signal: controller.signal }), name).toEqual([]);
    }
  });

  it('still abort a window that does read, so the poll did not move', async () => {
    const recording = await openEdf(byteSource(CONTINUOUS));
    const controller = new AbortController();
    controller.abort();
    for (const [name, drive] of calls(recording)) {
      const thrown = await settle(() => drive(0, 2, { signal: controller.signal }));
      expect((thrown as Error).name, name).toBe('AbortError');
    }
  });
});
