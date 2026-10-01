/**
 * An array of Promises where a diagnostics array belongs.
 *
 * 0.6.254 closed the LIST level of this: the whole argument being one pending Promise. This is the
 * other spelling, and it is a different mistake — the array is real, and every element of it is
 * pending. `recordings.map((r) => validateRecording(r))` is the across-several-files summary a batch
 * report wants, written without `Promise.all`, and `.map` over async work is the way that gets
 * written.
 *
 * The sentence it got was wrong twice. "The value at 0 carries no message, so it is not a diagnostic
 * — a row of a by-code summary counts a code rather than being one" names a shape the caller never
 * passed, and "carries no message" is true of a pending Promise the way it is true of almost
 * everything.
 *
 * `formatDiagnostics` names it one directory over, and `mergeChunks` names it per element too: "the
 * value at 1 is a pending Promise, not a chunk". This was the last per-element guard in the package
 * that did not.
 *
 * The advice has to be `Promise.all`, not `await`. One keyword in front of the array does nothing —
 * awaiting an array of Promises yields the array of Promises — so this is the one forgotten-await
 * family where naming the keyword alone would send a reader somewhere that still fails.
 *
 * Said in words rather than through `describeValue`, because this module "imports one type module and
 * nothing else, which is what lets any layer summarise a diagnostics array without taking on a
 * dependency", and a property read needs nothing.
 */

import { describe, expect, it } from 'vitest';
import { summarizeDiagnostics } from '../../src/diagnostics/summary.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfDiagnostic } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { minimalEdfPlus } from '../support/writer.js';

const bytes = minimalEdfPlus();
type Summarize = (diagnostics: unknown) => unknown;
const summarize = summarizeDiagnostics as unknown as Summarize;

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

describe('an array .map left pending', () => {
  it('is named as a Promise rather than as a by-code row', async () => {
    const recording = await openEdf(byteSource(bytes));
    const pending = [recording].map((r) => validateRecording(r));
    const message = refusal(() => summarize(pending));
    expect(message).toContain('the value at 0 is a pending Promise');
    expect(message).not.toContain('by-code summary');
    await Promise.all(pending);
  });

  it('says the array came from async work that was never awaited', async () => {
    const recording = await openEdf(byteSource(bytes));
    const pending = [recording].map((r) => validateRecording(r));
    const message = refusal(() => summarize(pending));
    expect(message).toContain('mapped from async work and never awaited');
    await Promise.all(pending);
  });

  it('advises Promise.all, because one await in front of the array does nothing', async () => {
    const recording = await openEdf(byteSource(bytes));
    const pending = [recording].map((r) => validateRecording(r));
    expect(refusal(() => summarize(pending))).toContain('Promise.all over the array');
    // And that is not pedantry: awaiting the array yields the array.
    const awaited = await pending;
    expect(awaited[0]).toBeInstanceOf(Promise);
    expect(refusal(() => summarize(awaited))).toContain('a pending Promise');
    await Promise.all(pending);
  });

  it('names the position, so a partly-resolved array says which element', () => {
    const real = {
      code: 'DATE_CLIPPED_TO_1985_2084',
      severity: 'info',
      message: 'a real diagnostic',
    } as unknown as EdfDiagnostic;
    const mixed = [real, Promise.resolve(real)] as unknown;
    expect(refusal(() => summarize(mixed))).toContain('the value at 1');
  });

  it('is a caller mistake, so it is a plain RangeError', () => {
    const thrown = (() => {
      try {
        summarize([Promise.resolve({})]);
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(thrown).toBeInstanceOf(RangeError);
  });

  it('does not await, settle or subscribe to the elements', () => {
    const neverSettles = new Promise<never>(() => {});
    expect(refusal(() => summarize([neverSettles]))).toContain('a pending Promise');
  });
});

describe('the advice, followed', () => {
  it('produces an array this call summarises', async () => {
    const recording = await openEdf(byteSource(bytes));
    const reports = await Promise.all([recording].map((r) => validateRecording(r)));
    const diagnostics = reports.flatMap((report) => report.diagnostics);
    const summary = summarizeDiagnostics(diagnostics);
    expect(summary.total).toBe(diagnostics.length);
  });
});

describe('the sentence that was already there', () => {
  it('still answers the shape it was written for', () => {
    const real = {
      code: 'DATE_CLIPPED_TO_1985_2084',
      severity: 'info',
      message: 'a real diagnostic',
    } as unknown as EdfDiagnostic;
    const summary = summarizeDiagnostics([real]);
    expect(refusal(() => summarize(summary.byCode))).toContain('carries no message');
    expect(refusal(() => summarize([{}]))).toContain('a row of a by-code summary');
    expect(refusal(() => summarize([null]))).toContain('carries no message');
  });

  it('and the list-level guard keeps 0.6.254’s wording', () => {
    expect(refusal(() => summarize(Promise.resolve([])))).toContain('half of the fix');
  });
});
