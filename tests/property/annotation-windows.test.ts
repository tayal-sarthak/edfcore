/**
 * The window rule for annotations, over arbitrary files rather than the ones the page draws.
 *
 * `annotations-query.ts` states it twice, in prose and in one expression:
 *
 * > Overlap, not containment: an annotation with a duration counts when any part of it falls in
 * > the window … A zero-duration event counts when its onset is in `[startSeconds, startSeconds +
 * > durationSeconds)` — half-open, so adjacent windows partition the recording without
 * > double-counting the boundary.
 *
 * `tests/unit/annotations-query.test.ts` checks that with hand-placed events at hand-picked
 * boundaries, and it is thorough about the cases someone thought of — the instant at t = 0, the
 * epoch that ends exactly where the window starts, the event whose writer spelled its duration
 * `0` rather than omitting it. What no example can say is that the rule holds for a partition it
 * was not written against.
 *
 * So this generates the events, writes them into a real EDF+ file, reads them back through the
 * parser, and checks the three things that make "partition" mean anything:
 *
 *  - every instantaneous event lands in exactly one window of an adjacent-window partition;
 *  - an event with a duration lands in every window it overlaps and no other;
 *  - the answer is the same one an independent case analysis gives, in ticks.
 *
 * Going through a file rather than synthesising `EdfAnnotation` objects is the point of doing it
 * here at all. The comparison is on `onsetTicksFromFirstRecord`, and those ticks are parsed digit
 * by digit out of the TAL — an oracle fed hand-built objects would agree with the filter about
 * numbers no file ever produced.
 *
 * The seed is constant, so a failure is reproducible from the terminal output alone.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { filterAnnotationsByTime } from '../../src/annotations-query.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import type { EdfAnnotation } from '../../src/types.js';
import { minimalEdfPlus } from '../support/writer.js';

const SEED = 0x0a17;
const RECORDS = 24;

interface Event {
  readonly onset: number;
  readonly duration: number | undefined;
}

/** Onsets on a tenth-of-a-second grid, which every TAL can spell exactly. */
const event = fc.record({
  onset: fc.integer({ min: 0, max: RECORDS * 10 - 1 }).map((tenths) => tenths / 10),
  duration: fc.oneof(
    fc.constant(undefined),
    // Zero is a real spelling of an instant, and the one that used to be dropped.
    fc.integer({ min: 0, max: 60 }).map((tenths) => tenths / 10),
  ),
});

async function read(events: readonly Event[]): Promise<readonly EdfAnnotation[]> {
  const bytes = minimalEdfPlus({
    recordCount: RECORDS,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    annotationSignals: [
      {
        samplesPerRecord: 120,
        tals: (record) =>
          events
            .filter((entry) => Math.floor(entry.onset) === record)
            .map((entry) => ({
              onset: entry.onset,
              ...(entry.duration === undefined ? {} : { duration: entry.duration }),
              texts: [`e${entry.onset}`],
            })),
      },
    ],
  });
  const recording = await openEdf(byteSource(bytes));
  const { annotations } = await readAnnotations(recording, { start: 0, count: RECORDS });
  return annotations;
}

/**
 * The rule as a case analysis rather than as one expression, which is the only way an oracle is
 * worth anything here: an instant is in a window when the window contains its onset, and a span
 * is in a window when the two half-open intervals overlap.
 */
function belongs(annotation: EdfAnnotation, fromTicks: bigint, toTicks: bigint): boolean {
  const onset = annotation.onsetTicksFromFirstRecord;
  const duration = annotation.durationTicks ?? 0n;
  if (duration === 0n) return onset >= fromTicks && onset < toTicks;
  return onset < toTicks && onset + duration > fromTicks;
}

const TICKS_PER_SECOND = 10_000_000n;

describe('filtering annotations to a window', () => {
  it('agrees with the case analysis the documentation writes out', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(event, { maxLength: 12 }),
        fc.integer({ min: 0, max: RECORDS * 10 }).map((tenths) => tenths / 10),
        fc.integer({ min: 1, max: 100 }).map((tenths) => tenths / 10),
        async (events, startSeconds, durationSeconds) => {
          const annotations = await read(events);
          const from = BigInt(Math.round(startSeconds * 10)) * (TICKS_PER_SECOND / 10n);
          const to = from + BigInt(Math.round(durationSeconds * 10)) * (TICKS_PER_SECOND / 10n);

          const got = filterAnnotationsByTime(annotations, { startSeconds, durationSeconds });
          const want = annotations.filter((annotation) => belongs(annotation, from, to));
          expect(got.map((annotation) => annotation.onsetRaw)).toEqual(
            want.map((annotation) => annotation.onsetRaw),
          );
        },
      ),
      { seed: SEED, numRuns: 60 },
    );
  });

  it('gives every instantaneous event exactly one window of a partition', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(event, { maxLength: 12 }),
        fc.integer({ min: 1, max: 8 }),
        async (events, widthSeconds) => {
          const annotations = await read(events);
          const instants = annotations.filter(
            (annotation) => (annotation.durationTicks ?? 0n) === 0n,
          );
          fc.pre(instants.length > 0);

          // Keyed by position, not by onset: two events may share an onset, and a map keyed on
          // the value would count the pair once and call it right.
          const homes = new Map<number, number>();
          for (const annotation of instants) homes.set(annotations.indexOf(annotation), 0);
          // Windows tile [0, RECORDS) end to end, which is what "adjacent" means.
          for (let start = 0; start < RECORDS; start += widthSeconds) {
            for (const annotation of filterAnnotationsByTime(annotations, {
              startSeconds: start,
              durationSeconds: widthSeconds,
            })) {
              if ((annotation.durationTicks ?? 0n) !== 0n) continue;
              const at = annotations.indexOf(annotation);
              homes.set(at, (homes.get(at) ?? 0) + 1);
            }
          }
          for (const [at, count] of homes) {
            expect(count, annotations[at]?.onsetRaw ?? `${at}`).toBe(1);
          }
        },
      ),
      { seed: SEED, numRuns: 60 },
    );
  });

  it('gives an event with a duration every window it overlaps', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(event, { maxLength: 8 }),
        fc.integer({ min: 1, max: 8 }),
        async (events, widthSeconds) => {
          const annotations = await read(events);
          const spans = annotations.filter((annotation) => (annotation.durationTicks ?? 0n) > 0n);
          fc.pre(spans.length > 0);

          const seen = new Map<number, number>();
          const expected = new Map<number, number>();
          const width = BigInt(widthSeconds) * TICKS_PER_SECOND;
          for (const annotation of spans) {
            const position = annotations.indexOf(annotation);
            seen.set(position, 0);
            let count = 0;
            for (let at = 0n; at < BigInt(RECORDS) * TICKS_PER_SECOND; at += width) {
              if (belongs(annotation, at, at + width)) count += 1;
            }
            expected.set(position, count);
          }

          for (let start = 0; start < RECORDS; start += widthSeconds) {
            for (const annotation of filterAnnotationsByTime(annotations, {
              startSeconds: start,
              durationSeconds: widthSeconds,
            })) {
              if ((annotation.durationTicks ?? 0n) === 0n) continue;
              const at = annotations.indexOf(annotation);
              seen.set(at, (seen.get(at) ?? 0) + 1);
            }
          }
          expect([...seen]).toEqual([...expected]);
        },
      ),
      { seed: SEED, numRuns: 40 },
    );
  });

  it('returns the same objects, in the order they came in', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(event, { minLength: 1, maxLength: 12 }), async (events) => {
        const annotations = await read(events);
        const got = filterAnnotationsByTime(annotations, {
          startSeconds: 0,
          durationSeconds: RECORDS,
        });
        // A filter, not a projection: identity and order both survive, which is what lets a
        // caller hold on to a result and compare it with the list it came from.
        let at = -1;
        for (const annotation of got) {
          const found = annotations.indexOf(annotation);
          expect(found).toBeGreaterThan(at);
          at = found;
        }
      }),
      { seed: SEED, numRuns: 40 },
    );
  });
});
