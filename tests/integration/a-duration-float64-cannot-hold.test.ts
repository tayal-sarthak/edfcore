/**
 * The thirteenth shape: a record duration with no exact binary form.
 *
 * `formatHeader` carries the story in a comment beside the function it forced: "Ticks, not
 * `recordCount * recordDurationSeconds`. That product is float64, and a record duration with no
 * exact binary representation makes it land just under the true value: 100 records of 0.29 s is
 * exactly 29 s and computes as 28.999999999999996, which floors to 28. The header line then reports
 * a recording a whole second shorter than it is (fixed in 0.2.67)."
 *
 * That file is exactly this one, and the matrix had never held it. Every sweep over `AWKWARD` ran
 * on durations of 1 s and 0 s — the two values where the float and the rational agree — so the
 * arithmetic the whole package is written in ticks to avoid was never exercised by any of them.
 *
 * They all pass. The point is that the properties were stated for any file and had only been asked
 * of files whose durations happen to be exact.
 *
 * The check below is the hazard itself, spelled out in both directions: the float product is wrong
 * and the tick product is right, on this fixture, at these numbers. Without the first half a reader
 * would have to take the comment's word for it.
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../../src/constants.js';
import { formatHeader } from '../../src/format-header.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { AWKWARD } from '../support/awkward-files.js';

const SHAPE = AWKWARD.find((file) => file.name === 'a record duration with no exact binary form');

describe('the shape', () => {
  it('is in the matrix, which is thirteen shapes', () => {
    expect(SHAPE).toBeDefined();
    expect(AWKWARD).toHaveLength(14);
  });

  it('is the hazard: the float product is short and the tick product is not', async () => {
    if (SHAPE === undefined) throw new Error('the matrix lost the inexact-duration shape');
    const { header } = await openEdf(byteSource(SHAPE.bytes));

    expect(header.recordCount).toBe(100);
    expect(header.recordDurationSeconds).toBe(0.29);

    // The wrong way, kept here so the right way is measured against something.
    const float = header.recordCount * header.recordDurationSeconds;
    expect(float).not.toBe(29);
    expect(float).toBeLessThan(29);
    expect(Math.floor(float)).toBe(28);

    // The way every duration in this package is computed.
    const ticks = header.recordDurationTicks * BigInt(header.recordCount);
    expect(ticks).toBe(29n * TICKS_PER_SECOND);
  });

  it('is the only shape in the matrix whose duration float64 cannot hold', async () => {
    const inexact: string[] = [];
    for (const file of AWKWARD) {
      const { header } = await openEdf(byteSource(file.bytes));
      const seconds = header.recordDurationSeconds;
      const exact =
        BigInt(Math.round(seconds * Number(TICKS_PER_SECOND))) === header.recordDurationTicks &&
        Number.isInteger(seconds * header.recordCount);
      if (!exact) inexact.push(file.name);
    }
    expect(inexact).toEqual(['a record duration with no exact binary form']);
  });
});

describe('what the formatter prints for it', () => {
  it('is the whole second the float would have dropped', async () => {
    if (SHAPE === undefined) throw new Error('the matrix lost the inexact-duration shape');
    const { header } = await openEdf(byteSource(SHAPE.bytes));
    const line = formatHeader(header)
      .split('\n')
      .find((one) => /^(duration|covered) /.test(one));

    // 29 s, not 28. This is the line 0.2.67 was about.
    expect(line).toContain('00:00:29');
    expect(line).not.toContain('00:00:28');
  });

  it('still says the duration the file states, unrounded', async () => {
    if (SHAPE === undefined) throw new Error('the matrix lost the inexact-duration shape');
    const { header } = await openEdf(byteSource(SHAPE.bytes));
    expect(formatHeader(header)).toContain('record       0.29 s');
  });
});

describe('and the derived rate is exact anyway', () => {
  it('is 100 Hz, because 29 samples in 0.29 s divides', async () => {
    // Worth pinning beside the hazard: an inexact duration does not have to make the rate
    // inexact, and a fixture where both were awkward would not tell the two apart.
    if (SHAPE === undefined) throw new Error('the matrix lost the inexact-duration shape');
    const { header } = await openEdf(byteSource(SHAPE.bytes));
    expect(header.signals[0]?.sampleRateHz).toBe(100);
  });
});
