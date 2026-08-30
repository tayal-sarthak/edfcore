/**
 * The scrolling table on `large-files.md`, measured.
 *
 * `large-files-cost.test.ts` runs the two tables above it — what opening costs, and what one
 * ten-second window costs. This is the third, and it is the one that carries an argument rather
 * than a figure: thirty consecutive ten-second windows over an 8-channel EDF+C cost 30 reads and
 * 1,246,800 bytes from a bare source, and 1 read of 1,048,576 bytes through `cachedSource`.
 *
 * The sentence under it is the reason the table is there. **"Removing `cachedSource` changes the
 * number of reads and nothing else."** That is a debugging instruction — if a bug appears with the
 * cache in place, delete the wrapper; if it survives, the cache was not involved — and it is only
 * as good as the "nothing else". So the two runs are compared sample for sample, 153,600 of them,
 * and the count of non-zero values is asserted too: a fixture that decoded to zeros throughout
 * would make an exact match mean nothing.
 *
 * The page also says which block the single read is: "the second 1 MiB block. The first was already
 * resident because the header read at open pulled it in, so the reads that come with opening a file
 * are not wasted." That is checked as an offset, because it is the part a reader plans an HTTP
 * range budget around — and because a cache that happened to issue one read of the right size at
 * the wrong place would satisfy every other assertion here.
 *
 * The file is present only as far as the records the windows touch. The page's file is 7,200
 * records; 340 of them are built with a per-signal ramp, the record-count field is rewritten, and
 * the source reports the length that count implies. Every byte either run decodes comes from a real
 * record.
 */

import { describe, expect, it } from 'vitest';
import { cachedSource } from '../../src/io/cached.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { ByteSource, EdfRecording } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('large-files.md') ?? '';
/** One line, because a sentence stating a number may wrap across two. */
const PROSE = PAGE.replace(/\s+/g, ' ');

const MIB = 1024 * 1024;
/** "thirty consecutive ten-second windows", "two channels at a time". */
const WINDOWS = 30;
const WINDOW_SECONDS = 10;
const CHANNELS = [0, 1] as const;

const RECORD_BYTES = 4156;
const TOTAL_RECORDS = 7200;
/** Enough real records to cover every byte the windows and the cache's block reach. */
const REAL_RECORDS = 340;

interface Recorded {
  readonly source: ByteSource;
  readonly reads: Array<{ offset: number; length: number }>;
  readonly byteLength: number;
}

/** "8 channels at 256 Hz, 7,200 one-second records, 4,156-byte records" — the page's EDF+C. */
function eightChannelPlus(): Recorded {
  const bytes = buildEdf({
    plus: 'C',
    recordCount: REAL_RECORDS,
    recordDurationSeconds: 1,
    signals: Array.from({ length: 8 }, (_, index) => ({
      label: `EEG C${index}`,
      samplesPerRecord: 256,
      // A ramp that differs per signal and per record, so an off-by-one anywhere shows up as a
      // value mismatch rather than as two identical runs of zeros.
      sample: (record: number, sample: number) => ((record * 7 + sample * 3 + index) % 1000) - 500,
    })),
    annotationSignals: [{ samplesPerRecord: 30 }],
  });

  const count = String(TOTAL_RECORDS).padEnd(8, ' ');
  for (let i = 0; i < 8; i += 1) bytes[236 + i] = count.charCodeAt(i);

  const headerBytes = bytes.byteLength - REAL_RECORDS * RECORD_BYTES;
  const byteLength = headerBytes + TOTAL_RECORDS * RECORD_BYTES;
  const reads: Array<{ offset: number; length: number }> = [];
  return {
    reads,
    byteLength,
    source: {
      byteLength,
      read: (offset: number, length: number) => {
        reads.push({ offset, length });
        const out = new Uint8Array(length);
        if (offset < bytes.byteLength) {
          out.set(bytes.subarray(offset, Math.min(bytes.byteLength, offset + length)));
        }
        return Promise.resolve(out);
      },
    },
  };
}

const totalOf = (reads: ReadonlyArray<{ length: number }>): number =>
  reads.reduce((total, read) => total + read.length, 0);

/** Every decoded sample of the two channels, in window order. */
async function scroll(recording: EdfRecording): Promise<readonly number[]> {
  const values: number[] = [];
  for (let window = 0; window < WINDOWS; window += 1) {
    const chunks = await readWindow(recording, {
      startSeconds: window * WINDOW_SECONDS,
      durationSeconds: WINDOW_SECONDS,
      signalIndices: [...CHANNELS],
    });
    for (const chunk of chunks) {
      for (const series of chunk.signals) {
        values.push(...series.digital.subarray(0, series.sampleCount));
      }
    }
  }
  return values;
}

/** `| bare source | 30 | 1,246,800 |` -> the two numbers. */
function tableRow(label: string): { reads: number; bytes: number } {
  const row = new RegExp(`\\|\\s*${label}\\s*\\|\\s*([\\d,]+)\\s*\\|\\s*([\\d,]+)\\s*\\|`).exec(
    PAGE,
  );
  const asNumber = (text: string | undefined): number => Number((text ?? '').replace(/,/g, ''));
  return { reads: asNumber(row?.[1]), bytes: asNumber(row?.[2]) };
}

const BARE = tableRow('bare source');
const CACHED = tableRow('`cachedSource`, 1 MiB blocks');

describe('the table', () => {
  it('reads as two rows of two numbers, so a passing run is not a vacuous one', () => {
    expect(BARE).toEqual({ reads: 30, bytes: 1_246_800 });
    expect(CACHED).toEqual({ reads: 1, bytes: MIB });
    expect(BARE.reads).toBe(WINDOWS);
  });

  it('is about the file the fixture builds', async () => {
    const file = eightChannelPlus();
    const recording = await openEdf(file.source);
    expect(recording.header.recordByteLength).toBe(RECORD_BYTES);
    expect(recording.header.recordCount).toBe(TOTAL_RECORDS);
  });
});

describe('scrolling a bare source', () => {
  it('issues one read per window, for the bytes the table prints', async () => {
    const file = eightChannelPlus();
    const recording = await openEdf(file.source);
    file.reads.length = 0;

    await scroll(recording);
    expect(file.reads).toHaveLength(BARE.reads);
    expect(totalOf(file.reads)).toBe(BARE.bytes);
  });

  it('and one 300-second window over the same records costs one read of the same bytes', async () => {
    // "Thirty ten-second windows cost thirty reads; one 300-second window covering the same
    // records costs one, for the same 1,246,800 bytes."
    const file = eightChannelPlus();
    const recording = await openEdf(file.source);
    file.reads.length = 0;

    await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: WINDOWS * WINDOW_SECONDS,
      signalIndices: [...CHANNELS],
    });
    expect(file.reads).toHaveLength(1);
    expect(totalOf(file.reads)).toBe(BARE.bytes);
  });
});

describe('scrolling through cachedSource', () => {
  async function cachedRun() {
    const file = eightChannelPlus();
    const recording = await openEdf(
      cachedSource(file.source, { blockBytes: MIB, maxBytes: 64 * MIB }),
    );
    const atOpen = [...file.reads];
    file.reads.length = 0;
    const values = await scroll(recording);
    return { file, atOpen, values };
  }

  it('turns thirty requests into the one the table prints', async () => {
    const { file } = await cachedRun();
    expect(file.reads).toHaveLength(CACHED.reads);
    expect(totalOf(file.reads)).toBe(CACHED.bytes);
  });

  it('and that one is the SECOND 1 MiB block, the first having come with the open', async () => {
    const { file, atOpen } = await cachedRun();
    expect(file.reads[0]?.offset).toBe(MIB);
    expect(atOpen.map((read) => read.offset)).toContain(0);
    expect(PROSE).toContain('The single read is the second 1 MiB block');
  });
});

describe('"removing cachedSource changes the number of reads and nothing else"', () => {
  it('gives both runs the same samples, value for value', async () => {
    const bareFile = eightChannelPlus();
    const bare = await scroll(await openEdf(bareFile.source));

    const cachedFile = eightChannelPlus();
    const cached = await scroll(
      await openEdf(cachedSource(cachedFile.source, { blockBytes: MIB, maxBytes: 64 * MIB })),
    );

    expect(cached).toEqual(bare);
    // Thirty windows of ten seconds, two channels at 256 Hz.
    expect(bare).toHaveLength(WINDOWS * WINDOW_SECONDS * CHANNELS.length * 256);
  });

  it('and those samples are real, so an exact match is not two runs of zeros', async () => {
    const file = eightChannelPlus();
    const values = await scroll(await openEdf(file.source));
    expect(values.filter((value) => value !== 0).length).toBeGreaterThan(values.length - 500);
    expect(new Set(values).size).toBeGreaterThan(100);
  });
});
