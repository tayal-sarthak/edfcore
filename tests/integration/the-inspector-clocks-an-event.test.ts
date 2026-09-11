/**
 * The clock the inspector prints beside each event.
 *
 * It read `onsetSecondsFromFirstRecord` and floored it. `format-annotations.ts` states the rule
 * for the library's own event list, and states why it is not fussiness: "The clock is built from
 * `onsetTicksFromFirstRecord` by integer division, never from the float seconds …
 * `onsetSecondsFromFirstRecord` is a float64 produced by dividing an exact tick count by
 * 10,000,000, so an onset written `+1.0000001` can print a … field that is off by one — and an
 * event list is exactly where someone reads a number off the screen and types it into something
 * else." The inspector's table IS that event list (fixed in 0.6.82).
 *
 * The float route has a second failure the seconds field hides: an onset whose exact tick count
 * sits a hair below a whole second can convert UP to that second and print the later one. The
 * test below finds such a tick count rather than assuming one exists.
 *
 * Negative onsets are legal — EDF+ measures from the header start time and a recording may begin
 * after its first annotation — so the sign is kept, as `format-annotations.ts` keeps it.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../../src/constants.js';
import { ticksToSeconds } from '../../src/tal/ticks.js';

const DEMO = readFileSync(new URL('../../website/src/pages/demo.astro', import.meta.url), 'utf8');

describe('the two routes to a whole second', () => {
  it('disagree where a tick count converts up across the boundary', () => {
    // One tick short of 1e10 seconds: exact division floors to the second before it.
    const ticks = 10_000_000_000n * TICKS_PER_SECOND - 1n;
    expect(ticks / TICKS_PER_SECOND).toBe(9_999_999_999n);
    // The float conversion rounds to the boundary — one tick is below its ulp there — and
    // flooring THAT names the later second, which is an instant after the event.
    expect(Math.floor(ticksToSeconds(ticks))).toBe(10_000_000_000);
  });

  it('agree on ordinary onsets, which is why the float route looked fine', () => {
    for (const seconds of [0n, 1n, 30n, 3600n, 100_000n]) {
      const ticks = seconds * TICKS_PER_SECOND;
      expect(BigInt(Math.floor(ticksToSeconds(ticks)))).toBe(ticks / TICKS_PER_SECOND);
    }
  });
});

describe('the inspector', () => {
  it('clocks an event from its ticks', () => {
    expect(DEMO).toContain('eventClock(a.onsetTicksFromFirstRecord)');
  });

  it('no longer clocks it from the float seconds', () => {
    expect(DEMO).not.toContain('hhmmss(a.onsetSecondsFromFirstRecord)');
  });

  it('floors, and keeps the sign a negative onset carries', () => {
    const clock =
      /const eventClock = \(ticks: bigint\) => \{([\s\S]*?)\n {2}\};/.exec(DEMO)?.[1] ?? '';
    expect(clock).toContain('TICKS_PER_SECOND');
    expect(clock).toContain("whole < 0n ? '-' : ''");
  });
});
