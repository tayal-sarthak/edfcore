/**
 * Exact decimal text -> 100 ns ticks.
 *
 * Every assertion here is about EXACTNESS. An EDF+ onset is a decimal string on disk, and the
 * only defensible reading of it is the one the digits spell: a float64 round trip makes `+0.07`
 * fail to be an integer number of ticks at all, and rounding the eighth fractional digit moves an
 * event to a time that appears in no file.
 *
 * Grammar under test (EDF+ specification 2.2.2, "Time-stamped Annotations Lists"):
 *
 *   Onset    = ("+" / "-") 1*DIGIT [ "." 1*DIGIT ]     ; the sign is MANDATORY
 *   Duration = 1*DIGIT [ "." 1*DIGIT ]                 ; never signed
 */

import { describe, expect, it } from 'vitest';
import {
  parseSignedTicks,
  parseUnsignedTicks,
  secondsToTicks,
  ticksToSeconds,
} from '../../../src/tal/ticks.js';

/** 10^7 ticks to the second, so exactly seven fractional decimal digits are representable. */
const TICKS_PER_SECOND = 10000000n;

/** Built rather than typed, so no control byte or confusable ever lands in this source file. */
const NUL = String.fromCharCode(0x00);
const NBSP = String.fromCharCode(0xa0);
const PLUS_MINUS = String.fromCharCode(0xb1);
const FULLWIDTH_ONE = String.fromCharCode(0xff11);

describe('parseSignedTicks accepts the onset grammar and converts it exactly', () => {
  const accepted: ReadonlyArray<readonly [string, bigint, string]> = [
    ['+0', 0n, 'the file start itself'],
    ['-0', 0n, 'a signed zero is still zero, and bigint has no -0 to leak'],
    ['+30', 300000000n, 'a whole number of seconds'],
    ['+1.25', 12500000n, 'a fraction float64 happens to represent exactly'],
    ['+0.1', 1000000n, 'a fraction float64 does NOT represent exactly'],
    ['+0.07', 700000n, 'a fraction whose float64 product with 1e7 is not even an integer'],
    ['+0.0000001', 1n, 'one tick, the finest time EDF+ can express'],
    ['-0.5', -5000000n, 'a pre-stimulus event'],
    ['+86400', 864000000000n, 'a full day of recording'],
    ['+00000030', 300000000n, 'leading zeros are digits, not padding'],
    ['+1.2500000', 12500000n, 'trailing fractional zeros fill the tick field exactly'],
    ['+0.0000000', 0n, 'seven fractional zeros are seven digits, and all of them are zero'],
    [
      '+922337203685.4775807',
      9223372036854775807n,
      'the largest onset that round-trips through the int64 recordOnsetTicks array',
    ],
  ];

  for (const [text, ticks, why] of accepted) {
    it(`reads ${JSON.stringify(text)} as ${ticks} ticks: ${why}`, () => {
      const parsed = parseSignedTicks(text);
      expect(parsed.ok).toBe(true);
      expect(parsed.ticks).toBe(ticks);
      // The digits are kept verbatim so a caller never has to reconstruct them.
      expect(parsed.raw).toBe(text);
      expect(parsed.seconds).toBe(ticksToSeconds(ticks));
    });
  }

  it('never routes the text through float64: +0.07 is 700000 ticks, which Number cannot produce', () => {
    // Number('0.07') * 1e7 is 700000.0000000001, not even an integer. If the parser multiplied a
    // float by the tick rate, this onset could not come out as an exact tick count at all.
    expect(Number('0.07') * 1e7).not.toBe(700000);
    expect(Number.isInteger(Number('0.07') * 1e7)).toBe(false);
    expect(parseSignedTicks('+0.07').ticks).toBe(700000n);
  });

  it('makes decimal addition exact, which float seconds are not: 0.1 + 0.2 === 0.3 in ticks', () => {
    // The reason ticks are the public comparison type at all (DESIGN section 2, "Time
    // comparison"): float `==` on event times is how ERP alignment silently breaks.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(parseSignedTicks('+0.1').ticks + parseSignedTicks('+0.2').ticks).toBe(
      parseSignedTicks('+0.3').ticks,
    );
  });
});

describe('the sign applies to the WHOLE value, fraction included', () => {
  it('reads -0.5 as -5000000 ticks, not as -0 seconds plus half a second', () => {
    // EDF+ 2.2.4: a negative onset is a pre-stimulus event. Splitting the sign off the fraction
    // reflects such an event about zero, so -0.5 s would be read as +0.5 s: half a second on the
    // wrong side of the trigger, and nothing downstream would look wrong.
    const parsed = parseSignedTicks('-0.5');
    expect(parsed.ok).toBe(true);
    expect(parsed.ticks).toBe(-5000000n);
    expect(parsed.ticks).toBeLessThan(0n);
    expect(parsed.ticks).not.toBe(5000000n);
    expect(parsed.seconds).toBe(-0.5);
  });

  it('negates the integer and the fraction together: -1.25 is -12500000, never -7500000', () => {
    // -7500000 is what "negate the integer part, then add the fraction" produces. It is a
    // plausible implementation and it is off by half a second here.
    expect(parseSignedTicks('-1.25').ticks).toBe(-12500000n);
    expect(parseSignedTicks('-1.25').ticks).not.toBe(-10000000n + 2500000n);
  });

  it('makes + and - exact mirrors of each other for the same digits', () => {
    for (const digits of ['0', '0.5', '1.25', '30', '0.0000001', '86399.9999999']) {
      expect(parseSignedTicks(`-${digits}`).ticks).toBe(-parseSignedTicks(`+${digits}`).ticks);
    }
  });
});

describe('more than seven fractional digits truncate toward zero, never round', () => {
  const truncating: ReadonlyArray<readonly [string, bigint]> = [
    ['+0.99999999', 9999999n],
    ['-0.99999999', -9999999n],
    ['+0.12345678', 1234567n],
    ['-0.12345678', -1234567n],
    ['+1.00000009', 10000000n],
    ['-1.00000009', -10000000n],
    ['+0.00000009', 0n],
    ['-0.00000009', 0n],
    ['+1.9999999999999999999', 19999999n],
  ];

  for (const [text, ticks] of truncating) {
    it(`truncates ${JSON.stringify(text)} to ${ticks} ticks`, () => {
      const parsed = parseSignedTicks(text);
      expect(parsed.ok).toBe(true);
      expect(parsed.ticks).toBe(ticks);
    });
  }

  it('truncates toward zero on BOTH signs, so the magnitude never grows', () => {
    // Toward zero, not toward -Infinity: -0.99999999 must become -9999999, not -10000000. Both
    // are "truncation" under some definition; only one keeps parse(-x) === -parse(+x), which the
    // mirror test above depends on.
    const positive = parseSignedTicks('+0.99999999').ticks;
    const negative = parseSignedTicks('-0.99999999').ticks;
    expect(positive).toBe(9999999n);
    expect(negative).toBe(-9999999n);
    expect(negative).toBe(-positive);
  });

  it('would move the event if it rounded: the rounded value differs by a whole tick', () => {
    // Rounding 0.99999999 s gives 10000000 ticks, a time 100 ns later than anything written in
    // the file. One tick is not clinically interesting; inventing a timestamp that is in no file
    // is, because the onset is also the join key between edfcore and every other tool.
    expect(Math.round(0.99999999 * 1e7)).toBe(10000000);
    expect(parseSignedTicks('+0.99999999').ticks).toBe(9999999n);
    expect(parseSignedTicks('+0.99999999').ticks).not.toBe(10000000n);
  });

  it('still requires the discarded digits to BE digits', () => {
    // `+1.00000000x` is rejected rather than silently truncated to +1: the parser is not allowed
    // to stop caring about bytes just because they are below its resolution.
    expect(parseSignedTicks('+1.00000000x').ok).toBe(false);
    expect(parseSignedTicks('+1.00000000x').ticks).toBe(0n);
  });
});

describe('an unsigned onset violates the grammar but keeps a usable magnitude', () => {
  // EDF+ 2.2.2 makes the sign mandatory, so `ok` is false and grammar.ts emits TAL_MALFORMED.
  // The magnitude is still returned, which is what lets that caller keep an otherwise readable
  // annotation instead of discarding it. This is the ONLY case where ok:false carries a value.
  const unsigned: ReadonlyArray<readonly [string, bigint]> = [
    ['30', 300000000n],
    ['0.5', 5000000n],
    ['0', 0n],
    ['1.25', 12500000n],
  ];

  for (const [text, ticks] of unsigned) {
    it(`rejects ${JSON.stringify(text)} as an onset yet still reports ${ticks} ticks`, () => {
      const parsed = parseSignedTicks(text);
      expect(parsed.ok).toBe(false);
      expect(parsed.ticks).toBe(ticks);
      expect(parsed.raw).toBe(text);
    });
  }
});

describe('parseSignedTicks rejects everything outside the grammar, with zero ticks', () => {
  const rejected: ReadonlyArray<readonly [string, string]> = [
    ['', 'empty'],
    ['+', 'a sign with no digits'],
    ['-', 'a sign with no digits'],
    ['.', 'a bare decimal point'],
    ['+.', 'a sign and a point, no digits'],
    ['+.5', 'no integer part, and 1*DIGIT is at least one digit'],
    ['.5', 'no sign and no integer part'],
    ['+1.', 'a trailing point with no fractional digits'],
    ['1.2.3', 'two decimal points'],
    ['+1.2.3', 'two decimal points behind a sign'],
    ['1 2', 'an embedded space'],
    ['+1 2', 'an embedded space behind a sign'],
    ['+1 ', 'trailing space padding, which a TAL timestamp field never carries'],
    [' +1', 'leading space padding'],
    [`+1${NUL}`, 'an embedded NUL, which terminates a TAL and is never part of a number'],
    ['++1', 'a doubled sign'],
    ['+-1', 'two different signs'],
    ['-+1', 'two different signs'],
    ['+1e3', 'scientific notation is not in the TAL grammar'],
    ['+1E3', 'scientific notation is not in the TAL grammar'],
    ['+0,5', 'a comma decimal separator is never guessed at'],
    ['abc', 'letters'],
    ['+abc', 'letters behind a sign'],
    ['+1a', 'a trailing letter'],
    ['+1.2a', 'a trailing letter after a fraction'],
    [`+${PLUS_MINUS}1`, 'a non-ASCII sign character'],
    [`+1${NBSP}`, 'a non-breaking space is neither a digit nor padding'],
    [`+${FULLWIDTH_ONE}`, 'a fullwidth digit is not an ASCII digit'],
  ];

  for (const [text, why] of rejected) {
    it(`rejects ${JSON.stringify(text)} rather than guessing: ${why}`, () => {
      const parsed = parseSignedTicks(text);
      expect(parsed.ok).toBe(false);
      expect(parsed.ticks).toBe(0n);
      expect(parsed.raw).toBe(text);
      expect(parsed.seconds).toBe(0);
    });
  }

  it('rejects a comma decimal separator rather than guessing which reading was meant', () => {
    // DESIGN section 2: '0,5' and '1,024' are indistinguishable, and substituting '.' in the
    // second silently turns 1024 into 1.024. Guessing is refused everywhere in edfcore.
    expect(parseSignedTicks('+0,5').ok).toBe(false);
    expect(parseSignedTicks('+1,024').ok).toBe(false);
    expect(parseSignedTicks('+1,024').ticks).toBe(0n);
  });
});

describe('parseUnsignedTicks accepts the duration grammar, which is never signed', () => {
  const accepted: ReadonlyArray<readonly [string, bigint]> = [
    ['0', 0n],
    ['30', 300000000n],
    ['1.25', 12500000n],
    ['0.0000001', 1n],
    ['0.99999999', 9999999n],
    ['0030', 300000000n],
  ];

  for (const [text, ticks] of accepted) {
    it(`reads the duration ${JSON.stringify(text)} as ${ticks} ticks`, () => {
      const parsed = parseUnsignedTicks(text);
      expect(parsed.ok).toBe(true);
      expect(parsed.ticks).toBe(ticks);
      expect(parsed.raw).toBe(text);
      expect(parsed.seconds).toBe(ticksToSeconds(ticks));
    });
  }

  const rejected = ['+30', '-30', '+0.5', '-0.5', '', '.', '1.', '1,5', '1e3', ' 30', '30 '];
  for (const text of rejected) {
    it(`rejects the duration ${JSON.stringify(text)}`, () => {
      expect(parseUnsignedTicks(text).ok).toBe(false);
    });
  }

  it('does not strip a sign from a duration: a signed duration means another field layout', () => {
    // Not "tolerated and normalised". If the writer signed the duration then the bytes after 0x15
    // are not the field we think we are reading, and reporting 1 s here would be a fabricated
    // event length rather than a missing one.
    expect(parseUnsignedTicks('+1').ticks).toBe(0n);
    expect(parseUnsignedTicks('-1').ticks).toBe(0n);
  });
});

describe('ticksToSeconds is the lossy convenience, and keeps the sign it was given', () => {
  const cases: ReadonlyArray<readonly [bigint, number]> = [
    [0n, 0],
    [12500000n, 1.25],
    [-12500000n, -1.25],
    [300000000n, 30],
    [-5000000n, -0.5],
    [700000n, 0.07],
    [1n, 1e-7],
    [-1n, -1e-7],
    [864000000000n, 86400],
  ];

  for (const [ticks, seconds] of cases) {
    it(`converts ${ticks} ticks to ${seconds} s`, () => {
      expect(ticksToSeconds(ticks)).toBe(seconds);
    });
  }

  it('keeps the sign when the whole-second part truncates to zero', () => {
    // bigint `/` truncates toward zero and `%` keeps the dividend's sign, so -5000000 ticks is
    // 0 whole seconds plus a NEGATIVE remainder. Summing a zero whole part with an unsigned
    // remainder is the classic way a pre-stimulus onset comes out as +0.5.
    expect(ticksToSeconds(-5000000n)).toBe(-0.5);
    expect(ticksToSeconds(-9999999n)).toBeLessThan(0);
    expect(ticksToSeconds(-1n)).toBeLessThan(0);
  });
});

describe('secondsToTicks rounds, so it is only ever for caller-supplied bounds', () => {
  const cases: ReadonlyArray<readonly [number, bigint]> = [
    [0, 0n],
    [30, 300000000n],
    [0.1, 1000000n],
    [0.07, 700000n],
    [-0.5, -5000000n],
    [1.25, 12500000n],
    [86400, 864000000000n],
  ];

  for (const [seconds, ticks] of cases) {
    it(`converts the window bound ${seconds} s to ${ticks} ticks`, () => {
      expect(secondsToTicks(seconds)).toBe(ticks);
    });
  }

  it("resolves a caller's 30 to exactly 300000000 ticks, not one ULP below", () => {
    // The whole reason this function rounds instead of truncating: `30 * 1e7` landing one ULP low
    // would put a window bound at 299999999 ticks and drop the sample exactly on the boundary.
    expect(secondsToTicks(30)).toBe(300000000n);
    expect(secondsToTicks(0.1)).toBe(1000000n);
  });

  it('rounds where the on-disk digit parsers truncate, which is why they are not interchangeable', () => {
    // A value read from a file must never come through here: the same decimal resolves to two
    // different tick counts, and only the truncating one matches the digits on disk.
    expect(secondsToTicks(0.99999999)).toBe(10000000n);
    expect(parseSignedTicks('+0.99999999').ticks).toBe(9999999n);
  });

  it('throws RangeError for a non-finite bound instead of inventing 0', () => {
    // Inventing 0 would silently move the window to the file start, which reads as a valid
    // result. There is no tick count for NaN.
    expect(() => secondsToTicks(Number.NaN)).toThrow(RangeError);
    expect(() => secondsToTicks(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => secondsToTicks(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('the tick unit itself', () => {
  it('is 100 ns, so seven fractional digits are exactly representable and an eighth is not', () => {
    expect(parseSignedTicks('+1').ticks).toBe(TICKS_PER_SECOND);
    expect(parseSignedTicks('+0.0000001').ticks).toBe(1n);
    expect(parseSignedTicks('+0.00000001').ticks).toBe(0n);
  });

  it('round-trips seconds -> ticks -> seconds for values a float64 can hold', () => {
    for (const seconds of [0, 0.5, 1.25, 30, 0.07, -0.5, -1.25, 86400]) {
      expect(ticksToSeconds(secondsToTicks(seconds))).toBe(seconds);
    }
  });
});
