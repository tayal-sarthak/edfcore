/**
 * The `strict` section of the decision record, executed.
 *
 * `design-decisions.md` is where the odd-looking choices are written down and defended, and this
 * one is load-bearing for every caller: one boolean, two states, and a list of codes that throw
 * whichever state you are in.
 *
 * Two claims in it are behaviour a refactor could quietly take away, and neither had a test that
 * read the page.
 *
 * The first is the `info` exemption. "`info` codes are exempt and are still collected — they
 * explain something the file got right, and `DATE_CLIPPED_TO_1985_2084` is carried by nearly every
 * conforming EDF file." Without the exemption, `strict: true` would reject almost every real
 * recording, and it would do it while looking correct: the mode is called strict, and a rejection
 * is what it is for. It is the kind of change that reads as tightening.
 *
 * The second is the list of conditions that "throw either way": no version block, a signal count
 * outside 1..9999, a comma used as a decimal separator, record onsets that go backwards. That is
 * the promise that the default mode is not merely tolerant — four named things it will never hand
 * back as a diagnostic for you to miss.
 */

import { describe, expect, it } from 'vitest';
import { dispositionOf } from '../../src/diagnostics/codes.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('design-decisions.md') ?? '';
const FLAT = PAGE.replace(/\s+/g, ' ');

/** A conforming file, which every real one resembles. */
const CONFORMING = buildEdf({
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 8 }],
});

/**
 * Three of the four conditions the page names, each as a file that has it.
 *
 * The fourth, "record onsets that go backwards", gets its own section below: unlike these it is not
 * a property of the header, so WHEN it is raised depends on what has been read.
 */
const ALWAYS_FATAL: readonly {
  readonly named: string;
  readonly code: string;
  readonly bytes: Uint8Array;
}[] = [
  {
    named: 'no version block',
    code: 'NOT_AN_EDF_FILE',
    bytes: buildEdf({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
      raw: { version: 'XX      ' },
    }),
  },
  {
    named: 'a signal count outside 1..9999',
    code: 'SIGNAL_COUNT_INVALID',
    bytes: buildEdf({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
      raw: { signalCount: '0   ' },
    }),
  },
  {
    named: 'a comma used as a decimal separator',
    code: 'COMMA_DECIMAL_SEPARATOR',
    bytes: buildEdf({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
      raw: { recordDuration: '0,5     ' },
    }),
  },
];

describe('the four conditions the page says throw either way', () => {
  it('are all named in the sentence the list comes from', () => {
    expect(FLAT).toContain('the always-fatal codes throw either way');
    for (const { named } of ALWAYS_FATAL) expect(FLAT, named).toContain(named);
    expect(FLAT).toContain('record onsets that go backwards');
  });

  for (const { named, code, bytes } of ALWAYS_FATAL) {
    it(`throws for ${named}, in the DEFAULT mode`, async () => {
      // The point of the sentence: not strict, and still a rejection.
      await expect(openEdf(byteSource(bytes))).rejects.toThrow();
      expect(dispositionOf(code), code).toBe('fatal');
    });

    it(`throws for ${named} under strict too`, async () => {
      await expect(openEdf(byteSource(bytes), { strict: true })).rejects.toThrow();
    });
  }
});

describe('the info exemption', () => {
  it('is stated on the page, with the code that makes it matter', () => {
    expect(FLAT).toContain('`info` codes are exempt and are still collected');
    expect(FLAT).toContain('`DATE_CLIPPED_TO_1985_2084` is carried by nearly every conforming');
  });

  it('lets a conforming file open under strict, carrying its info diagnostic', async () => {
    const { header } = await openEdf(byteSource(CONFORMING), { strict: true });
    const codes = header.diagnostics.map((entry) => entry.code);
    // "still collected" — exempt from throwing, not from being reported.
    expect(codes).toContain('DATE_CLIPPED_TO_1985_2084');
    for (const code of codes) expect(dispositionOf(code), code).toBe('info');
  });

  it('is what stops strict from rejecting nearly every real recording', async () => {
    // Stated as a counterfactual, because the exemption is invisible when it works: without it
    // this file — which has nothing wrong with it — would be a rejection.
    const { header } = await openEdf(byteSource(CONFORMING));
    expect(header.diagnostics.length).toBeGreaterThan(0);
    expect(header.diagnostics.every((entry) => entry.severity === 'info')).toBe(true);
  });
});

describe('one boolean, two states', () => {
  it('says so, and the second state is reachable from the first file that is wrong', async () => {
    expect(FLAT).toContain('One boolean.');
    // A file whose only defect is a warning: it opens by default and is refused under strict,
    // which is the whole of the difference between the two states.
    const warned = buildEdf({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [
        { label: 'Fp1', samplesPerRecord: 4, digitalMinimum: -100_000, digitalMaximum: 100_000 },
      ],
    });
    const { header } = await openEdf(byteSource(warned));
    expect(header.diagnostics.some((entry) => entry.severity !== 'info')).toBe(true);
    await expect(openEdf(byteSource(warned), { strict: true })).rejects.toThrow();
  });
});

describe('the fourth condition, which is not a property of the header', () => {
  const NAMED = 'record onsets that go backwards';

  /** Backwards between the two records `openEdf` probes: records 0 and n-1. */
  const AT_THE_PROBE = minimalEdfPlus({
    plus: 'D',
    recordCount: 4,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    annotationSignals: [{ samplesPerRecord: 40 }],
    recordOnsetSeconds: (record) => (record === 3 ? 1 : 10 + record),
  });

  /** Backwards in the middle, where the probe cannot see it. */
  const IN_THE_MIDDLE = minimalEdfPlus({
    plus: 'D',
    recordCount: 6,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    annotationSignals: [{ samplesPerRecord: 40 }],
    recordOnsetSeconds: (record) => (record === 2 ? 0 : record * 10),
  });

  it('is always-fatal, like the other three', () => {
    expect(dispositionOf('TIMELINE_NOT_MONOTONIC')).toBe('fatal');
    expect(FLAT).toContain(NAMED);
  });

  it('throws at open when the two probed records disagree', async () => {
    await expect(openEdf(byteSource(AT_THE_PROBE))).rejects.toThrow();
    await expect(openEdf(byteSource(AT_THE_PROBE), { strict: true })).rejects.toThrow();
  });

  it('opens when the reversal is between records nothing has read', async () => {
    // Not a hole in the promise, and worth stating rather than choosing a fixture that hides it.
    // `openEdf` reads records 0 and n-1 and nothing else — that is the cost the page charges for
    // it — so a reversal in the middle is not something it has seen. "Throws either way" is about
    // the two MODES, not about throwing before the bytes are read.
    const recording = await openEdf(byteSource(IN_THE_MIDDLE));
    expect(recording.index.coverage).toBe('probed');
  });

  it('throws the moment something does read them', async () => {
    const recording = await openEdf(byteSource(IN_THE_MIDDLE));
    await expect(buildRecordIndex(recording)).rejects.toThrow();
  });
});
