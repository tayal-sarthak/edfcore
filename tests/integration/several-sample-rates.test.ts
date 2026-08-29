/**
 * The table under "Files with several sample rates", and the sentence after it.
 *
 * `reading-signals.md` builds its case for per-signal grids on one worked read: EEG at 256 samples
 * per record, ECG at 512 and a temperature probe at 1, all in one file, read over `[10, 14)`. The
 * table gives each channel's `samplesPerRecord`, `sampleCount` and `firstSampleIndex`, then the
 * prose trims the same chunk to `[10.5, 12.5)` and gives three more counts.
 *
 * Nine numbers, and none of them had been run. `multi-signal-cost.test.ts` covers a different table
 * on the same page — what three channels cost in bytes — and `reading-signals-arithmetic.test.ts`
 * covers the derived-rate section above it. This is the section that says there is no single rate
 * for a recording, which is the misconception the whole page exists to correct.
 *
 * The last sentence is the one worth having under test: "The temperature channel's trimmed window
 * starts at 11 s rather than 10.5 s. At 1 Hz there's no sample at 10.5, and the first one inside
 * the window is the one at 11." That is `startSeconds` becoming genuinely per-signal — before the
 * trim all three share a value, because a record-aligned read gives every signal the same start —
 * and it is the difference between a boundary computed on each channel's own grid and one computed
 * from a rate. A viewer that used the requested 10.5 for all three would draw the temperature
 * trace half a sample to the left, on the one channel where half a sample is half a second.
 *
 * Every figure is read out of the page's own table, so neither side can drift.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { trimToWindow } from '../../src/time/window.js';
import type { EdfChunkSignal } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('reading-signals.md') ?? '';
const PROSE = PAGE.replace(/\s+/g, ' ');

/** `| \`Fp1\` | 256 | 1,024 | 2,560 |` -> the three numbers, commas removed. */
function row(label: string): readonly number[] {
  const found = PAGE.split('\n').find((line) => line.startsWith(`| \`${label}\` |`));
  if (found === undefined) throw new Error(`reading-signals.md no longer has a ${label} row`);
  return found
    .split('|')
    .slice(2, 5)
    .map((cell) => Number(cell.trim().replaceAll(',', '')));
}

/** The three counts the prose gives for the trimmed window, in table order. */
const TRIMMED: readonly number[] = (() => {
  const match =
    /Trimming each to `\[10\.5, 12\.5\)` gives ([\d,]+), ([\d,]+) and (\d+) samples/.exec(PROSE);
  if (match === null) throw new Error('reading-signals.md no longer states the trimmed counts');
  return match.slice(1, 4).map((value) => Number(value.replaceAll(',', '')));
})();

const LABELS = ['Fp1', 'ECG', 'Temp'] as const;
const WINDOW = { startSeconds: 10, durationSeconds: 4 } as const;
const TRIM_START = 10.5;
const TRIM_DURATION = 2;

const BYTES = buildEdf({
  format: 'EDF',
  recordCount: 20,
  recordDurationSeconds: 1,
  signals: LABELS.map((label, position) => ({
    label,
    samplesPerRecord: row(label)[0] as number,
    sample: (r: number, k: number) => (r * 1000 + k + position) % 2048,
  })),
});

async function windowSignals(): Promise<readonly EdfChunkSignal[]> {
  const recording = await openEdf(byteSource(BYTES));
  const chunks = await readWindow(recording, {
    ...WINDOW,
    signalIndices: recording.header.dataSignalIndices,
  });
  expect(chunks).toHaveLength(1);
  return chunks[0]?.signals ?? [];
}

describe('the table was read', () => {
  it('has three rows and three trimmed counts, so a passing run is not a vacuous one', () => {
    for (const label of LABELS) expect(row(label)).toHaveLength(3);
    expect(TRIMMED).toHaveLength(3);
    // The rates really do differ, which is the whole point of the section.
    expect(new Set(LABELS.map((label) => row(label)[0])).size).toBe(3);
    expect(PROSE).toContain('There is no single universal rate');
  });
});

describe('one chunk, three entries', () => {
  it('gives each channel the sample count and first index its row states', async () => {
    const signals = await windowSignals();
    expect(signals).toHaveLength(LABELS.length);

    for (const [position, label] of LABELS.entries()) {
      const [samplesPerRecord, sampleCount, firstSampleIndex] = row(label);
      const entry = signals[position];
      expect(entry?.sampleCount, `${label} sampleCount`).toBe(sampleCount);
      expect(entry?.firstSampleIndex, `${label} firstSampleIndex`).toBe(firstSampleIndex);
      // And the row's own arithmetic holds: a four-second window of one-second records.
      expect(sampleCount).toBe((samplesPerRecord as number) * WINDOW.durationSeconds);
      expect(firstSampleIndex).toBe((samplesPerRecord as number) * WINDOW.startSeconds);
    }
  });

  it('starts all three at the same second, because a read is record-aligned', async () => {
    // Before the trim there is nothing per-signal about `startSeconds`: every channel begins at
    // the same record. That is what makes the next test a change rather than a coincidence.
    const signals = await windowSignals();
    expect(signals.map((entry) => entry.startSeconds)).toEqual([10, 10, 10]);
  });
});

describe('trimming the same chunk to [10.5, 12.5)', () => {
  it('gives the three counts the prose states', async () => {
    const recording = await openEdf(byteSource(BYTES));
    const signals = await windowSignals();
    const counts = signals.map(
      (entry) => trimToWindow(recording.header, entry, TRIM_START, TRIM_DURATION).sampleCount,
    );
    expect(counts).toEqual([...TRIMMED]);
  });

  it('starts the temperature channel at 11 s rather than at 10.5', async () => {
    expect(PROSE).toContain("The temperature channel's trimmed window starts at 11 s rather than");
    const recording = await openEdf(byteSource(BYTES));
    const signals = await windowSignals();
    const trimmed = signals.map((entry) =>
      trimToWindow(recording.header, entry, TRIM_START, TRIM_DURATION),
    );

    // The two fast channels have a sample on the requested boundary; the 1 Hz one does not, and
    // the first sample inside the window is the one at 11.
    expect(trimmed[0]?.startSeconds, 'Fp1').toBe(TRIM_START);
    expect(trimmed[1]?.startSeconds, 'ECG').toBe(TRIM_START);
    expect(trimmed[2]?.startSeconds, 'Temp').toBe(11);
    // Ticks, because the seconds are float64 conversions of the value that decides the boundary.
    expect(trimmed[2]?.startTicks).toBe(110_000_000n);
    // Two samples, at 11 and 12: half-open, so the one at 12.5 is outside.
    expect(trimmed[2]?.sampleCount).toBe(2);
    expect(trimmed[2]?.firstSampleIndex).toBe(11);
  });
});
