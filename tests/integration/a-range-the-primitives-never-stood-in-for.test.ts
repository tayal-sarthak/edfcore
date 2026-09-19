/**
 * `decodeDigital` and `decodeAnnotations`, given no record range at all.
 *
 * Three copies of `assertRecordRange` exist — one per layer that takes a range — and the I/O copy
 * in `io/read.ts` opens with `records ?? {}`, with the reason written beside it: every wrong SHAPE
 * already reached its refusal, an array and a string and `{ start: 0 }` all reading as
 * `{ start: undefined, count: undefined }`, "while `undefined` and `null` threw `TypeError: Cannot
 * read properties of undefined (reading 'start')` from the two lines under this one, which names
 * neither the option nor anything to do about it".
 *
 * That line went into one copy in 0.4.443. The other two are the PRIMITIVES — the pure synchronous
 * layer `index.ts` describes as what "a consumer who outgrows the top layer drops to" — and they
 * read `records.start` with nothing in front of it, so both still threw the engine's `TypeError`.
 *
 * It is the one way out of this package that carries no `Next:` clause. `next-clause.test.ts`
 * proves every message edfcore composes ends with one; a `TypeError` raised by V8 is not one
 * edfcore composes, so nothing there could have caught this.
 *
 * And the range is the argument most likely to be absent here rather than wrong.
 * `decodeDigital(header, bytes, records, signalIndex)` takes four, the two in the middle come from
 * the same `readRecordBytes(source, header, records)` call, and a range read out of JSON, a config
 * file or a spread that dropped a key arrives as `undefined` rather than as a malformed object.
 *
 * Both keep their own wording and their own `EdfRangeError`; only the crash is gone.
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

interface Primitive {
  readonly without: (header: EdfHeader, bytes: Uint8Array, records: unknown) => unknown;
  readonly with: (header: EdfHeader, bytes: Uint8Array) => unknown;
}

const PRIMITIVES: ReadonlyArray<readonly [string, Primitive]> = [
  [
    'decodeDigital',
    {
      without: (header, bytes, records) => decodeDigital(header, bytes, records as never, 0),
      with: (header, bytes) => decodeDigital(header, bytes, RANGE, 0),
    },
  ],
  [
    'decodeAnnotations',
    {
      without: (header, bytes, records) => decodeAnnotations(header, bytes, records as never),
      with: (header, bytes) => decodeAnnotations(header, bytes, RANGE),
    },
  ],
];

describe.each(PRIMITIVES)('%s, with no record range', (_name, primitive) => {
  it.each([
    ['omitted', undefined],
    ['null', null],
  ])('no longer throws the engine TypeError for a range that is %s', async (_shape, records) => {
    const { header, bytes } = await decoded();
    const thrown = await refusal(() => primitive.without(header, bytes, records));
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect(thrown.message).not.toContain('Cannot read properties');
  });

  it.each([
    ['omitted', undefined],
    ['null', null],
  ])('answers in edfcore words instead, for a range that is %s', async (_shape, records) => {
    const { header, bytes } = await decoded();
    const thrown = await refusal(() => primitive.without(header, bytes, records));
    expect(thrown).toBeInstanceOf(EdfRangeError);
    expect(thrown.message).toContain('Next:');
    expect(thrown.message).toContain(`is not inside the ${RECORDS}`);
  });

  it('carries the stand-in on requested, as the I/O copy does', async () => {
    const { header, bytes } = await decoded();
    const thrown = (await refusal(() =>
      primitive.without(header, bytes, undefined),
    )) as EdfRangeError;
    expect(thrown.requested).toEqual({});
    expect(thrown.available).toEqual({ start: 0, count: RECORDS });
  });

  it('answers an absent range exactly as it answers an empty object', async () => {
    const { header, bytes } = await decoded();
    const absent = await refusal(() => primitive.without(header, bytes, undefined));
    const empty = await refusal(() => primitive.without(header, bytes, {}));
    expect(absent.message).toBe(empty.message);
  });

  it('still refuses a range that runs past the end, unchanged', async () => {
    const { header, bytes } = await decoded();
    const thrown = await refusal(() =>
      primitive.without(header, bytes, { start: 0, count: RECORDS + 1 }),
    );
    expect(thrown).toBeInstanceOf(EdfRangeError);
    expect(thrown.message).toContain('is not inside the');
  });

  it('still answers for the range the bytes were read with', async () => {
    const { header, bytes } = await decoded();
    expect(primitive.with(header, bytes)).toBeDefined();
  });
});
