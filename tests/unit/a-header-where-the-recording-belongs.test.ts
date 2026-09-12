/**
 * The three sample-locating entry points, handed a header instead of a recording.
 *
 * `sample-grid.ts` is the pure counterpart this module exists beside, and every function in it takes
 * the SIGNAL: `gridSampleStartTicks(signal, index, recordDuration)`. So reaching for the header — or
 * for one of its signals — is the mistake the pair invites, and all three of these read
 * `recording.header.signals` with nothing checked in front of it, so they died with V8's `Cannot
 * read properties of undefined (reading 'signals')`: no `Next:` clause, an internal field named
 * instead of the argument (fixed in 0.6.101).
 *
 * The guard is the one 0.6.89 added for `readWindow`, so a forgotten `await` is named here too — and
 * these three are synchronous, which makes a Promise the likeliest thing to arrive by accident: the
 * call sites around them are all awaited.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { sampleAt, sampleStartSecondsOf, sampleStartTicksOf } from '../../src/sample-locate.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const BYTES = buildEdf({
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

const opened = () => openEdf(byteSource(BYTES));

/** The cast a JavaScript caller does not need to write. */
const asRecording = (value: unknown) => value as EdfRecording;

const CALLS: ReadonlyArray<readonly [string, (recording: EdfRecording) => unknown]> = [
  ['sampleAt', (recording) => sampleAt(recording, 0, 1)],
  ['sampleStartTicksOf', (recording) => sampleStartTicksOf(recording, 0, 4)],
  ['sampleStartSecondsOf', (recording) => sampleStartSecondsOf(recording, 0, 4)],
];

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the argument was accepted');
}

describe.each(CALLS)('%s', (name, call) => {
  it('names itself and the argument when handed the header', async () => {
    const recording = await opened();
    const message = refusal(() => call(asRecording(recording.header)));
    expect(message).toContain(`${name}():`);
    expect(message).toContain('that is a header, not a recording');
  });

  it('says nothing about an internal field it read first', async () => {
    const recording = await opened();
    expect(refusal(() => call(asRecording(recording.header)))).not.toContain(
      'Cannot read properties',
    );
  });

  it('names a forgotten await, which is the other way one arrives', () => {
    const pending = opened();
    const message = refusal(() => call(asRecording(pending)));
    expect(message).toContain('the recording is a pending Promise');
    return pending;
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['a signal from the header', 'signal'],
  ])('refuses %s', async (_described, given) => {
    const recording = await opened();
    const value = given === 'signal' ? recording.header.signals[0] : given;
    expect(refusal(() => call(asRecording(value)))).toContain('not the object openEdf() returns');
  });
});

describe('a real recording', () => {
  it('still locates, so the guard costs nothing a caller notices', async () => {
    const recording = await opened();
    expect(sampleAt(recording, 0, 1)?.sampleIndex).toBe(8);
    expect(sampleStartTicksOf(recording, 0, 8)).toBe(10_000_000n);
    expect(sampleStartSecondsOf(recording, 0, 8)).toBe(1);
  });

  it('still refuses a signal index the file does not have', async () => {
    const recording = await opened();
    expect(refusal(() => sampleAt(recording, 9, 0))).toContain('outside the 1 signals');
  });
});
