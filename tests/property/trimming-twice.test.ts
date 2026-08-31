/**
 * Trimming twice is trimming to the overlap.
 *
 * `trimToWindow` narrows one signal of a chunk to the samples inside a window, and returns a
 * `subarray` view rather than a copy — "so trimming allocates nothing and the two share storage",
 * which is the sentence `api-primitives.md` uses to explain why it is a separate call. That makes
 * the result a chunk signal like any other, and a caller who has one is free to narrow it again: a
 * viewer that has read a minute and is now drawing ten seconds of it does exactly that.
 *
 * `trim-window.test.ts` covers the rule for one trim, against the closed form the source derives.
 * Composing two was not covered, and it is where a narrowing that treated its input's
 * `firstSampleIndex` as zero — or forgot it entirely — would show: the second trim would be measured
 * from the wrong origin and would come back with the right number of samples from the wrong place.
 *
 * The property is that trimming to A and then to B gives what trimming once to their overlap gives,
 * for any two windows, including ones that do not nest and ones that miss each other entirely. It
 * runs over arbitrary pairs with a constant seed, and the fixture's samples are a ramp over the
 * whole recording so a sample's value names its position — an off-by-one origin is a different
 * number rather than a different length.
 *
 * The allocation claim rides along: neither trim copies, so the twice-trimmed view still shares the
 * chunk's own buffer.
 *
 * One thing the property does NOT claim, because it is not true and is worth saying: an EMPTY trim
 * has no position to agree about. `trimToWindow`'s docblock promises that a window missing the
 * chunk "yields a zero-length result rather than an error", and says nothing about where that
 * result sits — so two routes to an empty answer report different `firstSampleIndex` and
 * `startSeconds`, each being the place its own arithmetic stopped. `sampleCount` is the field to
 * branch on, and the property below compares positions only when there are samples in them.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { trimToWindow } from '../../src/time/window.js';
import type { EdfChunkSignal, EdfHeader } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const SEED = 0x0717_0001;
const RECORDS = 12;
const PER_RECORD = 16;

/** A ramp over the whole recording: a sample's value is its index on the signal's own grid. */
const BYTES = buildEdf({
  plus: 'C',
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  signals: [
    {
      label: 'Fp1',
      samplesPerRecord: PER_RECORD,
      sample: (record, index) => record * PER_RECORD + index,
    },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function wholeFile(): Promise<{ header: EdfHeader; series: EdfChunkSignal }> {
  const recording = await openEdf(byteSource(BYTES));
  const [chunk] = await readWindow(recording, {
    startSeconds: 0,
    durationSeconds: RECORDS,
    signalIndices: [0],
  });
  const series = chunk?.signals[0];
  if (series === undefined) throw new Error('the window returned no signal');
  return { header: recording.header, series };
}

const describeTrim = (trimmed: EdfChunkSignal): string =>
  `${trimmed.firstSampleIndex}+${trimmed.sampleCount}@${trimmed.startSeconds}:` +
  [...trimmed.digital.subarray(0, trimmed.sampleCount)].join(',');

/** The overlap of `[aStart, aStart + aSpan)` and `[bStart, bStart + bSpan)`, in seconds. */
function overlap(
  aStart: number,
  aSpan: number,
  bStart: number,
  bSpan: number,
): { start: number; span: number } {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aStart + aSpan, bStart + bSpan);
  return { start, span: Math.max(0, end - start) };
}

describe('two trims and one', () => {
  it('agree on a window inside a window', async () => {
    const { header, series } = await wholeFile();
    const once = trimToWindow(header, series, 3, 4);
    const twice = trimToWindow(header, trimToWindow(header, series, 2, 8), 3, 4);
    expect(describeTrim(twice)).toBe(describeTrim(once));
    // And it is a real window, so this is not two empty results agreeing.
    expect(once.sampleCount).toBe(4 * PER_RECORD);
    expect([...once.digital.subarray(0, 3)]).toEqual([48, 49, 50]);
  });

  it('agree for any two windows, nesting or not', async () => {
    const { header, series } = await wholeFile();
    await fc.assert(
      fc.property(
        fc.double({ min: -3, max: RECORDS + 3, noNaN: true }),
        fc.double({ min: 0, max: RECORDS + 3, noNaN: true }),
        fc.double({ min: -3, max: RECORDS + 3, noNaN: true }),
        fc.double({ min: 0, max: RECORDS + 3, noNaN: true }),
        (aStart, aSpan, bStart, bSpan) => {
          const twice = trimToWindow(
            header,
            trimToWindow(header, series, aStart, aSpan),
            bStart,
            bSpan,
          );
          const { start, span } = overlap(aStart, aSpan, bStart, bSpan);
          const once = trimToWindow(header, series, start, span);

          expect(twice.sampleCount).toBe(once.sampleCount);
          if (once.sampleCount === 0) return;
          expect(describeTrim(twice)).toBe(describeTrim(once));
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
  });

  it('including two windows that miss each other entirely, which give nothing', async () => {
    const { header, series } = await wholeFile();
    const twice = trimToWindow(header, trimToWindow(header, series, 1, 2), 8, 2);
    expect(twice.sampleCount).toBe(0);
    expect(trimToWindow(header, series, 8, 0).sampleCount).toBe(0);
    // The two report different positions for that nothing, which is why `sampleCount` is the field
    // to branch on rather than `startSeconds`.
    expect(twice.startSeconds).not.toBe(trimToWindow(header, series, 8, 0).startSeconds);
  });
});

describe('and neither trim copies', () => {
  it('leaves the twice-trimmed view sharing the chunk’s own buffer', async () => {
    const { header, series } = await wholeFile();
    const once = trimToWindow(header, series, 2, 8);
    const twice = trimToWindow(header, once, 3, 4);
    expect(once.digital.buffer).toBe(series.digital.buffer);
    expect(twice.digital.buffer).toBe(series.digital.buffer);
    // A view, not a copy: writing through the chunk is visible in the narrowed one.
    const at = twice.digital[0];
    series.digital[twice.firstSampleIndex] = -1;
    expect(twice.digital[0]).toBe(-1);
    series.digital[twice.firstSampleIndex] = at ?? 0;
  });
});
