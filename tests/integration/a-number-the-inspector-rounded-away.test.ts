/**
 * The inspector's number formatter, on values smaller than the digits it keeps.
 *
 * `fmt` did `value.toFixed(digits)` and then stripped trailing zeros, so anything below half the
 * last digit kept became the string `"0"`. Zero is not a neutral answer at any of the five places
 * the page uses it.
 *
 * The physical range is the worst of them. A signal declared `-0.001 … 0.001` rendered as `0 … 0`,
 * which is `DEGENERATE_PHYSICAL_RANGE` — a diagnostic this same page lists three sections further
 * down, on a file that does not have it. A record duration of 0 is the legal file whose records do
 * not advance in time, which is why edfcore gives such a file no `sampleRateHz` at all; a rate of 0
 * is not a rate, and `undefined` is how that is said here (fixed in 0.6.119).
 *
 * The formatter is read out of the page and evaluated, rather than reimplemented, so this tests the
 * function the inspector actually ships.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PAGE = readFileSync(new URL('../../website/src/pages/demo.astro', import.meta.url), 'utf8');

/**
 * The `fmt` the page defines, lifted out of it and compiled.
 *
 * Bounded by the next top-level `const` rather than by a closing brace, so it lifts the expression
 * form this replaced as readily as the block form it is — a test that cannot load the old code is a
 * test that cannot show the old code was wrong.
 */
function inspectorFmt(): (value: number, digits?: number) => string {
  const at = PAGE.indexOf('const fmt = (value: number, digits = 2) =>');
  if (at === -1) throw new Error('demo.astro no longer defines fmt');
  const end = PAGE.indexOf('\n  const ', at + 1);
  if (end === -1) throw new Error('demo.astro no longer declares anything after fmt');
  const body = PAGE.slice(at, end)
    .replace(/: number/g, '')
    .replace(/^const /, '');
  // `new Function` rather than a reimplementation: the point of this test is the code the page
  // actually ships, and a second copy of the formatter here would agree with itself forever.
  return new Function(`const ${body}\nreturn fmt;`)() as (value: number, digits?: number) => string;
}

const fmt = inspectorFmt();

describe('a value below the digits kept', () => {
  it.each([
    ['a record duration in tenths of a millisecond', 0.0001, 3, '0.0001'],
    ['a slow channel, one sample per five minutes', 0.0033, 2, '0.0033'],
    ['a physical bound near zero', 0.001, 2, '0.001'],
    ['the negative bound beside it', -0.001, 2, '-0.001'],
    ['an event lasting four milliseconds', 0.004, 2, '0.004'],
  ])('keeps %s rather than rounding it to zero', (_described, value, digits, expected) => {
    expect(fmt(value, digits)).toBe(expected);
  });

  it('no longer renders a real physical range as a degenerate one', () => {
    // The declaration a sensor with a millivolt-scale range writes, and the diagnostic it is not.
    expect([fmt(-0.001), fmt(0.001)]).not.toEqual(['-0', '0']);
    expect(`${fmt(-0.001)} … ${fmt(0.001)}`).toBe('-0.001 … 0.001');
  });

  it('no longer renders a nonzero record duration as the zero-duration file', () => {
    expect(fmt(0.0001, 3)).not.toBe('0');
  });
});

describe('the values that were already right', () => {
  it.each([
    ['a true zero, which is the one value that should read as one', 0, 2, '0'],
    ['a whole rate', 256, 2, '256'],
    ['a rate with a hundreds digit', 100, 2, '100'],
    ['the awkward record duration sample-grid.ts names', 0.3, 3, '0.3'],
    ['a half', 0.5, 2, '0.5'],
    ['a physical bound', 3200, 2, '3200'],
  ])('still prints %s unchanged', (_described, value, digits, expected) => {
    expect(fmt(value, digits)).toBe(expected);
  });

  it('still prints an em dash for a value that is not finite', () => {
    expect(fmt(Number.NaN)).toBe('—');
    expect(fmt(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('rounds rather than truncating, where rounding is what is asked for', () => {
    expect(fmt(0.0005, 3)).toBe('0.001');
    expect(fmt(1.005, 2)).toBe('1');
  });
});

describe('the page still uses it where zero means something', () => {
  it('formats the record duration, the rates, the physical range and an event duration', () => {
    for (const site of [
      'fmt(header.recordDurationSeconds, 3)',
      'fmt(s.sampleRateHz)',
      'fmt(s.physicalMinimum)',
      'fmt(a.durationSeconds)',
    ]) {
      expect({ site, present: PAGE.includes(site) }).toEqual({ site, present: true });
    }
  });
});
