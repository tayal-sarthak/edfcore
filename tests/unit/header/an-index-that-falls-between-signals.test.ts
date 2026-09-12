/**
 * `getSignal(header, 1.5)`, refused without naming a rule 1.5 satisfies.
 *
 * `header.signals[1.5]` is `undefined`, so a fractional index took the same branch an out-of-range
 * one does and was told it "is outside the 7 signals this file declares. Next: pass an index in
 * 0..6". 1.5 already is an index in 0..6. The one thing wrong with it — that it is not whole — was
 * the one thing the message did not say (fixed in 0.6.93).
 *
 * It is not a contrived value. A midpoint between two channels, an average, and anything divided by
 * a sample rate all produce one, and the same shape of message was fixed in the time layer in
 * 0.6.92.
 */

import { describe, expect, it } from 'vitest';
import { EdfChannelNotFoundError } from '../../../src/errors.js';
import { getSignal } from '../../../src/header/lookup.js';
import { parseHeader } from '../../../src/header/parse.js';
import { buildEdf } from '../../support/writer.js';

const BYTES = buildEdf({
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 8 },
    { label: 'Fp2', samplesPerRecord: 8 },
    { label: 'C3', samplesPerRecord: 8 },
  ],
});

const header = parseHeader(BYTES, BYTES.byteLength);

function refusal(selector: number): string {
  try {
    getSignal(header, selector);
  } catch (error) {
    expect(error).toBeInstanceOf(EdfChannelNotFoundError);
    return (error as Error).message;
  }
  throw new Error(`index ${selector} was accepted`);
}

describe('a fractional index', () => {
  it.each([1.5, 0.5, 2.000_000_1])('says %s is not a whole number', (selector) => {
    const message = refusal(selector);
    expect(message).toContain(`signal index ${selector} is not a whole number`);
    expect(message).toContain('falls between two signals rather than outside them');
  });

  it('does not claim it is outside a range it is inside', () => {
    expect(refusal(1.5)).not.toContain('is outside the 3 signals');
  });

  it('asks for a whole index, which is the part that was missing', () => {
    expect(refusal(1.5)).toContain('Next: pass a whole index in 0..2, or a label.');
  });
});

describe('an index that really is outside', () => {
  it.each([3, 99, -1])('still says %s is outside the declared signals', (selector) => {
    const message = refusal(selector);
    expect(message).toContain(`signal index ${selector} is outside the 3 signals this file`);
    expect(message).not.toContain('not a whole number');
  });

  it('still lists the labels, in signal order', () => {
    expect(refusal(99)).toContain('Labels, in signal order: "Fp1", "Fp2", "C3"');
  });
});

describe('the indices that resolve', () => {
  it('still resolve, so the split costs nothing', () => {
    expect(getSignal(header, 0).label).toBe('Fp1');
    expect(getSignal(header, 2).label).toBe('C3');
    expect(getSignal(header, 'Fp2').index).toBe(1);
  });
});
