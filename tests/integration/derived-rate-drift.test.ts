/**
 * The derived sample rate that is not a number, and the census `reading-signals.md` takes of it.
 *
 * `signal.samplesPerRecord` is authoritative; `signal.sampleRateHz` is derived and is "provided for
 * display". The page argues that with one file: 256 samples in a 3-second record is 85.333… Hz, no
 * float holds it, and the error grows with *t*. It prints three values and then a Note that counts
 * how often the two ways of finding a sample disagree — "1,000 of the first 3,001" integer second
 * boundaries, "always by exactly one sample", with "the float answer land[ing] one sample early".
 *
 * That census is the sharpest claim on the page and nothing computed it. `sample-grid.test.ts`
 * covers the grid functions and `trim-window.test.ts` the window arithmetic, both against exact
 * expectations; neither compares either against `Math.round(t * sampleRateHz)`, which is the
 * expression a reader would otherwise have written and the one the whole section exists to talk
 * them out of.
 *
 * The three numbers are checked first — `85.33333333333333`, `8534` from `trimToWindow` and `8533`
 * from the float — and then the census is run over all 3,001 boundaries the Note counts, through
 * `trimToWindow` rather than through a reimplementation of it. All three of its clauses are
 * separate assertions, because they fail separately: a count that is right with the direction
 * wrong would be a worse page than one with no number at all.
 *
 * What this does NOT check: that `sampleRateHz` is `undefined` for a zero record duration, or the
 * refusals the grid raises for one. Those are `sample-grid.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import { trimToWindow } from '../../src/time/window.js';
import type { EdfChunkSignal, EdfHeader } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('reading-signals.md') ?? '';

/**
 * The fence this section is about. The page shows `trimToWindow` twice — once on a 256 Hz file
 * earlier — so every lookup below is scoped to the block that mentions the derived rate, or
 * `exact.firstSampleIndex` would be read off the wrong example.
 */
const FENCE = (() => {
  const at = PAGE.indexOf('signal.sampleRateHz;');
  const start = PAGE.lastIndexOf('```ts', at);
  const end = PAGE.indexOf('```', at);
  return PAGE.slice(start, end);
})();

/** `expression;  // 85.33… — comment` -> `85.33…`. */
function shows(expression: string): string {
  const line = new RegExp(`${expression};\\s+// (\\S+)`).exec(FENCE);
  return line?.[1] ?? '';
}

/**
 * The page's file: "a file declaring 256 samples per 3 s record". 1,001 records reach 3,003 s, so
 * every boundary the Note counts is inside the recording.
 */
const RECORD_SECONDS = 3;
const SAMPLES_PER_RECORD = 256;
const RECORD_COUNT = 1001;

const BYTES = buildEdf({
  recordCount: RECORD_COUNT,
  recordDurationSeconds: RECORD_SECONDS,
  signals: [{ label: 'Fp1', samplesPerRecord: SAMPLES_PER_RECORD }],
});

async function wholeFile(): Promise<{ header: EdfHeader; series: EdfChunkSignal; rate: number }> {
  const recording = await openEdf(byteSource(BYTES));
  const signal = getSignal(recording.header, 'Fp1');
  const chunk = await readRecords(recording, {
    records: { start: 0, count: RECORD_COUNT },
    signalIndices: [signal.index],
  });
  const series = chunk.signals[0];
  if (series === undefined) throw new Error('one signal was asked for and none came back');
  const rate = signal.sampleRateHz;
  if (rate === undefined) throw new Error('this fixture has a non-zero record duration');
  return { header: recording.header, series, rate };
}

describe('the rate the page prints', () => {
  it('is on the page, so a passing run is not a vacuous one', () => {
    expect(FENCE).toContain('256 samples per 3 s record');
    expect(shows('signal.sampleRateHz')).not.toBe('');
    expect(PAGE).toContain('85.333');
  });

  it('is what the header derives', async () => {
    const { rate } = await wholeFile();
    expect(String(rate)).toBe(shows('signal.sampleRateHz'));
    expect(rate).toBe(SAMPLES_PER_RECORD / RECORD_SECONDS);
  });
});

describe('the two answers at 100 s', () => {
  it('gives trimToWindow the index the page prints', async () => {
    const { header, series } = await wholeFile();
    const exact = trimToWindow(header, series, 100, 1);
    expect(exact.firstSampleIndex).toBe(Number(shows('exact.firstSampleIndex')));
    expect(exact.firstSampleIndex).toBe(8534);
  });

  it('gives the float expression the other one', async () => {
    const { rate } = await wholeFile();
    expect(Math.round(100 * rate)).toBe(
      Number(shows('Math.round\\(100 \\* signal.sampleRateHz\\)')),
    );
    expect(Math.round(100 * rate)).toBe(8533);
  });

  it('and the sample the float names starts before the window, as the page says', async () => {
    // 8533 * 3 / 256 = 99.99609375, which the page rounds to 99.996 in prose.
    const startSeconds = (8533 * RECORD_SECONDS) / SAMPLES_PER_RECORD;
    expect(startSeconds).toBeLessThan(100);
    expect(startSeconds.toFixed(3)).toBe('99.996');
    expect(PAGE).toContain('a sample that starts at 99.996 s');
  });
});

describe('the census in the Note', () => {
  /** `1,000 of the first 3,001` — both numbers read off the page. */
  // The Note is a blockquote and the sentence wraps inside it; the wrap is not the claim.
  const COUNTS = /\((\d[\d,]*) of the first (\d[\d,]*)\)/.exec(
    PAGE.replace(/\n>\s*/g, ' ').replace(/\s+/g, ' '),
  );
  const asNumber = (text: string | undefined): number => Number((text ?? '').replace(/,/g, ''));

  interface Disagreement {
    readonly second: number;
    readonly exact: number;
    readonly float: number;
  }

  async function survey(): Promise<{ boundaries: number; disagreements: readonly Disagreement[] }> {
    const { header, series, rate } = await wholeFile();
    const boundaries = asNumber(COUNTS?.[2]);
    const disagreements: Disagreement[] = [];
    for (let second = 0; second < boundaries; second += 1) {
      const exact = trimToWindow(header, series, second, 1).firstSampleIndex;
      const float = Math.round(second * rate);
      if (exact !== float) disagreements.push({ second, exact, float });
    }
    return { boundaries, disagreements };
  }

  it('states both numbers, so a passing run is not a vacuous one', () => {
    expect(COUNTS).not.toBeNull();
    expect(asNumber(COUNTS?.[1])).toBe(1000);
    expect(asNumber(COUNTS?.[2])).toBe(3001);
  });

  it('counts the boundaries where the two disagree', async () => {
    const { boundaries, disagreements } = await survey();
    expect(boundaries).toBe(3001);
    expect(disagreements).toHaveLength(asNumber(COUNTS?.[1]));
  });

  it('is a third of them, which is the fraction the Note calls it', async () => {
    const { boundaries, disagreements } = await survey();
    // Not a rounded ratio: 1000 of 3001 is what "a third" is standing in for here.
    expect(disagreements.length * 3).toBe(boundaries - 1);
  });

  it('disagrees by exactly one sample, never by more', async () => {
    const { disagreements } = await survey();
    expect(disagreements.every(({ exact, float }) => exact - float === 1)).toBe(true);
  });

  it('always with the float answer early, which is the direction that pulls in earlier data', async () => {
    const { disagreements } = await survey();
    expect(disagreements.every(({ float, exact }) => float < exact)).toBe(true);
    // And the sample it names really does start before the boundary it was asked for.
    for (const { second, float } of disagreements.slice(0, 8)) {
      expect((float * RECORD_SECONDS) / SAMPLES_PER_RECORD).toBeLessThan(second);
    }
  });
});
