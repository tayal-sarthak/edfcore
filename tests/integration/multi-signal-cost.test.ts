/**
 * The cost table on `reading-signals.md`: one call for three channels against three calls for one.
 *
 * | one call, `signalIndices: [0, 1, 2]` | 1 | 15,380 |
 * | three calls, one signal each        | 3 | 46,140 |
 *
 * The table is an argument about how to write a loop, and it is the argument most likely to be
 * ignored: three calls read the same bytes three times and return the same answers, so nothing in
 * the result says the caller paid triple. Over HTTP that is two round trips of pure waste per
 * window, invisible until someone opens a network panel.
 *
 * What makes the check worth having rather than obvious is the direction it constrains. A change
 * that made a multi-signal read narrow to a per-signal range would look like an optimisation —
 * fewer bytes decoded — and would turn one request into three. The row that must not move is the
 * first one: one read, and the WHOLE record.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { spySource } from '../support/spy-source.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('reading-signals.md') ?? '';
const FLAT = PAGE.replace(/\s+/g, ' ');

const digits = (text: string | undefined): number => Number((text ?? '').replaceAll(',', ''));

/** `On a three-signal file with 1,538-byte records, a ten-second window measures:` */
const DESCRIBED = /On a (\w+)-signal file with ([\d,]+)-byte records, a (\w+)-second window/.exec(
  FLAT,
);

/** The two rows of the table, as `{ reads, bytes }`. */
const ROWS = [...FLAT.matchAll(/\| (one call|three calls)[^|]*\| (\d+) \| ([\d,]+) \|/g)].map(
  ([, label = '', reads = '', bytes = '']) => ({
    label,
    reads: Number(reads),
    bytes: digits(bytes),
  }),
);

const WINDOW_SECONDS = 10;
const RECORD_BYTES = digits(DESCRIBED?.[2]);

/**
 * Three signals summing to the record size the page names. Only the total matters to the table —
 * the split decides which channel overreads which, not what any of it costs.
 */
const SAMPLES = [512, 256, RECORD_BYTES / 2 - 768] as const;

const BYTES = buildEdf({
  recordCount: 40,
  recordDurationSeconds: 1,
  signals: SAMPLES.map((samplesPerRecord, index) => ({
    label: `C${index}`,
    samplesPerRecord,
  })),
});

describe('the file the table measures', () => {
  it('is described in the sentence above it', () => {
    expect(DESCRIBED).not.toBeNull();
    expect(ROWS).toHaveLength(2);
    expect(SAMPLES.every((count) => count > 0)).toBe(true);
  });

  it('has the three signals and the record size the sentence names', async () => {
    const { header } = await openEdf(byteSource(BYTES));
    expect(header.signals).toHaveLength(3);
    expect(header.recordByteLength).toBe(RECORD_BYTES);
  });
});

describe('one call for three channels', () => {
  it('issues the reads and moves the bytes the first row states', async () => {
    const row = ROWS[0];
    const spy = spySource(byteSource(BYTES));
    const recording = await openEdf(spy);
    const before = spy.reads.length;

    const chunks = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: WINDOW_SECONDS,
      signalIndices: [0, 1, 2],
    });

    expect(spy.reads.length - before).toBe(row?.reads);
    expect(chunks[0]?.byteLength).toBe(row?.bytes);
    // Which is the window in whole records, since a record is the unit of I/O.
    expect(row?.bytes).toBe(WINDOW_SECONDS * RECORD_BYTES);
  });
});

describe('three calls for one channel each', () => {
  it('issues the reads and moves the bytes the second row states', async () => {
    const row = ROWS[1];
    const spy = spySource(byteSource(BYTES));
    const recording = await openEdf(spy);
    const before = spy.reads.length;

    let moved = 0;
    for (const index of [0, 1, 2]) {
      const chunks = await readWindow(recording, {
        startSeconds: 0,
        durationSeconds: WINDOW_SECONDS,
        signalIndices: [index],
      });
      moved += chunks[0]?.byteLength ?? 0;
    }

    expect(spy.reads.length - before).toBe(row?.reads);
    expect(moved).toBe(row?.bytes);
    // "Every call re-reads the same interleaved bytes."
    expect(row?.bytes).toBe((ROWS[0]?.bytes ?? 0) * 3);
  });

  it('reads the identical range each time, which is why it is waste', async () => {
    const spy = spySource(byteSource(BYTES));
    const recording = await openEdf(spy);
    const before = spy.reads.length;
    for (const index of [0, 1, 2]) {
      await readWindow(recording, {
        startSeconds: 0,
        durationSeconds: WINDOW_SECONDS,
        signalIndices: [index],
      });
    }
    const ranges = spy.reads.slice(before).map((read) => `${read.offset}:${read.length}`);
    expect(new Set(ranges).size).toBe(1);
  });
});

describe('the overread a single channel pays', () => {
  it('reads every byte of the records, not its own share of them', async () => {
    // "Asking for one channel out of thirty does not read 1/30th of the bytes. It reads all of
    //  them and decodes one."
    expect(FLAT).toContain('does not read 1/30th of the bytes');
    const recording = await openEdf(byteSource(BYTES));
    const [chunk] = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: WINDOW_SECONDS,
      signalIndices: [1],
    });
    // The narrow channel's own samples are a fraction of what came off the source.
    const occupied = (chunk?.signals[0]?.digital.length ?? 0) * recording.header.bytesPerSample;
    expect(chunk?.byteLength).toBe(WINDOW_SECONDS * RECORD_BYTES);
    expect(occupied).toBeLessThan(chunk?.byteLength ?? 0);
    // "`chunk.byteLength` reports the real figure, so the overread is a number in your result."
    expect(chunk?.byteLength).toBeGreaterThan(0);
  });
});
