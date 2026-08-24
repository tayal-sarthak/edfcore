/**
 * `[0, 1)` is half-open, and one second is outside it.
 *
 * Record 0's timekeeping onset IS the recording's sub-second start offset: the whole-second part
 * of the start time lives in the header, so an onset of one second means the writer has encoded a
 * second twice and every time edfcore publishes is a second out. `START_OFFSET_OUT_OF_RANGE` says
 * exactly that, and its message quotes the interval.
 *
 * Both comparisons that enforce it — the one on record 0's own onset and the one on a value
 * derived for a chunk that starts later — could be relaxed to `>` and `<=` with the whole suite
 * green. The fixtures that reach them use 1.5 s and 3 s, which are outside by a margin; nothing
 * had ever sat on the edge. An offset of exactly 1.0 s is not an exotic value, it is what a writer
 * produces the first time it puts the same second in both fields.
 *
 * Zero is checked on the other side of the same interval, because it is the closed end: the
 * overwhelmingly common case is an offset of exactly zero, and a check that refused it would
 * report every conforming file in existence.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../../src/io/bytes.js';
import { readRecordBytes } from '../../../src/io/read.js';
import { openEdf } from '../../../src/recording.js';
import { decodeAnnotations } from '../../../src/tal/annotations.js';
import type { EdfDiagnostic } from '../../../src/types.js';
import { minimalEdfPlus } from '../../support/writer.js';

/** Four contiguous one-second records whose first one starts at `offsetSeconds`. */
function startingAt(offsetSeconds: number | string, plus: 'C' | 'D' = 'C'): Uint8Array {
  return minimalEdfPlus({
    plus,
    recordCount: 4,
    recordDurationSeconds: 1,
    recordOnsetSeconds: (at: number) =>
      at === 0 ? offsetSeconds : `+${(Number(offsetSeconds) + at).toFixed(7)}`,
  });
}

/** Decode a record range the way `api-primitives.md` shows, and keep the offset diagnostics. */
async function offsetDiagnosticsOf(
  bytes: Uint8Array,
  records: { start: number; count: number },
): Promise<readonly EdfDiagnostic[]> {
  const source = byteSource(bytes);
  const recording = await openEdf(source);
  const recordBytes = await readRecordBytes(source, recording.header, records);
  const result = decodeAnnotations(recording.header, recordBytes, records);
  return result.diagnostics.filter((one) => one.code === 'START_OFFSET_OUT_OF_RANGE');
}

const WHOLE_RANGE = { start: 0, count: 4 } as const;

describe('record 0’s own onset', () => {
  it('is accepted at exactly zero, the closed end', async () => {
    // The common case, and the one a check that refused the boundary would report on every file.
    expect(await offsetDiagnosticsOf(startingAt(0), WHOLE_RANGE)).toEqual([]);
  });

  it('is accepted one tick below one second', async () => {
    // 0.9999999 s is 9,999,999 ticks: the largest offset the interval admits.
    expect(await offsetDiagnosticsOf(startingAt('+0.9999999'), WHOLE_RANGE)).toEqual([]);
  });

  it('is refused at exactly one second, the open end', async () => {
    const found = await offsetDiagnosticsOf(startingAt(1), WHOLE_RANGE);

    expect(found).toHaveLength(1);
    expect(found[0]?.recordIndex).toBe(0);
    // The message states the interval it is applying, so a reader can see which end was hit.
    expect(found[0]?.message).toContain('must be in [0, 1)');
    expect(found[0]?.message).toContain('encodes the start time twice');
  });
});

describe('an offset derived for a chunk that starts later', () => {
  it('is accepted at one tick below one second', async () => {
    // Records 1..3 of a file whose record 0 starts at 0.9999999 s: the derivation subtracts the
    // nominal distance back and lands on the same value, which is inside the interval.
    expect(await offsetDiagnosticsOf(startingAt('+0.9999999'), { start: 1, count: 3 })).toEqual([]);
  });

  it('is refused at exactly one second', async () => {
    const found = await offsetDiagnosticsOf(startingAt(1), { start: 1, count: 3 });

    expect(found).toHaveLength(1);
    // The record the derivation started from, which is the only one the caller named.
    expect(found[0]?.recordIndex).toBe(1);
    expect(found[0]?.message).toContain('outside');
  });

  it('says nothing on an EDF+D file, where the derivation implies nothing', async () => {
    // Non-vacuity in the other direction: the refusal above is about the interval on a file that
    // claims continuity, not about the arithmetic being impossible.
    expect(await offsetDiagnosticsOf(startingAt(1, 'D'), { start: 1, count: 3 })).toEqual([]);
  });
});
