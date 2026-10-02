/**
 * `signalIndices: new Set([3, 7])`, named as a Set.
 *
 * `describeSelection`'s own docblock names the shapes that reach it — "a `Set` of indices, a `Map`
 * from a config, an object keyed by label" — and then answered all three with the word they share
 * with every other wrong value. 0.6.230 was spent on the article in that sentence, `a object` →
 * `an object`, and left the noun alone.
 *
 * A Set is the one worth naming, because it is not a careless choice. A channel list must not hold
 * the same index twice, which is exactly what a Set is for, so a caller building one from a montage
 * has picked the wrong container for a right reason — and `[...indices]` is the whole fix. "An
 * object" does not get them there; it is also true of the header, the chunk, and the object keyed by
 * label that the same guard refuses.
 *
 * `describe.ts` gives the rule: a value is named by its built-in tag "because that IS the mistake
 * wherever one turns up". 0.6.256 applied it to a typed array in the Status-word guard and 0.6.269 to
 * a RegExp in the label lookups. This is the third, in the guard every read goes through. The tag
 * rather than `instanceof`, because it is the same across realms.
 *
 * Everything else keeps "an object", and the article property 0.6.230 added is pinned alongside: no
 * message from here says `a object` for any shape.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fp1', samplesPerRecord: 4 },
    { label: 'EEG C3', samplesPerRecord: 4 },
  ],
});

const open = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

const refusal = async (call: () => unknown): Promise<string> => {
  const thrown = await Promise.resolve()
    .then(call)
    .then(
      () => undefined,
      (error: unknown) => error as Error,
    );
  expect(thrown, 'nothing was refused').toBeDefined();
  return (thrown as Error).message;
};

type Read = (recording: unknown, selection: unknown) => unknown;
const window = readWindow as unknown as Read;

const WINDOW = { startSeconds: 0, durationSeconds: 1 };

describe('a Set where the index array belongs', () => {
  it('is named as a Set', async () => {
    const recording = await open();
    const message = await refusal(() =>
      window(recording, { signalIndices: new Set([0, 1]), ...WINDOW }),
    );
    expect(message).toContain('signalIndices is a Set');
    expect(message).not.toContain('an object');
  });

  it('keeps the reason and the next step, which is where the fix is', async () => {
    const recording = await open();
    const message = await refusal(() =>
      window(recording, { signalIndices: new Set([0, 1]), ...WINDOW }),
    );
    expect(message).toContain('not an array of signal indices');
    expect(message).toContain('Next: pass header.dataSignalIndices');
  });

  it('is named by every read that takes a selection', async () => {
    const recording = await open();
    const calls: ReadonlyArray<readonly [string, () => unknown]> = [
      ['readWindow', () => window(recording, { signalIndices: new Set([0]), ...WINDOW })],
      [
        'readRecords',
        () =>
          (readRecords as unknown as Read)(recording, {
            signalIndices: new Set([0]),
            records: { start: 0, count: 1 },
          }),
      ],
    ];
    for (const [name, call] of calls) {
      expect(await refusal(call), name).toContain('signalIndices is a Set');
    }
  });

  it('and the spread that fixes it reads', async () => {
    const recording = await open();
    const indices = new Set([0, 1]);
    await expect(
      readWindow(recording, { signalIndices: [...indices], ...WINDOW }),
    ).resolves.toBeDefined();
  });
});

describe('a Map where the index array belongs', () => {
  it('is named as a Map, which the docblock also lists', async () => {
    const recording = await open();
    const message = await refusal(() =>
      window(recording, { signalIndices: new Map([['Fp1', 0]]), ...WINDOW }),
    );
    expect(message).toContain('signalIndices is a Map');
  });
});

describe('the recording argument, which shares the describer', () => {
  it('names a Set there too', async () => {
    const recording = await open();
    const message = await refusal(() =>
      window(new Set([recording]), { signalIndices: [0], ...WINDOW }),
    );
    expect(message).toContain('the recording is a Set');
  });
});

describe('what keeps saying "an object"', () => {
  it('is everything with no name worth more than its shape', async () => {
    const recording = await open();
    const shapes: ReadonlyArray<readonly [string, unknown]> = [
      ['an object keyed by label', { 'EEG Fp1': 0 }],
      ['a header', recording.header],
      // Not `header.signals`: it is an array, so it reaches the guard that says it "holds a signal
      // rather than an index" — a better sentence than either of these, and not this describer's.
    ];
    for (const [name, signalIndices] of shapes) {
      const message = await refusal(() => window(recording, { signalIndices, ...WINDOW }));
      expect(message, name).toContain('is an object');
    }
  });

  it('and no shape produces "a object", which is what 0.6.230 added', async () => {
    const recording = await open();
    for (const signalIndices of [new Set([0]), new Map(), { Fp1: 0 }, 5, 'Fp1', true]) {
      const message = await refusal(() => window(recording, { signalIndices, ...WINDOW }));
      expect(message).not.toContain('a object');
    }
  });
});
