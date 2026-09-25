/**
 * `summarizeDiagnostics`, one keyword short.
 *
 * `formatDiagnostics` and this function are the two calls that take a diagnostics array: one turns
 * it into text for a person, the other into numbers for a program, and `format.ts` sends readers
 * across in its own `Next:` clause — "summarizeDiagnostics() takes the same array and returns the
 * counts". One of the two named a forgotten `await` and the other did not.
 *
 * `describe.ts` argues the case in general and lists the five async calls "whose resolved values
 * other guards take", then says what "an object" costs there: it is "true of the thing they meant
 * to pass too". "Not an array" is the same sentence with the same problem — a pending Promise is
 * not one, and neither is a header, a report, a chunk, a recording, a string or a number.
 *
 * The keyword is half of the fix, the way it is for `resolveTimeWindow` and `buildTimeline`
 * (0.6.253): no call in this package resolves to a diagnostics array. `readHeader` resolves to the
 * header that carries one, `validateRecording` to the report, `readWindow` to the chunks. So the
 * message names a field as well.
 *
 * Said in words and not through `describeValue`, because this module "imports one type module and
 * nothing else, which is what lets any layer summarise a diagnostics array without taking on a
 * dependency" — and the existing check is already worded that way for that reason.
 *
 * The old sentence is kept for the values it was written for. A header, a report and a bare number
 * genuinely are not arrays and never will be.
 */

import { describe, expect, it } from 'vitest';
import { summarizeDiagnostics } from '../../src/diagnostics/summary.js';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader } from '../../src/io/read.js';
import { openEdf } from '../../src/recording.js';
import type { EdfDiagnostic } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { minimalEdf } from '../support/writer.js';

const bytes = minimalEdf();
type Summarize = (diagnostics: unknown) => unknown;
const summarize = summarizeDiagnostics as unknown as Summarize;

describe('the Promise a reader forgot to await', () => {
  it('is named as one rather than as "not an array"', async () => {
    const pending = readHeader(byteSource(bytes));
    expect(() => summarize(pending)).toThrow(/pending Promise/);
    await pending;
  });

  it('is told the keyword is only half of it, because nothing resolves to the array', async () => {
    const pending = readHeader(byteSource(bytes));
    let message = '';
    try {
      summarize(pending);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('half of the fix');
    expect(message).toContain('.diagnostics');
    await pending;
  });

  it('says so for every call whose resolved value carries diagnostics', async () => {
    const recording = await openEdf(byteSource(bytes));
    const pendings: readonly unknown[] = [
      readHeader(byteSource(bytes)),
      validateRecording(recording),
      openEdf(byteSource(bytes)),
    ];
    for (const pending of pendings) {
      expect(() => summarize(pending)).toThrow(/pending Promise/);
    }
    await Promise.all(pendings);
  });

  it('is a caller mistake, so it is a plain RangeError', async () => {
    const pending = readHeader(byteSource(bytes));
    expect(() => summarize(pending)).toThrow(RangeError);
    await pending;
  });
});

describe('the awaited value, still one field short', () => {
  it('hears the refusal written for a value that is not an array', async () => {
    const header = await readHeader(byteSource(bytes));
    expect(() => summarize(header)).toThrow(/not an array/);
  });

  it('and its diagnostics field is what the call takes', async () => {
    const header = await readHeader(byteSource(bytes));
    const summary = summarizeDiagnostics(header.diagnostics);
    expect(summary.total).toBe(header.diagnostics.length);
  });
});

describe('the values the old sentence was written for', () => {
  it('still hear it', () => {
    for (const wrong of [20, 'diagnostics', null, undefined, { length: 3 }]) {
      expect(() => summarize(wrong)).toThrow(/not an array/);
    }
  });

  it('and an empty array is still a summary of nothing', () => {
    const empty: readonly EdfDiagnostic[] = [];
    expect(summarizeDiagnostics(empty)).toMatchObject({ total: 0, worst: undefined });
  });
});
