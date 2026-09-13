/**
 * The header argument of `header/lookup.ts`, in every entry point that takes one.
 *
 * 0.6.108 named this gap in the file itself, in the docblock of the one function it fixed: "the
 * header, which this module's other four entry points also take and which none of them checked".
 * `declaredDurationSeconds` got its guard; `findSignals`, `getSignal` and `matchSignals` did not,
 * so the module both stated the rule and broke it three times.
 *
 * The mistake they invite is the one 0.6.111 swept out of the reading entry points: `openEdf`
 * resolves to a recording and the header hangs off it, so `getSignal(recording, 'Fp1')` is what a
 * caller writes when they have the recording in hand. All three reached `header.signals` and threw
 * V8's `Cannot read properties of undefined (reading 'filter')`.
 *
 * `getSignal(recording, 0)` was the worst of the three, and the reason this is worth a release
 * rather than a nicety: it indexes `header.signals[selector]`, so the message came back as "Cannot
 * read properties of undefined (reading '0')" — a complaint about the selector, which was the
 * argument that was right.
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import {
  declaredDurationSeconds,
  findSignals,
  getSignal,
  matchSignals,
} from '../../src/header/lookup.js';

/** Called with something that is not a header, the way a JavaScript caller can. */
type OneHeader = (header: unknown) => unknown;

const TAKE_A_HEADER: ReadonlyArray<readonly [string, OneHeader]> = [
  [
    'findSignals',
    (header) =>
      (findSignals as never as OneHeader & ((h: unknown, l: string) => unknown))(header, 'A1'),
  ],
  [
    'getSignal',
    (header) => (getSignal as never as (h: unknown, s: string) => unknown)(header, 'A1'),
  ],
  [
    'matchSignals',
    (header) => (matchSignals as never as (h: unknown, m: RegExp) => unknown)(header, /A/),
  ],
  ['declaredDurationSeconds', (header) => (declaredDurationSeconds as never as OneHeader)(header)],
];

/** What a caller has in hand when they meant `recording.header`: no `signals`, no `recordCount`. */
const RECORDING = { header: { signals: [], recordCount: 4 }, source: {}, timeline: {}, index: {} };

describe.each(TAKE_A_HEADER)('%s given the recording', (name, call) => {
  it('throws a RangeError rather than a TypeError', () => {
    expect(() => call(RECORDING)).toThrow(RangeError);
    expect(() => call(RECORDING)).not.toThrow(TypeError);
  });

  it('is a caller mistake, so isEdfError says false', () => {
    let thrown: unknown;
    try {
      call(RECORDING);
    } catch (error) {
      thrown = error;
    }
    expect(isEdfError(thrown)).toBe(false);
  });

  it('names the call and sends the reader to recording.header', () => {
    expect(() => call(RECORDING)).toThrow(new RegExp(`^${name}\\(\\): that is not a header`));
    expect(() => call(RECORDING)).toThrow(/Next: pass recording\.header/);
  });

  it('says nothing about the field it happened to read first', () => {
    expect(() => call(RECORDING)).not.toThrow(/Cannot read properties/);
  });
});

describe('the selector is not blamed for the header', () => {
  it("getSignal(recording, 0) no longer complains about '0'", () => {
    expect(() => (getSignal as never as (h: unknown, s: number) => unknown)(RECORDING, 0)).toThrow(
      /^getSignal\(\): that is not a header/,
    );
    expect(() =>
      (getSignal as never as (h: unknown, s: number) => unknown)(RECORDING, 0),
    ).not.toThrow(/signal index 0|reading '0'/);
  });
});

describe('a real header still answers', () => {
  const header = {
    signals: [
      { index: 0, label: 'A1', kind: 'data' },
      { index: 1, label: 'A2', kind: 'data' },
    ],
  };
  it('finds, gets and matches as before', () => {
    expect(findSignals(header as never, 'A1')).toHaveLength(1);
    expect(getSignal(header as never, 1)).toBe(header.signals[1]);
    expect(matchSignals(header as never, /A/)).toHaveLength(2);
  });
});
