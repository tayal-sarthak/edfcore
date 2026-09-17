/**
 * `getStatusSignal`, given `readHeader(source)` unawaited — the one header guard 0.6.237 missed.
 *
 * 0.6.120 wrote this check for a stated reason: "`undefined` is what this function returns for a
 * file with no Status channel, so a wrong argument must not be able to produce it." The comment
 * above it says what that costs — "Every trigger in the recording then reads as absent, on the one
 * path in this package where a missing event is indistinguishable from no events" — and a pending
 * Promise is exactly such a wrong argument.
 *
 * What it was told is that the argument has no signals, which is true of a Promise and of almost
 * everything else, and the next step names `recording.header` — which a reader holding
 * `readHeader(source)` does not have.
 *
 * 0.6.217 named the keyword for the three lookups, 0.6.229 for `validateHeader`, 0.6.235 for
 * `buildTimeline`, 0.6.236 for the guards whose advice named `parseHeader`, and 0.6.237 for the
 * decoders and `trimToWindow`. That last entry claimed the set was complete; it was not, and this
 * is the one left out. `gridSampleIndexAt` and its two siblings take `recordDurationTicks` rather
 * than a header, so with this the claim holds.
 */

import { describe, expect, it } from 'vitest';
import { getStatusSignal } from '../../src/biosemi.js';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader } from '../../src/io/read.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

/** BDF with a Status channel, so a correct call has something to find. */
const FILE = buildEdf({
  format: 'BDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 8 },
    { label: 'Status', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const refusal = async (call: () => unknown): Promise<Error> => {
  const thrown = await Promise.resolve()
    .then(call)
    .then(
      () => undefined,
      (error: unknown) => error as Error,
    );
  expect(thrown, 'nothing was refused').toBeDefined();
  return thrown as Error;
};

describe('a header that had not arrived', () => {
  it('names the keyword rather than the missing field', async () => {
    const pending = readHeader(byteSource(FILE));
    const thrown = await refusal(() => getStatusSignal(pending as never));
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown.message).toContain('that is a pending Promise, not a header');
    expect(thrown.message).not.toContain('it has no signals');
    await pending;
  });

  it('names the call to await instead of a field the reader does not hold', async () => {
    const pending = readHeader(byteSource(FILE));
    const thrown = await refusal(() => getStatusSignal(pending as never));
    expect(thrown.message).toContain('await readHeader(source)');
    expect(thrown.message).toContain('it resolves to the header this takes');
    expect(thrown.message).not.toContain('pass recording.header');
    await pending;
  });

  it('is still refused rather than answered undefined, which is the point of the guard', async () => {
    const pending = readHeader(byteSource(FILE));
    const thrown = await refusal(() => getStatusSignal(pending as never));
    expect(thrown.message).toContain('Next:');
    await pending;
  });

  it('says the same thing every other header guard says', async () => {
    const pending = readHeader(byteSource(FILE));
    const { validateHeader } = await import('../../src/validate.js');
    const fromStatus = await refusal(() => getStatusSignal(pending as never));
    const fromValidate = await refusal(() => validateHeader(pending as never));
    expect(fromStatus.message).toContain('that is a pending Promise, not a header');
    expect(fromValidate.message).toContain('that is a pending Promise, not a header');
    await pending;
  });
});

describe('the answer a wrong argument must not be able to produce', () => {
  it('is what a real header with no Status channel gets', async () => {
    const plain = buildEdf({
      format: 'EDF',
      plus: 'C',
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
      annotationSignals: [{ samplesPerRecord: 40 }],
    });
    const recording = await openEdf(byteSource(plain));
    expect(getStatusSignal(recording.header)).toBeUndefined();
  });

  it('is never what a header that had not arrived gets', async () => {
    const pending = readHeader(byteSource(FILE));
    let answered: unknown = 'not reached';
    try {
      answered = getStatusSignal(pending as never);
    } catch {
      answered = 'refused';
    }
    expect(answered).toBe('refused');
    await pending;
  });

  it('still finds the channel on a file that has one', async () => {
    const recording = await openEdf(byteSource(FILE));
    expect(getStatusSignal(recording.header)?.label).toBe('Status');
  });
});

describe('the refusals 0.6.120 and its chunk branch already gave', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 5],
    ['an empty object', {}],
  ])('keeps the sentence for %s', async (_shape, given) => {
    const thrown = await refusal(() => getStatusSignal(given as never));
    expect(thrown.message).toContain('that is not a header — it has no signals');
    expect(thrown.message).toContain('a wrong argument must not be able to produce it');
    expect(thrown.message).toContain('Next: pass recording.header');
  });

  it('keeps the chunk branch, whose signals array defeats the shape test', async () => {
    const recording = await openEdf(byteSource(FILE));
    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 2,
    });
    const thrown = await refusal(() => getStatusSignal(chunks[0] as never));
    expect(thrown.message).toContain('chunk');
  });
});
