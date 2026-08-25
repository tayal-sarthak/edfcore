/**
 * The two cost tables on `large-files.md`, measured.
 *
 * That page is the random-access claim made concrete: it names two files by their exact geometry
 * and prints, byte for byte, what opening one and reading ten seconds out of the other costs. Four
 * read ranges with their offsets, two totals, a percentage, a sample count, and the highest byte
 * either read touches. None of it had ever been run.
 *
 * `documented-read-counts.test.ts` checks the read COUNTS `api-reading.md` states in prose. This
 * page states offsets and lengths, which is a stronger claim and the one a reader is actually
 * budgeting against: an HTTP round trip is priced by where the range starts and how long it is,
 * not by how many there are.
 *
 * Neither file is built. One is 29 MB and the other 442 MB, and both claims are about which bytes
 * are ASKED for — so a source that reports the length, serves a header of the right geometry and
 * counts the ranges answers the question exactly, without allocating a recording nobody reads.
 *
 * Every number is read out of the page. The point is not that 153,600 is right today; it is that
 * the page and the library cannot drift apart, in either direction.
 */

import { describe, expect, it } from 'vitest';
import { openEdf, readWindow } from '../../src/recording.js';
import type { ByteSource } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('large-files.md') ?? '';
/** One line, because a sentence stating a number may wrap across two. */
const PROSE = PAGE.replace(/\s+/g, ' ');

const stated = (pattern: RegExp, from: string = PROSE): number =>
  Number((pattern.exec(from)?.[1] ?? '').replace(/[,\s]/g, ''));

interface Recorded {
  readonly source: ByteSource;
  readonly reads: Array<{ offset: number; length: number }>;
  readonly byteLength: number;
}

/**
 * A file of `recordCount` records, present only as far as its header.
 *
 * `buildEdf` writes two records of the right geometry; the record-count field is rewritten and the
 * source reports the length that count implies. Nothing past the header is read except the probes
 * and the window, and those are answered with zeros — the claims under test are about which ranges
 * are asked for.
 */
function recording(bytes: Uint8Array, recordCount: number, recordBytes: number): Recorded {
  const count = String(recordCount).padEnd(8, ' ');
  for (let i = 0; i < 8; i += 1) bytes[236 + i] = count.charCodeAt(i);

  const headerBytes = bytes.byteLength - 2 * recordBytes;
  const byteLength = headerBytes + recordCount * recordBytes;
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

/** "8 channels at 256 Hz, 7,200 one-second records, 4,156-byte records" — an EDF+C. */
function eightChannelPlus(): Recorded {
  const bytes = buildEdf({
    plus: 'C',
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: Array.from({ length: 8 }, (_, index) => ({
      label: `EEG C${index}`,
      samplesPerRecord: 256,
    })),
    annotationSignals: [{ samplesPerRecord: 30 }],
  });
  return recording(bytes, 7200, 4156);
}

/** "an eight-hour, 30-channel, 256 Hz EDF (28,800 one-second records, 15,360 bytes each)". */
function thirtyChannel(): Recorded {
  const bytes = buildEdf({
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: Array.from({ length: 30 }, (_, index) => ({
      label: `EEG C${index}`,
      samplesPerRecord: 256,
    })),
  });
  return recording(bytes, 28_800, 15_360);
}

const totalOf = (reads: ReadonlyArray<{ length: number }>): number =>
  reads.reduce((total, read) => total + read.length, 0);

describe('opening the EDF+C the page measured', () => {
  it('asks for the four ranges it prints, at those offsets and lengths', async () => {
    const file = eightChannelPlus();
    const opened = await openEdf(file.source);

    // The premise: the fixture is the file the page describes.
    expect(opened.header.recordByteLength).toBe(4156);
    expect(opened.header.recordCount).toBe(7200);
    expect(file.byteLength).toBe(stated(/Measured on a ([\d,]+)-byte EDF\+C/));

    const printed = [...PAGE.matchAll(/\{ offset: (\d+), length: (\d+) \}/g)]
      .slice(0, 4)
      .map((match) => ({ offset: Number(match[1]), length: Number(match[2]) }));
    expect(printed).toHaveLength(4);
    expect(file.reads).toEqual(printed);
  });

  it('costs the total and the share of the file it prints', async () => {
    const file = eightChannelPlus();
    await openEdf(file.source);

    const total = totalOf(file.reads);
    expect(total).toBe(stated(/total: ([\d,]+) bytes = /));
    const share = ((total / file.byteLength) * 100).toFixed(3);
    expect(share).toBe(/total: [\d,]+ bytes = ([\d.]+) %/.exec(PROSE)?.[1]);
  });
});

describe('reading ten seconds out of the eight-hour file', () => {
  async function windowRead() {
    const file = thirtyChannel();
    const opened = await openEdf(file.source);
    const openedBytes = totalOf(file.reads);
    file.reads.length = 0;

    const chunks = await readWindow(opened, {
      startSeconds: 4 * 3600,
      durationSeconds: 10,
      signalIndices: opened.header.dataSignalIndices,
    });
    return { file, opened, openedBytes, chunks };
  }

  it('is the single range the page prints, at that offset', async () => {
    const { file, opened } = await windowRead();

    expect(opened.header.recordByteLength).toBe(stated(/records, ([\d,]+) bytes each/));
    expect(file.byteLength).toBe(stated(/bytes each, ([\d,]+) bytes in total/));

    // `[ { offset: 221191936, length: 153600 } ]  153600` — the program's own output.
    const printed = /\[ \{ offset: (\d+), length: (\d+) \} \]\s+(\d+)/.exec(PAGE);
    expect(printed, 'no window read printed on large-files.md').not.toBeNull();
    expect(file.reads).toEqual([{ offset: Number(printed?.[1]), length: Number(printed?.[2]) }]);
    expect(totalOf(file.reads)).toBe(Number(printed?.[3]));
  });

  it('touches the byte the page says it touches, and never the far end', async () => {
    const { file } = await windowRead();
    const read = file.reads[0];
    if (read === undefined) throw new Error('no window read');

    expect(read.offset + read.length - 1).toBe(stated(/highest byte the read touches is ([\d,]+)/));
    expect(file.byteLength - 1).toBe(stated(/the file's last byte is ([\d,]+)/));
    // "The far end of the recording is never addressed at all."
    expect(read.offset + read.length).toBeLessThan(file.byteLength);
  });

  it('costs at open what the page says opening costs', async () => {
    const { openedBytes } = await windowRead();
    expect(openedBytes).toBe(stated(/Opening the file first cost ([\d,]+) bytes/));
  });

  it('gives the chunk the sample count and byte length the page prints', async () => {
    const { chunks } = await windowRead();
    const chunk = chunks[0];
    if (chunk === undefined) throw new Error('no chunk at the four-hour mark');

    expect(chunk.signals[0]?.sampleCount).toBe(stated(/sampleCount;\s*\/\/ ([\d,]+) samples/));
    expect(chunk.byteLength).toBe(stated(/byteLength;\s*\/\/ ([\d,]+) bytes actually read/));
    // "2,560 samples x 2 bytes = 5,120 bytes of interest. Overread factor: 30."
    const interest = (chunk.signals[0]?.sampleCount ?? 0) * 2;
    expect(interest).toBe(stated(/x 2 bytes = ([\d,]+) bytes of interest/));
    expect(chunk.byteLength / interest).toBe(stated(/Overread factor: (\d+)/));
  });

  it('costs the same one read wherever the window sits', async () => {
    // "The window's position does not change the price: ten seconds at the end costs the same one
    // read as ten seconds at the start."
    const file = thirtyChannel();
    const opened = await openEdf(file.source);
    for (const startSeconds of [0, 28_790]) {
      file.reads.length = 0;
      await readWindow(opened, {
        startSeconds,
        durationSeconds: 10,
        signalIndices: opened.header.dataSignalIndices,
      });
      expect(file.reads).toHaveLength(1);
      expect(totalOf(file.reads)).toBe(153_600);
    }
  });
});
