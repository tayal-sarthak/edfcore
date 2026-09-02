/**
 * Locating a sample by the instant it starts at, on every shape.
 *
 * `api-helpers.md` describes what the recording-aware sample helpers do in two regimes: on a
 * contiguous file they agree with the grid functions exactly, and on a discontinuous one they
 * differ by the gaps, with `sampleAt` able to answer `undefined` for an instant in a hole.
 *
 * A file whose records OVERLAP is neither. Two samples start at the same instant there, so
 * `sampleAt(sampleStartSecondsOf(recording, signal, i))` can answer with a sample that is not `i`
 * — on the shape added in 0.6.36 it does for twenty of the first forty-eight indices. There is no
 * error and no `undefined`: the sample it names does start at the instant asked for, and nothing
 * can choose between two that do.
 *
 * That is a third answer a caller round-tripping an index would not expect from reading the page,
 * and the page now says so (0.6.38). What this file does is execute the property in both its
 * forms: the weak one that holds everywhere, and the strong one that holds on the sixteen shapes
 * whose records do not overlap.
 *
 * The distinction is read off the timeline's own diagnostic rather than from the indices being
 * compared, which would make the check circular.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { sampleAt, sampleStartSecondsOf } from '../../src/sample-locate.js';
import type { EdfRecording } from '../../src/types.js';
import { AWKWARD } from '../support/awkward-files.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

const PAGE = DOCS_PAGES.get('api-helpers.md') ?? '';

/** How many of the first `limit` indices come back as themselves, and how many merely as an instant. */
async function roundTrip(bytes: Uint8Array, limit = 48) {
  const opened = await openEdf(byteSource(bytes));
  const recording: EdfRecording = { ...opened, index: await buildRecordIndex(opened) };
  const signalIndex = recording.header.dataSignalIndices[0];
  const signal = signalIndex === undefined ? undefined : recording.header.signals[signalIndex];
  if (
    signalIndex === undefined ||
    signal === undefined ||
    recording.header.recordDurationSeconds === 0 ||
    recording.header.recordCount === 0
  ) {
    return undefined;
  }

  const total = Math.min(limit, signal.samplesPerRecord * recording.header.recordCount);
  let same = 0;
  let sameInstant = 0;
  for (let index = 0; index < total; index += 1) {
    const seconds = sampleStartSecondsOf(recording, signalIndex, index);
    const found = sampleAt(recording, signalIndex, seconds);
    if (found === undefined) continue;
    if (found.sampleIndex === index) same += 1;
    if (sampleStartSecondsOf(recording, signalIndex, found.sampleIndex) === seconds) {
      sameInstant += 1;
    }
  }
  const overlapping = recording.timeline.diagnostics.some(
    (one) => one.code === 'RECORD_ONSET_SPACING_VIOLATION',
  );
  return { total, same, sameInstant, overlapping };
}

describe('the page', () => {
  it('still describes the two regimes, and now the third', () => {
    const text = PAGE.replace(/\s+/g, ' ');
    expect(text).toContain('On a contiguous file they agree with the grid functions exactly');
    expect(text).toContain('There is a third regime');
    expect(text).toContain('two samples start at the same instant');
  });

  it('is checked against seventeen shapes', () => {
    expect(AWKWARD).toHaveLength(17);
  });
});

describe.each(AWKWARD)('$name', ({ bytes }) => {
  it('finds a sample that starts at the instant it was given, whatever the file', async () => {
    const result = await roundTrip(bytes);
    if (result === undefined) return;
    // The weak form, which holds everywhere including the overlapping file.
    expect(result.sameInstant).toBe(result.total);
  });

  it('finds the same index, unless two samples share the instant', async () => {
    const result = await roundTrip(bytes);
    if (result === undefined) return;
    if (result.overlapping) {
      // The strong form fails here, and it is the only place it does.
      expect(result.same).toBeLessThan(result.total);
      return;
    }
    expect(result.same).toBe(result.total);
  });
});

describe('the shape that separates the two forms', () => {
  it('is one, and it is the overlapping one', async () => {
    const differing: string[] = [];
    for (const file of AWKWARD) {
      const result = await roundTrip(file.bytes);
      if (result !== undefined && result.same < result.total) differing.push(file.name);
    }
    expect(differing).toEqual(['records that overlap in time']);
  });

  it('differs on a real share of its indices, not on one edge case', async () => {
    const overlapping = AWKWARD.find((file) => file.name === 'records that overlap in time');
    if (overlapping === undefined) throw new Error('the matrix lost the overlapping shape');
    const result = await roundTrip(overlapping.bytes);
    expect(result?.same).toBe(28);
    expect(result?.total).toBe(48);
  });
});
