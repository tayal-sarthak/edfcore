/**
 * Annotation queries and reads share one axis.
 *
 * EDF+ lets a file state a sub-second start offset in record 0's timekeeping TAL: the header
 * carries whole seconds, and the fraction goes there. `onsetTicks` is the number the file wrote,
 * on the header's axis. Every read in the package — `resolveTimeWindow`, `readWindow`,
 * `readEnvelope` — puts `t = 0` at the START OF RECORD 0 instead.
 *
 * Those two axes are the same on a file with no offset, which is most files, and up to a second
 * apart on a file that declares one. `filterAnnotationsByTime` compared against `onsetTicks`, so
 * on exactly the files careful enough to state their offset it answered on the wrong axis and put
 * events in the neighbouring window. The whole point of the pair `readWindow` +
 * `filterAnnotationsByTime` is "the events in the window I just read", so the two must agree.
 *
 * The assertion below is that agreement, checked against the records rather than against another
 * query: the annotation sits inside record 0, so the query for record 0's window must return it.
 */

import { describe, expect, it } from 'vitest';
import { annotationsAt, filterAnnotationsByTime } from '../../src/annotations-query.js';
import { TICKS_PER_SECOND } from '../../src/constants.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const START_OFFSET = 0.3;
const RECORDS = 4;

/** Record `r` covers header time `[0.3 + r, 1.3 + r)`, i.e. recording time `[r, r + 1)`. */
function offsetFile(): Uint8Array {
  return buildEdf({
    plus: 'C',
    recordCount: RECORDS,
    recordDurationSeconds: 1,
    startOffsetSeconds: START_OFFSET,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    annotationSignals: [
      {
        samplesPerRecord: 40,
        // Header time 1.2 s. Record 0 runs to header time 1.3, so this is 0.9 s into record 0.
        // Header time 4.1 s is 3.8 s into the recording, inside the last record — and past the
        // end of the 4 s span on the header axis, where it belongs to no window at all.
        tals: (r: number) =>
          r === 1
            ? [{ onset: 1.2, texts: ['Spindle'] }]
            : r === 3
              ? [{ onset: 4.1, texts: ['Arousal'] }]
              : [],
      },
    ],
  });
}

async function load(): Promise<{
  readonly annotations: Awaited<ReturnType<typeof readAnnotations>>['annotations'];
  readonly recording: Awaited<ReturnType<typeof openEdf>>;
}> {
  const recording = await openEdf(byteSource(offsetFile()));
  const { annotations } = await readAnnotations(recording, { start: 0, count: RECORDS });
  return { annotations, recording };
}

describe('a file with a sub-second start offset', () => {
  it('publishes both axes, exactly, and they differ by the offset', async () => {
    const { annotations } = await load();
    const event = annotations[0];
    expect(event?.text).toBe('Spindle');

    expect(event?.onsetTicks).toBe(12_000_000n);
    expect(event?.onsetTicksFromFirstRecord).toBe(9_000_000n);
    expect((event?.onsetTicks ?? 0n) - (event?.onsetTicksFromFirstRecord ?? 0n)).toBe(
      BigInt(Math.round(START_OFFSET * Number(TICKS_PER_SECOND))),
    );
    // The exact field agrees with the float one it replaces, to the tick.
    expect(event?.onsetSecondsFromFirstRecord).toBe(0.9);
    expect(event?.onsetSecondsFromHeaderStart).toBe(1.2);
  });

  it('answers a time query on the axis reads use, not the header axis', async () => {
    const { annotations, recording } = await load();

    // Ground truth from the records: the event is 0.9 s into record 0.
    const first = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 1,
    });
    expect(first[0]?.records).toEqual({ start: 0, count: 1 });

    // So the query for the same window must return it — and the next window must not.
    expect(
      filterAnnotationsByTime(annotations, { startSeconds: 0, durationSeconds: 1 }).map(
        (a) => a.text,
      ),
    ).toEqual(['Spindle']);
    expect(filterAnnotationsByTime(annotations, { startSeconds: 1, durationSeconds: 1 })).toEqual(
      [],
    );
  });

  it('locates the instant on the same axis', async () => {
    const { annotations } = await load();
    expect(annotationsAt(annotations, 0.9).map((a) => a.text)).toEqual(['Spindle']);
    // 1.2 is where the header axis would have put it.
    expect(annotationsAt(annotations, 1.2)).toEqual([]);
  });

  it('partitions the recording without gaps or double counting', async () => {
    // Adjacent half-open windows over the whole span see each event exactly once. `Arousal` is
    // what makes this bite: on the header axis it sits at 4.1 s, past the end of a 4 s span, so
    // it belonged to no window — the defect could drop an event outright, not merely misplace it.
    const { annotations } = await load();
    expect(annotations.map((a) => a.text)).toEqual(['Spindle', 'Arousal']);
    const seen = Array.from({ length: RECORDS }, (_, i) =>
      filterAnnotationsByTime(annotations, { startSeconds: i, durationSeconds: 1 }),
    ).flat();
    expect(seen.map((a) => a.text)).toEqual(['Spindle', 'Arousal']);
  });
});

describe('a file with no start offset', () => {
  it('leaves the two axes identical, so nothing changes for it', async () => {
    const recording = await openEdf(
      byteSource(
        buildEdf({
          plus: 'C',
          recordCount: RECORDS,
          recordDurationSeconds: 1,
          signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
          annotationSignals: [
            {
              samplesPerRecord: 40,
              tals: (r: number) => (r === 1 ? [{ onset: 1.2, texts: ['Spindle'] }] : []),
            },
          ],
        }),
      ),
    );
    const { annotations } = await readAnnotations(recording, { start: 0, count: RECORDS });
    const event = annotations[0];
    expect(event?.onsetTicksFromFirstRecord).toBe(event?.onsetTicks);
    expect(
      filterAnnotationsByTime(annotations, { startSeconds: 1, durationSeconds: 1 }).map(
        (a) => a.text,
      ),
    ).toEqual(['Spindle']);
  });
});

describe('an explicit zero duration on disk', () => {
  it('survives a real read and lands in the window that starts on its onset', async () => {
    // The on-disk shape is `+2\x150\x14ExplicitZero\x14\x00` — a writer that always emits the
    // 0x15 duration field and writes `0` for an instantaneous marker. src/tal/grammar.ts assigns
    // durationTicks = 0n for it, and before 0.2.20 filterAnnotationsByTime dropped it from the
    // window [2, 3) and from [1, 2) alike, so it belonged to no window in a partition.
    const bytes = buildEdf({
      plus: 'C',
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
      annotationSignals: [
        {
          samplesPerRecord: 60,
          tals: (r: number) =>
            r === 2
              ? [
                  { onset: 2, duration: 0, texts: ['ExplicitZero'] },
                  { onset: 2, texts: ['OmittedDuration'] },
                ]
              : [],
        },
      ],
    });
    const recording = await openEdf(byteSource(bytes));
    const { annotations } = await readAnnotations(recording, { start: 0, count: 4 });

    // The two really are spelled differently on disk, and really do mean the same instant.
    const explicit = annotations.find((a) => a.text === 'ExplicitZero');
    const omitted = annotations.find((a) => a.text === 'OmittedDuration');
    expect(explicit?.durationTicks).toBe(0n);
    expect(omitted?.durationTicks).toBeUndefined();
    expect(explicit?.onsetTicksFromFirstRecord).toBe(omitted?.onsetTicksFromFirstRecord);

    expect(
      filterAnnotationsByTime(annotations, { startSeconds: 2, durationSeconds: 1 }).map(
        (a) => a.text,
      ),
    ).toEqual(['ExplicitZero', 'OmittedDuration']);

    // And each appears exactly once across a partition of the whole recording.
    const seen = Array.from({ length: 4 }, (_, i) =>
      filterAnnotationsByTime(annotations, { startSeconds: i, durationSeconds: 1 }),
    ).flat();
    expect(seen.map((a) => a.text)).toEqual(['ExplicitZero', 'OmittedDuration']);
  });
});

describe('a record with no timekeeping TAL starts at the same instant however it was read', () => {
  /**
   * The 0.1.4 failure, still live on one path until 0.3.14: the same record reported two
   * different start times depending on how many neighbours were decoded with it.
   *
   * `decodeAnnotations` derives the onset of a record whose timekeeping TAL is missing as
   * `origin + recordIndex * recordDuration`, and the origin can only come from a caller who has
   * already seen record 0. Two option names carry it — `originTicks` for this grid,
   * `startOffsetTicks` for the annotation rebasing — and neither fell back to the other.
   * `readAnnotations` passed only `startOffsetTicks`, so the one public function whose docs say
   * "passes `timeline.startOffsetTicks` for you" was the one that did not supply this origin.
   */
  const OFFSET_TICKS = 2_500_000n; // 0.25 s, stated in record 0's timekeeping TAL.

  function fileWithOneBrokenTimekeepingTal(): Uint8Array {
    return minimalEdfPlus({
      plus: 'C',
      recordCount: 8,
      recordDurationSeconds: 1,
      startOffsetSeconds: 0.25,
      // Record 5's timekeeping onset fails the grammar outright, so that record has none.
      recordOnsetSeconds: (r: number) => (r === 5 ? 'xx' : 0.25 + r),
    });
  }

  it('gives record 5 the same onset alone as in a whole-file read', async () => {
    const recording = await openEdf(byteSource(fileWithOneBrokenTimekeepingTal()));
    expect(recording.timeline.startOffsetTicks).toBe(OFFSET_TICKS);

    const whole = await readAnnotations(recording, { start: 0, count: 8 });
    const alone = await readAnnotations(recording, { start: 5, count: 1 });

    // 5.25 s on the header axis: the offset plus five whole records.
    const expected = OFFSET_TICKS + 5n * TICKS_PER_SECOND;
    expect(whole.recordOnsetTicks[5]).toBe(expected);
    // Before 0.3.14 this was 50000000n — five seconds flat, the offset silently dropped.
    expect(alone.recordOnsetTicks[0]).toBe(expected);

    // The record really does lack a timekeeping TAL; without that the test proves nothing.
    expect(alone.diagnostics.map((d) => d.code)).toContain('TIMEKEEPING_TAL_MISSING');
  });

  it('agrees with the record onsets every other path derives', async () => {
    // readRecords decodes the same annotation regions through a caller that always passed
    // originTicks, so its answer is the independent one.
    const recording = await openEdf(byteSource(fileWithOneBrokenTimekeepingTal()));
    const chunk = await readRecords(recording, {
      records: { start: 5, count: 1 },
      signalIndices: [0],
    });
    const alone = await readAnnotations(recording, { start: 5, count: 1 });

    // chunk.startTicks is on the recording axis (t = 0 at record 0); the onset is on the header
    // axis. They differ by exactly the start offset, and did not before the fix.
    expect(alone.recordOnsetTicks[0]! - OFFSET_TICKS).toBe(chunk.startTicks);
  });
});

describe('a scan chunk size cannot change what the index says', () => {
  /**
   * `scanOnsets` states the invariant verbatim: "The origin comes from the recording, not from
   * whatever this chunk happens to contain. Chunking is a memory-bounding detail and must not
   * change the answer."
   *
   * It did change the answer. The grid origin for a record with no timekeeping TAL was derived as
   * `firstObserved.ticks - firstObserved.recordIndex * recordDuration` — chunk-LOCAL whenever the
   * chunk contained any readable TAL — and on a discontinuous file `firstObserved` may be a
   * post-gap record, so that expression is record 0's start plus the gap rather than record 0's
   * start. 0.3.14 gave a supplied origin to the branch where a range observes NOTHING; this branch
   * ignored it entirely (fixed in 0.3.28).
   */
  function jumpWithOneUnreadableTal(): Uint8Array {
    return buildEdf({
      plus: 'D',
      recordCount: 6,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 2 }],
      annotationSignals: [{ samplesPerRecord: 20 }],
      // 0, 1, 2, then a jump to 10; record 4's timekeeping onset fails the grammar outright.
      recordOnsetSeconds: (r: number) => (r === 4 ? 'zz' : ([0, 1, 2, 10, 11, 12][r] as number)),
    });
  }

  it('gives the same verdict at every budget, rather than one that depends on memory', async () => {
    const recording = await openEdf(byteSource(jumpWithOneUnreadableTal()));
    // 44-byte records, so these are 1, 3, 4, 6, 7 and 9 records per chunk.
    const budgets = [44, 136, 204, 272, 340, 408];

    const outcomes: string[] = [];
    for (const maxMaterializeBytes of budgets) {
      outcomes.push(
        await buildRecordIndex(recording, { maxMaterializeBytes })
          .then(() => 'built an index')
          .catch((error: unknown) => `threw ${(error as { code?: string }).code}`),
      );
    }

    // Before 0.3.28 this array held both 'built an index' and 'threw TIMELINE_NOT_MONOTONIC' for
    // the same recording object. Which one you got depended on maxMaterializeBytes alone.
    expect(new Set(outcomes).size).toBe(1);
    // And the verdict is the honest one: record 4 has no recoverable onset, so the timeline
    // derived by the rule TIMEKEEPING_TAL_MISSING promises really is not monotonic.
    expect(outcomes[0]).toBe('threw TIMELINE_NOT_MONOTONIC');
  });

  it('derives a missing onset by the rule its own diagnostic states', async () => {
    // A CONTIGUOUS file, where the derivation is recoverable: record 4's onset is
    // `startOffset + 4 * recordDuration`, and it is that at every chunk size.
    const bytes = buildEdf({
      plus: 'C',
      recordCount: 6,
      recordDurationSeconds: 1,
      startOffsetSeconds: 0.25,
      signals: [{ label: 'Fp1', samplesPerRecord: 2 }],
      annotationSignals: [{ samplesPerRecord: 20 }],
      recordOnsetSeconds: (r: number) => (r === 4 ? 'zz' : 0.25 + r),
    });
    const recording = await openEdf(byteSource(bytes));

    for (const maxMaterializeBytes of [44, 136, 272, 408]) {
      const index = await buildRecordIndex(recording, { maxMaterializeBytes });
      expect(await index.onsetTicks(4)).toBe(2_500_000n + 4n * TICKS_PER_SECOND);
      expect(index.segments).toHaveLength(1);
    }
  });
});
