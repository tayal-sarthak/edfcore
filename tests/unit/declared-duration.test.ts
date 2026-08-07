/**
 * declaredDurationSeconds.
 *
 * The distinction worth pinning: this is the DECLARED length — what the records cover — not the
 * span. On an EDF+D file the recording reaches further, because the gaps belong to no record.
 */

import { describe, expect, it } from 'vitest';
import { formatHeader } from '../../src/format-header.js';
import { declaredDurationSeconds } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { minimalEdf, minimalEdfPlus } from '../support/writer.js';

describe('declaredDurationSeconds', () => {
  it('is recordCount times recordDuration', async () => {
    const r = await openEdf(
      byteSource(minimalEdf({ recordCount: 120, recordDurationSeconds: 30 })),
    );
    expect(declaredDurationSeconds(r.header)).toBe(3600);
  });

  it('is exact for a record duration with no binary representation', async () => {
    // 100 x 0.29 s is exactly 29 s. In float64 the product is 28.999999999999996, which floors
    // to 28 — a recording reported a whole second short. The count is exact and the duration is
    // exact in ticks, so the multiplication happens there (fixed in 0.3.1).
    const r = await openEdf(
      byteSource(minimalEdf({ recordCount: 100, recordDurationSeconds: 0.29 })),
    );
    expect(declaredDurationSeconds(r.header)).toBe(29);
    expect(100 * r.header.recordDurationSeconds).not.toBe(29);
  });

  it('agrees with the duration formatHeader prints', async () => {
    // The two are independent implementations of one number, and that is exactly how this was
    // found: formatHeader was fixed in 0.2.67 and this was not, so the header line said 00:00:29
    // about a file this reported as 28.999999999999996.
    const r = await openEdf(
      byteSource(minimalEdf({ recordCount: 100, recordDurationSeconds: 0.29 })),
    );
    expect(formatHeader(r.header)).toContain('00:00:29');
    expect(Math.floor(declaredDurationSeconds(r.header))).toBe(29);
  });

  it('is zero for a zero record duration, which is legal EDF', async () => {
    // Such a file's records do not advance in time, so zero is the honest answer, not a bug.
    const r = await openEdf(byteSource(minimalEdf({ recordCount: 8, recordDurationSeconds: 0 })));
    expect(declaredDurationSeconds(r.header)).toBe(0);
  });

  it('is shorter than the span on a discontinuous file', async () => {
    // The gaps belong to no record, so what the records COVER is less than what the recording
    // reaches. Conflating the two is how a viewer draws a timeline that ends too early.
    const r = await openEdf(
      byteSource(
        minimalEdfPlus({
          plus: 'D',
          recordCount: 4,
          recordDurationSeconds: 1,
          recordOnsetSeconds: (i: number) => (i < 2 ? i : i + 10),
        }),
      ),
    );
    expect(declaredDurationSeconds(r.header)).toBe(4);
    expect(r.timeline.spanSeconds).toBeGreaterThan(4);
  });
});
