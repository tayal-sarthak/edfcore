/**
 * Read options handed over as the Promise that will produce them.
 *
 * `assertReadOptions` has three branches for an object that is not an options object: an
 * `AbortSignal` passed whole (0.6.155), an array (0.6.245), and a bare value. A pending Promise is
 * the fourth, and it went through, because every field is read off the object rather than awaited:
 * `options.signal` is `undefined`, `options.maxMaterializeBytes` is `undefined`, and both take their
 * defaults.
 *
 * The cost is the one the bare-value branch already spells out — the read "took the default budget
 * and no cancellation" — and this is the argument where making the mistake produces DATA rather than
 * an error. Every other forgotten `await` in this package lands on a guard: `formatHeader(readHeader(
 * source))` throws, `mergeChunks(readWindow(...))` throws. `readWindow(recording, selection,
 * optionsFor(session))` resolved with the samples, unbounded and uncancellable, and nothing
 * distinguished that from a read whose options were honoured.
 *
 * The route is an async helper of the caller's own: options whose budget comes from a config file, a
 * stored setting, or a session record. Nothing published resolves to read options, which is why this
 * branch names the keyword and not a call.
 *
 * A property read, never a call. Nothing here awaits, settles or subscribes to anything, which is
 * the rule `describeValue` states for its own Promise branch.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import { minimalEdfPlus } from '../support/writer.js';

const bytes = minimalEdfPlus();
const WINDOW = { signalIndices: [0], startSeconds: 0, durationSeconds: 1 };

/** What a caller's own async options helper hands back if the await is left off. */
const pendingOptions = (): unknown => Promise.resolve({ maxMaterializeBytes: 4 * 1024 * 1024 });

describe('a read given the Promise its options are behind', () => {
  it('is refused rather than resolved, on every call that takes read options', async () => {
    const recording = await openEdf(byteSource(bytes));
    const records = { start: 0, count: recording.header.recordCount };
    const calls: ReadonlyArray<readonly [string, () => unknown]> = [
      ['readWindow', () => readWindow(recording, WINDOW, pendingOptions() as never)],
      [
        'readRecords',
        () => readRecords(recording, { signalIndices: [0], records }, pendingOptions() as never),
      ],
      ['readAnnotations', () => readAnnotations(recording, records, pendingOptions() as never)],
      [
        'readRecordBytes',
        () =>
          readRecordBytes(recording.source, recording.header, records, pendingOptions() as never),
      ],
      ['streamRecords', () => streamRecords(recording, WINDOW, pendingOptions() as never).next()],
      ['buildRecordIndex', () => buildRecordIndex(recording, pendingOptions() as never)],
    ];
    for (const [name, call] of calls) {
      await expect(Promise.resolve().then(call), name).rejects.toThrow(/a pending Promise/);
    }
  });

  it('names the keyword and what taking the defaults cost', async () => {
    const recording = await openEdf(byteSource(bytes));
    let message = '';
    try {
      await readWindow(recording, WINDOW, pendingOptions() as never);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('the read options are a pending Promise');
    expect(message).toContain('took the default budget and no cancellation');
    expect(message).toContain('Next: await them');
  });

  it('is a caller mistake, so it is a plain RangeError', async () => {
    const recording = await openEdf(byteSource(bytes));
    await expect(readWindow(recording, WINDOW, pendingOptions() as never)).rejects.toThrow(
      RangeError,
    );
  });

  it('does not await, settle or subscribe to what it was given', async () => {
    const recording = await openEdf(byteSource(bytes));
    let executorRan = false;
    const neverSettles = new Promise<never>(() => {
      executorRan = true;
    });
    expect(executorRan, 'the Promise was constructed').toBe(true);
    // It never settles, so a guard that awaited it would hang here rather than reject. Reaching the
    // refusal at all is the proof that the branch only reads `.then`.
    await expect(readWindow(recording, WINDOW, neverSettles as never)).rejects.toThrow(
      /a pending Promise/,
    );
  });
});

describe('the options that were always right', () => {
  it('still read, and still bound the read', async () => {
    const recording = await openEdf(byteSource(bytes));
    const options = await (pendingOptions() as Promise<{ maxMaterializeBytes: number }>);
    await expect(readWindow(recording, WINDOW, options)).resolves.toHaveLength(1);
  });

  it('are still optional', async () => {
    const recording = await openEdf(byteSource(bytes));
    await expect(readWindow(recording, WINDOW)).resolves.toHaveLength(1);
    await expect(readWindow(recording, WINDOW, undefined)).resolves.toHaveLength(1);
  });
});

describe('the three branches that were already there', () => {
  it('keep their own sentences', async () => {
    const recording = await openEdf(byteSource(bytes));
    const cases: ReadonlyArray<readonly [unknown, RegExp]> = [
      [new AbortController().signal, /the read options are an AbortSignal/],
      [[new AbortController().signal], /the read options are an array/],
      [4 * 1024 * 1024, /not an object/],
    ];
    for (const [options, expected] of cases) {
      await expect(readWindow(recording, WINDOW, options as never)).rejects.toThrow(expected);
    }
  });
});
