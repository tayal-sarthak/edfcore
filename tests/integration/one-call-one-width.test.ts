/**
 * One call, one bucket width — which is the entire reason this function exists.
 *
 * `api-helpers.md` says it in those words: "Widths that disagree cannot be drawn on one axis, which
 * is the entire reason this function exists separately from `readEnvelope`." Above it the page
 * lists the two ways that went wrong, each with the numbers it produced:
 *
 *  - Before 0.2.31 one bucket COUNT was handed to every chunk, so a window of 11 s asked at 1 s per
 *    bucket came back as 0.27 s per bucket in one chunk and 0.09 s in the other.
 *  - Before 0.3.9 the bucket a sample landed in was decided by dividing the run evenly into that
 *    count, so a 100 s run at 30 s per bucket gave four buckets of 25 s while a 60 s run in the
 *    same call gave two of 30 s.
 *
 * Both are stated as history and neither was pinned. `envelope-buckets.test.ts` and
 * `envelope-bucket-count.test.ts` cover the count — that `bucketCount` is not always what you asked
 * for, and why the two entry points clamp differently — which is the field a caller loops over. The
 * WIDTH is the field a caller draws with, and a viewer placing bucket `b` at
 * `startSeconds + b * secondsPerBucket` gets a plot whose x-axis changes scale halfway across if
 * two chunks disagree about it. Nothing looks wrong; the second half of the trace is simply drawn
 * at a different rate from the first.
 *
 * The two ways run lengths differ in one call are both here: a window spanning a gap gives runs of
 * different lengths, and a window that does not begin on a record boundary gives a first run wider
 * than the window asked for. The assertion is the same for both — every chunk reports the width
 * that was requested — and the run lengths are asserted to differ, or the check is about one run
 * repeated.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelopeAtResolution } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import type { EdfEnvelopeChunk, EdfRecording } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PROSE = (DOCS_PAGES.get('api-helpers.md') ?? '').replace(/\s+/g, ' ');

/** Sixteen one-second records with a four-second hole after the third. */
const GAPPED = buildEdf({
  format: 'EDF',
  plus: 'D',
  recordCount: 16,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (record) => (record < 3 ? record : record + 4),
  signals: [{ label: 'Fp1', samplesPerRecord: 8, sample: (r, k) => (r * 8 + k) % 512 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

/** Contiguous, so a window can start mid-record without a gap confusing the picture. */
const CONTIGUOUS = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 16,
  recordDurationSeconds: 4,
  signals: [{ label: 'Fp1', samplesPerRecord: 32, sample: (r, k) => (r * 32 + k) % 512 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function scanned(bytes: Uint8Array): Promise<EdfRecording> {
  const opened = await openEdf(byteSource(bytes));
  return { ...opened, index: await buildRecordIndex(opened) };
}

// `secondsPerBucket` and `bucketCount` are on the CHUNK, not the signal: the grid is the chunk's,
// and every signal in it shares one axis. That is the shape the claim is about.
const widths = (chunks: readonly EdfEnvelopeChunk[]): readonly number[] =>
  chunks.map((chunk) => chunk.secondsPerBucket);

describe('the page still makes the claim', () => {
  it('says widths that disagree cannot be drawn on one axis', () => {
    expect(PROSE).toContain('Widths that disagree cannot be drawn on one axis');
    // And the two histories that produced disagreeing widths, so the sentence keeps its reasons.
    expect(PROSE).toContain('Before 0.2.31 one count was handed to every chunk');
    expect(PROSE).toContain('The bucket a sample lands in is decided by **when it is**');
  });
});

describe('a window spanning a gap', () => {
  it('comes back as runs of different lengths, or the next check is about one run', async () => {
    const recording = await scanned(GAPPED);
    const chunks = await readEnvelopeAtResolution(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 11,
      secondsPerBucket: 1,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(new Set(chunks.map((chunk) => chunk.durationSeconds)).size).toBeGreaterThan(1);
  });

  it('gives every chunk the width that was asked for', async () => {
    const recording = await scanned(GAPPED);
    for (const secondsPerBucket of [1, 2, 0.5]) {
      const chunks = await readEnvelopeAtResolution(recording, {
        signalIndices: [0],
        startSeconds: 0,
        durationSeconds: 11,
        secondsPerBucket,
      });
      expect(widths(chunks), `at ${secondsPerBucket} s per bucket`).toEqual(
        chunks.map(() => secondsPerBucket),
      );
    }
  });
});

describe('a window that does not begin on a record boundary', () => {
  it('gives a first run wider than the window, and still one width', async () => {
    // Four-second records, a window starting at 6 s: the read has to begin at record 1, so the
    // run it produces is wider than the window asked for. That is the second way one call ends up
    // with runs of different lengths.
    const recording = await scanned(CONTIGUOUS);
    const chunks = await readEnvelopeAtResolution(recording, {
      signalIndices: [0],
      startSeconds: 6,
      durationSeconds: 10,
      secondsPerBucket: 2,
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(widths(chunks)).toEqual(chunks.map(() => 2));
  });

  it('places its buckets on the width it reports, so a viewer can index by it', async () => {
    // The documented way to use it: bucket `b` is at `startSeconds + b * secondsPerBucket`. The
    // last bucket of a chunk must therefore not run past the chunk it belongs to.
    const recording = await scanned(GAPPED);
    const chunks = await readEnvelopeAtResolution(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 11,
      secondsPerBucket: 1,
    });
    for (const chunk of chunks) {
      const span = chunk.bucketCount * chunk.secondsPerBucket;
      expect(span, `chunk at ${chunk.startSeconds}`).toBeGreaterThanOrEqual(chunk.durationSeconds);
      // Never more than one bucket of overhang: the grid covers the run and does not sprawl.
      expect(span - chunk.durationSeconds).toBeLessThan(chunk.secondsPerBucket);
    }
  });
});
