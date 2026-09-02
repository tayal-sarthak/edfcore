/**
 * A decimal onset stops being exact in two places, and `edf-format.md` named one.
 *
 * The page said onsets "parsed digit by digit are exact, and `parseFloat` is the only thing that
 * makes them inexact". The first half is what `tal/ticks.ts` exists for: no `parseFloat`, no
 * `Number(text)`, no float arithmetic on the path, so `+0.1` and `+0.3` are integers and compare
 * by the digits on disk. The second half is a universal claim, and the grammar the same page
 * prints is what breaks it — `Onset = ("+" / "-") 1*DIGIT [ "." 1*DIGIT ]` puts no bound on the
 * fraction, and a writer emitting full double precision produces `+1234.5678901234`.
 *
 * edfcore counts in 100 ns, so `TICK_FRACTION_DIGITS` is seven and the eighth digit onward is
 * dropped — silently, with `ok: true`, because it is a resolution rather than a parse failure.
 * `+1.00000009` is one second exactly. That is the right design and the wrong sentence: a reader
 * told `parseFloat` is the only lossy step concludes the digits survive, and `onsetRaw` — the
 * field that actually keeps them — has no reason to exist.
 *
 * The page now says both, so this file runs both.
 */

import { describe, expect, it } from 'vitest';
import { parseSignedTicks, parseUnsignedTicks } from '../../src/tal/ticks.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

const PAGE = DOCS_PAGES.get('edf-format.md') ?? '';

const ticksOf = (text: string): bigint => parseSignedTicks(text).ticks;

describe('the page', () => {
  it('was read, so a passing run is not a vacuous one', () => {
    expect(PAGE).toContain('Onset    = ("+" / "-") 1*DIGIT');
    expect(PAGE.length).toBeGreaterThan(1000);
  });

  it('no longer calls parseFloat the only lossy step', () => {
    expect(PAGE).not.toContain('`parseFloat` is the only thing that makes them inexact');
  });

  it('names the second one and the field that keeps the digits', () => {
    expect(PAGE).toContain('100 ns ticks');
    expect(PAGE).toContain('onsetRaw');
  });
});

describe('within seven fractional digits', () => {
  it('is exact, which is the half of the claim that always held', () => {
    expect(ticksOf('+0.1234567')).toBe(1234567n);
    expect(ticksOf('-0.1234567')).toBe(-1234567n);
    // The pair the docs use to show float rounding has no part in it.
    expect(ticksOf('+0.1') + ticksOf('+0.2')).toBe(ticksOf('+0.3'));
  });
});

describe('past the seventh fractional digit', () => {
  it('drops what it cannot hold, in the two examples the page prints', () => {
    expect(ticksOf('+0.12345678')).toBe(1234567n);
    expect(ticksOf('+1.00000009')).toBe(10000000n);
  });

  it('says nothing about it: the parse succeeds', () => {
    const parsed = parseSignedTicks('+0.123456789012345');
    expect(parsed.ok).toBe(true);
    expect(parsed.ticks).toBe(1234567n);
  });

  it('keeps the digits on the parse, which is why onsetRaw can be trusted', () => {
    // The value is truncated; the text is not. That is the whole answer to the lost precision.
    expect(parseSignedTicks('+0.12345678').raw).toBe('+0.12345678');
  });

  it('truncates toward zero on both signs, rather than rounding to nearest', () => {
    // Rounding would make `+0.19999999` a full 0.2 s and put a negative onset on the far side of
    // its own instant. Two events written a nanosecond apart stay ordered as written.
    expect(ticksOf('+0.19999999')).toBe(1999999n);
    expect(ticksOf('-0.19999999')).toBe(-1999999n);
  });

  it('applies to durations too, which travel the same parser', () => {
    expect(parseUnsignedTicks('0.12345678').ticks).toBe(1234567n);
    expect(parseUnsignedTicks('0.12345678').ok).toBe(true);
  });
});
