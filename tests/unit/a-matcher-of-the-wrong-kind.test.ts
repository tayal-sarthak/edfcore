/**
 * The two functions that take a matcher, given one of the wrong kind.
 *
 * 0.6.86 guarded that a matcher ARRIVED and not what it was, and `test` is then assigned from
 * whatever did. So `matchSignals(header, 'Fp1')` — a plain string, which `matchSignals`'s own
 * docblock says is `findSignals`'s case — reached `test(signal.label)` and threw V8's "test is not a
 * function". That is the likeliest wrong argument this function has: a caller who wants one channel
 * reaches for the function whose name says match.
 *
 * `filterAnnotationsByText` was worse, because a predicate is only called once there is something to
 * call it on. A wrong matcher returned `[]` for a recording with no events and threw for the same
 * argument on the next file — the third time in this package that the quality of a refusal depended
 * on the data rather than on the call (fixed in 0.6.103).
 */

import { describe, expect, it } from 'vitest';
import { filterAnnotationsByText } from '../../src/annotations-query.js';
import { findSignals, matchSignals } from '../../src/header/lookup.js';
import { parseHeader } from '../../src/header/parse.js';
import type { EdfAnnotation } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const BYTES = buildEdf({
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fpz-Cz', samplesPerRecord: 8 },
    { label: 'EEG Pz-Oz', samplesPerRecord: 8 },
  ],
});

const header = parseHeader(BYTES, BYTES.byteLength);

/** The cast a JavaScript caller does not need to write. */
const loosely = <T>(value: unknown) => value as T;

function refusal(run: () => unknown): string {
  const outcome = (() => {
    try {
      return { ok: true as const, value: run() };
    } catch (error) {
      return { ok: false as const, message: (error as Error).message };
    }
  })();
  if (outcome.ok) throw new Error(`accepted, and returned ${JSON.stringify(outcome.value)}`);
  return outcome.message;
}

describe('matchSignals given a plain label', () => {
  it('says what it takes, and names the function that does take a label', () => {
    const message = refusal(() => matchSignals(header, loosely<RegExp>('EEG Fpz-Cz')));
    expect(message).toContain('matchSignals(): the matcher is the string "EEG Fpz-Cz"');
    expect(message).toContain('a RegExp or a predicate on the label');
    expect(message).toContain('findSignals(header, label)');
  });

  it('says nothing about an internal name', () => {
    expect(refusal(() => matchSignals(header, loosely<RegExp>('EEG Fpz-Cz')))).not.toContain(
      'test is not a function',
    );
  });

  it('points somewhere that works', () => {
    expect(findSignals(header, 'EEG Fpz-Cz')).toHaveLength(1);
  });

  it.each([
    ['a number', 0],
    ['an object', {}],
  ])('refuses %s too', (_described, given) => {
    expect(refusal(() => matchSignals(header, loosely<RegExp>(given)))).toContain(
      'this call takes a RegExp or a predicate',
    );
  });

  it('still matches by RegExp and by predicate', () => {
    expect(matchSignals(header, /Fpz/)).toHaveLength(1);
    expect(matchSignals(header, (label) => label.startsWith('EEG'))).toHaveLength(2);
  });
});

describe('filterAnnotationsByText given a matcher of no known kind', () => {
  const EMPTY: readonly EdfAnnotation[] = [];

  it('refuses on an empty list, which is where it used to return []', () => {
    const message = refusal(() => filterAnnotationsByText(EMPTY, loosely<string>(0)));
    // `describeValue` keeps a number bare, and here it reads correctly: nothing about "0" claims
    // to be a string, a RegExp or a predicate, which is the list the same sentence gives.
    expect(message).toContain('filterAnnotationsByText(): the matcher is 0');
    expect(message).toContain('a string matched verbatim, a RegExp, or a predicate on the text');
  });

  it('refuses the same way whatever the list holds, which is the point', () => {
    // A real annotation, onset included: 0.6.208 gave the four queries an element check, so a
    // stand-in missing the field an annotation cannot be without is refused as a list before the
    // matcher is looked at. The property being pinned is about the matcher, not about that.
    const one = [
      { text: 'Sleep stage W', onsetTicksFromFirstRecord: 0n, durationTicks: undefined },
    ] as unknown as readonly EdfAnnotation[];
    expect(refusal(() => filterAnnotationsByText(one, loosely<string>(0)))).toBe(
      refusal(() => filterAnnotationsByText(EMPTY, loosely<string>(0))),
    );
  });

  it('names the predicate a padded vocabulary needs', () => {
    expect(refusal(() => filterAnnotationsByText(EMPTY, loosely<string>(undefined)))).toContain(
      '(text) => text.trim() === label',
    );
  });

  it('still takes all three kinds it documents', () => {
    const events = [
      { text: 'Sleep stage W', onsetTicksFromFirstRecord: 0n, durationTicks: undefined },
      { text: 'Arousal', onsetTicksFromFirstRecord: 0n, durationTicks: undefined },
    ] as unknown as readonly EdfAnnotation[];
    expect(filterAnnotationsByText(events, 'Arousal')).toHaveLength(1);
    expect(filterAnnotationsByText(events, /^Sleep/)).toHaveLength(1);
    expect(filterAnnotationsByText(events, (text) => text.length < 8)).toHaveLength(1);
  });
});
