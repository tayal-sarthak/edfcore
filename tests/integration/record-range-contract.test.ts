/**
 * A record range, and the five calls that must refuse the same ones.
 *
 * `RecordRange` is the other half of the selection contract `signal-selection-contract.test.ts`
 * covers. It reaches five entry points spread across three layers — `readRecordBytes` in the I/O
 * layer, `readRecords` and `readAnnotations` in the recording layer, `decodeDigital` and
 * `decodeAnnotations` in the decoders — and they do not share a validator the way the signal
 * selections share `resolveSignals`. Each asserts the range for itself.
 *
 * That is the reason to check them together. `api-reading.md` documents one behaviour — an
 * `EdfRangeError` when the range is not inside `header.recordCount` — and a caller who tested
 * against `readRecords` has no way to know whether `decodeDigital` agrees. It also carries
 * `requested` and `available` so a caller can clamp and retry, and those fields have to hold the
 * same two ranges at every site or the retry computes the wrong one.
 *
 * Six bad ranges are driven at all five: a start past the end, a count that runs past it, a
 * negative start, a negative count, a fractional start and a fractional count. The last two are
 * the ones a caller reaches without noticing — `Math.floor` left off a division, or a range built
 * from `seconds * rate` — and they are refused rather than truncated, because a range that
 * silently became `{ start: 0, count: 1 }` would return real samples for a question nobody asked.
 *
 * `count: 0` is accepted at all five, which is the case the page singles out: "A range with
 * `count: 0` issues no read at all and returns an empty chunk." The two decoders check something
 * else as well — the buffer they were handed against the range they were given — and that second
 * check is exercised rather than worked around, since it is the one that catches a caller pairing
 * a range with the wrong bytes.
 */

import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../src/decode/digital.js';
import { EdfRangeError, isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf, readAnnotations, readRecords } from '../../src/recording.js';
import { decodeAnnotations } from '../../src/tal/annotations.js';
import type { EdfRecording, RecordRange } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const RECORD_COUNT = 4;

const BYTES = buildEdf({
  plus: 'C',
  recordCount: RECORD_COUNT,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 24 }],
});

/** Every bad range, named by what a caller did to produce it. */
const REFUSED: ReadonlyArray<readonly [string, RecordRange]> = [
  ['a start past the last record', { start: RECORD_COUNT, count: 1 }],
  ['a count that runs past the end', { start: RECORD_COUNT - 1, count: 2 }],
  ['a negative start', { start: -1, count: 1 }],
  ['a negative count', { start: 0, count: -1 }],
  ['a fractional start', { start: 0.5, count: 1 }],
  ['a fractional count', { start: 0, count: 1.5 }],
];

interface Fixture {
  readonly recording: EdfRecording;
  readonly wholeFile: Uint8Array;
}

async function fixture(): Promise<Fixture> {
  const recording = await openEdf(byteSource(BYTES));
  const wholeFile = await readRecordBytes(recording.source, recording.header, {
    start: 0,
    count: RECORD_COUNT,
  });
  return { recording, wholeFile };
}

/**
 * The five, each given the bytes its own layer expects: the two decoders are pure and take the
 * records they are told to decode, so a range is paired with a buffer of exactly that many.
 */
function entryPoints({
  recording,
  wholeFile,
}: Fixture): ReadonlyArray<readonly [string, (records: RecordRange) => unknown]> {
  const { header } = recording;
  const bytesFor = (records: RecordRange): Uint8Array =>
    wholeFile.subarray(0, Math.max(0, Math.round(records.count)) * header.recordByteLength);

  return [
    ['readRecordBytes', (records) => readRecordBytes(recording.source, header, records)],
    ['readRecords', (records) => readRecords(recording, { records, signalIndices: [0] })],
    ['readAnnotations', (records) => readAnnotations(recording, records)],
    ['decodeDigital', (records) => decodeDigital(header, bytesFor(records), records, 0)],
    ['decodeAnnotations', (records) => decodeAnnotations(header, bytesFor(records), records)],
  ];
}

async function thrownBy(call: () => unknown): Promise<unknown> {
  return Promise.resolve()
    .then(call)
    .then(
      () => undefined,
      (error: unknown) => error,
    );
}

describe('the five entry points', () => {
  it('all accept the whole file, so the fixture is not the reason they agree', async () => {
    const state = await fixture();
    for (const [name, drive] of entryPoints(state)) {
      await expect(
        Promise.resolve(drive({ start: 0, count: RECORD_COUNT })),
        name,
      ).resolves.toBeDefined();
    }
  });
});

describe.each(REFUSED)('%s', (_name, records) => {
  it('is an EdfRangeError at every one of them', async () => {
    const state = await fixture();
    for (const [name, drive] of entryPoints(state)) {
      const thrown = await thrownBy(() => drive(records));
      expect(thrown, name).toBeInstanceOf(EdfRangeError);
      // An EdfError: the range is checked against what the FILE declares.
      expect(isEdfError(thrown), name).toBe(true);
      expect((thrown as Error).message, name).toMatch(/Next:/);
    }
  });

  it('carries the same requested and available ranges at every one of them', async () => {
    const state = await fixture();
    const seen: string[] = [];
    for (const [name, drive] of entryPoints(state)) {
      const error = (await thrownBy(() => drive(records))) as EdfRangeError;
      expect(error.requested, name).toEqual(records);
      expect(error.available.start, name).toBe(0);
      expect(error.available.count, name).toBe(RECORD_COUNT);
      seen.push(JSON.stringify({ requested: error.requested, available: error.available }));
    }
    expect(new Set(seen).size).toBe(1);
  });
});

describe('a range of zero records', () => {
  it('is accepted at every one of them', async () => {
    const state = await fixture();
    for (const [name, drive] of entryPoints(state)) {
      await expect(Promise.resolve(drive({ start: 0, count: 0 })), name).resolves.toBeDefined();
    }
  });

  it('reads nothing and decodes nothing', async () => {
    const { recording } = await fixture();
    const bytes = await readRecordBytes(recording.source, recording.header, {
      start: 0,
      count: 0,
    });
    expect(bytes).toHaveLength(0);
    const chunk = await readRecords(recording, {
      records: { start: 0, count: 0 },
      signalIndices: [0],
    });
    expect(chunk.byteLength).toBe(0);
    expect(chunk.signals[0]?.sampleCount).toBe(0);
  });

  it('is accepted even at the end of the file, where a count of one would not be', async () => {
    const state = await fixture();
    for (const [name, drive] of entryPoints(state)) {
      await expect(
        Promise.resolve(drive({ start: RECORD_COUNT, count: 0 })),
        name,
      ).resolves.toBeDefined();
      expect(await thrownBy(() => drive({ start: RECORD_COUNT, count: 1 })), name).toBeInstanceOf(
        EdfRangeError,
      );
    }
  });
});

describe('the second check the decoders make', () => {
  it('refuses a buffer that does not hold the records the range names', async () => {
    const { recording, wholeFile } = await fixture();
    const { header } = recording;
    const twoRecords = wholeFile.subarray(0, 2 * header.recordByteLength);
    const range = { start: 0, count: 4 } as const;

    for (const [name, drive] of [
      ['decodeDigital', () => decodeDigital(header, twoRecords, range, 0)],
      ['decodeAnnotations', () => decodeAnnotations(header, twoRecords, range)],
    ] as const) {
      const thrown = await thrownBy(drive);
      expect(thrown, name).toBeInstanceOf(EdfRangeError);
      expect((thrown as Error).message, name).toContain('recordBytes');
    }
  });

  it('is about the bytes rather than the file, so the same range reads fine', async () => {
    const { recording } = await fixture();
    await expect(
      readRecordBytes(recording.source, recording.header, { start: 0, count: 4 }),
    ).resolves.toHaveLength(4 * recording.header.recordByteLength);
  });
});
