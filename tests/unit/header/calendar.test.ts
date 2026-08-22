/**
 * The calendar edfcore validates against, checked without a calendar.
 *
 * `isValidCalendarDate` exists because a `Date` is the wrong tool: real files carry 31 April and
 * 29 February in common years, and `new Date(1997, 3, 31)` rolls both forward into a neighbouring
 * month rather than rejecting them. A recording silently dated a day later than it was made is
 * the kind of error nobody finds, because the wrong answer is a perfectly ordinary date.
 *
 * `date-ban.test.ts` proves no `Date` is constructed anywhere. That leaves the arithmetic that
 * replaced it, and it had only ever been exercised through the parser — where a rejected date is
 * indistinguishable from a rejected field.
 *
 * The month lengths are not restated here. Restating a table checks a transcription, and a
 * transcription is what would already have been wrong; the properties the table has to satisfy
 * are checked instead, and they come from the Gregorian calendar rather than from this file:
 *
 *  - The twelve months sum to 365 days, or 366 in a leap year. Every year, 1 through 9999.
 *  - Four hundred consecutive years hold exactly 97 leap years and 146,097 days — which is a whole
 *    number of weeks, and the reason the Gregorian calendar repeats every four centuries.
 *  - Any century whose year is not divisible by 400 holds 24, not 25.
 *
 * A table with a month one day long or short fails the first of those for every year; a leap rule
 * missing its century exception fails the second by three days per cycle.
 *
 * The refusals are checked from both sides: the last day of every month is valid and the day after
 * it is not, for a leap year and a common one, so a bound cannot be off by one in either direction
 * without being seen.
 *
 * What this does NOT distinguish: the month-range guard from the table lookup behind it. A month
 * outside 1..12 gets a length of zero, which already refuses every day, so removing the guard
 * changes no answer — the two are belt and braces for each other, and the zero is the half that
 * makes that safe, so it is the half checked directly.
 */

import { describe, expect, it } from 'vitest';
import { daysInMonth, isLeapYear, isValidCalendarDate } from '../../../src/header/dates.js';

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

const yearLength = (year: number): number =>
  MONTHS.reduce((total, month) => total + daysInMonth(year, month), 0);

describe('the leap rule', () => {
  it('makes a four-century cycle 97 leap years long', () => {
    // The defining property of the Gregorian reform, and independent of how the rule is written.
    for (const start of [1, 401, 1601, 2001, 9600]) {
      const leaps = Array.from({ length: 400 }, (_, at) => start + at).filter(isLeapYear);
      expect(leaps, `${start}..${start + 399}`).toHaveLength(97);
    }
  });

  it('makes that cycle a whole number of weeks', () => {
    const days = Array.from({ length: 400 }, (_, at) => yearLength(1601 + at)).reduce(
      (total, one) => total + one,
      0,
    );
    expect(days).toBe(146_097);
    expect(days % 7).toBe(0);
  });

  it('skips the centuries the exception is for', () => {
    // 24, not 25: 1700, 1800 and 1900 are common years and 2000 is not in this span.
    const leaps = Array.from({ length: 100 }, (_, at) => 1801 + at).filter(isLeapYear);
    expect(leaps).toHaveLength(24);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
  });
});

describe('the month lengths', () => {
  it('sum to the length of the year, every year edfcore accepts', () => {
    const wrong: string[] = [];
    for (let year = 1; year <= 9999; year += 1) {
      const expected = isLeapYear(year) ? 366 : 365;
      if (yearLength(year) !== expected) wrong.push(`${year}: ${yearLength(year)}`);
    }
    expect(wrong.slice(0, 5), 'years whose months do not sum to their length').toEqual([]);
  });

  it('are zero for a month that is not a month, rather than undefined', () => {
    // The lookup is by index, so an out-of-range month would otherwise read past the table.
    for (const month of [-1, 0, 13, 99]) {
      expect(daysInMonth(2024, month), `month ${month}`).toBe(0);
    }
  });

  it('give February its extra day only in a leap year', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });
});

describe('a date that names a day', () => {
  it.each([2023, 2024])('accepts the last day of every month of %i, and not the next', (year) => {
    for (const month of MONTHS) {
      const last = daysInMonth(year, month);
      expect(isValidCalendarDate({ year, month, day: last }), `${year}-${month}-${last}`).toBe(
        true,
      );
      expect(
        isValidCalendarDate({ year, month, day: last + 1 }),
        `${year}-${month}-${last + 1}`,
      ).toBe(false);
    }
  });

  it('refuses the days real files actually carry', () => {
    // Both named in the module docblock as the reason this function exists.
    expect(isValidCalendarDate({ year: 1997, month: 4, day: 31 })).toBe(false);
    expect(isValidCalendarDate({ year: 2023, month: 2, day: 29 })).toBe(false);
    expect(isValidCalendarDate({ year: 2024, month: 2, day: 29 })).toBe(true);
  });

  it.each([
    ['day zero', { year: 2024, month: 1, day: 0 }],
    ['a fractional day', { year: 2024, month: 1, day: 1.5 }],
    ['month zero', { year: 2024, month: 0, day: 1 }],
    ['a thirteenth month', { year: 2024, month: 13, day: 1 }],
    ['a fractional month', { year: 2024, month: 1.5, day: 1 }],
    ['year zero', { year: 0, month: 1, day: 1 }],
    ['a five-digit year', { year: 10_000, month: 1, day: 1 }],
    ['a fractional year', { year: 2024.5, month: 1, day: 1 }],
    ['a negative year', { year: -1, month: 1, day: 1 }],
    ['NaN anywhere', { year: Number.NaN, month: 1, day: 1 }],
  ])('refuses %s', (_why, date) => {
    expect(isValidCalendarDate(date)).toBe(false);
  });

  it('accepts the ends of the range it does allow', () => {
    expect(isValidCalendarDate({ year: 1, month: 1, day: 1 })).toBe(true);
    expect(isValidCalendarDate({ year: 9999, month: 12, day: 31 })).toBe(true);
  });
});
