/**
 * `options.signal` given the `AbortController` rather than the signal on it.
 *
 * It is the value a caller holds. `{ signal: controller }` for `{ signal: controller.signal }` is
 * the same slip `fetch(url, signal)` is, one field further in — and 0.6.155 fixed that one, for the
 * signal passed as the whole options object, with the argument this inherits:
 *
 * > `options?.signal` was then `undefined`, so the read ran to completion and RESOLVED WITH DATA.
 * > Nothing distinguishes that from a read that finished before the abort, which is the ordinary
 * > outcome a caller is already handling — so a viewer that cancels on every scroll cancelled
 * > nothing, and neither the reads nor their memory stopped.
 *
 * A controller has `abort()` and `signal` and no `aborted`, so `signal?.aborted !== true` was false
 * and the read went through. An ALREADY-ABORTED controller behaves the same: the whole window comes
 * back, and the caller's own `catch (AbortError)` never runs.
 *
 * Every other shape meant the same thing and could never mean anything else — a string, a number,
 * `{}`, and `{ aborted: 'yes' }` out of a JSON config all read as "not cancelled".
 *
 * `AbortSignalLike` is published as `aborted` and nothing more, so a boolean `aborted` is the whole
 * test and a consumer's own shim still passes.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 60 }],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

const WINDOW = { signalIndices: [0], startSeconds: 0, durationSeconds: 3 } as const;

type Call = (recording: EdfRecording, signal: unknown) => Promise<unknown>;

const CALLS: ReadonlyArray<readonly [string, Call]> = [
  ['readWindow', (recording, signal) => readWindow(recording, WINDOW, { signal: signal as never })],
  [
    'readRecords',
    (recording, signal) =>
      readRecords(
        recording,
        { signalIndices: [0], records: { start: 0, count: 2 } },
        { signal: signal as never },
      ),
  ],
  [
    'readAnnotations',
    (recording, signal) =>
      readAnnotations(recording, { start: 0, count: 6 }, { signal: signal as never }),
  ],
  [
    'readEnvelope',
    (recording, signal) =>
      readEnvelope(recording, { ...WINDOW, buckets: 4 }, { signal: signal as never }),
  ],
];

const aborted = (): AbortController => {
  const controller = new AbortController();
  controller.abort();
  return controller;
};

describe.each(CALLS)('%s', (_name, call) => {
  it('refuses an AbortController and names the field on it', async () => {
    const recording = await opened();
    const thrown = await call(recording, aborted()).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown, 'the read resolved with an aborted controller in hand').toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain('an AbortController, not the signal on it');
    expect(thrown?.message).toContain('Next: pass controller.signal');
  });

  it.each([
    ['a string', 'abort'],
    ['a number', 1],
    ['an empty object', {}],
    ['a config value', { aborted: 'yes' }],
  ])('refuses %s, which could never mean cancelled', async (_shape, signal) => {
    const recording = await opened();
    const thrown = await call(recording, signal).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain('carries no `aborted`');
    expect(thrown?.message).toContain('would have resolved with data');
  });

  it('still aborts for the signal itself', async () => {
    const recording = await opened();
    const thrown = await call(recording, aborted().signal).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown?.name).toBe('AbortError');
  });

  it('still reads for a live signal, and for none at all', async () => {
    const recording = await opened();
    await expect(call(recording, new AbortController().signal)).resolves.toBeDefined();
    await expect(call(recording, undefined)).resolves.toBeDefined();
  });

  it('still takes the shim AbortSignalLike publishes', async () => {
    const recording = await opened();
    await expect(call(recording, { aborted: false })).resolves.toBeDefined();
    const thrown = await call(recording, { aborted: true }).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown?.name).toBe('AbortError');
  });
});
