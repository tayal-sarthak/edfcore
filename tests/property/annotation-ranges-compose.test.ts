/**
 * Reading the annotations in pieces is reading them whole — and the origin that makes it so.
 *
 * `annotations.md` states it as a promise about `readAnnotations`: it "supplies the rebasing origin
 * from the timeline, so a partial range answers the same as a whole-file one". It then says what
 * that promise costs, which is the part with teeth: "It could not derive that origin on its own: a
 * range that does not contain record 0 has to infer it from an observed onset, which only works
 * while the records in between are contiguous, and on an EDF+D file the inference lands outside
 * `[0, 1)` and the rebasing switches off. Before 0.2.28, `readAnnotations(recording, chunk.records)`
 * — the pairing this page recommends — reported the same event a quarter of a second later than a
 * whole-file decode did."
 *
 * Three behaviours, one of them a defect that shipped, and none of them under test. `readAnnotations`
 * was checked on whole files and on single ranges; nothing partitioned a file and compared.
 *
 * The property comes first: for any partition of the record range into contiguous pieces, the reads
 * concatenate to the whole-file read — every field of every event, both axes and both exact tick
 * counts, plus `recordOnsetTicks`. It runs over a plain file, one with a quarter-second start
 * offset (where the origin is a number rather than zero), and an EDF+D file with a twenty-second
 * hole (where the inference the page describes cannot work).
 *
 * Then the three-way comparison that shows the origin doing the work, on the post-gap range of that
 * EDF+D file. `readAnnotations` puts the event at 26.5 s on the record axis. `decodeAnnotations`
 * called directly on the same bytes puts it at 26.75 — its inferred origin landed outside `[0, 1)`,
 * so rebasing switched off and the two axes came back equal, exactly as documented. Passing
 * `startOffsetTicks` by hand, which is what the page tells that caller to do, restores 26.5.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { decodeAnnotations } from '../../src/tal/annotations.js';
import type { EdfAnnotation } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = (DOCS_PAGES.get('annotations.md') ?? '').replace(/\s+/g, ' ');
const SEED = 0x0a11_0001;
const RECORDS = 9;

const shape = (value: unknown): string =>
  JSON.stringify(value, (_key, member: unknown) =>
    typeof member === 'bigint' ? `${member}n` : member,
  );

/** One event per record, half a second into it, so every partition boundary has events either side. */
function fileWith(onsetOf: (record: number) => number, plus: 'C' | 'D'): Uint8Array {
  return buildEdf({
    plus,
    recordCount: RECORDS,
    recordDurationSeconds: 1,
    recordOnsetSeconds: onsetOf,
    signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
    annotationSignals: [
      {
        samplesPerRecord: 40,
        tals: (record) => [{ onset: `+${onsetOf(record) + 0.5}`, texts: [`e${record}`] }],
      },
    ],
  });
}

const FILES: ReadonlyArray<readonly [string, Uint8Array]> = [
  ['a contiguous file', fileWith((record) => record, 'C')],
  ['a quarter-second start offset', fileWith((record) => 0.25 + record, 'C')],
  [
    'an EDF+D file with a twenty-second hole',
    fileWith((record) => (record < 4 ? 0.25 + record : 0.25 + record + 20), 'D'),
  ],
];

/** Contiguous ranges covering `[0, RECORDS)`, from a list of cut points. */
function partitionFrom(cuts: readonly number[]): ReadonlyArray<{ start: number; count: number }> {
  const edges = [...new Set([0, ...cuts.filter((cut) => cut > 0 && cut < RECORDS), RECORDS])].sort(
    (a, b) => a - b,
  );
  const ranges: Array<{ start: number; count: number }> = [];
  for (let at = 0; at < edges.length - 1; at += 1) {
    const start = edges[at] ?? 0;
    const end = edges[at + 1] ?? RECORDS;
    ranges.push({ start, count: end - start });
  }
  return ranges;
}

describe('the page still makes the promise', () => {
  it('and still says what it costs', () => {
    expect(PAGE).toContain(
      '`readAnnotations` supplies the rebasing origin from the timeline, so a partial range answers the same as a whole-file one',
    );
    expect(PAGE).toContain('the inference lands outside `[0, 1)` and the rebasing switches off');
  });
});

describe.each(FILES)('%s', (_name, bytes) => {
  it('reads in any partition of the record range exactly as it reads whole', async () => {
    const recording = await openEdf(byteSource(bytes));
    const whole = await readAnnotations(recording, { start: 0, count: RECORDS });
    expect(whole.annotations).toHaveLength(RECORDS);

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: RECORDS - 1 }), { maxLength: 4 }),
        async (cuts) => {
          const ranges = partitionFrom(cuts);
          const pieces: EdfAnnotation[] = [];
          const onsets: bigint[] = [];
          for (const range of ranges) {
            const part = await readAnnotations(recording, range);
            pieces.push(...part.annotations);
            onsets.push(...part.recordOnsetTicks);
          }
          expect(shape(pieces)).toBe(shape(whole.annotations));
          expect(onsets).toEqual([...whole.recordOnsetTicks]);
        },
      ),
      { seed: SEED, numRuns: 40 },
    );
  });
});

describe('the origin readAnnotations supplies', () => {
  const GAPPED = fileWith((record) => (record < 4 ? 0.25 + record : 0.25 + record + 20), 'D');
  const RANGE = { start: 6, count: 2 } as const;
  const EVENT = 'e6';

  const onsetsOf = (annotations: readonly EdfAnnotation[]): readonly [number, number] => {
    const event = annotations.find((entry) => entry.text === EVENT);
    if (event === undefined) throw new Error(`the fixture carries ${EVENT} and it was not read`);
    return [event.onsetSecondsFromHeaderStart, event.onsetSecondsFromFirstRecord];
  };

  it('is a quarter of a second, and the two axes really differ by it', async () => {
    const recording = await openEdf(byteSource(GAPPED));
    expect(recording.timeline.startOffsetSeconds).toBe(0.25);
    const whole = await readAnnotations(recording, { start: 0, count: RECORDS });
    expect(onsetsOf(whole.annotations)).toEqual([26.75, 26.5]);
  });

  it('reaches a range that does not contain record 0', async () => {
    const recording = await openEdf(byteSource(GAPPED));
    const partial = await readAnnotations(recording, RANGE);
    expect(onsetsOf(partial.annotations)).toEqual([26.75, 26.5]);
  });

  it('and is what decodeAnnotations cannot infer on a discontinuous file', async () => {
    const recording = await openEdf(byteSource(GAPPED));
    const bytes = await readRecordBytes(recording.source, recording.header, RANGE);

    // No origin: the inference lands outside [0, 1), so rebasing switches off and the two axes
    // come back equal — the event sits a quarter of a second late on the record axis.
    const bare = decodeAnnotations(recording.header, bytes, RANGE);
    expect(onsetsOf(bare.annotations)).toEqual([26.75, 26.75]);

    // Passed by hand, which is what the page tells this caller to do.
    const supplied = decodeAnnotations(recording.header, bytes, RANGE, {
      startOffsetTicks: recording.timeline.startOffsetTicks,
    });
    expect(onsetsOf(supplied.annotations)).toEqual([26.75, 26.5]);
  });

  it('though the inference does work while the records in between are contiguous', async () => {
    // The same shape without the hole: `decodeAnnotations` alone gets it right, which is why the
    // failure above is about EDF+D rather than about partial ranges.
    const contiguous = fileWith((record) => 0.25 + record, 'C');
    const recording = await openEdf(byteSource(contiguous));
    const bytes = await readRecordBytes(recording.source, recording.header, RANGE);
    const bare = decodeAnnotations(recording.header, bytes, RANGE);
    expect(onsetsOf(bare.annotations)).toEqual([6.75, 6.5]);
  });
});
