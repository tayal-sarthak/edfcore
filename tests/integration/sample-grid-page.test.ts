/**
 * The sample grid on `api-helpers.md`: three ways the obvious spelling breaks, and the rounding
 * rule that keeps two functions inverse.
 *
 * The page opens by naming what a reader would otherwise write —
 * `Math.round(seconds * signal.sampleRateHz)` — and tabulating why it is wrong. Each row is a
 * silent failure: a rate with no exact float representation drifts the index by one over a long
 * recording, an undefined rate makes the expression `NaN`, and rounding rather than flooring puts
 * a window boundary one sample late. None of the three throws.
 *
 * The rounding rule at the end is the interesting one, because it is stated as a property rather
 * than a case: "`gridSampleStartTicks` rounds up to a whole tick … Truncating would return a tick
 * lying inside the previous sample, and `gridSampleIndexAt` would send it straight back there.
 * Rounding up keeps the two functions inverse for every index."
 *
 * That is checkable for every index of a signal whose boundaries are not whole ticks, which is
 * exactly the 128-samples-over-0.3-seconds case the page names twice.
 */

import { describe, expect, it } from 'vitest';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import {
  gridSampleIndexAt,
  gridSampleStartSeconds,
  gridSampleStartTicks,
} from '../../src/sample-grid.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('api-helpers.md') ?? '';
const FLAT = PAGE.replace(/\s+/g, ' ');

/** "128 samples over 0.3 s", the geometry the page uses for both of its awkward numbers. */
const AWKWARD = { samplesPerRecord: 128, recordDurationSeconds: 0.3 } as const;

const awkwardSignal = async () => {
  const { header } = await openEdf(
    byteSource(
      buildEdf({
        recordCount: 6,
        recordDurationSeconds: AWKWARD.recordDurationSeconds,
        signals: [{ label: 'EEG', samplesPerRecord: AWKWARD.samplesPerRecord }],
      }),
    ),
  );
  return { header, signal: getSignal(header, 'EEG') };
};

describe('the three ways the obvious spelling breaks', () => {
  it('has the repeating rate the page names, which edfcore never divides by', async () => {
    // "128 samples over 0.3 s is 426.666… with no exact float representation, and the index drifts
    //  by one over a long recording."
    //
    // The DRIFT is not asserted here, and that is deliberate rather than an omission. Fed the tick
    // this package publishes, `Math.round(seconds * rate)` and the integer arithmetic agree for
    // every index of every geometry tried — the two roundings cancel. The drift is a property of
    // times a caller arrives at some other way, and a fixture that manufactured one would be
    // asserting about its own construction rather than about the library.
    //
    // What is checkable is that the rate is the repeating quantity the page describes, and that
    // edfcore's answer does not come from it: the two rows below are the failures that do show.
    expect(FLAT).toContain('128 samples over 0.3 s is 426.666');
    const { signal } = await awkwardSignal();
    const rate = signal.sampleRateHz ?? Number.NaN;
    expect(Math.trunc(rate)).toBe(426);
    expect(Number.isInteger(rate)).toBe(false);
    // "These do the arithmetic in integers on `(record, sampleWithinRecord)`."
    expect(FLAT).toContain('do the arithmetic in integers on `(record, sampleWithinRecord)`');
  });

  it('yields NaN silently through an undefined rate', async () => {
    // "legal EDF, which a real sleep-staging file relies on — the expression yields `NaN` silently"
    const { header } = await openEdf(
      byteSource(
        buildEdf({
          recordCount: 2,
          recordDurationSeconds: 0,
          signals: [{ label: 'Stage', samplesPerRecord: 1 }],
        }),
      ),
    );
    const stage = getSignal(header, 'Stage');
    expect(stage.sampleRateHz).toBeUndefined();
    expect(Math.round(3600 * (stage.sampleRateHz as unknown as number))).toBeNaN();
  });

  it('throws for that file rather than returning NaN', async () => {
    // "throw a `RangeError` for a zero record duration rather than returning `NaN`"
    expect(FLAT).toContain('throw a `RangeError` for a zero record duration rather than returning');
    const { header } = await openEdf(
      byteSource(
        buildEdf({
          recordCount: 2,
          recordDurationSeconds: 0,
          signals: [{ label: 'Stage', samplesPerRecord: 1 }],
        }),
      ),
    );
    const stage = getSignal(header, 'Stage');
    expect(() => gridSampleIndexAt(stage, 1, header.recordDurationTicks)).toThrow(RangeError);
    expect(() => gridSampleStartTicks(stage, 1, header.recordDurationTicks)).toThrow(RangeError);
  });

  it('floors rather than rounds, so a boundary is not one sample late', async () => {
    // A time just before a sample's start belongs to the sample already running.
    const { header, signal } = await awkwardSignal();
    const oneStart = gridSampleStartTicks(signal, 1, header.recordDurationTicks);
    const justBefore = (Number(oneStart) - 1) / 1e7;
    expect(gridSampleIndexAt(signal, justBefore, header.recordDurationTicks).sampleIndex).toBe(0);
    // Whereas rounding the naive product would already have reached sample 1.
    expect(Math.round(justBefore * (signal.sampleRateHz ?? 0))).toBe(1);
  });
});

describe('the rounding rule that keeps the pair inverse', () => {
  it('puts the sample the page names on a half tick', async () => {
    // "128 samples over 0.3 s puts sample 1 at 23,437.5 ticks"
    const printed = /puts sample (\d+) at ([\d,.]+) ticks/.exec(FLAT);
    expect(printed).not.toBeNull();
    const exact =
      (Number(printed?.[1]) * AWKWARD.recordDurationSeconds * 1e7) / AWKWARD.samplesPerRecord;
    expect(exact).toBe(Number((printed?.[2] ?? '').replaceAll(',', '')));
    expect(Number.isInteger(exact)).toBe(false);

    const { header, signal } = await awkwardSignal();
    // Rounded up, because 100 ns is the finest unit edfcore has.
    expect(gridSampleStartTicks(signal, Number(printed?.[1]), header.recordDurationTicks)).toBe(
      BigInt(Math.ceil(exact)),
    );
  });

  it('is inverse for every index of a signal whose boundaries are not whole ticks', async () => {
    // "Truncating would return a tick lying inside the previous sample, and `gridSampleIndexAt`
    //  would send it straight back there. Rounding up keeps the two functions inverse for every
    //  index." Checked across several records, since the drift the page warns about accumulates.
    const { header, signal } = await awkwardSignal();
    const total = AWKWARD.samplesPerRecord * header.recordCount;
    for (let index = 0; index < total; index += 1) {
      const ticks = gridSampleStartTicks(signal, index, header.recordDurationTicks);
      const seconds = Number(ticks) / 1e7;
      expect(
        gridSampleIndexAt(signal, seconds, header.recordDurationTicks).sampleIndex,
        `sample ${index}`,
      ).toBe(index);
    }
  });

  it('would not be inverse if the tick were truncated instead', async () => {
    // Stated as a counterfactual, because the rule is invisible when it works: the truncated tick
    // of a half-tick boundary lands inside the previous sample.
    const { header, signal } = await awkwardSignal();
    let landedEarly = 0;
    for (let index = 1; index < AWKWARD.samplesPerRecord; index += 1) {
      const exact = (index * AWKWARD.recordDurationSeconds * 1e7) / AWKWARD.samplesPerRecord;
      if (Number.isInteger(exact)) continue;
      const truncated = Math.floor(exact) / 1e7;
      if (gridSampleIndexAt(signal, truncated, header.recordDurationTicks).sampleIndex < index) {
        landedEarly += 1;
      }
    }
    expect(landedEarly).toBeGreaterThan(0);
  });

  it('agrees with the seconds form, which is the same value divided out', async () => {
    const { header, signal } = await awkwardSignal();
    for (const index of [0, 1, 127, 128, 500]) {
      const ticks = gridSampleStartTicks(signal, index, header.recordDurationTicks);
      expect(gridSampleStartSeconds(signal, index, header.recordDurationTicks)).toBe(
        Number(ticks) / 1e7,
      );
    }
  });
});
