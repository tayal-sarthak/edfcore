/**
 * `declaredDurationSeconds` and `isAnnotationLabel`, the two entry points in `header/lookup.ts` that
 * still took anything.
 *
 * `declaredDurationSeconds` is the one function in that module whose NAME says recording — "the
 * recording's total declared length in seconds" — so passing the recording is what it invites, and
 * `BigInt(undefined)` answered "Cannot convert undefined to a BigInt": not edfcore's voice, no
 * `Next:` clause, and nothing about the argument.
 *
 * `isAnnotationLabel` is the module's only plain-string argument, and it reads as a predicate, so
 * `header.signals.filter(isAnnotationLabel)` is the shape it invites. That reached `trimEdfField`
 * and threw "text.slice is not a function" (fixed in 0.6.108).
 */

import { describe, expect, it } from 'vitest';
import { declaredDurationSeconds, isAnnotationLabel } from '../../../src/header/lookup.js';
import { byteSource } from '../../../src/io/bytes.js';
import { openEdf } from '../../../src/recording.js';
import type { EdfHeader } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

const BYTES = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = () => openEdf(byteSource(BYTES));

/** The cast a JavaScript caller does not need to write. */
const loosely = <T>(value: unknown) => value as T;

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the argument was accepted');
}

describe('declaredDurationSeconds', () => {
  it('names the recording as not a header, and says which field to reach for', async () => {
    const recording = await opened();
    const message = refusal(() => declaredDurationSeconds(loosely<EdfHeader>(recording)));
    expect(message).toContain('declaredDurationSeconds(): that is not a header');
    expect(message).toContain('Next: pass recording.header');
  });

  it('names the other number a reader asking this might want', async () => {
    const recording = await opened();
    expect(refusal(() => declaredDurationSeconds(loosely<EdfHeader>(recording)))).toContain(
      'timeline.spanSeconds',
    );
  });

  it('says nothing about BigInt, which is an implementation detail', async () => {
    const recording = await opened();
    expect(refusal(() => declaredDurationSeconds(loosely<EdfHeader>(recording)))).not.toContain(
      'BigInt',
    );
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['a signal', 'signal'],
  ])('refuses %s', async (_described, given) => {
    const recording = await opened();
    const value = given === 'signal' ? recording.header.signals[0] : given;
    expect(refusal(() => declaredDurationSeconds(loosely<EdfHeader>(value)))).toContain(
      'it has no recordCount',
    );
  });

  it('accepts the timeline, which carries both fields and gives the same answer', async () => {
    // Not an oversight to guard against: `EdfTimeline` declares `recordCount` and
    // `recordDurationTicks` with the same meanings, so the arithmetic is the header's arithmetic.
    // Recorded here so a later tightening of the check is a decision rather than an accident.
    const recording = await opened();
    expect(declaredDurationSeconds(loosely<EdfHeader>(recording.timeline))).toBe(
      declaredDurationSeconds(recording.header),
    );
  });

  it('still answers for a real header, including a zero-duration file', async () => {
    const recording = await opened();
    expect(declaredDurationSeconds(recording.header)).toBe(4);
  });
});

describe('isAnnotationLabel', () => {
  it('refuses the signal, which is what a predicate invites', async () => {
    const recording = await opened();
    const message = refusal(() => isAnnotationLabel(loosely<string>(recording.header.signals[1])));
    expect(message).toContain('isAnnotationLabel(): the label is an object, not a string');
    expect(message).toContain('Next: pass signal.label');
  });

  it('says nothing about an internal name', async () => {
    const recording = await opened();
    expect(
      refusal(() => isAnnotationLabel(loosely<string>(recording.header.signals[1]))),
    ).not.toContain('slice is not a function');
  });

  it('still answers for the labels it is about', async () => {
    const recording = await opened();
    const labels = recording.header.signals.map((signal) => signal.label);
    expect(labels.map(isAnnotationLabel)).toEqual([false, true]);
    expect(isAnnotationLabel('BDF Annotations')).toBe(true);
  });
});
