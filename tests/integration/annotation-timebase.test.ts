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
import { openEdf, readAnnotations, readWindow } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

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
