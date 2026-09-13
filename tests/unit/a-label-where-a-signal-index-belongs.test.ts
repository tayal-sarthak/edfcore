/**
 * What `sample-locate.ts` says about a signal index it will not accept.
 *
 * All three entry points here — `sampleAt`, `sampleStartTicksOf`, `sampleStartSecondsOf` — share
 * one refusal, and it was one flat sentence: "signalIndex N is outside the R signals this file
 * declares".
 *
 * For a LABEL that sentence is false twice over. `getSignal(header, selector)` takes
 * `number | string`, so naming a channel is the habit the rest of the package teaches, and
 * `sampleAt(recording, 'A1', t)` is what a caller with that habit writes. It came back as
 * "signalIndex A1 is outside the 2 signals this file declares" — one clause above "resolve one
 * with getSignal(header, label)", which is the function that would have taken it.
 *
 * For a FRACTION it is false the way 0.6.93 already wrote down, in `getSignal`: 1.5 "is not a
 * whole number, so it falls between two signals rather than outside them". That fix landed in one
 * of the two places this package resolves a signal by index; this is the other.
 *
 * The genuinely out-of-range case is unchanged, because for that one the sentence was true.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { sampleAt, sampleStartSecondsOf, sampleStartTicksOf } from '../../src/sample-locate.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'A1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

/** Every entry point in the module, each called with a signal index and something valid after it. */
const RESOLVE_A_SIGNAL: ReadonlyArray<readonly [string, (r: EdfRecording, i: unknown) => unknown]> =
  [
    [
      'sampleAt',
      (r, i) =>
        (sampleAt as never as (a: EdfRecording, b: unknown, c: number) => unknown)(r, i, 0.5),
    ],
    [
      'sampleStartTicksOf',
      (r, i) =>
        (sampleStartTicksOf as never as (a: EdfRecording, b: unknown, c: number) => unknown)(
          r,
          i,
          0,
        ),
    ],
    [
      'sampleStartSecondsOf',
      (r, i) =>
        (sampleStartSecondsOf as never as (a: EdfRecording, b: unknown, c: number) => unknown)(
          r,
          i,
          0,
        ),
    ],
  ];

async function thrownBy(
  call: (r: EdfRecording, i: unknown) => unknown,
  i: unknown,
): Promise<Error> {
  const recording = await openEdf(byteSource(FILE));
  try {
    call(recording, i);
  } catch (error) {
    return error as Error;
  }
  throw new Error('the call was accepted');
}

describe.each(RESOLVE_A_SIGNAL)('%s given a label', (_name, call) => {
  it('is not described as a signal outside the file', async () => {
    const { message } = await thrownBy(call, 'A1');
    expect(message).not.toContain('signalIndex A1 is outside');
    expect(message).not.toContain('is outside the 2 signals');
  });

  it('is named as the string it is', async () => {
    expect((await thrownBy(call, 'A1')).message).toContain(
      'signalIndex is the string "A1", not a number this header can be indexed by',
    );
  });

  it('still names the call that does take a label', async () => {
    expect((await thrownBy(call, 'A1')).message).toContain('getSignal(header, label)');
  });
});

describe('a signal index between two signals', () => {
  it('is described as falling between them, the way getSignal has said since 0.6.93', async () => {
    const [, call] = RESOLVE_A_SIGNAL[0] as (typeof RESOLVE_A_SIGNAL)[number];
    const { message } = await thrownBy(call, 1.5);
    expect(message).toContain(
      'signalIndex 1.5 is not a whole number, so it falls between two signals rather than outside them',
    );
  });

  it('says so for a value that is no number at all, rather than calling it fractional', async () => {
    const [, call] = RESOLVE_A_SIGNAL[0] as (typeof RESOLVE_A_SIGNAL)[number];
    expect((await thrownBy(call, Number.NaN)).message).toContain(
      'signalIndex is NaN, not a number this header can be indexed by',
    );
  });
});

describe('a signal index that really is outside the file', () => {
  it('reads exactly as before, because for it the sentence was true', async () => {
    const [, call] = RESOLVE_A_SIGNAL[0] as (typeof RESOLVE_A_SIGNAL)[number];
    for (const value of [-1, 2, 99]) {
      expect((await thrownBy(call, value)).message).toContain(
        `signalIndex ${value} is outside the 2 signals this file declares`,
      );
    }
  });
});
