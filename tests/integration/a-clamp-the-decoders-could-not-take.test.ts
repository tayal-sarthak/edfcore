/**
 * The same clamp 0.6.221 withdrew, still offered by the two decoding primitives.
 *
 * `assertRecordRange` exists three times — once per layer that takes a range — and each copy ends
 * on a sentence its own shape branches are documented as fixes for, both naming the same half:
 * advice "to clamp it against `header.recordCount`, which no clamp can satisfy". 0.6.221 withdrew
 * it from the I/O copy for every range with no numbers in it: the `records ?? {}` stand-in that
 * 0.6.223 has just given these two, a half-built `{ start: 0 }`, a range whose fields arrived from
 * JSON as strings. The decoders kept offering it.
 *
 * The next step here is not the I/O copy's, because these are decoders. They cannot take any range
 * — only the one the buffer beside them was read with, which is precisely what the check under this
 * one pins: `recordBytes.length` must equal `records.count * header.recordByteLength`, and
 * `decodeDigital` "cannot tell which record a differently sized buffer begins at, so it will not
 * guess". A caller holding no range has to go back to the `readRecordBytes` call that produced the
 * bytes, and that is what the clause says now.
 *
 * A range that IS two numbers and runs past the end keeps its clamp in both, because there the
 * clamp is the fix and the two decoders phrase it differently on purpose.
 */

import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../src/decode/digital.js';
import { EdfRangeError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf } from '../../src/recording.js';
import { decodeAnnotations } from '../../src/tal/annotations.js';
import type { EdfHeader, RecordRange } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const RECORDS = 4;

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    { samplesPerRecord: 40, tals: (r) => [{ onset: r + 0.25, texts: [`e${r}`] }] },
  ],
});

const RANGE: RecordRange = { start: 0, count: 2 };

async function decoded(): Promise<{ header: EdfHeader; bytes: Uint8Array }> {
  const recording = await openEdf(byteSource(FILE));
  return {
    header: recording.header,
    bytes: await readRecordBytes(recording.source, recording.header, RANGE),
  };
}

const refusal = async (call: () => unknown): Promise<Error> => {
  const thrown = await Promise.resolve()
    .then(call)
    .then(
      () => undefined,
      (error: unknown) => error as Error,
    );
  expect(thrown, 'nothing was refused').toBeDefined();
  return thrown as Error;
};

type Decode = (header: EdfHeader, bytes: Uint8Array, records: unknown) => unknown;

const DECODERS: ReadonlyArray<readonly [string, Decode]> = [
  ['decodeDigital', (header, bytes, records) => decodeDigital(header, bytes, records as never, 0)],
  [
    'decodeAnnotations',
    (header, bytes, records) => decodeAnnotations(header, bytes, records as never),
  ],
];

const NO_NUMBERS: ReadonlyArray<readonly [string, unknown]> = [
  ['omitted', undefined],
  ['null', null],
  ['an empty object', {}],
  ['only a start', { start: 0 }],
  ['only a count', { count: 2 }],
  ['fields that arrived from JSON as strings', { start: '0', count: '2' }],
  ['a null field', { start: null, count: 2 }],
  ['a string', '0-2'],
];

describe.each(DECODERS)('%s, given a range with no numbers in it', (_name, decode) => {
  it.each(NO_NUMBERS)('no longer advises a clamp for %s', async (_shape, records) => {
    const { header, bytes } = await decoded();
    const thrown = await refusal(() => decode(header, bytes, records));
    expect(thrown.message).not.toContain('clamp the range');
  });

  it.each(NO_NUMBERS)(
    'sends the reader back to the read instead, for %s',
    async (_shape, records) => {
      const { header, bytes } = await decoded();
      const thrown = await refusal(() => decode(header, bytes, records));
      expect(thrown.message).toContain('readRecordBytes(source, header, records) was called with');
      expect(thrown.message).toContain('name the same records');
    },
  );

  it('stays an EdfRangeError carrying the fields a handler branches on', async () => {
    const { header, bytes } = await decoded();
    const thrown = (await refusal(() => decode(header, bytes, undefined))) as EdfRangeError;
    expect(thrown).toBeInstanceOf(EdfRangeError);
    expect(thrown.available).toEqual({ start: 0, count: RECORDS });
  });

  it('keeps the sentence naming the range and the record count', async () => {
    const { header, bytes } = await decoded();
    const thrown = await refusal(() => decode(header, bytes, {}));
    expect(thrown.message).toContain(`is not inside the ${RECORDS}`);
  });

  it('answers an absent range exactly as it answers an empty object', async () => {
    const { header, bytes } = await decoded();
    const absent = await refusal(() => decode(header, bytes, undefined));
    const empty = await refusal(() => decode(header, bytes, {}));
    expect(absent.message).toBe(empty.message);
  });

  it.each([
    ['past the end', { start: 0, count: RECORDS + 1 }],
    ['a negative start', { start: -1, count: 1 }],
    ['a fractional start', { start: 0.5, count: 1 }],
    ['a NaN count', { start: 0, count: Number.NaN }],
  ])('keeps the clamp for %s, where a clamp is the fix', async (_shape, records) => {
    const { header, bytes } = await decoded();
    const thrown = await refusal(() => decode(header, bytes, records));
    expect(thrown.message).toContain('clamp the range');
    expect(thrown.message).not.toContain('was called with');
  });

  it('still decodes the range the bytes were read with', async () => {
    const { header, bytes } = await decoded();
    expect(decode(header, bytes, RANGE)).toBeDefined();
  });
});

describe('the two decoders still phrase their own clamp their own way', () => {
  it('keeps decodeDigital naming header.recordCount', async () => {
    const { header, bytes } = await decoded();
    const thrown = await refusal(() =>
      decodeDigital(header, bytes, { start: 0, count: RECORDS + 1 }, 0),
    );
    expect(thrown.message).toContain('clamp the range against header.recordCount before decoding');
  });

  it('keeps decodeAnnotations naming the interval', async () => {
    const { header, bytes } = await decoded();
    const thrown = await refusal(() =>
      decodeAnnotations(header, bytes, { start: 0, count: RECORDS + 1 }),
    );
    expect(thrown.message).toContain(`clamp the range to [0, ${RECORDS})`);
  });
});
