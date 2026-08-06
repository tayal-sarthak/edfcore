/**
 * Annotation queries.
 *
 * The interesting cases are the boundaries: an event exactly on a window edge, an event with a
 * duration that only overlaps, and onsets whose float64 seconds do not round-trip. Every
 * comparison is on `onsetTicksFromFirstRecord`, so the last of those has to hold. These fixtures
 * declare no start offset, so that field equals `onsetTicks`; the file that separates them lives
 * in tests/integration/annotation-timebase.test.ts.
 */

import { describe, expect, it } from 'vitest';
import {
  annotationsAt,
  countAnnotationsByText,
  filterAnnotationsByText,
  filterAnnotationsByTime,
} from '../../src/annotations-query.js';
import { TICKS_PER_SECOND } from '../../src/constants.js';
import type { EdfAnnotation } from '../../src/types.js';

function annotation(onsetSeconds: number, text: string, durationSeconds?: number): EdfAnnotation {
  const onsetTicks = BigInt(Math.round(onsetSeconds * Number(TICKS_PER_SECOND)));
  const durationTicks =
    durationSeconds === undefined
      ? undefined
      : BigInt(Math.round(durationSeconds * Number(TICKS_PER_SECOND)));
  return {
    onsetSecondsFromHeaderStart: onsetSeconds,
    onsetSecondsFromFirstRecord: onsetSeconds,
    onsetTicks,
    onsetTicksFromFirstRecord: onsetTicks,
    onsetRaw: `+${onsetSeconds}`,
    durationSeconds,
    durationTicks,
    durationRaw: durationSeconds === undefined ? undefined : String(durationSeconds),
    text,
    channelLabel: undefined,
    signalIndex: 1,
    recordIndex: 0,
    byteOffsetInRecord: 0,
    textEncoding: 'utf-8',
  } as EdfAnnotation;
}

describe('filterAnnotationsByTime', () => {
  const events = [
    annotation(0, 'Sleep stage W', 30),
    annotation(30, 'Sleep stage N1', 30),
    annotation(60, 'Sleep stage N2', 30),
    annotation(45, 'Arousal'),
  ];

  it('is half-open, so adjacent windows partition without double counting', () => {
    const first = filterAnnotationsByTime(events, { startSeconds: 30, durationSeconds: 30 });
    const second = filterAnnotationsByTime(events, { startSeconds: 60, durationSeconds: 30 });
    // The N1 epoch ends exactly at 60 and must not appear in the window starting there.
    expect(first.map((a) => a.text)).toEqual(['Sleep stage N1', 'Arousal']);
    expect(second.map((a) => a.text)).toEqual(['Sleep stage N2']);
  });

  it('returns an epoch that merely overlaps the window', () => {
    // A 30 s epoch is what a window inside it is part of; containment would return nothing.
    const inside = filterAnnotationsByTime(events, { startSeconds: 35, durationSeconds: 5 });
    expect(inside.map((a) => a.text)).toEqual(['Sleep stage N1']);
  });

  it('returns nothing for a non-positive duration', () => {
    expect(filterAnnotationsByTime(events, { startSeconds: 0, durationSeconds: 0 })).toEqual([]);
    expect(filterAnnotationsByTime(events, { startSeconds: 0, durationSeconds: -5 })).toEqual([]);
  });

  it('compares exactly, where float seconds would not', () => {
    // 0.1 + 0.2 !== 0.3 in float64. The tick counts are exact, so the boundary is too.
    const tricky = [annotation(0.3, 'exact')];
    const window = { startSeconds: 0.1 + 0.2, durationSeconds: 1 };
    expect(window.startSeconds).not.toBe(0.3);
    expect(filterAnnotationsByTime(tricky, window).map((a) => a.text)).toEqual(['exact']);
  });
});

describe('filterAnnotationsByText', () => {
  const events = [
    annotation(0, 'Sleep stage W'),
    annotation(30, 'Sleep stage REM'),
    annotation(60, 'Sleep stage W'),
  ];

  it('matches a string exactly, not as a substring', () => {
    // Substring matching on 'W' would also catch spellings like 'W/REM'.
    expect(filterAnnotationsByText(events, 'Sleep stage W')).toHaveLength(2);
    expect(filterAnnotationsByText(events, 'Sleep')).toHaveLength(0);
  });

  it('accepts a RegExp and a predicate when looser matching is wanted', () => {
    expect(filterAnnotationsByText(events, /^Sleep/)).toHaveLength(3);
    expect(filterAnnotationsByText(events, (text) => text.endsWith('REM'))).toHaveLength(1);
  });
});

describe('countAnnotationsByText', () => {
  it('counts by exact text, most frequent first', () => {
    const events = [
      annotation(0, 'Sleep stage W'),
      annotation(30, 'Sleep stage N2'),
      annotation(60, 'Sleep stage W'),
      annotation(90, 'Sleep stage W'),
      annotation(120, 'Sleep stage N2'),
    ];
    expect(countAnnotationsByText(events)).toEqual([
      { text: 'Sleep stage W', count: 3 },
      { text: 'Sleep stage N2', count: 2 },
    ]);
  });

  it('returns an empty list for no annotations', () => {
    expect(countAnnotationsByText([])).toEqual([]);
  });
});

describe('annotationsAt', () => {
  const events = [
    annotation(0, 'Sleep stage W', 30),
    annotation(30, 'Sleep stage N1', 30),
    annotation(45, 'Arousal'),
  ];

  it('covers the half-open span of an annotation with a duration', () => {
    expect(annotationsAt(events, 30).map((a) => a.text)).toEqual(['Sleep stage N1']);
    expect(annotationsAt(events, 59.9).map((a) => a.text)).toEqual(['Sleep stage N1']);
    // 60 is the start of the next epoch, not the end of this one.
    expect(annotationsAt(events, 60)).toEqual([]);
  });

  it('matches a zero-duration event only at its own onset', () => {
    expect(annotationsAt(events, 45).map((a) => a.text)).toEqual(['Sleep stage N1', 'Arousal']);
    expect(annotationsAt(events, 45.0001).map((a) => a.text)).toEqual(['Sleep stage N1']);
  });

  it('is what a cursor needs, where a zero-length window returns nothing', () => {
    // filterAnnotationsByTime refuses a non-positive duration, so the obvious call returns []
    // at every position.
    expect(filterAnnotationsByTime(events, { startSeconds: 45, durationSeconds: 0 })).toEqual([]);
    expect(annotationsAt(events, 45).length).toBeGreaterThan(0);
  });
});

describe('an instantaneous event is instantaneous however the writer spelled it', () => {
  // A TAL may write `+0.5\x150\x14Marker` or `+0.5\x14Marker`; both name the same instant, and
  // annotations.md says edfcore does not distinguish them. Before 0.2.20 filterAnnotationsByTime
  // keyed its left-edge clause on `durationTicks === undefined`, i.e. on the spelling, so the
  // explicit `0` form vanished from the window that starts at its own onset.
  const explicit = annotation(0.5, 'ExplicitZero', 0);
  const omitted = annotation(0.5, 'OmittedDuration');

  it('includes both at a window that starts exactly on the onset', () => {
    for (const event of [explicit, omitted]) {
      expect(
        filterAnnotationsByTime([event], { startSeconds: 0.5, durationSeconds: 0.5 }).map(
          (a) => a.text,
        ),
      ).toEqual([event.text]);
    }
  });

  it('leaves neither in the window that ends on the onset', () => {
    for (const event of [explicit, omitted]) {
      expect(filterAnnotationsByTime([event], { startSeconds: 0, durationSeconds: 0.5 })).toEqual(
        [],
      );
    }
  });

  it('gives an adjacent-window partition exactly one home for each', () => {
    // The sharp end of the defect: an explicitly-zero event fell out of the window starting at its
    // onset AND out of the one before it, so a partition of the recording lost it entirely.
    const events = [explicit, omitted];
    const seen = Array.from({ length: 4 }, (_, i) =>
      filterAnnotationsByTime(events, { startSeconds: i * 0.5, durationSeconds: 0.5 }),
    ).flat();
    expect(seen.map((a) => a.text).sort()).toEqual(['ExplicitZero', 'OmittedDuration']);
  });

  it('includes an explicit zero at t = 0, the first window of any partition', () => {
    const atZero = annotation(0, 'Start', 0);
    expect(
      filterAnnotationsByTime([atZero], { startSeconds: 0, durationSeconds: 30 }).map(
        (a) => a.text,
      ),
    ).toEqual(['Start']);
  });

  it('agrees with annotationsAt, which already treated the two alike', () => {
    for (const event of [explicit, omitted]) {
      expect(annotationsAt([event], 0.5).map((a) => a.text)).toEqual([event.text]);
      expect(filterAnnotationsByTime([event], { startSeconds: 0.5, durationSeconds: 0.5 })).toEqual(
        annotationsAt([event], 0.5),
      );
    }
  });

  it('still excludes a positive-duration event that ends exactly at the window start', () => {
    // The fix must not turn the half-open rule into a closed one for real intervals.
    const epoch = annotation(0, 'Epoch', 0.5);
    expect(filterAnnotationsByTime([epoch], { startSeconds: 0.5, durationSeconds: 0.5 })).toEqual(
      [],
    );
  });
});
