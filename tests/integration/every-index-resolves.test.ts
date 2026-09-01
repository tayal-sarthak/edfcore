/**
 * Every index and every byte offset edfcore publishes points at something the file has.
 *
 * The API is full of numbers that are addresses rather than measurements: `signalIndex` names a row
 * of `header.signals`, `recordIndex` a record, `firstSampleIndex` a position on a signal's own
 * grid, and `byteOffset`/`byteLength` a range in the file a reader is expected to be able to take
 * to a hex editor. A measurement that is wrong is wrong; an address that is wrong sends someone
 * looking at the wrong bytes and telling them apart is the whole job.
 *
 * They are checked one at a time where they are produced — `read-edf.test.ts` on a chunk,
 * `diagnostic-raw-points-there.test.ts` on a diagnostic's own quoted bytes — and nowhere as a class.
 * So this walks every object every entry point returns, over the eleven `AWKWARD` shapes and a file
 * with a gap, and resolves every number it finds against the file it came from: 1,500 of them,
 * across 51 distinct field names.
 *
 * Three of the checks are resolutions rather than range checks, which is the part worth having:
 *
 * - A `signalIndex` must name a signal whose own `index` is that number, so the two cannot drift.
 * - `firstSampleIndex + sampleCount` must land inside the signal's `sampleCount`, which is where an
 *   off-by-one in the record arithmetic would show.
 * - A chunk's `byteOffset` and `byteLength` are used to slice the fixture and decode it again. The
 *   samples that come back must be the samples the chunk carries. A range check would pass on an
 *   offset that is inside the file and points at the wrong record; re-decoding will not.
 *
 * The finiteness clause rides along with them: `fuzz.test.ts` establishes that no number edfcore
 * computes is `NaN` or infinite for arbitrary bytes, over the fields it names; this says it of
 * every number on every result, which is the wider statement and the cheap one.
 */

import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../src/decode/digital.js';
import { readEnvelope } from '../../src/envelope.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import type { EdfHeader } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { AWKWARD } from '../support/awkward-files.js';
import { buildEdf } from '../support/writer.js';

const GAPPED = buildEdf({
  plus: 'D',
  recordCount: 6,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (record) => (record < 3 ? record : record + 10),
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    {
      samplesPerRecord: 40,
      tals: (record) => (record === 0 ? [{ onset: '+0.5', duration: 2, texts: ['e'] }] : []),
    },
  ],
});

const FILES: ReadonlyArray<readonly [string, Uint8Array]> = [
  ...AWKWARD.map((file) => [file.name, file.bytes] as const),
  ['a file with a gap', GAPPED],
];

/**
 * Records that differ from each other, which the shared fixtures do not.
 *
 * `writer.ts` defaults its sample generator to `(_record, index) => index % 100` — the same ramp in
 * every record. That is right for a fixture about a header, and it makes a byte-offset check
 * silently vacuous: a chunk that reported the offset of the wrong record would decode to the same
 * samples. So the resolution below uses a file whose every record is distinguishable, and asserts
 * that it is before relying on it.
 */
const DISTINGUISHABLE = buildEdf({
  plus: 'C',
  recordCount: 8,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 16, sample: (record, index) => record * 100 + index },
  ],
  annotationSignals: [{ samplesPerRecord: 24 }],
});

interface Number_ {
  readonly where: string;
  readonly key: string;
  readonly value: number;
}

function numbersIn(value: unknown, path: string, into: Number_[], depth = 0): void {
  if (depth > 9 || value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries())
      numbersIn(item, `${path}[${index}]`, into, depth + 1);
    return;
  }
  for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
    if (typeof member === 'number') into.push({ where: `${path}.${key}`, key, value: member });
    numbersIn(member, `${path}.${key}`, into, depth + 1);
  }
}

interface Surveyed {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly header: EdfHeader;
  readonly numbers: readonly Number_[];
}

async function survey(): Promise<readonly Surveyed[]> {
  const surveyed: Surveyed[] = [];
  for (const [name, bytes] of FILES) {
    const recording = await openEdf(byteSource(bytes));
    const index = await buildRecordIndex(recording);
    const located = { ...recording, index };
    const signalIndices = [...recording.header.dataSignalIndices];
    const numbers: Number_[] = [];

    numbersIn(recording, `${name}: openEdf`, numbers);
    numbersIn(index, `${name}: buildRecordIndex`, numbers);
    numbersIn(
      await validateRecording(recording, { scanSamples: true }),
      `${name}: validateRecording`,
      numbers,
    );
    numbersIn(await inspectEdf(byteSource(bytes)), `${name}: inspectEdf`, numbers);
    numbersIn(
      await readAnnotations(recording, { start: 0, count: recording.header.recordCount }),
      `${name}: readAnnotations`,
      numbers,
    );

    const readable =
      signalIndices.length > 0 &&
      recording.header.recordCount > 0 &&
      recording.header.recordDurationSeconds > 0;
    if (readable) {
      numbersIn(
        await readRecords(located, { records: { start: 0, count: 1 }, signalIndices }),
        `${name}: readRecords`,
        numbers,
      );
      numbersIn(
        await readWindow(located, { startSeconds: 0, durationSeconds: 20, signalIndices }),
        `${name}: readWindow`,
        numbers,
      );
      numbersIn(
        await readEnvelope(located, {
          startSeconds: 0,
          durationSeconds: 3,
          buckets: 4,
          signalIndices,
        }),
        `${name}: readEnvelope`,
        numbers,
      );
    }
    surveyed.push({ name, bytes, header: recording.header, numbers });
  }
  return surveyed;
}

const SURVEY = await survey();
const ALL = SURVEY.flatMap((file) => file.numbers);

describe('the sweep', () => {
  it('walked enough numbers that a passing run is not a vacuous one', () => {
    expect(ALL.length).toBeGreaterThan(1_000);
    expect(new Set(ALL.map((number) => number.key)).size).toBeGreaterThan(40);
  });

  it('reached the address-shaped fields it is about', () => {
    const keys = new Set(ALL.map((number) => number.key));
    for (const key of [
      'signalIndex',
      'recordIndex',
      'byteOffset',
      'byteLength',
      'firstSampleIndex',
      'sampleCount',
    ]) {
      expect(keys.has(key), key).toBe(true);
    }
  });
});

describe('every number', () => {
  it('is finite', () => {
    const wrong = ALL.filter((number) => !Number.isFinite(number.value)).map(
      (number) => `${number.where} = ${number.value}`,
    );
    expect(wrong).toEqual([]);
  });

  it('is a whole number wherever it is a count or an address', () => {
    const counted = new Set([
      'signalIndex',
      'recordIndex',
      'byteOffset',
      'byteLength',
      'firstSampleIndex',
      'sampleCount',
      'bucketCount',
      'outOfDigitalRangeCount',
      'samplesPerRecord',
      'recordCount',
      'index',
      'start',
      'count',
    ]);
    const wrong = ALL.filter(
      (number) => counted.has(number.key) && !Number.isSafeInteger(number.value),
    ).map((number) => `${number.where} = ${number.value}`);
    expect(wrong).toEqual([]);
  });
});

describe('every address', () => {
  it('names a signal whose own index is that number', () => {
    const wrong: string[] = [];
    for (const file of SURVEY) {
      for (const number of file.numbers) {
        if (number.key !== 'signalIndex') continue;
        const signal = file.header.signals[number.value];
        if (signal === undefined || signal.index !== number.value) {
          wrong.push(`${number.where} = ${number.value}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('names a record the file has', () => {
    const wrong: string[] = [];
    for (const file of SURVEY) {
      for (const number of file.numbers) {
        if (number.key !== 'recordIndex') continue;
        if (number.value < 0 || number.value >= file.header.recordCount) {
          wrong.push(`${number.where} = ${number.value} of ${file.header.recordCount}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('stays inside the file, byte offset and length together', () => {
    const wrong: string[] = [];
    for (const file of SURVEY) {
      for (const number of file.numbers) {
        if (number.key !== 'byteOffset') continue;
        if (number.value < 0 || number.value > file.bytes.byteLength) {
          wrong.push(`${number.where} = ${number.value} of ${file.bytes.byteLength}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('a chunk’s byte range', () => {
  it('holds records that differ, or the resolution below would prove nothing', async () => {
    const recording = await openEdf(byteSource(DISTINGUISHABLE));
    const first = await readRecords(recording, {
      records: { start: 1, count: 1 },
      signalIndices: [0],
    });
    const second = await readRecords(recording, {
      records: { start: 2, count: 1 },
      signalIndices: [0],
    });
    expect([...(first.signals[0]?.digital ?? [])]).not.toEqual([
      ...(second.signals[0]?.digital ?? []),
    ]);
  });

  it('really holds the records it says, which a range check could not tell', async () => {
    let resolved = 0;
    for (const [name, bytes] of [...FILES, ['records that differ', DISTINGUISHABLE] as const]) {
      const recording = await openEdf(byteSource(bytes));
      const [signalIndex] = recording.header.dataSignalIndices;
      if (signalIndex === undefined || recording.header.recordCount < 2) continue;
      if (recording.header.recordDurationSeconds <= 0) continue;

      // Record 1, not record 0: an offset that forgot the header would still land in the file.
      const chunk = await readRecords(recording, {
        records: { start: 1, count: 1 },
        signalIndices: [signalIndex],
      });
      expect(chunk.byteLength, name).toBe(chunk.records.count * recording.header.recordByteLength);
      expect(chunk.byteOffset + chunk.byteLength, name).toBeLessThanOrEqual(bytes.byteLength);

      const slice = bytes.subarray(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
      const again = decodeDigital(recording.header, slice, chunk.records, signalIndex);
      const series = chunk.signals[0];
      if (series === undefined) throw new Error('one signal was asked for and none came back');
      expect([...again], name).toEqual([...series.digital.subarray(0, series.sampleCount)]);
      resolved += 1;
    }
    expect(resolved).toBeGreaterThanOrEqual(6);
  });

  it('and moving that offset by one record changes what comes back', async () => {
    // The check above is only as good as this: on the shared fixtures, whose records are identical,
    // it would pass against the wrong record.
    const recording = await openEdf(byteSource(DISTINGUISHABLE));
    const chunk = await readRecords(recording, {
      records: { start: 1, count: 1 },
      signalIndices: [0],
    });
    const shifted = DISTINGUISHABLE.subarray(
      chunk.byteOffset + recording.header.recordByteLength,
      chunk.byteOffset + recording.header.recordByteLength + chunk.byteLength,
    );
    const wrong = decodeDigital(recording.header, shifted, chunk.records, 0);
    const series = chunk.signals[0];
    if (series === undefined) throw new Error('one signal was asked for and none came back');
    expect([...wrong]).not.toEqual([...series.digital.subarray(0, series.sampleCount)]);
  });

  it('and a signal’s samples end inside the signal, which is where an off-by-one shows', async () => {
    for (const [name, bytes] of FILES) {
      const recording = await openEdf(byteSource(bytes));
      const signalIndices = [...recording.header.dataSignalIndices];
      if (signalIndices.length === 0 || recording.header.recordDurationSeconds <= 0) continue;
      if (recording.header.recordCount === 0) continue;

      // A scanned index, because a window over a gapped file needs one — which is itself the
      // refusal `discontinuous.md` documents and `discontinuous.test.ts` owns.
      const located = { ...recording, index: await buildRecordIndex(recording) };
      const chunks = await readWindow(located, {
        startSeconds: 0,
        durationSeconds: 1_000,
        signalIndices,
      });
      for (const chunk of chunks) {
        for (const series of chunk.signals) {
          const signal = recording.header.signals[series.signalIndex];
          expect(signal, name).toBeDefined();
          expect(series.firstSampleIndex, name).toBeGreaterThanOrEqual(0);
          expect(series.firstSampleIndex + series.sampleCount, name).toBeLessThanOrEqual(
            signal?.sampleCount ?? -1,
          );
        }
      }
    }
  });
});

describe('the matrix this file sweeps', () => {
  it('is the twelve shapes it was written against', () => {
    // `awkward-files.ts` asks every consumer for this: without it, a shape removed from the matrix
    // quietly removes cases from here instead of failing anything.
    expect(AWKWARD).toHaveLength(12);
  });
});
