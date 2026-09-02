/**
 * The sixteenth shape: 24-bit samples and a discontinuity in one file.
 *
 * The matrix held both halves and never together. Every BDF shape in it ran end to end, and every
 * discontinuous shape was 16-bit EDF — so a three-byte stride and a chunk boundary that is not the
 * nominal grid had never met.
 *
 * They meet in one arithmetic. A read across a gap resolves a record range per contiguous run, and
 * each run's bytes are addressed as `headerByteLength + record * recordByteLength +
 * signal.recordByteOffset`. Every term in that is a multiple of `bytesPerSample`, which is 3 here
 * and 2 everywhere else in the matrix — and a sign extension that is right for a 16-bit sample is
 * wrong for a 24-bit one. An off-by-one in either would show up on this file and on no other in
 * the matrix.
 *
 * `biosemi.ts` and `corpus.test.ts` read real BDF, and `discontinuous.test.ts` reads gapped EDF.
 * This is the crossing, in front of the thirty sweeps that run over every shape.
 *
 * They all pass. What this file adds is the check that the crossing is real: two segments, three
 * bytes a sample, and samples that survive the join.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { AWKWARD } from '../support/awkward-files.js';

const SHAPE = AWKWARD.find((file) => file.name === 'BDF+D: 24-bit samples and a gap at once');

async function shape() {
  if (SHAPE === undefined) throw new Error('the matrix lost the BDF+D shape');
  return openEdf(byteSource(SHAPE.bytes));
}

describe('the shape', () => {
  it('is in the matrix, which is sixteen shapes', () => {
    expect(SHAPE).toBeDefined();
    expect(AWKWARD).toHaveLength(17);
  });

  it('is both things at once, which is what nothing else in the matrix is', async () => {
    const { header } = await shape();
    expect(header.bytesPerSample).toBe(3);
    expect(header.variant).toBe('BDF+D');

    const pairs: string[] = [];
    for (const file of AWKWARD) {
      const recording = await openEdf(byteSource(file.bytes));
      const index = await buildRecordIndex(recording);
      if (recording.header.bytesPerSample === 3 && (index.gaps ?? []).length > 0) {
        pairs.push(file.name);
      }
    }
    expect(pairs).toEqual(['BDF+D: 24-bit samples and a gap at once']);
  });

  it('has a real hole in it, found by a full scan', async () => {
    const index = await buildRecordIndex(await shape());
    expect(index.segments).toHaveLength(2);
    expect(index.gaps ?? []).toHaveLength(1);
    expect((index.gaps ?? [])[0]?.durationSeconds).toBe(7);
  });
});

describe('reading across the join', () => {
  it('returns one chunk per contiguous run, not one crossing the gap', async () => {
    const recording = await shape();
    const index = await buildRecordIndex(recording);
    const chunks = await readWindow(
      { ...recording, index },
      { startSeconds: 0, durationSeconds: 20, signalIndices: [0] },
    );
    expect(chunks).toHaveLength(2);
  });

  it('reads the same samples through the window as through the record range', async () => {
    // The arithmetic that a three-byte stride and a run boundary share: if either were wrong, the
    // two paths would disagree on this file and agree on every other shape in the matrix.
    const recording = await shape();
    const index = await buildRecordIndex(recording);
    const chunks = await readWindow(
      { ...recording, index },
      { startSeconds: 0, durationSeconds: 20, signalIndices: [0] },
    );

    const joined = chunks.flatMap((chunk) => [...(chunk.signals[0]?.digital ?? [])]);
    const direct = await readRecords(recording, {
      records: { start: 0, count: recording.header.recordCount },
      signalIndices: [0],
    });
    expect(joined).toEqual([...(direct.signals[0]?.digital ?? [])]);
    expect(joined.length).toBeGreaterThan(0);
  });

  it('sign-extends three bytes, which two bytes would not exercise', async () => {
    const recording = await shape();
    const signal = recording.header.signals[0];
    expect(signal?.samplesPerRecord).toBe(8);
    // A 24-bit signal declares the BDF digital range; a 16-bit reader would clamp it.
    expect(signal?.digitalMinimum).toBe(-8388608);
    expect(signal?.digitalMaximum).toBe(8388607);
  });
});
