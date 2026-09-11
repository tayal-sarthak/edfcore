/**
 * The last tick-derived number on the inspector that was still read as a float.
 *
 * Three values on that page come from exact tick counts, and all three were taken from the
 * float64 seconds beside them: the contiguity test (0.6.75), the event clock (0.6.82) and the
 * summary's Duration. `EdfTimeline` says which field carries a span — "the ticks are what it must
 * be asked of" — and the Duration is the headline number on the summary (fixed in 0.6.88).
 *
 * The float route fails the same way the event clock did: one tick short of a whole second, at a
 * scale where a tick is below the float's ulp, `spanSeconds` rounds up and flooring it names a
 * recording a second longer than it is.
 *
 * This file is the sweep rather than a fourth one-off: it reads the page and asserts that no
 * `*Seconds` field of the timeline or of an annotation is handed to a clock or compared against
 * another, so a fourth site cannot be added quietly.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../../src/constants.js';
import { ticksToSeconds } from '../../src/tal/ticks.js';

const DEMO = readFileSync(new URL('../../website/src/pages/demo.astro', import.meta.url), 'utf8');

describe('a span one tick short of a whole second', () => {
  it('floors to the second before it, exactly', () => {
    const ticks = 10_000_000_000n * TICKS_PER_SECOND - 1n;
    expect(ticks / TICKS_PER_SECOND).toBe(9_999_999_999n);
  });

  it('names the second after it through the float, which is a longer recording', () => {
    const ticks = 10_000_000_000n * TICKS_PER_SECOND - 1n;
    expect(Math.floor(ticksToSeconds(ticks))).toBe(10_000_000_000);
  });
});

describe('the inspector', () => {
  it('takes its Duration from the span in ticks', () => {
    expect(DEMO).toContain("['Duration', eventClock(timeline.spanTicks)]");
  });

  it('takes its contiguity verdict from the ticks', () => {
    expect(DEMO).toContain('opened.timeline.spanTicks !== opened.timeline.coveredTicks');
  });

  it('takes its event clock from the ticks', () => {
    expect(DEMO).toContain('eventClock(a.onsetTicksFromFirstRecord)');
  });
});

describe('and no float64 seconds are used for any of the three jobs', () => {
  /** The page with comments stripped, so the prose explaining these fixes is not scanned. */
  const CODE = DEMO.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('hands no *Seconds field to a clock', () => {
    expect(CODE).not.toMatch(/(?:hhmmss|eventClock)\([\w.]*\.\w*Seconds\b/);
  });

  it('compares no *Seconds field against another', () => {
    expect(CODE).not.toMatch(/\.\w*Seconds\s*[!=]==\s*[\w.]*\.\w*Seconds\b/);
  });

  it('still uses the seconds for the scrub controls, which are float inputs anyway', () => {
    // `position` and `windowLength` are range inputs read with `Number(...)`: there is no exact
    // value behind them to lose, and `readWindow` takes seconds.
    expect(CODE).toContain('const startSeconds = Number(position.value)');
  });
});
