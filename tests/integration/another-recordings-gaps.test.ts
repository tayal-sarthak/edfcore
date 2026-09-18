/**
 * A recording carrying another recording's index.
 *
 * The timeline and the index reach `resolveTimeWindow` as separate arguments, and are only ever
 * paired by a caller. `buildRecordIndex` resolves to a bare index, so
 * `{ ...recording, index: await buildRecordIndex(recording) }` is the documented way to attach one —
 * which makes holding the wrong one an ordinary slip. `validate-index-reuse.test.ts` lists how:
 * "a viewer holding indices for several open recordings, a helper that caches one per session, a
 * loop that forgets to rebuild", and states what it costs — "not a wrong number but a wrong FILE:
 * the segments and gaps of recording A reported as the structure of recording B".
 *
 * `validateRecording` refuses a mismatched index. Every READ went through `resolveTimeWindow`, which
 * did not: a continuous eight-record file carrying a gapped file's index returned records 0..3 for a
 * window over the whole recording — half the data missing, silently — and `[]` for a window inside
 * the other file's gap, which reads as a hole in a file that has none.
 *
 * Two files of the same record count are the case the count alone cannot catch, so the span is
 * compared too: a complete index's last segment ends at the recording's span, by construction.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import { resolveTimeWindow } from '../../src/time/window.js';
import type { EdfRecordIndex, EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const RECORDS = 8;

/** Continuous, eight records, eight seconds. */
const WHOLE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 60 }],
});

/** The same record count, with a twenty-second hole after record 3. */
const GAPPED = buildEdf({
  format: 'EDF',
  plus: 'D',
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  signals: [{ label: 'Zz1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 60 }],
  recordOnsetSeconds: (r) => (r < 4 ? r : r + 20),
});

/** Half as many records, so the cheaper count test is the one that fires. */
const SHORTER = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Yy1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 60 }],
});

async function scanned(bytes: Uint8Array): Promise<{
  recording: EdfRecording;
  index: EdfRecordIndex;
}> {
  const recording = await openEdf(byteSource(bytes));
  return { recording, index: await buildRecordIndex(recording) };
}

const WINDOW = { signalIndices: [0], startSeconds: 0, durationSeconds: 8 } as const;

describe('an index from a different file of the same length', () => {
  it('used to hide half the recording, which is what makes it worth refusing', async () => {
    // Through the correctly paired objects, so the numbers are the real ones: eight records here,
    // and a foreign index whose segments stop at four.
    const mine = await scanned(WHOLE);
    const theirs = await scanned(GAPPED);
    expect(theirs.index.recordCount).toBe(mine.index.recordCount);
    expect(resolveTimeWindow(mine.recording.timeline, mine.index, 0, 8)).toEqual([
      { start: 0, count: 8 },
    ]);
    expect(theirs.index.segments?.length).toBe(2);
  });

  it('is refused by resolveTimeWindow', async () => {
    const mine = await scanned(WHOLE);
    const theirs = await scanned(GAPPED);
    let thrown: Error | undefined;
    try {
      resolveTimeWindow(mine.recording.timeline, theirs.index, 0, 8);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown, 'the foreign index mapped the window').toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain('built from different files');
    expect(thrown?.message).toContain('Next:');
  });

  it('is refused by every read that maps a window', async () => {
    const mine = await scanned(WHOLE);
    const theirs = await scanned(GAPPED);
    const crossed = { ...mine.recording, index: theirs.index };
    await expect(readWindow(crossed, WINDOW)).rejects.toThrow(/built from different files/);
    await expect(readEnvelope(crossed, { ...WINDOW, buckets: 4 })).rejects.toThrow(
      /built from different files/,
    );
    await expect(
      (async () => {
        for await (const chunk of streamRecords(crossed, WINDOW)) return chunk;
        return undefined;
      })(),
    ).rejects.toThrow(/built from different files/);
  });

  it('says what reading through the wrong one does', async () => {
    const mine = await scanned(WHOLE);
    const theirs = await scanned(GAPPED);
    expect(() => resolveTimeWindow(mine.recording.timeline, theirs.index, 0, 8)).toThrow(
      /data missing rather than data wrong/,
    );
  });
});

describe('an index from a file of a different length', () => {
  it('is refused on the record counts, which is the cheaper test', async () => {
    const mine = await scanned(WHOLE);
    const theirs = await scanned(SHORTER);
    expect(() => resolveTimeWindow(mine.recording.timeline, theirs.index, 0, 8)).toThrow(
      /the index counts 4 records and the timeline 8/,
    );
  });
});

describe('a recording and its own index', () => {
  it('still maps a window over the whole continuous file', async () => {
    const { recording, index } = await scanned(WHOLE);
    const chunks = await readWindow({ ...recording, index }, WINDOW);
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.records).toEqual({ start: 0, count: RECORDS });
  });

  it('still splits a gapped file at its own gap', async () => {
    const { recording, index } = await scanned(GAPPED);
    const chunks = await readWindow(
      { ...recording, index },
      {
        signalIndices: [0],
        startSeconds: 0,
        durationSeconds: 40,
      },
    );
    expect(chunks.length).toBe(2);
  });

  it('still works from the probed index openEdf hands you', async () => {
    const recording = await openEdf(byteSource(WHOLE));
    expect(resolveTimeWindow(recording.timeline, recording.index, 0, 8)).toEqual([
      { start: 0, count: RECORDS },
    ]);
  });

  it('still answers for a file with no records at all', async () => {
    const empty = buildEdf({
      format: 'EDF',
      recordCount: 0,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
    });
    const { recording, index } = await scanned(empty);
    expect(index.segments?.length ?? 0).toBe(0);
    expect(resolveTimeWindow(recording.timeline, index, 0, 8)).toEqual([]);
  });
});
