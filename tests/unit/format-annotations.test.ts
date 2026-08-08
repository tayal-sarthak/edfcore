/**
 * formatAnnotations.
 *
 * Two decisions are worth pinning: the clock comes from exact ticks rather than from the float
 * seconds, and a negative onset prints as one instead of being clamped.
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../../src/constants.js';
import { formatAnnotations } from '../../src/format-annotations.js';
import type { EdfAnnotation } from '../../src/types.js';

function annotation(
  onsetSeconds: number,
  text: string,
  durationSeconds?: number,
  channelLabel?: string,
): EdfAnnotation {
  const ticks = BigInt(Math.round(onsetSeconds * Number(TICKS_PER_SECOND)));
  return {
    onsetSecondsFromHeaderStart: onsetSeconds,
    onsetSecondsFromFirstRecord: onsetSeconds,
    onsetTicks: ticks,
    onsetTicksFromFirstRecord: ticks,
    onsetRaw: `+${onsetSeconds}`,
    durationSeconds,
    durationTicks:
      durationSeconds === undefined
        ? undefined
        : BigInt(Math.round(durationSeconds * Number(TICKS_PER_SECOND))),
    durationRaw: durationSeconds === undefined ? undefined : String(durationSeconds),
    text,
    channelLabel,
    signalIndex: 1,
    recordIndex: 0,
    byteOffsetInRecord: 0,
    textEncoding: 'utf-8',
  } as EdfAnnotation;
}

describe('the clock', () => {
  it('renders hours, minutes, seconds and milliseconds', () => {
    const out = formatAnnotations([annotation(3661.25, 'Spindle')]);
    expect(out).toContain('01:01:01.250');
    expect(out).toContain('Spindle');
  });

  it('does not wrap past 24 hours', () => {
    // A 30-hour recording is a real thing, and 06:12 on day two is worse than 30:12.
    expect(formatAnnotations([annotation(30 * 3600 + 720, 'Late')])).toContain('30:12:00.000');
  });

  it('prints a negative onset rather than clamping it', () => {
    // EDF+ measures onsets from the header start time, and a recording may begin after its first
    // annotation. Clamping to zero would silently move the event.
    expect(formatAnnotations([annotation(-1.5, 'Before')])).toContain('-00:00:01.500');
  });

  it('truncates to the millisecond rather than rounding up past the event', () => {
    // 1.0009999 s must not print as 1.001, which names an instant after the event.
    const event = annotation(0, 'Precise');
    const shifted: EdfAnnotation = { ...event, onsetTicksFromFirstRecord: 10_009_999n };
    expect(formatAnnotations([shifted])).toContain('00:00:01.000');
  });

  it('truncates a NEGATIVE onset away from zero, not toward it', () => {
    // The same promise, in the direction that got it wrong. -1.5009 s truncated by magnitude
    // printed -00:00:01.500, which is 0.9 ms AFTER the event — so the guarantee held only for
    // positive onsets, which is the half that does not need it. Flooring gives -00:00:01.501.
    const event = annotation(0, 'Before the start');
    const before: EdfAnnotation = { ...event, onsetTicksFromFirstRecord: -15_009_000n };
    expect(formatAnnotations([before])).toContain('-00:00:01.501');

    // A sub-millisecond negative onset floors to the millisecond below it for the same reason.
    const barely: EdfAnnotation = { ...event, onsetTicksFromFirstRecord: -1n };
    expect(formatAnnotations([barely])).toContain('-00:00:00.001');

    // An exact millisecond is unchanged: flooring only moves a value that has a remainder.
    const exact: EdfAnnotation = { ...event, onsetTicksFromFirstRecord: -15_000_000n };
    expect(formatAnnotations([exact])).toContain('-00:00:01.500');
  });

  it('builds the clock from ticks, not from the float seconds', () => {
    // The two fields are deliberately made to disagree here: only a formatter reading the exact
    // one produces 02:00:00.000. This is the assertion the whole design decision rests on.
    const event = annotation(0, 'Exact');
    const misleading: EdfAnnotation = {
      ...event,
      onsetTicksFromFirstRecord: 72_000_000_000n,
      onsetSecondsFromFirstRecord: 999,
    };
    expect(formatAnnotations([misleading])).toContain('02:00:00.000');
    expect(formatAnnotations([misleading])).not.toContain('00:16:39');
  });
});

describe('the listing', () => {
  it('returns an empty string for no annotations, so it concatenates cleanly', () => {
    expect(formatAnnotations([])).toBe('');
  });

  it('shows a duration only when there is one', () => {
    // An omitted duration and an explicit 0 are the same instant, so both print blank.
    const out = formatAnnotations([
      annotation(0, 'Instant'),
      annotation(1, 'ExplicitZero', 0),
      annotation(2, 'Epoch', 30),
    ]);
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/00:00:00\.000\s+Instant$/);
    expect(lines[1]).toMatch(/00:00:01\.000\s+ExplicitZero$/);
    expect(lines[2]).toContain('00:00:30.000');
    expect(lines[2]).toContain('Epoch');
  });

  it('says how many it withheld', () => {
    const many = Array.from({ length: 10 }, (_, i) => annotation(i, `event ${i}`));
    const out = formatAnnotations(many, { maxItems: 3 });
    expect(out.split('\n')).toHaveLength(4);
    expect(out).toContain('... and 7 more');
  });

  it('keeps the caller order rather than re-sorting', () => {
    // `readAnnotations` already sorts by onset, and re-sorting here would discard a deliberate
    // filterAnnotationsByText ordering.
    const out = formatAnnotations([annotation(9, 'Ninth'), annotation(1, 'First')]);
    expect(out.indexOf('Ninth')).toBeLessThan(out.indexOf('First'));
  });

  it('includes the channel label only when asked', () => {
    const scoped = [annotation(0, 'Spike', undefined, 'Fp1')];
    expect(formatAnnotations(scoped)).not.toContain('@@Fp1');
    expect(formatAnnotations(scoped, { includeChannel: true })).toContain('@@Fp1');
  });
});
