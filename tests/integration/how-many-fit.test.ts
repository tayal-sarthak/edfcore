/**
 * A budget refusal says how many fit, not "fewer".
 *
 * The three refusals are the ones a caller meets when they ask for more than
 * `maxMaterializeBytes` allows, and all three ended with a comparative: read fewer records, decode
 * fewer samples, convert fewer samples. Each printed the two numbers that answer the question —
 * what the call needed, and what the budget is — and left the third, the width of one item, out of
 * the message. So the reader was being asked to divide by something the message knows and does not
 * print.
 *
 * `options.ts` records the same shape going wrong twice: a `NaN` budget was refused with "read
 * fewer records per call", "advice no record count can satisfy", and elsewhere with "clamp the
 * range against header.recordCount", "a range neither function takes as a parameter" (0.3.21).
 * Advice that is not actionable is what that docblock is about, and a comparative with no
 * quantity is the mild version of it.
 *
 * The count is exact rather than approximate: `requiredBytes / records.count` is the record size,
 * because that is how `requiredBytes` was computed. `the-advice-works.test.ts` now follows the
 * number the message gives rather than one it worked out itself, which is the check that matters —
 * the advice has to be true, not just present.
 */

import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../src/decode/digital.js';
import { toPhysical } from '../../src/decode/physical.js';
import { EdfBudgetError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const BYTES = buildEdf({
  recordCount: 10,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

const open = (): Promise<EdfRecording> => openEdf(byteSource(BYTES));

async function budgetRefusal(run: () => Promise<unknown> | unknown): Promise<EdfBudgetError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof EdfBudgetError) return error;
    throw error;
  }
  throw new Error('the call was not refused');
}

describe('reading records', () => {
  it('names the count that fits, and that count works', async () => {
    const recording = await open();
    const { header } = recording;
    const budget = 3 * header.recordByteLength;

    const error = await budgetRefusal(() =>
      readRecordBytes(
        recording.source,
        header,
        { start: 0, count: 10 },
        {
          maxMaterializeBytes: budget,
        },
      ),
    );
    expect(error.message).toContain('read at most 3 records per call');

    await expect(
      readRecordBytes(
        recording.source,
        header,
        { start: 0, count: 3 },
        {
          maxMaterializeBytes: budget,
        },
      ),
    ).resolves.toHaveLength(budget);
  });

  it('says one record, singular, when one is what fits', async () => {
    const recording = await open();
    const { header } = recording;
    const error = await budgetRefusal(() =>
      readRecordBytes(
        recording.source,
        header,
        { start: 0, count: 10 },
        {
          maxMaterializeBytes: header.recordByteLength,
        },
      ),
    );
    expect(error.message).toContain('read at most 1 record per call');
  });

  it('says so when nothing fits, rather than advising a count of zero', async () => {
    const recording = await open();
    const { header } = recording;
    const error = await budgetRefusal(() =>
      readRecordBytes(
        recording.source,
        header,
        { start: 0, count: 10 },
        {
          maxMaterializeBytes: header.recordByteLength - 1,
        },
      ),
    );
    expect(error.message).toContain(
      `one record of this file needs ${header.recordByteLength} bytes`,
    );
    expect(error.message).toContain('so no count fits');
    expect(error.message).not.toContain('at most 0');
  });
});

describe('decoding and converting samples', () => {
  it('names the sample count that fits, for the digital path', async () => {
    const recording = await open();
    const bytes = await readRecordBytes(recording.source, recording.header, {
      start: 0,
      count: 10,
    });
    const error = await budgetRefusal(() =>
      decodeDigital(recording.header, bytes, { start: 0, count: 10 }, 0, undefined, {
        maxMaterializeBytes: 40,
      }),
    );
    // 40 bytes at four bytes a sample.
    expect(error.message).toContain('decode at most 10 samples per call');
    expect(error.message).toContain('reuse an `out` array');
  });

  it('names it for the physical path, where a sample is eight bytes', async () => {
    const recording = await open();
    const signal = recording.header.signals[0];
    if (signal === undefined) throw new Error('no signal');
    const digital = Int32Array.from({ length: 100 }, (_, index) => index);

    const error = await budgetRefusal(() =>
      toPhysical(signal, digital, undefined, { maxMaterializeBytes: 80 }),
    );
    expect(error.message).toContain('convert at most 10 samples per call');
  });

  it('says so when a single sample does not fit', async () => {
    const recording = await open();
    const signal = recording.header.signals[0];
    if (signal === undefined) throw new Error('no signal');
    const error = await budgetRefusal(() =>
      toPhysical(signal, Int32Array.from([1, 2]), undefined, { maxMaterializeBytes: 0 }),
    );
    expect(error.message).toContain('this budget does not fit one sample');
  });
});

describe('what the numbers are still for', () => {
  it('leaves requiredBytes and budgetBytes on the error, which is what a program branches on', async () => {
    const recording = await open();
    const { header } = recording;
    const error = await budgetRefusal(() =>
      readRecordBytes(
        recording.source,
        header,
        { start: 0, count: 10 },
        {
          maxMaterializeBytes: 3 * header.recordByteLength,
        },
      ),
    );
    expect(error.requiredBytes).toBe(10 * header.recordByteLength);
    expect(error.budgetBytes).toBe(3 * header.recordByteLength);
  });
});
