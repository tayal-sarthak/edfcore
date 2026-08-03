/**
 * A record whose timekeeping TAL is missing must get the SAME onset however it is reached.
 *
 * EDF+ requires a timekeeping TAL in every data record, but a missing one is a warning here, not
 * a fatal error, and such a record is documented to get `start + recordIndex * recordDuration`.
 * The `start` in that sentence is the recording's, and deriving it needs record 0 — which a
 * caller decoding some other range does not have.
 *
 * Falling back to an origin of zero made the derived onset a function of *which records shared
 * the call*. Three separate failures came out of that one gap, and all three are here: a
 * conforming file being refused outright, a scan whose verdict depended on its own memory
 * budget, and a record that reported two different start times depending on how many neighbours
 * were requested with it.
 */

import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../src/header/parse.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { minimalEdfPlus } from '../support/writer.js';

const RECORD_SECONDS = 0.5;
const START_OFFSET = 0.5;
const RECORDS = 6;

/**
 * Erase one record's annotation region, which removes its timekeeping TAL and nothing else.
 *
 * The writer always synthesises a conforming TAL, so the defect is introduced afterwards, using
 * the parsed header's own geometry rather than hand-computed offsets.
 */
function withoutTimekeeping(file: Uint8Array, recordIndex: number): Uint8Array {
  const out = file.slice();
  const header = parseHeader(out, out.length);
  const annotationIndex = header.annotationSignalIndices[0];
  if (annotationIndex === undefined) throw new Error('the fixture has no annotation signal');

  let withinRecord = 0;
  for (let i = 0; i < annotationIndex; i += 1) {
    const signal = header.signals[i];
    if (signal === undefined) throw new Error(`signal ${i} is missing from the parsed header`);
    withinRecord += signal.samplesPerRecord * header.bytesPerSample;
  }

  const signal = header.signals[annotationIndex];
  if (signal === undefined) throw new Error('the annotation signal is missing');
  const start = header.headerByteLength + recordIndex * header.recordByteLength + withinRecord;
  out.fill(0, start, start + signal.samplesPerRecord * header.bytesPerSample);
  return out;
}

function fixture(blankRecord: number): Uint8Array {
  return withoutTimekeeping(
    minimalEdfPlus({
      recordCount: RECORDS,
      recordDurationSeconds: RECORD_SECONDS,
      startOffsetSeconds: START_OFFSET,
    }),
    blankRecord,
  );
}

describe('a missing timekeeping TAL in the last record', () => {
  it('does not fabricate a discontinuity in a contiguous file', async () => {
    const recording = await openEdf(byteSource(fixture(RECORDS - 1)));

    // The last record derived its onset from zero, so it looked START_OFFSET seconds early and
    // the span came out short of what the records actually cover.
    expect(recording.timeline.spanSeconds).toBe(recording.timeline.coveredSeconds);
    expect(recording.timeline.diagnostics.map((d) => d.code)).not.toContain(
      'DISCONTINUITY_IN_CONTINUOUS_FILE',
    );
  });

  it('still reports the TAL as missing, because it is', async () => {
    const recording = await openEdf(byteSource(fixture(RECORDS - 1)));
    expect(recording.timeline.diagnostics.map((d) => d.code)).toContain('TIMEKEEPING_TAL_MISSING');
  });

  it('leaves the whole file readable', async () => {
    // The fabricated discontinuity made resolveTimeWindow refuse every window on the file, so a
    // single missing TAL in the last record cost the caller the entire recording.
    const recording = await openEdf(byteSource(fixture(RECORDS - 1)));
    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: RECORDS * RECORD_SECONDS,
    });
    expect(chunks).toHaveLength(1);
  });
});

describe('the scan chunk size is a memory detail and cannot change the answer', () => {
  it('produces identical onsets and segments at every budget', async () => {
    // Chunking is documented as invisible ("memory stays bounded whatever the file size"), but a
    // chunk that happened to contain no observed onset derived from zero, so the onsets, the
    // segments and even a fatal TIMELINE_NOT_MONOTONIC varied with maxMaterializeBytes.
    const file = fixture(3);

    const runs = await Promise.all(
      [undefined, 200, 100].map(async (maxMaterializeBytes) => {
        const recording = await openEdf(byteSource(file));
        const index = await buildRecordIndex(
          recording,
          maxMaterializeBytes === undefined ? undefined : { maxMaterializeBytes },
        );
        const onsets: string[] = [];
        for (let i = 0; i < RECORDS; i += 1) onsets.push(String(await index.onsetTicks(i)));
        return `segments=${index.segments?.length} onsets=${onsets.join(',')}`;
      }),
    );

    expect(new Set(runs).size).toBe(1);
    expect(runs[0]).toContain('segments=1');
  });
});

describe("a record's start time does not depend on who it was read with", () => {
  it('reports the same start alone as alongside a neighbour', async () => {
    const recording = await openEdf(byteSource(fixture(3)));

    const alone = await readRecords(recording, {
      signalIndices: [0],
      records: { start: 3, count: 1 },
    });
    const withNeighbour = await readRecords(recording, {
      signalIndices: [0],
      records: { start: 2, count: 2 },
    });

    // Record 2 carries a TAL, so the paired read had an observed onset to derive from and was
    // always right. Read alone, record 3 had none and fell back to an origin of zero.
    expect(alone.startSeconds).toBe(withNeighbour.startSeconds + RECORD_SECONDS);
  });

  it('keeps the sample grid origin consistent too', async () => {
    // chunk.signals[i].startSeconds is what trimToWindow measures its grid from, so a wrong
    // chunk start silently shifts every trimmed window over that record.
    const recording = await openEdf(byteSource(fixture(3)));
    const alone = await readRecords(recording, {
      signalIndices: [0],
      records: { start: 3, count: 1 },
    });
    expect(alone.signals[0]?.startSeconds).toBe(alone.startSeconds);
  });
});
