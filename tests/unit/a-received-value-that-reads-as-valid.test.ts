/**
 * The sample family's numeric guards, when the value is not a number at all.
 *
 * `Number.isSafeInteger('0')` is false and `Number.isFinite('0')` is false, so a string is rejected
 * — correctly — and then printed with `${value}`. `gridSampleStartTicks(signal, '0', ticks)` was
 * told "sampleIndex must be a whole number, received 0", and 0 is a whole number. The sentence
 * describes a rule its own evidence satisfies, so a reader who trusts it looks past the argument
 * (fixed in 0.6.94).
 *
 * A BigInt is the case that costs the most, for the reason 0.6.92 gives about the time layer: every
 * instant and every span edfcore hands out is ticks, and `received 10000000` reads as a plausible
 * sample index rather than as one out by ten million.
 */

import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../src/header/parse.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { gridSampleStartSeconds, gridSampleStartTicks } from '../../src/sample-grid.js';
import { sampleAt, sampleStartTicksOf } from '../../src/sample-locate.js';
import { buildEdf } from '../support/writer.js';

const BYTES = buildEdf({
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

const header = parseHeader(BYTES, BYTES.byteLength);
const signal = header.signals[0] as NonNullable<(typeof header.signals)[0]>;

/** The cast a JavaScript caller does not need to write. */
const asNumber = (value: unknown) => value as number;

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the value was accepted');
}

const NOT_NUMBERS: ReadonlyArray<readonly [string, unknown, string]> = [
  ['a string from a URL', '0', 'the string "0"'],
  ['a BigInt tick count', 10_000_000n, 'the BigInt 10000000n'],
  ['null', null, 'null'],
  ['an object', {}, 'an object'],
];

describe('gridSampleStartTicks', () => {
  it.each(NOT_NUMBERS)('describes %s as what it is', (_name, value, expected) => {
    const message = refusal(() =>
      gridSampleStartTicks(signal, asNumber(value), header.recordDurationTicks),
    );
    expect(message).toContain(`sampleIndex must be a whole number, received ${expected}`);
  });

  it('no longer prints a string as if it were the number it spells', () => {
    const message = refusal(() => gridSampleStartTicks(signal, asNumber('0'), 10_000_000n));
    expect(message).not.toContain('received 0.');
  });

  it('still says what a real fractional index is', () => {
    expect(refusal(() => gridSampleStartTicks(signal, 1.5, 10_000_000n))).toContain('received 1.5');
  });
});

describe('the two sibling guards in the family', () => {
  it('describes a BigInt handed to gridSampleStartSeconds', () => {
    expect(
      refusal(() => gridSampleStartSeconds(signal, asNumber(3n), header.recordDurationTicks)),
    ).toContain('the BigInt 3n');
  });

  it('describes a string handed to sampleStartTicksOf', async () => {
    const recording = await openEdf(byteSource(BYTES));
    expect(refusal(() => sampleStartTicksOf(recording, 0, asNumber('4')))).toContain(
      'the string "4"',
    );
  });

  it('describes a string handed to sampleAt, whose argument is a time', async () => {
    const recording = await openEdf(byteSource(BYTES));
    const message = refusal(() => sampleAt(recording, 0, asNumber('0.5')));
    expect(message).toContain('sampleAt(): seconds must be a finite number, received');
    expect(message).toContain('the string "0.5"');
  });

  it('still says NaN, which always read correctly', async () => {
    const recording = await openEdf(byteSource(BYTES));
    expect(refusal(() => sampleAt(recording, 0, Number.NaN))).toContain('received NaN');
  });
});

describe('the values that resolve', () => {
  it('still resolve', () => {
    expect(gridSampleStartTicks(signal, 0, 10_000_000n)).toBe(0n);
    expect(gridSampleStartTicks(signal, 8, 10_000_000n)).toBe(10_000_000n);
  });
});
