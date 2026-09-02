/**
 * The observed-ranges block is a table, not a ragged list.
 *
 * `formatValidationReport` printed the observed digital range straight after the padded label and
 * the sample count straight after that, so both columns fell where the numbers left them. On the
 * PhysioNet polysomnogram in the corpus that is seven rows and three different offsets:
 *
 *     EEG Fpz-Cz           -2048..1819 over 7,950,000 samples
 *     EMG submental        -54..1905 over 79,500 samples
 *     Event marker         136..980 over 79,500 samples
 *
 * The block exists so a reader can compare channels down a column — that is what "observed sample
 * ranges" is for — and it was the one output where comparing meant re-finding the number on every
 * line.
 *
 * Same defect as the sample rate (0.6.23), the signal index (0.6.24) and the event clock (0.6.25),
 * in the fourth and last formatter that lays out a table: a value wider than the space it was
 * given. Same fix: measure the rows first. The count is right-aligned because it is a number and
 * magnitudes compare down a column; the range is left-aligned because `min..max` has no single
 * place to hang.
 *
 * A single-signal file has one row, so its widths are its own and its report does not move.
 */

import { describe, expect, it } from 'vitest';
import { formatValidationReport } from '../../src/format-report.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { AWKWARD } from '../support/awkward-files.js';
import { buildEdf } from '../support/writer.js';

/** Ranges and counts of very different widths, which is what the polysomnogram has. */
const WIDE = buildEdf({
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fpz-Cz', samplesPerRecord: 100, sample: (_r, i) => (i % 2 === 0 ? -2048 : 1819) },
    { label: 'EMG submental', samplesPerRecord: 4, sample: (_r, i) => (i % 2 === 0 ? -54 : 1905) },
    { label: 'Event marker', samplesPerRecord: 1, sample: () => 136 },
  ],
});

async function ranges(bytes: Uint8Array): Promise<readonly string[]> {
  const recording = await openEdf(byteSource(bytes));
  const report = await validateRecording(recording, { scanSamples: true });
  const printed = formatValidationReport(report, { header: recording.header });
  const lines = printed.split('\n');
  const at = lines.indexOf('observed sample ranges:');
  if (at === -1) return [];
  const rows: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line === '') break;
    rows.push(line);
  }
  return rows;
}

describe('a file whose channels observe very different ranges', () => {
  it('has rows of different natural width, or nothing below means anything', async () => {
    const rows = await ranges(WIDE);
    expect(rows).toHaveLength(3);
    const natural = rows.map((row) => /(-?\d+\.\.-?\d+)/.exec(row)?.[1]?.length);
    expect(new Set(natural).size).toBeGreaterThan(1);
  });

  it('puts `over` at one column on every row', async () => {
    const rows = await ranges(WIDE);
    expect(new Set(rows.map((row) => row.indexOf(' over ')))).toHaveLength(1);
  });

  it('ends every sample count at one column, so magnitudes compare', async () => {
    const rows = await ranges(WIDE);
    const ends = rows.map((row) => {
      // The count is right-aligned, so `over` and the digits are separated by padding.
      const match = / over\s+([\d,]+)/.exec(row);
      expect(match, row).not.toBeNull();
      return (match?.index ?? 0) + (match?.[0].length ?? 0);
    });
    expect(new Set(ends)).toHaveLength(1);
  });
});

describe('over the matrix', () => {
  it('is the seventeen shapes it was written against', () => {
    expect(AWKWARD).toHaveLength(17);
  });

  it.each(AWKWARD)('$name keeps its block square', async ({ bytes }) => {
    const rows = await ranges(bytes);
    if (rows.length < 2) return;
    expect(new Set(rows.map((row) => row.indexOf(' over ')))).toHaveLength(1);
  });

  it('has a shape with more than one row, so the sweep is not vacuous', async () => {
    const annotated = AWKWARD.find((file) => file.name === 'EDF+C with annotations');
    if (annotated === undefined) throw new Error('the matrix lost its annotated file');
    expect((await ranges(annotated.bytes)).length).toBeGreaterThan(1);
  });
});

describe('a single-signal file', () => {
  it('reads exactly as it read before, because its widths are its own', async () => {
    const one = buildEdf({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4, sample: (_r, index) => index }],
    });
    const rows = await ranges(one);
    expect(rows).toEqual(['  Fp1                  0..3 over 8 samples']);
  });
});
