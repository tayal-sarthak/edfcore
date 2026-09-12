/**
 * The two header formatters, given the object one layer up from the one they take.
 *
 * `formatStartTimeNaive` is the worse of the two, because `undefined` is one of its answers: it
 * returns that for a file whose start cannot be resolved. Its name reads as something you ask of a
 * header, and `formatStartTimeNaive(header)` — or of a recording — found no `resolvedDate` and
 * returned exactly that. A well-formed "this file has no usable start", for a file whose start was
 * on the very object that was passed.
 *
 * `formatHeader(recording)` at least threw, with V8's `Cannot read properties of undefined (reading
 * 'startTime')`. The recording is what a reader has in hand and this is the report they want printed
 * of it, so it is the call the name invites (fixed in 0.6.110).
 */

import { describe, expect, it } from 'vitest';
import { formatHeader } from '../../src/format-header.js';
import { formatStartTimeNaive } from '../../src/header/dates.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfHeader, EdfStartTime } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const BYTES = buildEdf({
  recordCount: 2,
  recordDurationSeconds: 1,
  startDate: '01.01.20',
  startTime: '10.00.00',
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

const opened = () => openEdf(byteSource(BYTES));

/** The cast a JavaScript caller does not need to write. */
const loosely = <T>(value: unknown) => value as T;

function refusal(run: () => unknown): string {
  const outcome = (() => {
    try {
      return { ok: true as const, value: run() };
    } catch (error) {
      return { ok: false as const, message: (error as Error).message };
    }
  })();
  if (outcome.ok) throw new Error(`accepted, and returned ${String(outcome.value)}`);
  return outcome.message;
}

describe('formatStartTimeNaive', () => {
  it('answers for the start time it takes', async () => {
    const recording = await opened();
    expect(formatStartTimeNaive(recording.header.startTime)).toBe('2020-01-01T10:00:00.000');
  });

  it('refuses the header rather than returning its own "no usable start"', async () => {
    const recording = await opened();
    const message = refusal(() => formatStartTimeNaive(loosely<EdfStartTime>(recording.header)));
    expect(message).toContain('formatStartTimeNaive(): that is not a start time');
    expect(message).toContain('Next: pass header.startTime');
  });

  it('says why undefined is not available as a refusal', async () => {
    const recording = await opened();
    expect(refusal(() => formatStartTimeNaive(loosely<EdfStartTime>(recording)))).toContain(
      'undefined is what this function returns for a file whose start cannot be resolved',
    );
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['the calendar date alone', 'date'],
  ])('refuses %s', async (_described, given) => {
    const recording = await opened();
    const value = given === 'date' ? recording.header.startTime.resolvedDate : given;
    expect(refusal(() => formatStartTimeNaive(loosely<EdfStartTime>(value)))).toContain(
      'it has no clockSource',
    );
  });
});

describe('formatHeader', () => {
  it('names the recording as not a header', async () => {
    const recording = await opened();
    const message = refusal(() => formatHeader(loosely<EdfHeader>(recording)));
    expect(message).toContain('formatHeader(): that is not a header — it has no signals');
    expect(message).toContain('Next: pass recording.header');
    expect(message).not.toContain('Cannot read properties');
  });

  it('still prints a real header', async () => {
    const recording = await opened();
    expect(formatHeader(recording.header)).toContain('2 records');
  });
});
