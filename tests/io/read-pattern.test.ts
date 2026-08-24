/**
 * The READ PATTERN — edfcore's central claim, and the one thing a unit test on a small fixture
 * cannot demonstrate.
 *
 * "edfcore does bounded random access rather than quietly reading whole files" is unfalsifiable
 * on a 4 KB fixture: that file loads entirely however careless the code is. The only way to test
 * the claim is to wrap the `ByteSource` in a spy and assert *which ranges were requested* — how
 * many, at what offsets, for how many bytes, and how far into the file the highest one reached.
 * Every assertion below is on `spy.reads` / `spy.bytesRead` / `spy.maxOffsetTouched`, never on
 * elapsed time, and never on a byte count alone (a single read of the whole file has a perfectly
 * respectable read count).
 *
 * The design promises pinned here, all from DESIGN section 3 and decision 7:
 *
 * - `readHeader` costs EXACTLY two reads: 256 bytes, then the remaining `256 * ns` as one range.
 * - `readRecordBytes` costs EXACTLY one read: one contiguous range covering ALL signals.
 * - `openEdf` never scans: zero record probes on a plain EDF, at most two on an EDF+/BDF+.
 * - `index.locate()` costs O(log recordCount) probes, and memoises what it read.
 * - `buildRecordIndex()` is the only full traversal, it chunks to the materialisation budget,
 *   and it reports progress.
 * - There is NO cheap single-channel read, and `EdfChunk.byteLength` says so out loud.
 *
 * The large fixtures are built once per file and are several megabytes each, because a fraction
 * only means something against a file that would hurt to read.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { parseHeader } from '../../src/header/parse.js';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader, readRecordBytes } from '../../src/io/read.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import type { EdfChunk, EdfRecording } from '../../src/types.js';
import { setHeaderField } from '../support/corrupt.js';
import { type SpySource, spySource } from '../support/spy-source.js';
import { buildEdf, minimalEdf, minimalEdfPlus, type SignalSpec } from '../support/writer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The recorded ranges without the sequence number, which `toEqual` order already pins. */
function rangesOf(spy: SpySource): Array<{ offset: number; length: number }> {
  return spy.reads.map((read) => ({ offset: read.offset, length: read.length }));
}

/** The single element of a one-element array, keeping `noUncheckedIndexedAccess` on. */
function only<T>(items: readonly T[]): T {
  expect(items).toHaveLength(1);
  const item = items[0];
  if (item === undefined) throw new Error('unreachable: the length was asserted above');
  return item;
}

async function openSpied(bytes: Uint8Array): Promise<{ recording: EdfRecording; spy: SpySource }> {
  const spy = spySource(byteSource(bytes));
  const recording = await openEdf(spy);
  return { recording, spy };
}

// ---------------------------------------------------------------------------
// Fixtures
//
// Sample VALUES are irrelevant to a read-pattern test, so the huge files use a constant
// sampler: it keeps building a 30 MB fixture at ~110 ms instead of ~680 ms for a sine.
// ---------------------------------------------------------------------------

const LARGE_SIGNAL_COUNT = 30;
const LARGE_SAMPLES_PER_RECORD = 256; // 256 Hz at a 1 s record
const LARGE_RECORD_COUNT = 2048;

/** 30 channels x 256 samples x 2 bytes. */
const LARGE_RECORD_BYTES = 2 * LARGE_SIGNAL_COUNT * LARGE_SAMPLES_PER_RECORD; // 15,360
/** 256 * (30 + 1). */
const LARGE_HEADER_BYTES = 256 * (LARGE_SIGNAL_COUNT + 1); // 7,936
const LARGE_FILE_BYTES = LARGE_HEADER_BYTES + LARGE_RECORD_COUNT * LARGE_RECORD_BYTES; // 31,465,216

function largeSignals(): SignalSpec[] {
  return Array.from({ length: LARGE_SIGNAL_COUNT }, (_, index) => ({
    label: `EEG ${index}`,
    samplesPerRecord: LARGE_SAMPLES_PER_RECORD,
    sample: () => 0,
  }));
}

let largeEdfCache: Uint8Array | undefined;
/** A 31,465,216-byte plain EDF: 30 signals, 256 Hz, 2048 one-second records. */
function largeEdf(): Uint8Array {
  largeEdfCache ??= buildEdf({
    signals: largeSignals(),
    recordCount: LARGE_RECORD_COUNT,
    recordDurationSeconds: 1,
  });
  return largeEdfCache;
}

let largeEdfPlusCache: Uint8Array | undefined;
/** The same geometry as an EDF+C, so every record carries a timekeeping TAL to probe. */
function largeEdfPlus(): Uint8Array {
  largeEdfPlusCache ??= buildEdf({
    plus: 'C',
    signals: largeSignals(),
    annotationSignals: [{ samplesPerRecord: 30 }],
    recordCount: LARGE_RECORD_COUNT,
    recordDurationSeconds: 1,
  });
  return largeEdfPlusCache;
}

const D_RECORD_COUNT = 4096;
const D_SEGMENT_RECORDS = 512;
const D_GAP_SECONDS = 60;
const D_RECORD_BYTES = 2 * (10 + 30); // one 10-sample signal + a 30-sample annotation region

/** Record `r`'s on-disk onset: eight 512-second segments, an hour-hand minute apart. */
function discontinuousOnset(recordIndex: number): number {
  return recordIndex + D_GAP_SECONDS * Math.floor(recordIndex / D_SEGMENT_RECORDS);
}

let largeEdfPlusDCache: Uint8Array | undefined;
/**
 * A genuine EDF+D with 4096 records in 8 segments — `locate()` needs a lot of RECORDS to say
 * anything about O(log n), not a lot of bytes, so this one stays at 328 KB.
 */
function largeEdfPlusD(): Uint8Array {
  largeEdfPlusDCache ??= buildEdf({
    plus: 'D',
    signals: [{ label: 'Fp1', samplesPerRecord: 10, sample: () => 0 }],
    annotationSignals: [{ samplesPerRecord: 30 }],
    recordCount: D_RECORD_COUNT,
    recordDurationSeconds: 1,
    recordOnsetSeconds: discontinuousOnset,
  });
  return largeEdfPlusDCache;
}

/*
 * Built once, and paid for somewhere that is allowed to take time.
 *
 * All three builders memoise, so only the first caller pays — but "the first caller" is a test
 * body with the default five-second budget, and constructing 31 MB of records inside it is most of
 * that budget on an idle machine and more than it on a loaded one. The two tests that happen to
 * ask first, one per fixture, then fail on a timeout that has nothing to do with what they assert:
 * both were seen failing under coverage instrumentation while the same run passed without it.
 *
 * This is what 0.4.417 and 0.4.418 did for `spec-references.test.ts`, in that order and for the
 * same reason — memoising alone moves the cost to whichever test runs first, and a `beforeAll` is
 * where a cost that belongs to the file rather than to one case is supposed to sit.
 */
beforeAll(() => {
  largeEdf();
  largeEdfPlus();
  largeEdfPlusD();
}, 120_000);

// ---------------------------------------------------------------------------
// readHeader: exactly two reads
// ---------------------------------------------------------------------------

describe('readHeader costs exactly two reads, whatever the signal count', () => {
  // DESIGN section 3: "Exactly 2 source reads: 256 bytes, then the remaining 256*ns."
  // The fixed header must be read before the per-signal block can be SIZED, and the size is
  // 256*(ns+1) computed — never the header-bytes field at offset 184, which the file may lie
  // about (EDF spec, header record bytes 184-191; HEADER_SIZE_MISMATCH).
  const cases = [1, 3, 30, 64];

  for (const signalCount of cases) {
    it(`asks for 256 bytes at 0 then ${256 * signalCount} bytes at 256 for ${signalCount} signals`, async () => {
      const bytes = buildEdf({
        signals: Array.from({ length: signalCount }, (_, index) => ({
          label: `S${index}`,
          samplesPerRecord: 4,
        })),
        recordCount: 3,
      });
      const spy = spySource(byteSource(bytes));

      const header = await readHeader(spy);

      expect(rangesOf(spy)).toEqual([
        { offset: 0, length: 256 },
        { offset: 256, length: 256 * signalCount },
      ]);
      expect(header.headerByteLength).toBe(256 * (signalCount + 1));
      expect(spy.bytesRead).toBe(256 * (signalCount + 1));
    });
  }

  it('reads the per-signal block as ONE range, never one read per signal', async () => {
    // 64 signals is 64 blocks of 256 bytes. A reader that walked them would issue 64 reads and
    // 64 HTTP requests; the second range below is a single 16,384-byte ask.
    const bytes = buildEdf({
      signals: Array.from({ length: 64 }, (_, index) => ({
        label: `S${index}`,
        samplesPerRecord: 2,
      })),
      recordCount: 1,
    });
    const spy = spySource(byteSource(bytes));

    await readHeader(spy);

    expect(spy.reads).toHaveLength(2);
    expect(only(spy.reads.slice(1))).toMatchObject({ offset: 256, length: 16_384 });
  });

  it('never reads past the header, even for a file whose data dwarfs it', async () => {
    const spy = spySource(byteSource(largeEdf()));

    await readHeader(spy);

    // The last header byte is 7,935; the file is 31,465,216 bytes long.
    expect(spy.maxOffsetTouched).toBe(LARGE_HEADER_BYTES - 1);
    expect(spy.bytesRead).toBe(LARGE_HEADER_BYTES);
  });

  it('skips the second read rather than guessing when the signal count does not parse', async () => {
    // `signalCountHint` is a PREFETCH HINT only: with nothing trustworthy to size the second
    // read with, readHeader hands parseHeader the 256 bytes it has so the right diagnostic is
    // produced. EDF spec, header record bytes 252-255: ns is 1..9999.
    const spy = spySource(byteSource(setHeaderField(minimalEdf(), 'signalCount', '')));

    await expect(readHeader(spy)).rejects.toMatchObject({ code: 'SIGNAL_COUNT_INVALID' });
    expect(rangesOf(spy)).toEqual([{ offset: 0, length: 256 }]);
  });
});

// ---------------------------------------------------------------------------
// readRecordBytes: exactly one contiguous read
// ---------------------------------------------------------------------------

describe('readRecordBytes costs exactly one contiguous read covering every signal', () => {
  // DESIGN decision 7: "The unit of I/O is the record range, never the channel range. One
  // contiguous read() per window; de-interleave in memory."
  const spr = [256, 128, 1, 64];
  const recordByteLength = 2 * (256 + 128 + 1 + 64); // 898
  const headerByteLength = 256 * (spr.length + 1); // 1,280

  function mixedRateEdf(): Uint8Array {
    return buildEdf({
      signals: spr.map((samplesPerRecord, index) => ({
        label: `S${index}`,
        samplesPerRecord,
      })),
      recordCount: 12,
      recordDurationSeconds: 1,
    });
  }

  const cases = [
    { name: 'the first record alone', records: { start: 0, count: 1 } },
    { name: 'a range in the middle', records: { start: 3, count: 5 } },
    { name: 'the last record alone', records: { start: 11, count: 1 } },
    { name: 'every record in the file', records: { start: 0, count: 12 } },
  ];

  for (const testCase of cases) {
    it(`issues one read for ${testCase.name}`, async () => {
      const bytes = mixedRateEdf();
      const spy = spySource(byteSource(bytes));
      const header = await readHeader(spy);
      spy.reset();

      const got = await readRecordBytes(spy, header, testCase.records);

      const expectedOffset = headerByteLength + testCase.records.start * recordByteLength;
      const expectedLength = testCase.records.count * recordByteLength;
      expect(rangesOf(spy)).toEqual([{ offset: expectedOffset, length: expectedLength }]);
      expect(got.length).toBe(expectedLength);
      // The bytes are the file's own, unsliced and unshuffled: decodeDigital addresses signal i
      // at recordByteOffset[i] inside each record, so the buffer must start at records.start.
      expect(Array.from(got.subarray(0, 32))).toEqual(
        Array.from(bytes.subarray(expectedOffset, expectedOffset + 32)),
      );
    });
  }

  it('covers every signal in that one range, so no per-channel read is ever issued', async () => {
    const bytes = mixedRateEdf();
    const spy = spySource(byteSource(bytes));
    const header = await readHeader(spy);
    spy.reset();

    await readRecordBytes(spy, header, { start: 2, count: 4 });

    // 898 bytes per record is the sum over ALL four signals; the widest single signal is
    // 512 bytes. One read of 3,592 bytes, not four reads of one channel's stripes.
    expect(header.recordByteLength).toBe(recordByteLength);
    expect(only(spy.reads).length).toBe(4 * recordByteLength);
    expect(spy.bytesRead).toBe(3_592);
  });

  it('issues no read at all for a zero-record range', async () => {
    // A zero-length HTTP range is not expressible (`bytes=n--1`) and there is nothing to fetch.
    const bytes = minimalEdf();
    const spy = spySource(byteSource(bytes));
    const header = await readHeader(spy);
    spy.reset();

    const got = await readRecordBytes(spy, header, { start: 1, count: 0 });

    expect(got.length).toBe(0);
    expect(spy.reads).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A window on a large file
// ---------------------------------------------------------------------------

describe('a ten-second window on a 31 MB file reads half a percent of it', () => {
  it('issues one read of 153,600 bytes and never touches the far end of the file', async () => {
    // MEASURED, and the numbers are the whole point of this test:
    //   file            31,465,216 B  (30 signals x 256 Hz x 2048 one-second records)
    //   header               7,936 B
    //   record              15,360 B
    //   window [30, 40)  -> records { start: 30, count: 10 }
    //   read            153,600 B at offset 468,736   =  0.488 % of the file
    //   maxOffsetTouched   622,335       = 1.98 % of the way in; the last byte is 31,465,215
    const { recording, spy } = await openSpied(largeEdf());
    spy.reset();

    const chunks = await readWindow(recording, {
      startSeconds: 30,
      durationSeconds: 10,
      signalIndices: recording.header.dataSignalIndices,
    });

    expect(recording.header.recordByteLength).toBe(LARGE_RECORD_BYTES);
    expect(spy.byteLength).toBe(LARGE_FILE_BYTES);
    expect(rangesOf(spy)).toEqual([{ offset: 468_736, length: 153_600 }]);
    expect(spy.bytesRead).toBe(153_600);
    expect(spy.bytesRead / LARGE_FILE_BYTES).toBeLessThan(0.01);

    // The final byte is what a whole-file reader cannot avoid, so it is the sharpest witness.
    expect(spy.maxOffsetTouched).toBe(622_335);
    expect(spy.maxOffsetTouched).toBeLessThan(LARGE_FILE_BYTES - 1);

    const chunk = only(chunks);
    expect(chunk.records).toEqual({ start: 30, count: 10 });
    expect(chunk.byteOffset).toBe(468_736);
    expect(chunk.byteLength).toBe(153_600);
  });

  it('costs the same one read whether the window is at the start or near the end', async () => {
    // Random access, not a scan: the last ten seconds must not cost more than the first ten.
    const { recording, spy } = await openSpied(largeEdf());

    for (const startSeconds of [0, 1000, LARGE_RECORD_COUNT - 10]) {
      spy.reset();
      await readWindow(recording, {
        startSeconds,
        durationSeconds: 10,
        signalIndices: recording.header.dataSignalIndices,
      });
      expect(spy.reads).toHaveLength(1);
      expect(spy.bytesRead).toBe(153_600);
    }
  });
});

// ---------------------------------------------------------------------------
// openEdf: never a scan
// ---------------------------------------------------------------------------

describe('openEdf never scans the file', () => {
  it('performs ZERO record probes on a plain EDF', async () => {
    // DESIGN, `record-index.ts`: a file with no annotation signal stores no per-record onsets,
    // so record r starts at r * recordDuration BY DEFINITION and probing would learn nothing.
    const { recording, spy } = await openSpied(largeEdf());

    expect(rangesOf(spy)).toEqual([
      { offset: 0, length: 256 },
      { offset: 256, length: 256 * LARGE_SIGNAL_COUNT },
    ]);
    const dataReads = spy.reads.filter((read) => read.offset >= recording.header.headerByteLength);
    expect(dataReads).toEqual([]);
    // 7,936 of 31,465,216 bytes = 0.025 %.
    expect(spy.bytesRead).toBe(LARGE_HEADER_BYTES);
    expect(spy.bytesRead / LARGE_FILE_BYTES).toBeLessThan(0.001);
    expect(spy.maxOffsetTouched).toBe(LARGE_HEADER_BYTES - 1);
  });

  it('performs AT MOST two record probes on an EDF+, and reads 0.13 % of a 31 MB file', async () => {
    // DESIGN, "`openEdf` cost on EDF+D": the header, then record 0 and the last record — two
    // tiny reads that catch any NET drift of the timeline. A full scan at open is unusable over
    // HTTP on a million-record file.
    //   file        31,588,352 B   record 15,420 B   header 8,192 B
    //   open reads      256 + 7,936 + 15,420 + 15,420 = 39,032 B = 0.1236 %
    const { recording, spy } = await openSpied(largeEdfPlus());
    const header = recording.header;
    const lastRecordOffset =
      header.headerByteLength + (header.recordCount - 1) * header.recordByteLength;

    expect(rangesOf(spy)).toEqual([
      { offset: 0, length: 256 },
      { offset: 256, length: 256 * (LARGE_SIGNAL_COUNT + 1) },
      { offset: header.headerByteLength, length: header.recordByteLength },
      { offset: lastRecordOffset, length: header.recordByteLength },
    ]);
    const probes = spy.reads.filter((read) => read.offset >= header.headerByteLength);
    expect(probes).toHaveLength(2);
    expect(spy.bytesRead).toBe(39_032);
    expect(spy.bytesRead / spy.byteLength).toBeLessThan(0.002);
    // `coverage` stays 'probed' and segments stay undefined: nothing on the returned object can
    // be mistaken for a verified statement that the recording is continuous.
    expect(recording.index.coverage).toBe('probed');
    expect(recording.index.segments).toBeUndefined();
    expect(recording.index.gaps).toBeUndefined();
  });

  const probeCases = [
    { name: 'a plain EDF', bytes: () => minimalEdf({ recordCount: 8 }), probes: 0 },
    { name: 'an EDF+C', bytes: () => minimalEdfPlus({ recordCount: 8 }), probes: 2 },
    {
      name: 'an EDF+D',
      bytes: () =>
        minimalEdfPlus({ plus: 'D', recordCount: 8, recordOnsetSeconds: (r) => r + 30 * r }),
      probes: 2,
    },
    {
      name: 'a BDF+C',
      bytes: () =>
        buildEdf({
          format: 'BDF',
          plus: 'C',
          signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
          annotationSignals: [{ samplesPerRecord: 30 }],
          recordCount: 8,
        }),
      probes: 2,
    },
    // One record is its own first and last, so there is only one record to probe.
    { name: 'a single-record EDF+', bytes: () => minimalEdfPlus({ recordCount: 1 }), probes: 1 },
    // No records means no onsets: probing would have to invent one.
    { name: 'a zero-record EDF+', bytes: () => minimalEdfPlus({ recordCount: 0 }), probes: 0 },
  ];

  for (const testCase of probeCases) {
    it(`probes ${testCase.probes} record(s) when opening ${testCase.name}`, async () => {
      const { recording, spy } = await openSpied(testCase.bytes());

      const probes = spy.reads.filter((read) => read.offset >= recording.header.headerByteLength);
      expect(probes).toHaveLength(testCase.probes);
      expect(spy.reads).toHaveLength(2 + testCase.probes);
      for (const probe of probes) {
        // A probe reads one WHOLE record, not just the annotation region: the unit of I/O is
        // the record range, and decodeAnnotations owns the timekeeping rule it needs them for.
        expect(probe.length).toBe(recording.header.recordByteLength);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// locate(): O(log n) and memoised
// ---------------------------------------------------------------------------

describe('index.locate costs O(log recordCount) probes and remembers what it read', () => {
  /** ceil(log2(4096)) = 12 — the depth of a binary search over 4096 records. */
  const LOG2_RECORDS = Math.ceil(Math.log2(D_RECORD_COUNT));

  it('finds a record 2000 deep in a 4096-record EDF+D in at most 12 probes', async () => {
    // MEASURED: 12 reads of 80 bytes = 960 bytes, against 4096 records and a 328,448-byte file.
    // A linear walk would be 2001 reads. Records 0 and 4095 are free — buildTimeline already
    // probed them at open and memoised both.
    const { recording, spy } = await openSpied(largeEdfPlusD());
    spy.reset();

    const found = await recording.index.locate(discontinuousOnset(2000) + 0.25);

    expect(found).toEqual({
      recordIndex: 2000,
      recordStartSeconds: 2180, // 2000 s of records + 3 gaps x 60 s
      recordStartTicks: 21_800_000_000n,
      offsetInRecordSeconds: 0.25,
      offsetInRecordTicks: 2_500_000n,
    });
    expect(spy.reads.length).toBeLessThanOrEqual(LOG2_RECORDS);
    expect(spy.reads.length).toBeGreaterThan(0);
    expect(spy.reads.length).toBeLessThan(D_RECORD_COUNT / 100);
    for (const read of spy.reads) expect(read.length).toBe(D_RECORD_BYTES);
  });

  it('answers a second locate in the same record with NO reads at all', async () => {
    // `onsetTicks(r)` memoises, so the second search walks exactly the same path over onsets
    // that are already in hand. MEASURED: 12 reads, then 0.
    const { recording, spy } = await openSpied(largeEdfPlusD());
    spy.reset();
    await recording.index.locate(discontinuousOnset(2000) + 0.25);
    const firstCost = spy.reads.length;

    spy.reset();
    const again = await recording.index.locate(discontinuousOnset(2000) + 0.5);

    expect(again?.recordIndex).toBe(2000);
    expect(spy.reads).toEqual([]);
    expect(spy.reads.length).toBeLessThan(firstCost);
  });

  it('answers a locate in the NEXT record with fewer reads than the first', async () => {
    // The search paths share every step until they diverge, and only the divergent midpoints
    // are new. MEASURED: 12 reads, then 1.
    const { recording, spy } = await openSpied(largeEdfPlusD());
    spy.reset();
    await recording.index.locate(discontinuousOnset(2000) + 0.25);
    const firstCost = spy.reads.length;

    spy.reset();
    const neighbour = await recording.index.locate(discontinuousOnset(2001) + 0.25);

    expect(neighbour?.recordIndex).toBe(2001);
    expect(spy.reads.length).toBeLessThan(firstCost);
    expect(spy.reads.length).toBeLessThanOrEqual(2);
  });

  it('returns undefined for a time inside a gap without reading the whole file', async () => {
    // Record 511 ends at 512 s, record 512 starts at 572 s: 541 s is in the gap, and edfcore
    // fills nothing in (DESIGN "Gap policy" — no gap-fill, and no gap-fill option).
    const { recording, spy } = await openSpied(largeEdfPlusD());
    spy.reset();

    const inGap = await recording.index.locate(discontinuousOnset(511) + 30);

    expect(inGap).toBeUndefined();
    expect(spy.reads.length).toBeLessThanOrEqual(LOG2_RECORDS);
    expect(spy.bytesRead).toBeLessThan(spy.byteLength / 100);
  });

  it('reads exactly one record when asked for one onset', async () => {
    const { recording, spy } = await openSpied(largeEdfPlusD());
    spy.reset();

    const ticks = await recording.index.onsetTicks(3000);

    expect(ticks).toBe(BigInt(discontinuousOnset(3000)) * 10_000_000n);
    expect(rangesOf(spy)).toEqual([
      { offset: 768 + 3000 * D_RECORD_BYTES, length: D_RECORD_BYTES },
    ]);

    spy.reset();
    await recording.index.onsetTicks(3000);
    expect(spy.reads).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildRecordIndex: the one full traversal
// ---------------------------------------------------------------------------

describe('buildRecordIndex chunks to the materialisation budget and reports progress', () => {
  const D_DATA_BYTES = D_RECORD_COUNT * D_RECORD_BYTES; // 327,680

  const cases = [
    // Default budget: min(4 MiB scan block, 256 MiB) / 80 B = 52,428 records >= 4096, so one read.
    { name: 'the default budget', budget: undefined, reads: 1, maxReadBytes: 327_680 },
    // 8,000 / 80 = 100 records per chunk -> ceil(4096 / 100) = 41 reads.
    { name: 'an 8,000-byte budget', budget: 8_000, reads: 41, maxReadBytes: 8_000 },
    // 800 / 80 = 10 records per chunk -> ceil(4096 / 10) = 410 reads.
    { name: 'an 800-byte budget', budget: 800, reads: 410, maxReadBytes: 800 },
  ];

  for (const testCase of cases) {
    it(`traverses 4096 records in ${testCase.reads} read(s) under ${testCase.name}`, async () => {
      const { recording, spy } = await openSpied(largeEdfPlusD());
      spy.reset();
      const progress: Array<[number, number]> = [];

      const index = await buildRecordIndex(recording, {
        ...(testCase.budget === undefined ? {} : { maxMaterializeBytes: testCase.budget }),
        onProgress: (done, total) => progress.push([done, total]),
      });

      expect(spy.reads).toHaveLength(testCase.reads);
      for (const read of spy.reads) expect(read.length).toBeLessThanOrEqual(testCase.maxReadBytes);
      // Every record read exactly once: the scan is a traversal, not a search that backtracks.
      expect(spy.bytesRead).toBe(D_DATA_BYTES);

      expect(progress).toHaveLength(testCase.reads);
      expect(progress.at(-1)).toEqual([D_RECORD_COUNT, D_RECORD_COUNT]);
      let previousDone = 0;
      for (const [done, total] of progress) {
        expect(done).toBeGreaterThan(previousDone);
        expect(total).toBe(D_RECORD_COUNT);
        previousDone = done;
      }

      expect(index.coverage).toBe('complete');
      expect(index.segments).toHaveLength(D_RECORD_COUNT / D_SEGMENT_RECORDS);
      expect(index.gaps).toHaveLength(D_RECORD_COUNT / D_SEGMENT_RECORDS - 1);
    });
  }

  it('answers locate from memory once complete, with no reads at all', async () => {
    const { recording, spy } = await openSpied(largeEdfPlusD());
    const index = await buildRecordIndex(recording);
    spy.reset();

    const found = await index.locate(discontinuousOnset(3333) + 0.5);

    expect(found?.recordIndex).toBe(3333);
    expect(spy.reads).toEqual([]);
  });

  it('is never called implicitly — openEdf leaves coverage probed', async () => {
    const { recording } = await openSpied(largeEdfPlusD());
    expect(recording.index.coverage).toBe('probed');
    expect(recording.index.segments).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// There is no cheap single-channel read
// ---------------------------------------------------------------------------

describe('reading ONE channel over a window still reads the whole record range', () => {
  /**
   * EDF INTERLEAVES every channel inside each data record: record r holds signal 0's samples,
   * then signal 1's, and so on. One channel's samples are therefore a stripe repeated every
   * `recordByteLength` bytes, and there is no byte range that contains them and nothing else.
   *
   * edfcore refuses to hide that (DESIGN decision 7). It does NOT issue one small read per
   * record to fetch the stripes — ten seconds of one channel out of thirty would be a 27x
   * overread spread over ten requests, against a single 153,600-byte read for all thirty — and
   * it does not pretend the read was small either. `EdfChunk.byteLength` reports the bytes
   * ACTUALLY read, so the overread is a number in the result rather than a surprise in a
   * network tab.
   */
  async function windowFor(signalIndices: readonly number[]): Promise<{
    chunk: EdfChunk;
    spy: SpySource;
  }> {
    const { recording, spy } = await openSpied(largeEdf());
    spy.reset();
    const chunks = await readWindow(recording, {
      startSeconds: 30,
      durationSeconds: 10,
      signalIndices,
    });
    return { chunk: only(chunks), spy };
  }

  it('issues the identical read for one channel and for all thirty', async () => {
    const one = await windowFor([0]);
    const all = await windowFor(Array.from({ length: LARGE_SIGNAL_COUNT }, (_, i) => i));

    expect(rangesOf(one.spy)).toEqual(rangesOf(all.spy));
    expect(rangesOf(one.spy)).toEqual([{ offset: 468_736, length: 153_600 }]);
    expect(one.chunk.byteLength).toBe(all.chunk.byteLength);
  });

  it('makes the 30x overread visible through EdfChunk.byteLength', async () => {
    const { chunk } = await windowFor([0]);

    const signal = only(chunk.signals);
    expect(signal.sampleCount).toBe(10 * LARGE_SAMPLES_PER_RECORD); // 2,560 samples
    // 2,560 samples x 2 bytes = 5,120 bytes of interest inside a 153,600-byte read.
    const wantedBytes = signal.sampleCount * 2;
    expect(wantedBytes).toBe(5_120);
    expect(chunk.byteLength).toBe(153_600);
    expect(chunk.byteLength / wantedBytes).toBe(LARGE_SIGNAL_COUNT);
  });

  it('reports the same byteLength from readRecords, so the cost is never hidden', async () => {
    const { recording, spy } = await openSpied(largeEdf());
    spy.reset();

    const chunk = await readRecords(recording, {
      records: { start: 100, count: 4 },
      signalIndices: [7],
    });

    expect(chunk.byteLength).toBe(4 * LARGE_RECORD_BYTES);
    expect(only(spy.reads).length).toBe(4 * LARGE_RECORD_BYTES);
    expect(chunk.byteLength).toBe(spy.bytesRead);
  });
});

describe('a record 0 with no timekeeping TAL costs one extra probe and nothing else', () => {
  /**
   * Every probe but one is handed record 0's onset as its origin. Record 0 has none to be handed,
   * so when ITS timekeeping TAL is missing the derivation fell back to zero and
   * `startOffsetTicks` became 0 rather than the recording's true sub-second start.
   *
   * On a perfectly contiguous file that produced the symptoms 0.1.4 fixed for the LAST record:
   * `spanTicks` exceeded `coveredTicks` by the offset, `openEdf` reported
   * DISCONTINUITY_IN_CONTINUOUS_FILE, `readWindow` refused every window, and `buildRecordIndex`
   * found two segments with a gap that does not exist (fixed in 0.3.29).
   */
  const OFFSET_TICKS = 5_000_000n; // 0.5 s

  function contiguousWithOffset(zeroRecord0: boolean): Uint8Array {
    const bytes = buildEdf({
      plus: 'C',
      recordCount: 6,
      recordDurationSeconds: 1,
      startOffsetSeconds: 0.5,
      signals: [{ label: 'Fp1', samplesPerRecord: 2 }],
      annotationSignals: [{ samplesPerRecord: 20 }],
    });
    if (!zeroRecord0) return bytes;
    const header = parseHeader(bytes, bytes.byteLength);
    const signal = header.signals[header.annotationSignalIndices[0] as number];
    if (signal === undefined) throw new Error('fixture has no annotations channel');
    const at = header.headerByteLength + signal.recordByteOffset;
    bytes.fill(0, at, at + signal.samplesPerRecord * header.bytesPerSample);
    return bytes;
  }

  it('recovers the start offset instead of inventing a discontinuity', async () => {
    const recording = await openEdf(byteSource(contiguousWithOffset(true)));

    expect(recording.timeline.startOffsetTicks).toBe(OFFSET_TICKS);
    expect(recording.timeline.spanTicks).toBe(recording.timeline.coveredTicks);
    // The missing TAL is still reported — it is a real defect. The invented one is not.
    expect(recording.timeline.diagnostics.map((d) => d.code)).toEqual(['TIMEKEEPING_TAL_MISSING']);

    // And the file reads, rather than every window in it being refused.
    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 6,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.startTicks).toBe(0n);
  });

  it('agrees with the same file with its TAL intact, except for the diagnostic', async () => {
    const damaged = await openEdf(byteSource(contiguousWithOffset(true)));
    const intact = await openEdf(byteSource(contiguousWithOffset(false)));

    expect(damaged.timeline.startOffsetTicks).toBe(intact.timeline.startOffsetTicks);
    expect(damaged.timeline.spanTicks).toBe(intact.timeline.spanTicks);

    const damagedIndex = await buildRecordIndex(damaged);
    const intactIndex = await buildRecordIndex(intact);
    expect(damagedIndex.segments).toHaveLength(1);
    expect(damagedIndex.gaps).toHaveLength(0);
    expect(damagedIndex.segments?.[0]?.startTicks).toBe(intactIndex.segments?.[0]?.startTicks);
  });

  it('costs the extra probe only on the file that needs it', async () => {
    // `openEdf` is documented as two probes. The recovery is a third read, and it must not appear
    // on a file whose record 0 is fine.
    const intact = spySource(byteSource(contiguousWithOffset(false)));
    await openEdf(intact);
    const intactReads = intact.reads.length;

    const damaged = spySource(byteSource(contiguousWithOffset(true)));
    await openEdf(damaged);

    expect(damaged.reads.length).toBe(intactReads + 1);
  });
});

describe('an onset probe reads one whole record, which is what the type now says', () => {
  /**
   * `EdfRecordIndex.onsetTicks` was documented as "one targeted read of that record's annotation
   * region". It reads the record: the unit of I/O in edfcore is the record, never the channel
   * (decision 7), and `decodeAnnotations` owns the timekeeping rule and needs the full bytes.
   *
   * On a 64-channel file the region is 32 bytes of a 16,416-byte record, so "targeted" understated
   * the read by 513x — and `locate()` issues O(log recordCount) of them, which is exactly the
   * number someone planning HTTP range requests reads that line to compute (fixed in 0.3.71).
   */
  it('reads recordByteLength bytes at the record offset, once, and memoises', async () => {
    const signals: SignalSpec[] = Array.from({ length: 64 }, (_, index) => ({
      label: `EEG ${index}`,
      samplesPerRecord: 128,
    }));
    const bytes = buildEdf({
      plus: 'C',
      recordCount: 8,
      recordDurationSeconds: 1,
      signals,
      annotationSignals: [{ samplesPerRecord: 16 }],
    });
    const source = spySource(byteSource(bytes));
    const edf = await openEdf(source);
    const { header } = edf;
    const annotation = header.signals[header.annotationSignalIndices[0] as number];
    if (annotation === undefined) throw new Error('expected an annotation signal');

    // The premise: the region really is a rounding error next to the record.
    expect(annotation.recordByteLength).toBe(32);
    expect(header.recordByteLength).toBe(16_416);

    const before = source.reads.length;
    await edf.index.onsetTicks(4);
    const issued = source.reads.slice(before);

    expect(issued).toHaveLength(1);
    expect(issued[0]?.length).toBe(header.recordByteLength);
    expect(issued[0]?.offset).toBe(header.headerByteLength + 4 * header.recordByteLength);

    // Memoised: the second call reads nothing.
    const after = source.reads.length;
    await edf.index.onsetTicks(4);
    expect(source.reads.length).toBe(after);
  });
});
