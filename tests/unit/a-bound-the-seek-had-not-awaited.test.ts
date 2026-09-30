/**
 * A time bound handed over as the Promise that will produce it.
 *
 * Every time-bounded call in the package converts its seconds through one function, and that
 * function described a pending Promise as "an object" — true of it, and true of the window object a
 * reader might have passed instead, which is what makes the sentence useless here. `describeValue`
 * names it everywhere else and gives the reason: a forgotten `await` is otherwise told "nothing about
 * the one keyword that fixes it".
 *
 * The route is ordinary. `startSeconds` and `durationSeconds` come from a seek position, a playhead,
 * or a viewport read back from storage, and `index.locate(seconds)` takes one directly — so
 * `readWindow(recording, { signalIndices, startSeconds: seekPosition(), durationSeconds: 10 })` with
 * an async `seekPosition` is one keyword short. The advice is wrong for it too: "convert it first —
 * Number(text) for a string" is for a value that exists.
 *
 * Said in words rather than through `describeValue`, because `tal/ticks.ts` "imports `constants.ts`
 * and nothing else" — the property `AGENTS.md` cites as the point of the layer rule, and the reason
 * `tal/ticks.ts` sits at layer 1 rather than with the rest of `tal/`. `summarizeDiagnostics` closed
 * its own copy of this the same way in 0.6.254: the constraint is about the import, not the sentence.
 *
 * Numbers keep their bare spelling, so `NaN`, `Infinity` and `undefined` still read as themselves and
 * still get the advice 0.6.87 wrote for an absent field. A string and a BigInt keep theirs, which is
 * what this helper was written for in 0.6.92.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { trimToWindow } from '../../src/time/window.js';
import { minimalEdf } from '../support/writer.js';

const bytes = minimalEdf();

/** What an async seek position hands back if the await is left off. */
const pendingSeconds = (): unknown => Promise.resolve(30);

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

describe('a window bound that is still a Promise', () => {
  it('is named as one rather than as "an object"', async () => {
    const recording = await openEdf(byteSource(bytes));
    const message = await refusal(() =>
      readWindow(recording, {
        signalIndices: [0],
        startSeconds: pendingSeconds() as never,
        durationSeconds: 1,
      }),
    );
    expect(message).toContain('a pending Promise');
    expect(message).not.toContain('an object');
  });

  it('is named on the duration as well as the start', async () => {
    const recording = await openEdf(byteSource(bytes));
    const message = await refusal(() =>
      readWindow(recording, {
        signalIndices: [0],
        startSeconds: 0,
        durationSeconds: pendingSeconds() as never,
      }),
    );
    expect(message).toContain('durationSeconds');
    expect(message).toContain('a pending Promise');
  });

  it('is named by the index call that takes seconds directly', async () => {
    const recording = await openEdf(byteSource(bytes));
    const index = await buildRecordIndex(recording);
    const message = await refusal(() => index.locate(pendingSeconds() as never));
    expect(message).toContain('a pending Promise');
  });

  it('is named by trimToWindow, which narrows samples already in hand', async () => {
    const recording = await openEdf(byteSource(bytes));
    const [chunk] = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 1,
    });
    const chunkSignal = chunk?.signals[0];
    if (chunkSignal === undefined) throw new Error('fixture');
    const message = await refusal(() =>
      trimToWindow(recording.header, chunkSignal, pendingSeconds() as never, 1),
    );
    expect(message).toContain('a pending Promise');
  });

  it('is a caller mistake, so it is a plain RangeError', async () => {
    const recording = await openEdf(byteSource(bytes));
    await expect(
      readWindow(recording, {
        signalIndices: [0],
        startSeconds: pendingSeconds() as never,
        durationSeconds: 1,
      }),
    ).rejects.toThrow(RangeError);
  });

  it('is never awaited, settled or subscribed to', async () => {
    const recording = await openEdf(byteSource(bytes));
    const neverSettles = new Promise<never>(() => {});
    const message = await refusal(() =>
      readWindow(recording, {
        signalIndices: [0],
        startSeconds: neverSettles as never,
        durationSeconds: 1,
      }),
    );
    expect(message).toContain('a pending Promise');
  });
});

describe('the values this helper was written for', () => {
  it('keep their spellings', async () => {
    const recording = await openEdf(byteSource(bytes));
    const index = await buildRecordIndex(recording);
    expect(await refusal(() => index.locate('1' as never))).toContain('the string "1"');
    expect(await refusal(() => index.locate(1n as never))).toContain('the BigInt 1n');
    expect(await refusal(() => index.locate(null as never))).toContain('null');
    expect(await refusal(() => index.locate(true as never))).toContain('a boolean');
  });

  it('and a plain object is still an object', async () => {
    const recording = await openEdf(byteSource(bytes));
    const index = await buildRecordIndex(recording);
    expect(await refusal(() => index.locate({ startSeconds: 1 } as never))).toContain('an object');
  });

  it('and a number still reads as itself, with the advice for an absent field', async () => {
    const recording = await openEdf(byteSource(bytes));
    const index = await buildRecordIndex(recording);
    expect(await refusal(() => index.locate(Number.NaN))).toContain('was NaN');
    expect(await refusal(() => index.locate(undefined as never))).toContain(
      'nothing computes undefined',
    );
  });
});

describe('a bound that resolved', () => {
  it('still reads the window it names', async () => {
    const recording = await openEdf(byteSource(bytes));
    const startSeconds = (await (pendingSeconds() as Promise<number>)) - 30;
    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds,
      durationSeconds: 1,
    });
    expect(chunks.length).toBeGreaterThan(0);
  });
});
