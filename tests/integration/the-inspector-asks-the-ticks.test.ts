/**
 * The contiguity question the inspector asks before it decides to index a file.
 *
 * `EdfTimeline` is explicit about which fields carry the two-probe verdict: "`spanTicks ===
 * coveredTicks` is the two-probe contiguity verdict, and the ticks are what it must be asked of.
 * The seconds beside them are float64 conversions of these, and two different tick counts can
 * round to one float: once the span is large enough that an ulp exceeds a tick — around 4e8
 * seconds ... a real discontinuity disappears from the comparison." That paragraph records the
 * same defect being fixed inside `resolveTimeWindow` in 0.3.4.
 *
 * `demo.astro` asked it of `spanSeconds !== coveredSeconds`. On a file whose span reaches that
 * size the answer is "contiguous", `buildRecordIndex` is skipped, and the page draws a
 * discontinuous recording on the nominal grid — which is the silently wrong timeline the library
 * exists to refuse, on the page that is its central claim made checkable (fixed in 0.6.75).
 *
 * The collision is demonstrated rather than argued: two tick counts a tick apart, converted, come
 * back as one float.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../../src/constants.js';
import { ticksToSeconds } from '../../src/tal/ticks.js';

const DEMO = readFileSync(new URL('../../website/src/pages/demo.astro', import.meta.url), 'utf8');

describe('the seconds the question was asked of', () => {
  it('lose a tick once the span is large enough', () => {
    const span = 10_000_000_000n * TICKS_PER_SECOND;
    expect(ticksToSeconds(span)).toBe(ticksToSeconds(span + 1n));
    // So a one-tick discontinuity at that scale is invisible to a seconds comparison...
    expect(span === span + 1n).toBe(false);
  });

  it('still separate them at an ordinary scale, which is why this hid', () => {
    const span = 3600n * TICKS_PER_SECOND;
    expect(ticksToSeconds(span)).not.toBe(ticksToSeconds(span + 1n));
  });
});

describe('the inspector', () => {
  it('compares the exact fields', () => {
    expect(DEMO).toContain('opened.timeline.spanTicks !== opened.timeline.coveredTicks');
  });

  it('does not compare the float64 ones', () => {
    expect(DEMO).not.toContain('spanSeconds !== opened.timeline.coveredSeconds');
    expect(DEMO).not.toMatch(/spanSeconds\s*!==\s*\w*\.?coveredSeconds/);
  });

  it('still indexes a file the reserved field already calls discontinuous', () => {
    expect(DEMO).toContain("header.continuity === 'discontinuous'");
  });
});
