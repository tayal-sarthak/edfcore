/**
 * Passing `{ records }` to a call that takes a time window.
 *
 * `readRecords` takes `{ records, signalIndices }`. `streamRecords` takes a WINDOW — and is called
 * streamRECORDS, and its own page shows it beside `readRecords`. So
 * `streamRecords(recording, { records })` is the shape both its name and its sibling suggest, and
 * it is the one mistake of shape worth naming on its own.
 *
 * It reached the seconds-to-ticks conversion with nothing to convert, and earned "startSeconds
 * must be a finite number of seconds, but was undefined. Next: check the expression that produced it — Number() on an absent
 * environment variable, query parameter or config key yields NaN." Every clause of that is about a
 * value the caller never computed: it sends them to audit a config key, when what they wrote is an
 * argument of the wrong shape (fixed in 0.6.87).
 *
 * `readWindow` and `readEnvelope` take a window too and said the same thing, so the check lives in
 * `assertSelection` where 0.6.79 put the object check, and fires for all three.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

const RECORD_RANGE = { records: { start: 0, count: 2 }, signalIndices: [0] } as const;
const WINDOW = { startSeconds: 0, durationSeconds: 2, signalIndices: [0] } as const;

const opened = () => openEdf(byteSource(FILE));

const TAKE_A_WINDOW: ReadonlyArray<
  readonly [string, (recording: never, selection: unknown) => unknown]
> = [
  [
    'readWindow',
    (recording, selection) =>
      (readWindow as never as (r: never, s: unknown) => unknown)(recording, selection),
  ],
  [
    'readEnvelope',
    (recording, selection) =>
      (readEnvelope as never as (r: never, s: unknown) => unknown)(recording, {
        ...(selection as object),
        buckets: 4,
      }),
  ],
  [
    'streamRecords',
    (recording, selection) =>
      (streamRecords as never as (r: never, s: unknown) => AsyncGenerator<unknown>)(
        recording,
        selection,
      ).next(),
  ],
];

async function thrownBy(
  call: (recording: never, selection: unknown) => unknown,
  selection: unknown,
): Promise<Error | undefined> {
  const recording = (await opened()) as never;
  try {
    await call(recording, selection);
    return undefined;
  } catch (error) {
    return error as Error;
  }
}

describe.each(TAKE_A_WINDOW)('%s given a record range', (name, call) => {
  it('says the selection is the wrong shape', async () => {
    const error = await thrownBy(call, RECORD_RANGE);
    expect(error).toBeInstanceOf(RangeError);
    expect(error?.message).toContain(
      `${name}(): the selection has a \`records\` range, and this call takes a time window.`,
    );
  });

  it('names the call that does take records', async () => {
    expect((await thrownBy(call, RECORD_RANGE))?.message).toContain('readRecords()');
  });

  it('no longer sends the reader to audit a config key', async () => {
    const { message } = (await thrownBy(call, RECORD_RANGE)) ?? { message: '' };
    expect(message).not.toContain('startSeconds must be a finite number');
    expect(message).not.toContain('absent environment variable');
  });

  it('still accepts the window it does take', async () => {
    expect(await thrownBy(call, WINDOW)).toBeUndefined();
  });
});

describe('readRecords, which is the one that takes records', () => {
  it('accepts the range unchanged', async () => {
    const recording = await opened();
    const chunk = await readRecords(recording, RECORD_RANGE);
    expect(chunk.records).toEqual({ start: 0, count: 2 });
  });
});
