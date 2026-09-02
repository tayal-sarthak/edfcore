/**
 * The header helpers agree with the header, on every awkward shape — without the corpus.
 *
 * `tests/corpus/whole-api.test.ts` asserts this over six real files and skips without
 * `npm run corpus:fetch`, so a fresh clone has never run it. What those files contribute is not
 * realness — none of these properties cares where the bytes came from — but awkwardness: a zero
 * record duration, a duplicated channel label, a file with no data signal at all. `awkward-files.ts`
 * builds those shapes, so the properties run on every clone.
 *
 * The class of defect this catches is the one no single-function test does. Each helper below can
 * be correct on its own and disagree with its neighbour about the same file: `matchSignals` and
 * `header.dataSignalIndices` disagreeing about which channels are data, `physicalRangeOf` ordering
 * its bounds one way while `signal.physicalMinimum` says another, `summarizeDiagnostics` counting a
 * severity the array does not carry.
 *
 * What this does NOT check: that any one helper is right. Those are the unit tests. This checks
 * only that they are right about the SAME file.
 */

import { describe, expect, it } from 'vitest';
import {
  byteSource,
  declaredDurationSeconds,
  findSignals,
  formatDiagnostics,
  formatHeader,
  getSignal,
  matchSignals,
  openEdf,
  physicalRangeOf,
  summarizeDiagnostics,
} from '../../src/index.js';
import { AWKWARD } from '../support/awkward-files.js';

describe('the shapes under test', () => {
  it('are the eight awkward-files.ts builds, so a removed one fails rather than vanishing', () => {
    expect(AWKWARD).toHaveLength(17);
    expect(new Set(AWKWARD.map((file) => file.name)).size).toBe(AWKWARD.length);
  });
});

describe.each(AWKWARD)('$name', ({ awkward, bytes }) => {
  it(`agrees with itself, where ${awkward}`, async () => {
    const { header, timeline } = await openEdf(byteSource(bytes));

    // `matchSignals` never returns the annotations channel, and agrees with the kind the parser
    // assigned rather than deciding for itself.
    const everyMatch = matchSignals(header, /.*/);
    expect(everyMatch.every((signal) => signal.kind === 'data')).toBe(true);
    expect(everyMatch.map((signal) => signal.index)).toEqual([...header.dataSignalIndices]);

    // The two index arrays partition the signals: each is data or annotations, none is both.
    expect(header.dataSignalIndices.length + header.annotationSignalIndices.length).toBe(
      header.signals.length,
    );
    expect(new Set([...header.dataSignalIndices, ...header.annotationSignalIndices]).size).toBe(
      header.signals.length,
    );

    /*
     * What the records COVER against the span they are spread across.
     *
     * `declaredDurationSeconds` is the sum of the record durations and `spanSeconds` is the last
     * record's end minus the first's start, so the two are equal on a contiguous file, the sum is
     * SMALLER where there are gaps, and LARGER where records overlap — because an overlap counts
     * the same instant twice. The one-sided claim held only because no shape in the matrix
     * overlapped until 0.6.36 put one in it.
     */
    // Read off the probe's own finding rather than from the two numbers being compared, which
    // would make the check circular. An overlapping file is the only shape that earns this code.
    const overlapping = timeline.diagnostics.some(
      (one) => one.code === 'RECORD_ONSET_SPACING_VIOLATION',
    );
    if (overlapping) {
      expect(declaredDurationSeconds(header)).toBeGreaterThan(timeline.spanSeconds);
    } else {
      expect(declaredDurationSeconds(header)).toBeLessThanOrEqual(timeline.spanSeconds + 1e-9);
    }

    // A physical range is ordered whichever way the file declared its bounds — an inverted
    // physical range is legal, and `physicalRangeOf` is the helper that hides that from a plot.
    for (const signal of header.signals) {
      if (!Number.isFinite(signal.physicalMinimum) || !Number.isFinite(signal.physicalMaximum)) {
        continue;
      }
      const range = physicalRangeOf(signal);
      expect(range.low, signal.label).toBeLessThanOrEqual(range.high);
      expect(new Set([range.low, range.high])).toEqual(
        new Set([signal.physicalMinimum, signal.physicalMaximum]),
      );
    }

    // `findSignals` and `getSignal` answer about the same channels: whenever a label is unique,
    // the one `getSignal` returns is the one `findSignals` found.
    for (const signal of header.signals) {
      const found = findSignals(header, signal.label);
      expect(found.map((match) => match.index)).toContain(signal.index);
      if (found.length === 1) {
        expect(getSignal(header, signal.label).index).toBe(signal.index);
      } else {
        // A repeated label leaves no way to name them apart, so the helper that must return one
        // refuses rather than picking.
        expect(() => getSignal(header, signal.label)).toThrow();
      }
    }

    // The summary accounts for every diagnostic exactly once.
    const summary = summarizeDiagnostics(header.diagnostics);
    expect(summary.total).toBe(header.diagnostics.length);
    expect(summary.errors + summary.warnings + summary.infos).toBe(summary.total);

    // The formatters produce text for any of these files, and name what they are about.
    expect(formatHeader(header)).toContain(header.variant);
    expect(typeof formatDiagnostics(header.diagnostics)).toBe('string');
  });
});

describe('the shapes really are awkward', () => {
  it('include one with no data signals, one with no rate, and one with a repeated label', async () => {
    // Without this the run above could pass on eight tidy files and prove nothing about the
    // shapes it is named for.
    const headers = await Promise.all(
      AWKWARD.map(async (file) => (await openEdf(byteSource(file.bytes))).header),
    );
    expect(headers.some((header) => header.dataSignalIndices.length === 0)).toBe(true);
    expect(
      headers.some((header) => header.signals.every((signal) => signal.sampleRateHz === undefined)),
    ).toBe(true);
    expect(
      headers.some(
        (header) =>
          new Set(header.signals.map((signal) => signal.label)).size < header.signals.length,
      ),
    ).toBe(true);
    expect(headers.some((header) => header.bytesPerSample === 3)).toBe(true);
    expect(
      headers.some((header) => header.signals.some((signal) => signal.scale === undefined)),
    ).toBe(true);
  });
});
