/**
 * declaredDurationSeconds.
 *
 * The distinction worth pinning: this is the DECLARED length — what the records cover — not the
 * span. On an EDF+D file the recording reaches further, because the gaps belong to no record.
 */

import { describe, expect, it } from 'vitest';
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
