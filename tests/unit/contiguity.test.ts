/**
 * contiguityOf.
 *
 * Three answers, not two. A probed index has seen the first and last records and nothing in
 * between, so 'unknown' is the only truthful answer for it.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex, contiguityOf } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { minimalEdfPlus } from '../support/writer.js';

const contiguous = () => minimalEdfPlus({ recordCount: 6, recordDurationSeconds: 1 });
const withGap = () =>
  minimalEdfPlus({
    plus: 'D',
    recordCount: 6,
    recordDurationSeconds: 1,
    recordOnsetSeconds: (i: number) => (i < 3 ? i : i + 5),
  });

describe('contiguityOf', () => {
  it('is unknown for the probed index openEdf builds', async () => {
    // Two probes cannot rule out a gap in the middle. Saying 'contiguous' would claim something
    // nobody verified; saying 'discontinuous' would report something nobody observed.
    const r = await openEdf(byteSource(contiguous()));
    expect(r.index.coverage).toBe('probed');
    expect(contiguityOf(r.index)).toBe('unknown');
  });

  it('is contiguous once the whole file has been scanned', async () => {
    const r = await openEdf(byteSource(contiguous()));
    expect(contiguityOf(await buildRecordIndex(r))).toBe('contiguous');
  });

  it('is discontinuous for a file with a real gap', async () => {
    const r = await openEdf(byteSource(withGap()));
    expect(contiguityOf(await buildRecordIndex(r))).toBe('discontinuous');
  });
});
