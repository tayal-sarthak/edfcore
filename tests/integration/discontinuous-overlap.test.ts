/**
 * The rest of `discontinuous.md`: what `openEdf` alone reports, and what an overlap looks like.
 *
 * `discontinuous-page.test.ts` runs the reading half of that page — the chunks a window becomes,
 * the span of a record range across a hole, and what `locate` answers on either side. This is the
 * half above and below it.
 *
 * The overlap section is the one worth pinning. EDF+D never lets a record start before the previous
 * one ends; files do it anyway, and edfcore's answer is that there is no separate shape for it —
 * `EdfGap.durationSeconds` simply goes negative. The page demonstrates that with one line,
 * `[-1, 1]`, on a file whose first pair of segments overlaps by a second and whose second pair is
 * a second apart. A reader summing `durationSeconds` to get "time lost to gaps" needs that line to
 * be true, and the page says so in the sentence under it.
 *
 * The probed-index block is checked with it because it is the page's other promise: nothing on the
 * object `openEdf` returns reads as "this recording is continuous" when nothing has looked.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('discontinuous.md') ?? '';

const shows = (expression: string): string =>
  new RegExp(`${expression.replace(/[.()]/g, '\\$&')};\\s*//\\s*([^\\n]+)`)
    .exec(PAGE)?.[1]
    ?.trim() ?? '';

const number = (expression: string): number => Number(/^-?[\d.]+/.exec(shows(expression))?.[0]);

/** Six one-second records with a ten-second hole before record 3 — the page's running file. */
const WITH_A_GAP = buildEdf({
  plus: 'D',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 256 }],
  annotationSignals: [{ samplesPerRecord: 30 }],
  recordOnsetSeconds: (record: number) => (record < 3 ? record : record + 10),
});

/**
 * Onsets 0, 1, 1, 2, 4, 5: three segments, the first pair overlapping by a second and the second
 * pair a second apart. That is the `[-1, 1]` the page prints.
 */
const WITH_AN_OVERLAP = buildEdf({
  plus: 'D',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 30 }],
  recordOnsetSeconds: (record: number) => [0, 1, 1, 2, 4, 5][record] ?? 0,
});

describe('what openEdf reports on its own', () => {
  it('names the variant and the continuity the page prints', async () => {
    const { header } = await openEdf(byteSource(WITH_A_GAP));

    expect(`'${header.variant}'`).toBe(shows('recording.header.variant'));
    expect(`'${header.continuity}'`).toBe(shows('recording.header.continuity'));
  });

  it('reports the span and the coverage, which differ by the hole', async () => {
    const { timeline } = await openEdf(byteSource(WITH_A_GAP));

    expect(timeline.spanSeconds).toBe(number('recording.timeline.spanSeconds'));
    expect(timeline.coveredSeconds).toBe(number('recording.timeline.coveredSeconds'));
    expect(timeline.spanSeconds - timeline.coveredSeconds).toBe(10);
  });

  it('leaves nothing on the index that reads as "continuous"', async () => {
    const { index } = await openEdf(byteSource(WITH_A_GAP));

    expect(`'${index.coverage}'`).toBe(shows('recording.index.coverage'));
    expect(index.segments).toBeUndefined();
    expect(index.gaps).toBeUndefined();
  });
});

describe('a file whose records overlap', () => {
  it('reports the overlap as a negative gap, exactly as the page prints', async () => {
    const recording = await openEdf(byteSource(WITH_AN_OVERLAP));
    const index = await buildRecordIndex(recording);

    // `index.gaps.map((g) => g.durationSeconds);   // [-1, 1]`
    const printed = /index\.gaps\.map\(\(g\) => g\.durationSeconds\);\s*\/\/\s*\[([^\]]*)\]/
      .exec(PAGE)?.[1]
      ?.split(',')
      .map((entry) => Number(entry.trim()));
    expect(printed, 'no overlap example on discontinuous.md').toEqual([-1, 1]);

    expect(index.gaps?.map((gap) => gap.durationSeconds)).toEqual(printed);
  });

  it('keeps gaps.length one below segments.length, overlap included', async () => {
    // The page states it as a rule for "any file that has records", so it has to hold for the
    // overlapping one too — which is the case where a reader would doubt it.
    const recording = await openEdf(byteSource(WITH_AN_OVERLAP));
    const index = await buildRecordIndex(recording);

    expect(index.segments).toHaveLength(3);
    expect(index.gaps).toHaveLength((index.segments?.length ?? 0) - 1);
  });

  it('is what validateRecording calls a spacing violation', async () => {
    const recording = await openEdf(byteSource(WITH_AN_OVERLAP));
    const report = await validateRecording(recording);

    expect(report.diagnostics.map((one) => one.code)).toContain('RECORD_ONSET_SPACING_VIOLATION');
    // The page names the code, so the page and the sweep cannot part company.
    expect(PAGE).toContain('RECORD_ONSET_SPACING_VIOLATION');
  });

  it('makes summing the durations a subtraction, which the page warns about', async () => {
    // "Summing durationSeconds to get 'time lost to gaps' is only right if you expect a negative
    // term." The sum here is zero seconds lost across a file that plainly has a hole in it.
    const recording = await openEdf(byteSource(WITH_AN_OVERLAP));
    const index = await buildRecordIndex(recording);

    const summed = (index.gaps ?? []).reduce((total, gap) => total + gap.durationSeconds, 0);
    expect(summed).toBe(0);
    expect((index.gaps ?? []).some((gap) => gap.durationSeconds > 0)).toBe(true);
  });
});
