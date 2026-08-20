/**
 * The file `discontinuous.md` draws, built and read.
 *
 * The page opens with a diagram — six one-second records, a ten-second gap between record 2 and
 * record 3 — and everything after it is arithmetic on that picture: which chunk starts where,
 * which one carries the gap, what a two-record read either side of it spans, and what `locate`
 * answers at 13.5 s. Then it says why the numbers matter: "reading such a file as if it were
 * contiguous puts record 3 at t = 3 s when it truly starts at t = 13 s. Nothing throws, the
 * waveform looks fine, and every event you align against it is ten seconds out."
 *
 * `discontinuous.test.ts` covers EDF+D thoroughly against a different fixture — a multiple sleep
 * latency test with hour-long intervals. This builds the page's own file, so the figures a reader
 * copies are the ones a run produces.
 */

import { describe, expect, it } from 'vitest';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { buildEdf } from '../support/writer.js';

/** "record 0 1 2 │← 10 s gap →│ 3 4 5" starting at 0,1,2 then 13,14,15. */
const BYTES = buildEdf({
  plus: 'D',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG C3-A2', samplesPerRecord: 256 }],
  annotationSignals: [{ samplesPerRecord: 30 }],
  recordOnsetSeconds: (recordIndex) => (recordIndex < 3 ? recordIndex : recordIndex + 10),
});

const open = async () => {
  const recording = await openEdf(byteSource(BYTES));
  return { ...recording, index: await buildRecordIndex(recording) };
};

describe('the timeline the diagram draws', () => {
  it('puts record 3 at 13 s, not at 3', async () => {
    const located = await open();
    // The whole reason the page exists: read contiguously and every event here is 10 s out.
    const { segments, gaps } = located.index;
    // `gaps` is undefined on a probed index and defined after a scan — the distinction the page
    // spends a section on, so narrowing it here rather than asserting past it is the point.
    expect(segments).toHaveLength(2);
    expect(gaps, 'a scanned index reports its gaps').toBeDefined();
    expect(gaps).toHaveLength(1);
    expect(gaps?.[0]?.durationSeconds).toBe(10);
    expect(gaps?.[0]?.startSeconds).toBe(3);
    expect(gaps?.[0]?.endSeconds).toBe(13);
  });

  it('answers locate(13.5) with the record and offset the page prints', async () => {
    // "{ recordIndex: 3, recordStartSeconds: 13, offsetInRecordSeconds: 0.5 }"
    const located = await open();
    const at = await located.index.locate(13.5);
    expect(at?.recordIndex).toBe(3);
    expect(at?.recordStartSeconds).toBe(13);
    expect(at?.offsetInRecordSeconds).toBeCloseTo(0.5, 9);
  });
});

describe('reading across the gap', () => {
  it('returns one chunk per contiguous run, with the figures the page lists', async () => {
    const located = await open();
    const signal = getSignal(located.header, 'EEG C3-A2');
    const chunks = await readWindow(located, {
      startSeconds: 2,
      durationSeconds: 12,
      signalIndices: [signal.index],
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.startSeconds).toBe(2);
    expect(chunks[0]?.precededByGap).toBeUndefined();
    expect(chunks[1]?.startSeconds).toBe(13);
    expect(chunks[1]?.precededByGap?.durationSeconds).toBe(10);
  });

  it('spans twelve seconds for two seconds of data when records are read by index', async () => {
    // "chunk.durationSeconds; // 12 — the SPAN, not the time covered" over records 2 and 3.
    const located = await open();
    const signal = getSignal(located.header, 'EEG C3-A2');
    const chunk = await readRecords(located, {
      records: { start: 2, count: 2 },
      signalIndices: [signal.index],
    });

    expect(chunk.startSeconds).toBe(2);
    expect(chunk.durationSeconds).toBe(12);
    // Two records' worth of samples, whatever the span: 2 x 256.
    expect(chunk.signals[0]?.sampleCount).toBe(512);
  });
});
