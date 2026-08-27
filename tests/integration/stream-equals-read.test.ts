/**
 * "A streamed chunk and a read chunk are the same object in every respect, diagnostics included."
 *
 * `api-helpers.md` says that of `streamRecords`, and gives the reason: the chunks come from
 * `readRecords`. It is what lets a caller develop against `readWindow` and switch to streaming for
 * the twenty-two-hour file without re-reading their own downstream code — the argument the page
 * makes two sentences earlier, that `readWindow` "returns every chunk at once, which is right for
 * a window you are about to draw and wrong for a whole recording".
 *
 * It was checked in one place, `tests/corpus/large-file.test.ts`, which SKIPS without
 * `npm run corpus:fetch`. So on a fresh clone nothing compared the two at all — and even there the
 * comparison is of samples, which is the half that would survive a chunk losing its diagnostics,
 * its `precededByGap`, or its byte accounting.
 *
 * "Every respect" is taken literally here: each streamed chunk is compared with the chunk
 * `readRecords` returns for the same record range, field for field. The fixture is chosen so the
 * fields that are usually empty are not — a gap in the middle so `precededByGap` is populated on
 * one chunk and `undefined` on the others, and a malformed TAL so some chunk carries a diagnostic.
 * A chunk whose every optional field is absent compares equal to a chunk that dropped them.
 *
 * The other two claims in the same sentence are checked beside it: chunks arrive in time order and
 * never span a gap. The second is what makes `chunk.durationTicks` mean what a reader thinks —
 * `readRecords` will happily hand back a chunk straddling a discontinuity, because you named the
 * records, and a streamed chunk must never be one.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfChunk, EdfRecording } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PROSE = (DOCS_PAGES.get('api-helpers.md') ?? '').replace(/\s+/g, ' ');

/** Twelve records, a seven-second hole after record 5, and one record whose TAL is malformed. */
const BYTES = buildEdf({
  format: 'EDF',
  plus: 'D',
  recordCount: 12,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (recordIndex) => (recordIndex < 6 ? recordIndex : recordIndex + 7),
  signals: [
    { label: 'Fp1', samplesPerRecord: 8, sample: (r, k) => r * 16 + k },
    { label: 'Resp', samplesPerRecord: 3, sample: (r, k) => r * 4 + k },
  ],
  annotationSignals: [
    {
      samplesPerRecord: 40,
      tals: (recordIndex) =>
        recordIndex === 4
          ? // A non-numeric onset, written verbatim: the record still reads and the chunk carries
            // a TAL_MALFORMED diagnostic, which is the field a samples-only comparison misses.
            [{ onset: '+4.x', texts: ['spike'] }]
          : [{ onset: recordIndex + 0.5, texts: [`event ${recordIndex}`] }],
    },
  ],
});

async function scanned(): Promise<EdfRecording> {
  const recording = await openEdf(byteSource(BYTES));
  return { ...recording, index: await buildRecordIndex(recording) };
}

const SIGNALS = [0, 1] as const;

async function streamAll(recording: EdfRecording, chunkRecords: number): Promise<EdfChunk[]> {
  const chunks: EdfChunk[] = [];
  for await (const chunk of streamRecords(recording, {
    signalIndices: SIGNALS,
    startSeconds: 0,
    durationSeconds: recording.timeline.spanSeconds,
    chunkRecords,
  })) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('the page still makes the claim', () => {
  it('says a streamed chunk and a read chunk are the same object', () => {
    expect(PROSE).toContain(
      'a streamed chunk and a read chunk are the same object in every respect',
    );
    expect(PROSE).toContain('Chunks arrive in time order, never span a gap');
  });
});

describe('a streamed chunk equals the chunk readRecords returns for the same records', () => {
  for (const chunkRecords of [1, 2, 5, 256]) {
    it(`holds at chunkRecords ${chunkRecords}, diagnostics and gap included`, async () => {
      const recording = await scanned();
      const chunks = await streamAll(recording, chunkRecords);
      expect(chunks.length).toBeGreaterThan(0);

      for (const chunk of chunks) {
        const read = await readRecords(recording, {
          records: chunk.records,
          signalIndices: SIGNALS,
        });
        expect(chunk, `chunk at record ${chunk.records.start}`).toEqual(read);
      }
    });
  }

  it('compared chunks whose optional fields were populated, or it compared nothing', async () => {
    // A chunk with no diagnostics and no `precededByGap` compares equal to one that dropped both.
    const recording = await scanned();
    const chunks = await streamAll(recording, 2);
    expect(chunks.some((chunk) => chunk.diagnostics.length > 0)).toBe(true);
    expect(chunks.some((chunk) => chunk.precededByGap !== undefined)).toBe(true);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe('the chunks a stream yields', () => {
  it('arrive in time order', async () => {
    const recording = await scanned();
    for (const chunkRecords of [1, 3, 256]) {
      const chunks = await streamAll(recording, chunkRecords);
      for (let at = 1; at < chunks.length; at += 1) {
        const previous = chunks[at - 1];
        const next = chunks[at];
        if (previous === undefined || next === undefined) continue;
        // Ticks, not seconds: two tick counts can round to the same float.
        expect(next.startTicks > previous.startTicks, `chunk ${at} does not follow ${at - 1}`).toBe(
          true,
        );
        expect(next.records.start).toBe(previous.records.start + previous.records.count);
      }
    }
  });

  it('never spans a gap, however the records are chunked', async () => {
    const recording = await scanned();
    const segments = recording.index.segments;
    expect(segments, 'the fixture index was not scanned').toBeDefined();
    expect(segments?.length).toBe(2);

    for (const chunkRecords of [1, 5, 12, 256]) {
      for (const chunk of await streamAll(recording, chunkRecords)) {
        const inside = (segments ?? []).some(
          (segment) =>
            chunk.records.start >= segment.records.start &&
            chunk.records.start + chunk.records.count <=
              segment.records.start + segment.records.count,
        );
        expect(inside, `a chunk of ${chunkRecords} spans the gap`).toBe(true);
        // A chunk inside one segment covers exactly the time its records occupy.
        expect(chunk.durationTicks).toBe(
          BigInt(chunk.records.count) * recording.header.recordDurationTicks,
        );
      }
    }
  });

  it('carries the precededByGap a readWindow chunk carries', async () => {
    const recording = await scanned();
    const windowed = await readWindow(recording, {
      signalIndices: SIGNALS,
      startSeconds: 0,
      durationSeconds: recording.timeline.spanSeconds,
    });
    // One chunk per contiguous run, so the second one is the one after the gap.
    expect(windowed).toHaveLength(2);
    const afterGap = windowed[1];
    expect(afterGap?.precededByGap).toBeDefined();

    const streamedAfterGap = (await streamAll(recording, 256)).find(
      (chunk) => chunk.records.start === afterGap?.records.start,
    );
    expect(streamedAfterGap?.precededByGap).toEqual(afterGap?.precededByGap);
  });
});
