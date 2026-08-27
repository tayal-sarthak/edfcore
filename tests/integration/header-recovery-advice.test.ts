/**
 * Four recovery diagnostics that tell you what a READ will do, checked by reading.
 *
 * When the header's own numbers disagree with the file, `parseHeader` recovers rather than
 * refuses, and each recovery ends its message with the consequence: which byte the first data
 * record is read at, which records exist, which bytes are never decoded. Those sentences are the
 * whole value of the diagnostic — a caller who has been told the file is odd needs to know what
 * they are now holding — and every one of them is a claim about `decodeDigital` output made in a
 * module that never calls it.
 *
 * The existing tests check the header fields the sentences mention: `headerByteLength`,
 * `recordCount`, `dataByteLength`. That is one step short. A file whose declared header size is
 * 512 where the computed size is 1024 has a right-looking `recordCount` under either reading,
 * because the arithmetic that produced it used the same size the reader would; what separates
 * them is which 1024 bytes come back as record 0. So this reads the samples.
 *
 * Every fixture writes its real samples as a ramp and its unreachable bytes — a truncated tail,
 * bytes past the declared records, the header block itself — as 0x7F, which decodes to 32639 and
 * to -1 in 24-bit BDF. Neither is a value the ramp produces, so "never decoded" is checked by
 * looking for it rather than by trusting an offset.
 *
 * What this does NOT check: which diagnostic fires, its severity, its byte offsets, or its
 * wording. Those are `parse.test.ts`. This is only the last sentence of each.
 */

import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../src/decode/digital.js';
import { EdfRangeError } from '../../src/errors.js';
import { parseHeader } from '../../src/header/parse.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import type { EdfHeader, RecordRange } from '../../src/types.js';
import { appendBytes, truncateBy } from '../support/corrupt.js';
import { buildEdf, type EdfSpec } from '../support/writer.js';

/** 0x7F everywhere reads as 32639 in EDF, which the ramp below never produces. */
const UNREACHABLE_BYTE = 0x7f;
const UNREACHABLE_SAMPLE = 32639;

const CLEAN_DATES = { startDate: '01.01.01', startTime: '00.00.00' } as const;

/** Record r, sample k, as a value unique to the pair and far from `UNREACHABLE_SAMPLE`. */
const ramp = (recordIndex: number, sampleIndex: number): number => recordIndex * 10 + sampleIndex;

function fileOf(overrides: Partial<EdfSpec> = {}): Uint8Array {
  return buildEdf({
    recordCount: 2,
    recordDurationSeconds: 1,
    raw: CLEAN_DATES,
    signals: [
      { label: 'Fp1', samplesPerRecord: 4, sample: ramp },
      { label: 'Fp2', samplesPerRecord: 4, sample: ramp },
      { label: 'Fpz', samplesPerRecord: 4, sample: ramp },
    ],
    ...overrides,
  });
}

async function samplesOf(
  bytes: Uint8Array,
  header: EdfHeader,
  records: RecordRange,
): Promise<number[]> {
  const recordBytes = await readRecordBytes(byteSource(bytes), header, records);
  const out: number[] = [];
  for (let signalIndex = 0; signalIndex < header.signals.length; signalIndex += 1) {
    out.push(...decodeDigital(header, recordBytes, records, signalIndex));
  }
  return out;
}

describe('HEADER_SIZE_MISMATCH: "the first data record is read at byte N"', () => {
  // Three signals, so the computed header is 1024 bytes and the declared 512 lands in the middle
  // of the per-signal block — a plausible-looking wrong answer rather than an obviously wrong one.
  const bytes = fileOf({ raw: { ...CLEAN_DATES, headerByteLength: '512' } });
  const header = parseHeader(bytes, bytes.byteLength);

  it('reads record 0 from the computed byte, not the declared one', async () => {
    expect(header.headerByteLength).toBe(1024);
    expect(header.declaredHeaderByteLength).toBe(512);

    const samples = await samplesOf(bytes, header, { start: 0, count: 1 });
    expect(samples).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
  });

  it('would have returned header bytes had the declared size won, so the check is not vacuous', () => {
    // The 1024 bytes at the DECLARED offset are the second half of the per-signal header block.
    // Reading them as samples is exactly the failure the recovery avoids, and it produces numbers
    // rather than an error — which is why the message says which byte it used.
    const asIfDeclared = { ...header, headerByteLength: 512 } as EdfHeader;
    const wrong = decodeDigital(
      asIfDeclared,
      bytes.subarray(512, 512 + header.recordByteLength),
      { start: 0, count: 1 },
      0,
    );
    expect(Array.from(wrong)).not.toEqual([0, 1, 2, 3]);
  });
});

describe('TRAILING_BYTES: "those bytes are never decoded"', () => {
  const clean = fileOf();
  const reference = parseHeader(clean, clean.byteLength);
  const bytes = appendBytes(
    clean,
    new Uint8Array(reference.recordByteLength).fill(UNREACHABLE_BYTE),
  );
  const header = parseHeader(bytes, bytes.byteLength);

  it('counts only the declared records', () => {
    expect(header.recordCount).toBe(2);
    expect(header.dataByteLength).toBe(2 * header.recordByteLength);
  });

  it('decodes no sample from them, across every record the file admits to', async () => {
    const samples = await samplesOf(bytes, header, { start: 0, count: header.recordCount });
    expect(samples).not.toContain(UNREACHABLE_SAMPLE);
  });

  it('refuses to reach them by record number rather than returning them', async () => {
    await expect(
      readRecordBytes(byteSource(bytes), header, { start: 2, count: 1 }),
    ).rejects.toThrow(EdfRangeError);
  });
});

describe('PARTIAL_FINAL_RECORD: "edfcore never zero-pads a record into existence"', () => {
  // Half of record 1 cut off, then the surviving half overwritten with the unreachable byte: the
  // fragment is both incomplete AND full of a value the ramp never writes, so a reader that
  // padded it would return samples that are visibly not the file's.
  const clean = fileOf();
  const reference = parseHeader(clean, clean.byteLength);
  const truncated = truncateBy(clean, Math.floor(reference.recordByteLength / 2));
  const bytes = Uint8Array.from(truncated);
  bytes.fill(UNREACHABLE_BYTE, clean.byteLength - reference.recordByteLength);
  const header = parseHeader(bytes, bytes.byteLength);

  it('exposes only the whole records', () => {
    expect(header.recordCount).toBe(1);
    expect(header.dataByteLength).toBe(header.recordByteLength);
  });

  it('decodes nothing from the fragment', async () => {
    const samples = await samplesOf(bytes, header, { start: 0, count: header.recordCount });
    expect(samples).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
    expect(samples).not.toContain(UNREACHABLE_SAMPLE);
  });

  it('refuses the fragment by record number instead of padding it', async () => {
    await expect(
      readRecordBytes(byteSource(bytes), header, { start: 1, count: 1 }),
    ).rejects.toThrow(EdfRangeError);
  });
});

describe('TRUNCATED_FILE: "the missing records are not readable, and edfcore will not fabricate them"', () => {
  // Declares four records and carries two. The two that exist read exactly as they do in the
  // clean file; the two that do not are refused rather than zero-filled.
  const clean = fileOf({ recordCount: 4 });
  const reference = parseHeader(clean, clean.byteLength);
  const bytes = truncateBy(clean, 2 * reference.recordByteLength);
  const header = parseHeader(bytes, bytes.byteLength);

  it('keeps the records that survived, unchanged', async () => {
    expect(header.recordCount).toBe(2);
    expect(header.recordCountSource).toBe('sourceByteLength');
    expect(header.declaredRecordCount).toBe(4);

    // Two records of four samples, for each of the three signals: `samplesOf` decodes the
    // signals in order, so the surviving pair of records appears once per channel.
    const samples = await samplesOf(bytes, header, { start: 0, count: 2 });
    expect(samples).toEqual([
      0, 1, 2, 3, 10, 11, 12, 13, 0, 1, 2, 3, 10, 11, 12, 13, 0, 1, 2, 3, 10, 11, 12, 13,
    ]);
  });

  it('refuses the records the header claimed and the file does not hold', async () => {
    await expect(
      readRecordBytes(byteSource(bytes), header, { start: 2, count: 2 }),
    ).rejects.toThrow(EdfRangeError);
  });
});
