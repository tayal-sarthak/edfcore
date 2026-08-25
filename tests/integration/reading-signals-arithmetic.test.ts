/**
 * The worked example on `reading-signals.md`, run.
 *
 * That page carries the argument the whole indexing design exists for: `trimToWindow` compares
 * integers taken from the header as written, never `round(t * sampleRateHz)`, and on a file whose
 * derived rate is not representable the two answers differ. It makes the case with six concrete
 * numbers and a footnote counting how often the disagreement happens — and nothing ran any of
 * them. `documented-examples.test-d.ts` compiles the snippets, which proves they are valid
 * TypeScript and says nothing about whether 8534 is the answer.
 *
 * Numbers in prose rot in a direction that is hard to see. A value that was right when it was
 * written stays plausible for ever: a reader checks it against their intuition, not against the
 * library, and the page's whole purpose is to correct an intuition. The footnote is the extreme
 * case — "1,000 of the first 3,001, always by exactly one sample" is a claim nobody could check
 * by reading, and the argument leans on it.
 *
 * So every number is read OUT OF THE PAGE and compared with what the library does, the way
 * `scaling-page-arithmetic.test.ts` reads the `outOfDigitalRangeCount` it checks. A change on
 * either side fails: the page cannot drift from the library, and the library cannot quietly stop
 * matching the page.
 *
 * The sweep runs `trimToWindow` over one chunk rather than reading three thousand windows. It is
 * pure and takes a chunk, so the reads are one and the arithmetic is the thing under test.
 */

import { describe, expect, it } from 'vitest';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { trimToWindow } from '../../src/time/window.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('reading-signals.md') ?? '';

/**
 * The same page as one line, with the blockquote markers gone.
 *
 * The footnote is a `>` block, so its sentence wraps across lines each beginning `> ` — and a
 * pattern written against the sentence finds nothing. Collapsing whitespace alone is not enough:
 * the marker survives it and lands in the middle of the phrase.
 */
const PROSE = PAGE.replace(/^>\s?/gm, '').replace(/\s+/g, ' ');

/** `exact.firstSampleIndex; // 7808` and `exact.firstSampleIndex; // 8534`, in page order. */
const FIRST_SAMPLE_CLAIMS = [...PAGE.matchAll(/exact\.firstSampleIndex;\s*\/\/ (\d+)/g)].map(
  (match) => Number(match[1]),
);

const claim = (pattern: RegExp): number => Number(pattern.exec(PAGE)?.[1]);

/** One-second records at 256 samples: the file the first snippet describes. */
const SECOND_RECORDS = buildEdf({
  recordCount: 40,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 256 }],
});

/** "A file declaring 256 samples per 3 s record", long enough for the footnote's sweep. */
const THREE_SECOND_RECORDS = buildEdf({
  recordCount: 1001,
  recordDurationSeconds: 3,
  signals: [{ label: 'Fp1', samplesPerRecord: 256 }],
});

describe('the page was read', () => {
  it('found the numbers it states, so a passing run is not a vacuous one', () => {
    expect(FIRST_SAMPLE_CLAIMS).toHaveLength(2);
    for (const value of FIRST_SAMPLE_CLAIMS) expect(Number.isInteger(value)).toBe(true);
    expect(claim(/exact\.sampleCount;\s*\/\/ (\d+)/)).toBeGreaterThan(0);
    expect(claim(/signal\.sampleRateHz;\s*\/\/ ([\d.]+)/)).toBeGreaterThan(0);
  });
});

describe('a window between two record boundaries', () => {
  it('trims to the samples the page says it does', async () => {
    const recording = await openEdf(byteSource(SECOND_RECORDS));
    const [chunk] = await readWindow(recording, {
      startSeconds: 30.5,
      durationSeconds: 2,
      signalIndices: [0],
    });
    const series = chunk?.signals[0];
    if (series === undefined) throw new Error('no chunk for [30.5, 32.5)');

    const exact = trimToWindow(recording.header, series, 30.5, 2);

    expect(exact.sampleCount).toBe(claim(/exact\.sampleCount;\s*\/\/ (\d+)/));
    expect(exact.firstSampleIndex).toBe(FIRST_SAMPLE_CLAIMS[0]);
    expect(exact.startSeconds).toBe(claim(/exact\.startSeconds;\s*\/\/ ([\d.]+)/));
  });

  it('is narrower than the chunk it came from, which is why the page is about it', async () => {
    // The premise: records are the unit the file can be read by, so the untrimmed chunk really is
    // three records wide. Without this the numbers above could be a trim that did nothing.
    const recording = await openEdf(byteSource(SECOND_RECORDS));
    const [chunk] = await readWindow(recording, {
      startSeconds: 30.5,
      durationSeconds: 2,
      signalIndices: [0],
    });
    expect(chunk?.records).toEqual({ start: 30, count: 3 });
    expect(chunk?.signals[0]?.sampleCount).toBe(768);
  });
});

describe('a record duration the sample rate cannot express', () => {
  it('derives the rate the page prints', async () => {
    const recording = await openEdf(byteSource(THREE_SECOND_RECORDS));
    const signal = getSignal(recording.header, 'Fp1');
    expect(signal.sampleRateHz).toBe(claim(/signal\.sampleRateHz;\s*\/\/ ([\d.]+)/));
  });

  it('indexes by integers, and the float answer lands one sample early', async () => {
    const recording = await openEdf(byteSource(THREE_SECOND_RECORDS));
    const signal = getSignal(recording.header, 'Fp1');
    const [chunk] = await readWindow(recording, {
      startSeconds: 100,
      durationSeconds: 1,
      signalIndices: [signal.index],
    });
    const series = chunk?.signals[0];
    if (series === undefined) throw new Error('no chunk at 100 s');

    const exact = trimToWindow(recording.header, series, 100, 1);

    expect(exact.firstSampleIndex).toBe(FIRST_SAMPLE_CLAIMS[1]);
    expect(Math.round(100 * (signal.sampleRateHz as number))).toBe(
      claim(/Math\.round\(100 \* signal\.sampleRateHz\);\s*\/\/ (\d+)/),
    );
    // And they really are different, which is the entire point of the page.
    expect(exact.firstSampleIndex).not.toBe(Math.round(100 * (signal.sampleRateHz as number)));
  });
});

describe('the footnote counting how often they disagree', () => {
  it('is the number the library produces, and every disagreement is the one it describes', async () => {
    // "1,000 of the first 3,001", "always by exactly one sample", "the float answer lands one
    // sample early". Three claims in two sentences, all read out of the page.
    const stated = /\((\d[\d,]*) of the first (\d[\d,]*)\)/.exec(PROSE);
    expect(stated, 'no count in the note on reading-signals.md').not.toBeNull();
    const expectedDisagreements = Number((stated?.[1] ?? '').replace(/,/g, ''));
    const boundaries = Number((stated?.[2] ?? '').replace(/,/g, ''));

    const recording = await openEdf(byteSource(THREE_SECOND_RECORDS));
    const signal = getSignal(recording.header, 'Fp1');
    const rate = signal.sampleRateHz as number;
    const [chunk] = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: 3003,
      signalIndices: [signal.index],
    });
    const whole = chunk?.signals[0];
    if (whole === undefined) throw new Error('no chunk over the whole file');

    let disagreements = 0;
    let byExactlyOne = 0;
    let floatLandsEarly = 0;
    for (let second = 0; second < boundaries; second += 1) {
      const exact = trimToWindow(recording.header, whole, second, 1).firstSampleIndex;
      const float = Math.round(second * rate);
      if (exact === float) continue;
      disagreements += 1;
      if (Math.abs(exact - float) === 1) byExactlyOne += 1;
      if (float < exact) floatLandsEarly += 1;
    }

    expect(disagreements).toBe(expectedDisagreements);
    expect(byExactlyOne).toBe(disagreements);
    expect(floatLandsEarly).toBe(disagreements);
    // And the page says "a third", which is what those two numbers have to come to.
    expect(PROSE).toContain('a third of all integer second boundaries');
    expect(Math.round(boundaries / disagreements)).toBe(3);
  });
});
