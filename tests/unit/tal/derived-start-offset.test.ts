/**
 * The start offset a chunk has to derive when it does not begin at record 0.
 *
 * Every onset edfcore publishes is rebased on record 0's sub-second start offset, and that offset
 * lives in record 0's timekeeping TAL. A caller following the `decodeAnnotations` example on
 * `api-primitives.md` — read the bytes of a record range, decode them — hands over a range that
 * usually does not include record 0, and the offset then has to be derived from the onset that IS
 * in the range, by subtracting the nominal distance back to record 0.
 *
 * That subtraction is only valid while the records in between are contiguous, which is exactly
 * what a discontinuous file is not. So a derived value outside [0, 1) is evidence about the FILE:
 * on a file marked EDF+C it means the file is either discontinuous while claiming continuity or
 * its onsets drift, and `decodeAnnotations` says so rather than rebasing on a number it knows is
 * wrong. On an EDF+D file the same derived value carries no such implication — gaps are what that
 * marker is for — so nothing is reported.
 *
 * The three internal callers do not take this path at all. Each passes `originTicks`, and until
 * 0.3.15 they did not: on an EDF+C file with a real gap, every chunk beginning after it derived a
 * value outside [0, 1) and reported `START_OFFSET_OUT_OF_RANGE` against a chunk boundary the
 * caller never chose, so one file produced 1, 2, 4, 7, 16 or 31 of them purely as a function of
 * `maxMaterializeBytes`. That a supplied origin still outranks any derivation is checked here too,
 * because it is what keeps the count a property of the file.
 *
 * What this does NOT check: which value a rebased onset should have had. When the derivation is
 * refused the offset is zero, which makes `onsetTicksFromFirstRecord` equal `onsetTicks` for the
 * call — the diagnostic says so in as many words. Whether that is the right fallback is a
 * question about the API, not about this branch.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../../src/io/bytes.js';
import { readRecordBytes } from '../../../src/io/read.js';
import { openEdf } from '../../../src/recording.js';
import { decodeAnnotations } from '../../../src/tal/annotations.js';
import type { EdfDiagnostic, EdfHeader } from '../../../src/types.js';
import { minimalEdfPlus } from '../../support/writer.js';

/** Four one-second records at 0, 1, 2 and 5: a three-second hole before the last one. */
const drifting = (plus: 'C' | 'D'): Uint8Array =>
  minimalEdfPlus({
    plus,
    recordCount: 4,
    recordDurationSeconds: 1,
    recordOnsetSeconds: (at: number) => (at < 3 ? at : at + 2),
  });

/** The last record alone, decoded the way the page's example decodes a range. */
async function decodeTail(
  bytes: Uint8Array,
  options?: Parameters<typeof decodeAnnotations>[3],
): Promise<{ header: EdfHeader; diagnostics: readonly EdfDiagnostic[] }> {
  const source = byteSource(bytes);
  const recording = await openEdf(source);
  const records = { start: 3, count: 1 };
  const recordBytes = await readRecordBytes(source, recording.header, records);
  const result = decodeAnnotations(recording.header, recordBytes, records, options);
  return { header: recording.header, diagnostics: result.diagnostics };
}

const offsetDiagnostics = (diagnostics: readonly EdfDiagnostic[]): readonly EdfDiagnostic[] =>
  diagnostics.filter((one) => one.code === 'START_OFFSET_OUT_OF_RANGE');

describe('a chunk that starts in the middle of a continuous file', () => {
  it('reports the derived offset it will not use', async () => {
    const { diagnostics } = await decodeTail(drifting('C'));
    const found = offsetDiagnostics(diagnostics);
    expect(found).toHaveLength(1);
    // The record the derivation started from, not record 0: that is the only thing the caller
    // can act on, and the value they would otherwise never see.
    expect(found[0]?.recordIndex).toBe(3);
    expect(found[0]?.message).toContain('starts at record 3');
    expect(found[0]?.message).toContain('outside');
    // What a continuous file means, said as the reason rather than as a rule number.
    expect(found[0]?.message).toContain('recordIndex * recordDuration by definition');
    // And the two things it could be, with the call that separates them.
    expect(found[0]?.message).toContain('buildRecordIndex()');
    expect(found[0]?.field).toBe('timekeeping TAL');
  });

  it('says what the onsets it just returned mean, since it rebased on nothing', async () => {
    const { diagnostics } = await decodeTail(drifting('C'));
    expect(offsetDiagnostics(diagnostics)[0]?.message).toContain(
      'onsetSecondsFromFirstRecord equals onsetSecondsFromHeaderStart',
    );
  });
});

describe('the same chunk of a file that admits it is discontinuous', () => {
  it('is not reported, because a gap is what EDF+D is for', async () => {
    const { header, diagnostics } = await decodeTail(drifting('D'));
    expect(header.continuity).toBe('discontinuous');
    expect(offsetDiagnostics(diagnostics)).toEqual([]);
  });
});

describe('an origin the caller supplied', () => {
  it('outranks the derivation, and silences it', async () => {
    // What the sweep, the index scan and the envelope fold pass. Before 0.3.15 they did not, and
    // the count of these diagnostics was a function of the chunk size rather than of the file.
    const { diagnostics } = await decodeTail(drifting('C'), { originTicks: 0n });
    expect(offsetDiagnostics(diagnostics)).toEqual([]);
  });

  it('is used as given even when it lies outside [0, 1), under either name', async () => {
    // The range check is on a DERIVED value, and exists because a derivation across a gap is
    // wrong. A supplied one is not a derivation: it came from the timeline, which read record 0.
    // Two seconds is outside the second the spec allows and is still what the caller said.
    for (const name of ['originTicks', 'startOffsetTicks'] as const) {
      const decoded = await decodeTail(drifting('C'), { [name]: 20_000_000n });
      expect(offsetDiagnostics(decoded.diagnostics), name).toEqual([]);
    }
  });
});

describe('a contiguous file decoded from the middle', () => {
  it('derives an offset inside [0, 1) and says nothing', async () => {
    // The ordinary case, and the one that has to stay quiet: record 3 of a contiguous file is
    // exactly 3 * recordDuration after record 0, so the derivation returns the true offset.
    const { diagnostics } = await decodeTail(
      minimalEdfPlus({ plus: 'C', recordCount: 4, recordDurationSeconds: 1 }),
    );
    expect(offsetDiagnostics(diagnostics)).toEqual([]);
  });
});
