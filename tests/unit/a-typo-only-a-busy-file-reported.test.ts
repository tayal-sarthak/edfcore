/**
 * The options of `formatAnnotations`, on a recording that carries no events.
 *
 * All three of its option guards sat behind `if (annotations.length === 0) return ''`, so what a
 * caller was told about their own arguments depended on the file in front of them. The same call,
 * written once, was refused on a scoring file and accepted in silence on a plain EDF recording.
 *
 * `format-report.ts` states the rule for the formatter beside it, and states it as a rule rather
 * than as a preference: its `assertOptions` sits "outside the `diagnostics.length > 0` branch
 * below" because "the typo belongs to the call, and the clean file is the cheap place to find out
 * about it". `options.ts` makes the same argument for `requireFunctionOption` from the other end —
 * a guard reached from inside a traversal threw "not at all, on a file with nothing to scan", which
 * is "the data-dependent guard 0.6.169 and 0.6.177 were spent on".
 *
 * The empty list is the common case here, not an edge case. Most EDF files carry no annotations at
 * all, `readAnnotations` on one resolves to an empty array, and a caller building a viewer will
 * open several of those before they open a file with events in it — so the silent reading is the
 * one they get while the code is still being written, and the refusal arrives from a user's file.
 *
 * `formatAnnotations([])` with no options at all still returns `''`, which three other test files
 * pin. Passing no options is not the mistake.
 */

import { describe, expect, it } from 'vitest';
import type { FormatAnnotationsOptions } from '../../src/format-annotations.js';
import { formatAnnotations } from '../../src/format-annotations.js';
import type { EdfAnnotation } from '../../src/types.js';

const EMPTY: readonly EdfAnnotation[] = [];

const EVENT = {
  onsetTicks: 0n,
  onsetSeconds: 0,
  onsetTicksFromFirstRecord: 0n,
  onsetSecondsFromFirstRecord: 0,
  durationTicks: undefined,
  durationSeconds: undefined,
  text: 'Lights out',
  channel: undefined,
  recordIndex: 0,
  isTimekeeping: false,
} as unknown as EdfAnnotation;

type Formatter = (annotations: unknown, options: unknown) => string;
const format = formatAnnotations as unknown as Formatter;

/** Each one is refused on a file with events; the file without them must agree. */
const WRONG: ReadonlyArray<readonly [string, unknown]> = [
  ['a bare number where maxItems goes', 20],
  ['a list where the options go', [20]],
  ['a string where the options go', 'maxItems=20'],
  ['includeChannel as text', { includeChannel: 'true' }],
  ['maxItems as text', { maxItems: '20' }],
];

describe.each(WRONG)('%s', (_name, options) => {
  it('is refused on a recording with events', () => {
    expect(() => format([EVENT], options)).toThrow(RangeError);
  });

  it('is refused on a recording with none of them, for the same reason', () => {
    expect(() => format(EMPTY, options)).toThrow(RangeError);
  });

  it('is refused in the same words either way, so the message does not describe the file', () => {
    const onBusy = (() => {
      try {
        format([EVENT], options);
      } catch (error) {
        return (error as Error).message;
      }
      return undefined;
    })();
    const onEmpty = (() => {
      try {
        format(EMPTY, options);
      } catch (error) {
        return (error as Error).message;
      }
      return undefined;
    })();
    expect(onEmpty).toBe(onBusy);
  });
});

describe('an empty listing', () => {
  it('is still the empty string when the options are right', () => {
    expect(formatAnnotations(EMPTY)).toBe('');
    expect(formatAnnotations(EMPTY, {})).toBe('');
    expect(formatAnnotations(EMPTY, { maxItems: 20, includeChannel: true })).toBe('');
  });

  it('is still the empty string when the options are spelled as no options', () => {
    const asNull = null as unknown as FormatAnnotationsOptions;
    expect(formatAnnotations(EMPTY, asNull)).toBe('');
    expect(formatAnnotations(EMPTY, undefined)).toBe('');
  });
});
