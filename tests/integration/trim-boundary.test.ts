/**
 * `trimToWindow`, against the two-signal example on `api-primitives.md`.
 *
 * The example is there to make one point: two signals of different rates have different first
 * samples inside the same window, which is why `startSeconds` lives on `EdfChunkSignal` rather
 * than only on the chunk. A 256 Hz channel and a 3 Hz channel asked for `[1.4, 1.9)` start at
 * different instants and hold different counts, and a caller who assumes one `startSeconds` for
 * the chunk aligns the coarse channel to the fine one's boundary.
 *
 * The rule underneath it is stated on the page and is the part most easily lost in a refactor:
 * membership is decided against the tick edfcore PUBLISHES for a sample, not against the sample's
 * exact rational start. The two differ whenever a boundary is not a whole tick — 256 samples in a
 * one-second record puts sample 1 at 39,062.5 ticks, published as 39,063 — and selecting on the
 * exact start excluded the very sample a caller had aligned the window to, which is a real defect
 * this project shipped and fixed in 0.3.56.
 */

import { describe, expect, it } from 'vitest';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { gridSampleStartTicks } from '../../src/sample-grid.js';
import { trimToWindow } from '../../src/time/window.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('api-primitives.md') ?? '';

/** `startSeconds: 1.4,` and `durationSeconds: 0.5,` from the snippet above the printed output. */
const WINDOW =
  /startSeconds: ([\d.]+),\s*\n\s*durationSeconds: ([\d.]+),\s*\n\s*signalIndices: \[0, 1\]/.exec(
    PAGE,
  );

/** `// 0 128 1.40234375           <- 256 Hz: …` */
// Column-aligned in the source, so the separators are runs of spaces rather than single ones.
const PRINTED = [...PAGE.matchAll(/^\/\/ (\d)\s+(\d+)\s+([\d.]+)\s+<- (\d+) Hz/gm)].map(
  ([, index = '', sampleCount = '', startSeconds = '', hz = '']) => ({
    signalIndex: Number(index),
    sampleCount: Number(sampleCount),
    startSeconds: Number(startSeconds),
    hz: Number(hz),
  }),
);

describe('the two-signal example', () => {
  it('is printed with both rows and its window', () => {
    expect(WINDOW).not.toBeNull();
    expect(PRINTED).toHaveLength(2);
    // "signal 0 at 256 samples/record and signal 1 at 3"
    expect(PRINTED.map((row) => row.hz)).toEqual([256, 3]);
  });

  it('trims each signal to the count and start the page prints', async () => {
    const bytes = buildEdf({
      recordCount: 8,
      recordDurationSeconds: 1,
      signals: PRINTED.map((row) => ({
        label: `C${row.signalIndex}`,
        samplesPerRecord: row.hz,
      })),
    });
    const recording = await openEdf(byteSource(bytes));
    const startSeconds = Number(WINDOW?.[1]);
    const durationSeconds = Number(WINDOW?.[2]);

    const [chunk] = await readWindow(recording, {
      startSeconds,
      durationSeconds,
      signalIndices: [0, 1],
    });

    for (const row of PRINTED) {
      const signal = chunk?.signals[row.signalIndex];
      expect(signal, `signal ${row.signalIndex}`).toBeDefined();
      const exact = trimToWindow(
        recording.header,
        signal ?? ({} as never),
        startSeconds,
        durationSeconds,
      );
      expect(exact.sampleCount, `signal ${row.signalIndex} count`).toBe(row.sampleCount);
      expect(exact.startSeconds, `signal ${row.signalIndex} start`).toBe(row.startSeconds);
    }
  });

  it('gives the two signals different first samples, which is the point of the example', () => {
    // "Two signals of different rates have different first samples inside the same window."
    expect(PAGE).toContain('have different first samples inside the same window');
    expect(PRINTED[0]?.startSeconds).not.toBe(PRINTED[1]?.startSeconds);
    // The coarser grid lands later, as the page's own annotation says.
    expect(PRINTED[1]?.startSeconds).toBeGreaterThan(PRINTED[0]?.startSeconds ?? 0);
  });
});

describe('the published tick, not the exact one', () => {
  it('publishes the value the page names for sample 1 of a 256 Hz record', async () => {
    // "256 samples in a one-second record puts sample 1 at 39,062.5 ticks, published as 39,063"
    const printed = /puts sample (\d+) at ([\d,.]+) ticks, published as ([\d,]+)/.exec(PAGE);
    expect(printed).not.toBeNull();
    const digits = (text: string | undefined): number => Number((text ?? '').replaceAll(',', ''));

    const bytes = buildEdf({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'C0', samplesPerRecord: 256 }],
    });
    const { header } = await openEdf(byteSource(bytes));
    const signal = getSignal(header, 'C0');
    const sample = digits(printed?.[1]);

    // The exact rational start, which is not a whole tick.
    const exact = (sample * Number(header.recordDurationTicks)) / signal.samplesPerRecord;
    expect(exact).toBe(digits(printed?.[2]));
    expect(Number.isInteger(exact)).toBe(false);

    // And what edfcore publishes for it, which is the ceiling.
    expect(gridSampleStartTicks(signal, sample, header.recordDurationTicks)).toBe(
      BigInt(digits(printed?.[3])),
    );
    expect(digits(printed?.[3])).toBe(Math.ceil(exact));
  });
});

describe('what trimming allocates and refuses', () => {
  const BYTES = buildEdf({
    recordCount: 8,
    recordDurationSeconds: 1,
    signals: [{ label: 'C0', samplesPerRecord: 16 }],
  });

  it('returns a view over the input rather than a copy', async () => {
    // "`digital` in the result is a **subarray view** of the input's, so trimming allocates
    //  nothing and the two share memory."
    const recording = await openEdf(byteSource(BYTES));
    const [chunk] = await readWindow(recording, {
      startSeconds: 1,
      durationSeconds: 3,
      signalIndices: [0],
    });
    const signal = chunk?.signals[0];
    const exact = trimToWindow(recording.header, signal ?? ({} as never), 1.5, 1);
    expect(exact.digital.buffer).toBe(signal?.digital.buffer);
    // "`sampleCount` is taken from the view, so the count and the data cannot disagree."
    expect(exact.sampleCount).toBe(exact.digital.length);
  });

  it('yields a zero-length result for a window that misses the chunk', async () => {
    // "One that misses it entirely yields a zero-length result rather than an error."
    const recording = await openEdf(byteSource(BYTES));
    const [chunk] = await readWindow(recording, {
      startSeconds: 1,
      durationSeconds: 2,
      signalIndices: [0],
    });
    const exact = trimToWindow(recording.header, chunk?.signals[0] ?? ({} as never), 6, 1);
    expect(exact.sampleCount).toBe(0);
    expect(exact.digital.length).toBe(0);
  });

  it('refuses a header the chunk did not come from', async () => {
    // "Throws `EdfChannelNotFoundError` when `chunkSignal.signalIndex` is not in `header.signals`,
    //  which means you passed a different header than the chunk was read with."
    const recording = await openEdf(byteSource(BYTES));
    const [chunk] = await readWindow(recording, {
      startSeconds: 1,
      durationSeconds: 2,
      signalIndices: [0],
    });
    const other = await openEdf(
      byteSource(
        buildEdf({
          recordCount: 2,
          recordDurationSeconds: 1,
          signals: [{ label: 'X', samplesPerRecord: 4 }],
        }),
      ),
    );
    expect(() =>
      trimToWindow(other.header, { ...(chunk?.signals[0] ?? ({} as never)), signalIndex: 9 }, 1, 1),
    ).toThrow(/signalIndex 9 is not one of/);
  });
});
