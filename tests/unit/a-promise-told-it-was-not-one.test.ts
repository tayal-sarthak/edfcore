/**
 * "Not the object openEdf() returns", said to someone holding the object `openEdf` returns.
 *
 * `assertRecording` is the guard every published read passes through, and 0.6.89 gave it a branch
 * for the forgotten `await`. The branch names the argument — "a pending Promise" — and then the
 * shared tail contradicts it: `openEdf(source)` is async, so a pending Promise is exactly what it
 * returns. The recording is what that Promise RESOLVES to.
 *
 * Every sibling guard in the package already says it that way. 0.6.215 for the index — "await
 * buildRecordIndex(recording) — it resolves to the index this takes" — 0.6.217 for the header, and
 * 0.6.229 for `validateHeader`. This is the one they were all modelled on, and the one saying the
 * opposite.
 *
 * The `Next:` clause was right throughout and is unchanged, which is why this cost a reader nothing
 * beyond a sentence that could not both be true. The other arm is untouched: a number, a string or
 * an object is not what `openEdf` returns, and for those the sentence was always true.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
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
  [
    'readWindow',
    (r) => readWindow(r as never, { signalIndices: [0], startSeconds: 0, durationSeconds: 1 }),
  ],
  [
    'readRecords',
    (r) => readRecords(r as never, { signalIndices: [0], records: { start: 0, count: 1 } }),
  ],
  ['readAnnotations', (r) => readAnnotations(r as never, { start: 0, count: 1 })],
  [
    'readEnvelope',
    (r) =>
      readEnvelope(r as never, {
        signalIndices: [0],
        startSeconds: 0,
        durationSeconds: 1,
        buckets: 4,
      }),
  ],
  [
    'readEnvelopeAtResolution',
    (r) =>
      readEnvelopeAtResolution(r as never, {
        signalIndices: [0],
        startSeconds: 0,
        durationSeconds: 1,
        secondsPerBucket: 0.5,
      }),
  ],
  [
    'streamRecords',
    async (r) => {
      for await (const chunk of streamRecords(r as never, {
        signalIndices: [0],
        startSeconds: 0,
        durationSeconds: 1,
      })) {
        return chunk;
      }
      return undefined;
    },
  ],
];

describe.each(CALLS)('%s, given openEdf(source) unawaited', (_name, call) => {
  it('no longer says a Promise is not what openEdf returns', async () => {
    const pending = openEdf(byteSource(FILE));
    const thrown = await refusal(() => call(pending));
    expect(thrown.message).toContain('the recording is a pending Promise');
    expect(thrown.message).not.toContain('not the object openEdf() returns');
    await pending;
  });

  it('says what the Promise resolves to instead', async () => {
    const pending = openEdf(byteSource(FILE));
    const thrown = await refusal(() => call(pending));
    expect(thrown.message).toContain('openEdf(source) is async, so that is what it returns');
    expect(thrown.message).toContain('the recording is what it resolves to');
    await pending;
  });

  it('keeps the next step, which was always right', async () => {
    const pending = openEdf(byteSource(FILE));
    const thrown = await refusal(() => call(pending));
    expect(thrown.message).toContain('Next: pass `await openEdf(source)`');
    expect(thrown).toBeInstanceOf(RangeError);
    await pending;
  });

  it('still reads once it has been awaited', async () => {
    const recording = await openEdf(byteSource(FILE));
    await expect(Promise.resolve(call(recording))).resolves.toBeDefined();
  });
});

describe('the arm where the sentence was true', () => {
  it.each([
    ['a number', 5, 'the recording is a number'],
    ['a string', 'edf', 'the recording is a string'],
    ['an object', new Set(), 'the recording is an object'],
    ['null', null, 'the recording is null'],
    ['undefined', undefined, 'the recording is missing'],
  ])('keeps it for %s', async (_shape, given, expected) => {
    const thrown = await refusal(() =>
      readWindow(given as never, { signalIndices: [0], startSeconds: 0, durationSeconds: 1 }),
    );
    expect(thrown.message).toContain(expected);
    expect(thrown.message).toContain('not the object openEdf() returns');
  });
});

describe('the header arm, which names a different mistake', () => {
  it('is untouched', async () => {
    const recording = await openEdf(byteSource(FILE));
    const thrown = await refusal(() =>
      readWindow(recording.header as never, {
        signalIndices: [0],
        startSeconds: 0,
        durationSeconds: 1,
      }),
    );
    expect(thrown.message).toContain('that is a header, not a recording');
  });
});

describe('the siblings this now agrees with', () => {
  it('all name what the pending call resolves to', async () => {
    const { buildRecordIndex } = await import('../../src/record-index.js');
    const { contiguityOf } = await import('../../src/record-index.js');
    const recording = await openEdf(byteSource(FILE));
    const pendingIndex = buildRecordIndex(recording);
    const fromIndex = await refusal(() => contiguityOf(pendingIndex as never));
    expect(fromIndex.message).toContain('it resolves to the index this takes');
    await pendingIndex;
  });
});
