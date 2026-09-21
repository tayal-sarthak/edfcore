/**
 * `buildRecordIndex` and `validateRecording`, given `openEdf(source)` unawaited.
 *
 * Three functions in this package refuse a recording with the same sentence, and 0.6.231 fixed the
 * one the five reading calls share: `openEdf(source)` is async, so a pending Promise is what it
 * returns and the recording is what that Promise resolves to — which makes "the recording is not
 * the object openEdf() returns" the one thing that cannot be said to a Promise.
 *
 * These two never had the branch at all, so a Promise landed in the arm written for a number or a
 * string and was told exactly that. They are also the two calls a reader reaches for on the line
 * after `openEdf` — `buildRecordIndex(recording)` is the whole of the scan step, and
 * `validateRecording(recording)` the whole of the sweep — so the first argument is where a missing
 * keyword shows up.
 *
 * Each keeps its own tail: `validateRecording` still names `validateHeader` for the checks that
 * need only a header, and the header arm of each still says what that call in particular needs.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
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

const CALLS: ReadonlyArray<readonly [string, (recording: unknown) => unknown]> = [
  ['buildRecordIndex', (recording) => buildRecordIndex(recording as never)],
  ['validateRecording', (recording) => validateRecording(recording as never)],
];

describe.each(CALLS)('%s', (_name, call) => {
  it('names the pending Promise rather than denying it is one', async () => {
    const pending = openEdf(byteSource(FILE));
    const thrown = await refusal(() => call(pending));
    expect(thrown.message).toContain('the recording is a pending Promise');
    expect(thrown.message).not.toContain('not the object openEdf() returns');
    await pending;
  });

  it('says what the Promise resolves to', async () => {
    const pending = openEdf(byteSource(FILE));
    const thrown = await refusal(() => call(pending));
    expect(thrown.message).toContain('openEdf(source) is async, so that is what it returns');
    expect(thrown.message).toContain('the recording is what it resolves to');
    await pending;
  });

  it('keeps the next step and the class', async () => {
    const pending = openEdf(byteSource(FILE));
    const thrown = await refusal(() => call(pending));
    expect(thrown.message).toContain('Next: pass `await openEdf(source)`');
    expect(thrown).toBeInstanceOf(RangeError);
    await pending;
  });

  it('still answers once it has been awaited', async () => {
    const recording = await openEdf(byteSource(FILE));
    await expect(Promise.resolve(call(recording))).resolves.toBeDefined();
  });

  it.each([
    ['a number', 5],
    ['null', null],
    ['undefined', undefined],
  ])('keeps the sentence for %s, where it was true', async (_shape, given) => {
    const thrown = await refusal(() => call(given));
    expect(thrown.message).toContain('not the object openEdf() returns');
  });
});

describe('each keeps the tail that is its own', () => {
  it('buildRecordIndex still says a scan needs the source and the timeline', async () => {
    const recording = await openEdf(byteSource(FILE));
    const thrown = await refusal(() => buildRecordIndex(recording.header as never));
    expect(thrown.message).toContain('a full scan needs the source and the timeline too');
  });

  it('validateRecording still says the sweep reads the records', async () => {
    const recording = await openEdf(byteSource(FILE));
    const thrown = await refusal(() => validateRecording(recording.header as never));
    expect(thrown.message).toContain('this sweep reads the records too');
  });

  it('validateRecording still names validateHeader for a header-only check', async () => {
    const thrown = await refusal(() => validateRecording(5 as never));
    expect(thrown.message).toContain('validateHeader(header)');
  });
});

describe('the three copies now agree', () => {
  it('says the same thing as the guard the reading calls share', async () => {
    const { readWindow } = await import('../../src/recording.js');
    const pending = openEdf(byteSource(FILE));
    const fromRead = await refusal(() =>
      readWindow(pending as never, { signalIndices: [0], startSeconds: 0, durationSeconds: 1 }),
    );
    const fromIndex = await refusal(() => buildRecordIndex(pending as never));
    const fromSweep = await refusal(() => validateRecording(pending as never));
    for (const thrown of [fromRead, fromIndex, fromSweep]) {
      expect(thrown.message).toContain(
        'the recording is a pending Promise — openEdf(source) is async, so that is what it ' +
          'returns, and the recording is what it resolves to.',
      );
    }
    await pending;
  });
});
