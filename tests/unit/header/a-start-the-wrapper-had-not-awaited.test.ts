/**
 * `formatStartTimeNaive`, one keyword short.
 *
 * `undefined` is this function's own answer for a file whose start cannot be resolved, which is what
 * makes a wrong argument dangerous here rather than merely unhelpful — the argument 0.6.110 added
 * the guard for. It then described a pending Promise with the sentence written for a header or a
 * recording: "that is not a start time — it has no clockSource". True of all three.
 *
 * The route is a caller's own helper, because nothing published resolves to an `EdfStartTime`. A
 * viewer listing the start time of several files wraps `openEdf` and returns
 * `recording.header.startTime`, and that wrapper is async. 0.6.267 named the same route for a time
 * bound: the value comes from the caller rather than from this package, which is exactly why the
 * keyword is the thing worth naming.
 *
 * The advice was the unusable part. "Pass header.startTime" names a field on an object a caller
 * holding a Promise has not unwrapped yet — and a reader who is already handling this function's
 * `undefined` answer has no reason to suspect their argument in the first place.
 *
 * The existing sentence is kept for the shapes it was written for: a header and a recording both
 * genuinely have no `clockSource`, and the field they do carry it on is what the advice names.
 */

import { describe, expect, it } from 'vitest';
import { formatStartTimeNaive } from '../../../src/header/dates.js';
import { byteSource } from '../../../src/io/bytes.js';
import { readHeader } from '../../../src/io/read.js';
import { openEdf } from '../../../src/recording.js';
import type { EdfStartTime } from '../../../src/types.js';
import { minimalEdf } from '../../support/writer.js';

const bytes = minimalEdf();
const format = formatStartTimeNaive as unknown as (startTime: unknown) => string | undefined;

const refusal = (call: () => unknown): string => {
  let thrown: Error | undefined;
  try {
    call();
  } catch (error) {
    thrown = error as Error;
  }
  expect(thrown, 'nothing was refused').toBeDefined();
  return (thrown as Error).message;
};

/** What a caller's own async helper hands back if the await is left off. */
const pendingStart = (): unknown =>
  openEdf(byteSource(bytes)).then((recording) => recording.header.startTime);

describe('a start time that is still a Promise', () => {
  it('is named as one rather than as "not a start time"', async () => {
    const pending = pendingStart();
    const message = refusal(() => format(pending));
    expect(message).toContain('that is a pending Promise');
    expect(message).not.toContain('it has no clockSource');
    await pending;
  });

  it('says the start is on what it resolves to', async () => {
    const pending = pendingStart();
    expect(refusal(() => format(pending))).toContain('resolves to rather than on what it returns');
    await pending;
  });

  it('says to await and then take the field, rather than naming a field it cannot reach', async () => {
    const pending = pendingStart();
    const message = refusal(() => format(pending));
    expect(message).toContain('Next: await it');
    expect(message).toContain('.header.startTime');
    await pending;
  });

  it('is a caller mistake, so it is a plain RangeError', async () => {
    const pending = pendingStart();
    expect(() => format(pending)).toThrow(RangeError);
    await pending;
  });

  it('does not await, settle or subscribe to what it was given', () => {
    const neverSettles = new Promise<never>(() => {});
    expect(refusal(() => format(neverSettles))).toContain('a pending Promise');
  });
});

describe('the awaited value, still one field short', () => {
  it('hears the sentence written for it', async () => {
    const header = await readHeader(byteSource(bytes));
    expect(refusal(() => format(header))).toContain('it has no clockSource');
    const recording = await openEdf(byteSource(bytes));
    expect(refusal(() => format(recording))).toContain('it has no clockSource');
  });

  it('and the field that advice names is the one that works', async () => {
    const header = await readHeader(byteSource(bytes));
    expect(formatStartTimeNaive(header.startTime)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("this function's own answer", () => {
  it('is still undefined for a start that cannot be resolved', () => {
    const unresolved = {
      headerDate: undefined,
      recordingIdDate: undefined,
      resolvedDate: undefined,
      dateSource: 'none',
      clock: { hour: 0, minute: 0, second: 0 },
      clockSource: 'none',
      secondsSinceMidnight: 0,
    } as unknown as EdfStartTime;
    expect(formatStartTimeNaive(unresolved)).toBeUndefined();
  });
});
