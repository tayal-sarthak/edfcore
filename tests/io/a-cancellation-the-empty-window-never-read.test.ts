/**
 * Bad read options on a window that selects nothing.
 *
 * `readWindow`'s own docblock argues for validating the SELECTION before resolving the window, and
 * ends: "`[]` means 'no records in this window', and letting a bad argument produce it hands the
 * caller a wrong diagnosis at the worst moment: an out-of-range index silently reads as an empty
 * stretch of recording. A caller mistake is a caller mistake wherever the window lands."
 *
 * The third argument was not covered by it. `assertReadOptions` ran inside the read, so a window
 * past the end, a window entirely inside an EDF+D gap, and a window of zero duration all returned
 * `[]` with the options never examined — and `[]` is this function's own documented answer for
 * exactly those three windows.
 *
 * `stream.ts` closed this for itself in 0.6.166 and wrote the sentence: "An abort that was never
 * wired up and a window with nothing in it both end as a stream that yielded nothing." That module
 * exists to issue the read `readWindow` issues — its own comment says the chunk "must be the same
 * object in every respect" — so the guard it moved up front belongs in the call it mirrors.
 *
 * `readWindow(recording, selection, controller.signal)` is the spelling that matters, and
 * `assertReadOptions` was written for it: "`typeof options === 'object'` is true of an
 * `AbortSignal`", so none of the bare-value guards can see it, and the read it was handed ran
 * uncancellable.
 *
 * What does NOT change: an already-aborted signal passed CORRECTLY still does not fire on a window
 * that reads nothing. `aborted-before-it-starts.test.ts` documents that as deliberate — "a call
 * that reads nothing has nothing to abort" — and the guard moved here is a shape check.
 * `assertReadOptions` reads `.aborted` to recognise a signal handed over AS the options, never to
 * poll one (0.6.288).
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
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

/** Each of these makes `readWindow` resolve to no records at all. */
const EMPTY_WINDOWS: ReadonlyArray<readonly [string, number, number]> = [
  ['past the end of the recording', 1000, 2],
  ['of zero duration', 1, 0],
  ['of negative duration', 1, -5],
];

/** Every shape `assertReadOptions` refuses, and the argument each one is. */
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

describe('readWindow checks its options before it checks the window', () => {
  it('returns [] for each of these windows, which is why the guard has to come first', async () => {
    const recording = await openEdf(byteSource(CONTINUOUS));
    for (const [what, startSeconds, durationSeconds] of EMPTY_WINDOWS) {
      const chunks = await readWindow(recording, {
        startSeconds,
        durationSeconds,
        signalIndices: [0],
      });
      expect(chunks, what).toEqual([]);
    }
  });

  it('refuses every wrong options shape, on a window that reads nothing', async () => {
    const recording = await openEdf(byteSource(CONTINUOUS));
    for (const [what, startSeconds, durationSeconds] of EMPTY_WINDOWS) {
      for (const [kind, options] of wrongOptions()) {
        const label = `${kind}, on a window ${what}`;
        const thrown = await settle(() =>
          readWindow(
            recording,
            { startSeconds, durationSeconds, signalIndices: [0] },
            options as ReadOptions,
          ),
        );
        expect(thrown, label).toBeInstanceOf(Error);
        expect((thrown as Error).message, label).toMatch(/Next:/);
      }
    }
  });

  it('gives the same refusal a window over data gives, for each shape', async () => {
    const recording = await openEdf(byteSource(CONTINUOUS));
    const read = async (startSeconds: number, options: unknown): Promise<string> =>
      String(
        (
          (await settle(() =>
            readWindow(
              recording,
              { startSeconds, durationSeconds: 2, signalIndices: [0] },
              options as ReadOptions,
            ),
          )) as Error
        ).message,
      );
    for (const [kind, options] of wrongOptions()) {
      // One window reads, the other does not. The message is about the argument either way.
      expect(await read(1000, options), kind).toBe(await read(0, options));
    }
  });

  it('agrees with streamRecords, which this call is meant to be interchangeable with', async () => {
    const recording = await openEdf(byteSource(CONTINUOUS));
    const stream = async (options: unknown): Promise<string> =>
      String(
        (
          (await settle(async () => {
            for await (const piece of streamRecords(
              recording,
              { startSeconds: 1000, durationSeconds: 2, signalIndices: [0] },
              options as ReadOptions,
            ))
              void piece;
          })) as Error
        ).message,
      );
    const window = async (options: unknown): Promise<string> =>
      String(
        (
          (await settle(() =>
            readWindow(
              recording,
              { startSeconds: 1000, durationSeconds: 2, signalIndices: [0] },
              options as ReadOptions,
            ),
          )) as Error
        ).message,
      );
    for (const [kind, options] of wrongOptions()) {
      expect(await window(options), kind).toBe(await stream(options));
    }
  });

  it('leaves the already-aborted empty window alone, which is documented', async () => {
    const recording = await openEdf(byteSource(CONTINUOUS));
    const controller = new AbortController();
    controller.abort();
    // The signal passed CORRECTLY, on a window that reads nothing: no read, nothing to abort.
    const chunks = await readWindow(
      recording,
      { startSeconds: 1000, durationSeconds: 2, signalIndices: [0] },
      { signal: controller.signal },
    );
    expect(chunks).toEqual([]);
  });

  it('still aborts a window that does read, so the poll did not move', async () => {
    const recording: EdfRecording = await openEdf(byteSource(CONTINUOUS));
    const controller = new AbortController();
    controller.abort();
    const thrown = await settle(() =>
      readWindow(
        recording,
        { startSeconds: 0, durationSeconds: 2, signalIndices: [0] },
        { signal: controller.signal },
      ),
    );
    expect((thrown as Error).name).toBe('AbortError');
    // A cancellation, not a file defect — the discriminator consumers branch on.
    expect(isEdfError(thrown)).toBe(false);
  });
});
