/**
 * How the inspector puts a sample on the time axis.
 *
 * It computed `signal.samplesPerRecord / (recordDurationSeconds || 1)` and then plotted sample
 * `i` at `part.startSeconds + i / rate`. That is mistake 3 on `AGENTS.md` — "Do not compute
 * sample indices from `sampleRateHz`. It is derived and can be `undefined`. Use
 * `samplesPerRecord`, or `trimToWindow` for an exact window" — and it is the whole reason
 * `sample-grid.ts` exists: "Every viewer needs this and the obvious spelling is wrong."
 *
 * A record duration that does not divide leaves the rate irrational in binary. 128 samples over
 * 0.3 s is 426.666…, so `i / rate` drifts from the sample's real position as `i` grows, on the
 * page whose whole job is showing that edfcore gets this right. The `|| 1` beside it invented a
 * rate for the legal zero record duration, where the library reports none (fixed in 0.6.76).
 *
 * The drift is measured below against `gridSampleStartTicks`, which is exact, on the awkward
 * record duration the library's own docblock names.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../../src/constants.js';
import { gridSampleStartSeconds, gridSampleStartTicks } from '../../src/sample-grid.js';
import type { EdfSignal } from '../../src/types.js';

const DEMO = readFileSync(new URL('../../website/src/pages/demo.astro', import.meta.url), 'utf8');

/** 128 samples over 0.3 s — the shape `sample-grid.ts` names, where the rate is 426.666…. */
const SIGNAL = { samplesPerRecord: 128 } as EdfSignal;
const DURATION_TICKS = (3n * TICKS_PER_SECOND) / 10n;

/** `samplesPerRecord / recordDurationSeconds`, which is what the page computed. */
const DERIVED_RATE = SIGNAL.samplesPerRecord / 0.3;

describe('the two ways of placing sample i', () => {
  it('disagree from the very first sample, by more than a tick', () => {
    const derived = 1 / DERIVED_RATE;
    const exact = gridSampleStartSeconds(SIGNAL, 1, DURATION_TICKS);
    expect(derived).not.toBe(exact);
    // A tick is 1e-7 s, so this is a real position difference rather than a rounding artefact.
    expect(Math.abs(derived - exact)).toBeGreaterThan(1e-8);
  });

  it('disagree further out, where a viewer is actually scrubbing', () => {
    const index = 4_000_001;
    const derived = index / DERIVED_RATE;
    const exact = Number(gridSampleStartTicks(SIGNAL, index, DURATION_TICKS)) / 1e7;
    expect(derived).not.toBe(exact);
  });

  it('has the grid land on exact ticks, which a float rate cannot promise', () => {
    // 0.3 s over 128 samples is 23437.5 ticks: sample 2 is exactly 46,875.
    expect(gridSampleStartTicks(SIGNAL, 2, DURATION_TICKS)).toBe(46_875n);
    // An odd index lands mid-tick, and the grid CEILINGS there — truncating would return a tick
    // inside the PREVIOUS sample, which is the rule `gridSampleStartTicks` states for itself.
    expect(gridSampleStartTicks(SIGNAL, 1, DURATION_TICKS)).toBe(23_438n);
  });
});

describe('the inspector', () => {
  it('places samples on the signal’s own grid', () => {
    expect(DEMO).toContain('gridSampleStartSeconds(signal, i, durationTicks)');
  });

  it('no longer derives a rate, or substitutes one for a zero duration', () => {
    expect(DEMO).not.toContain(
      'signal.samplesPerRecord / (recording?.header.recordDurationSeconds',
    );
    expect(DEMO).not.toMatch(/const rate = .*samplesPerRecord/);
    // The phrase survives in the comment explaining the fix; what must not is the expression.
    expect(DEMO).not.toMatch(/startSeconds \+ i \/ rate/);
  });

  it('still measures from the chunk’s own start, so a gap does not shift the trace', () => {
    expect(DEMO).toContain('part.startSeconds + gridSampleStartSeconds');
  });
});
