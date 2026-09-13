/**
 * How a refused record range is printed.
 *
 * Three modules each carried their own `{ start: ${range.start}, count: ${range.count} }`, and all
 * three interpolated the values raw. A string interpolates as its digits, so the
 * `{ start: '0', count: '1' }` a JSON config, a saved view or a query string produces was refused
 * with "records { start: 0, count: 1 } is not inside the 4 data records this file contains" — a
 * range plainly inside a four-record file — and then told to "clamp the range against
 * header.recordCount", which for those values is nothing anyone can act on.
 *
 * `a-selection-from-json.test.ts` already sweeps string-valued fields as one of the shapes that
 * must be refused, and they were: the CLASS was right all along, and only the sentence was false.
 * That test asserts the phrase "is not inside the 6 data records", which is unchanged; what
 * changes is the range printed in front of it.
 *
 * One printer rather than three, for the reason 0.6.121 gives for `isByteArray`: two copies of a
 * rule have to be kept in agreement, and one does not.
 */

import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../../src/decode/digital.js';
import { byteSource } from '../../../src/io/bytes.js';
import { readRecordBytes } from '../../../src/io/read.js';
import { openEdf, readAnnotations, readRecords } from '../../../src/recording.js';
import { decodeAnnotations } from '../../../src/tal/annotations.js';
import { describeRecordRange } from '../../../src/text/describe.js';
import type { EdfRecording, RecordRange } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'A1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

/** Every entry point that prints a record range in a refusal. */
const PRINTS_A_RANGE: ReadonlyArray<
  readonly [string, (r: EdfRecording, records: RecordRange) => Promise<unknown>]
> = [
  ['readRecordBytes', (r, records) => readRecordBytes(r.source, r.header, records)],
  ['readAnnotations', (r, records) => readAnnotations(r, records)],
  ['readRecords', (r, records) => readRecords(r, { signalIndices: [0], records })],
  [
    'decodeDigital',
    async (r, records) =>
      decodeDigital(
        r.header,
        await readRecordBytes(r.source, r.header, { start: 0, count: 1 }),
        records,
        0,
      ),
  ],
  [
    'decodeAnnotations',
    async (r, records) =>
      decodeAnnotations(
        r.header,
        await readRecordBytes(r.source, r.header, { start: 0, count: 1 }),
        records,
      ),
  ],
];

async function thrownBy(
  call: (r: EdfRecording, records: RecordRange) => Promise<unknown>,
  records: unknown,
): Promise<Error> {
  try {
    await call(await opened(), records as RecordRange);
  } catch (error) {
    return error as Error;
  }
  throw new Error('the range was accepted');
}

describe.each(PRINTS_A_RANGE)('%s given a range that arrived as text', (_name, call) => {
  it('does not print it as the numbers its digits spell', async () => {
    const { message } = await thrownBy(call, { start: '0', count: '1' });
    expect(message).not.toContain('{ start: 0, count: 1 }');
  });

  it('names each field as itself', async () => {
    expect((await thrownBy(call, { start: '0', count: '1' })).message).toContain(
      '{ start: the string "0", count: the string "1" }',
    );
  });

  it('still names the numbers when they are numbers', async () => {
    expect((await thrownBy(call, { start: 0, count: 9 })).message).toContain(
      '{ start: 0, count: 9 }',
    );
  });

  it('names an absent field rather than printing nothing for it', async () => {
    expect((await thrownBy(call, { start: 0 })).message).toContain(
      '{ start: 0, count: undefined }',
    );
  });
});

describe('the printer itself', () => {
  it('reads each field through describeValue, and survives no range at all', () => {
    expect(describeRecordRange({ start: 0, count: 4 })).toBe('{ start: 0, count: 4 }');
    expect(describeRecordRange({ start: '0', count: null })).toBe(
      '{ start: the string "0", count: null }',
    );
    expect(describeRecordRange(undefined)).toBe('{ start: undefined, count: undefined }');
  });
});
