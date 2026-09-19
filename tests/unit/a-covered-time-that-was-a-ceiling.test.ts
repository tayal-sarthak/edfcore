/**
 * `formatHeader`'s note under `covered`, on a file whose records overlap.
 *
 * On an EDF+D file the header prints what the records COVER rather than a duration, because the
 * span lives in the timekeeping TALs and a header alone cannot see it. That much is right, and the
 * comment above it explains why: a four-record file with an hour-long hole printed
 * `duration 00:00:04` for a recording spanning 3604 s.
 *
 * The two notes under it then asserted which way the number was wrong: "the gaps between them are
 * not in it", and "where the gaps are". A header cannot know that either. `EDF+D` means the records
 * do not run end to end, and they may leave gaps — or OVERLAP, which is one instant two records both
 * claim, and a file with overlaps covers MORE time than it spans.
 *
 * So on an overlapping file the note told a reader the recording reaches further than the printed
 * number, when it reaches less far: six seconds covered against a span of three and a half, printed
 * as though six were a floor.
 *
 * 0.3.3 stated the partition — "a gap is time no record covers; an overlap is one instant two
 * records both claim" — and 0.3.33, 0.3.41 and 0.3.59 each applied it to one site. This is the
 * fifth, and it is the first thing `edfcore header` prints.
 */

import { describe, expect, it } from 'vitest';
import { formatHeader } from '../../src/format-header.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const RECORDS = 6;

/** Each record starts half a second after the last, so every pair overlaps by half a second. */
const OVERLAPPING = buildEdf({
  format: 'EDF',
  plus: 'D',
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 60 }],
  recordOnsetSeconds: (r) => r * 0.5,
});

/** A five-second hole, where the old note was true. */
const GAPPED = buildEdf({
  format: 'EDF',
  plus: 'D',
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 60 }],
  recordOnsetSeconds: (r) => (r < 3 ? r : r + 5),
});

/** Continuous, where the line is a duration and there is no note at all. */
const WHOLE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 60 }],
});

const opened = (bytes: Uint8Array): Promise<EdfRecording> => openEdf(byteSource(bytes));

describe('a file whose records overlap', () => {
  it('covers more time than it spans, which is what the note got backwards', async () => {
    const recording = await opened(OVERLAPPING);
    expect(recording.header.continuity).toBe('discontinuous');
    expect(recording.timeline.coveredSeconds).toBe(RECORDS);
    expect(recording.timeline.spanSeconds).toBeLessThan(recording.timeline.coveredSeconds);
  });

  it('is no longer told the gaps are missing from the number', async () => {
    const recording = await opened(OVERLAPPING);
    const text = formatHeader(recording.header);
    expect(text).toContain('covered      00:00:06');
    expect(text).not.toContain('the gaps between them are not in it');
    expect(text).not.toContain('where the gaps are');
  });

  it('is told both ways the records can fail to run end to end', async () => {
    const recording = await opened(OVERLAPPING);
    const text = formatHeader(recording.header);
    expect(text).toContain('may leave gaps between them, and may overlap each other');
    expect(text).toContain('buildRecordIndex(recording) reports the span and which it is');
  });
});

describe('a file with a real gap', () => {
  it('spans more than it covers, and reads the same note', async () => {
    const recording = await opened(GAPPED);
    expect(recording.timeline.spanSeconds).toBeGreaterThan(recording.timeline.coveredSeconds);
    const text = formatHeader(recording.header);
    expect(text).toContain('covered      00:00:06');
    expect(text).toContain('may leave gaps between them, and may overlap each other');
  });

  it('is described identically to the overlapping one, because a header cannot tell them apart', async () => {
    const gapped = formatHeader((await opened(GAPPED)).header);
    const overlapping = formatHeader((await opened(OVERLAPPING)).header);
    const note = (text: string): string[] =>
      text
        .split('\n')
        .filter((line) => line.trim().startsWith('records may') || line.includes('covered'));
    expect(note(gapped)).toEqual(note(overlapping));
  });
});

describe('a continuous file', () => {
  it('still reads as a duration, with no note under it', async () => {
    const text = formatHeader((await opened(WHOLE)).header);
    expect(text).toContain('duration     00:00:06 (6 × 1 s)');
    expect(text).not.toContain('covered');
    expect(text).not.toContain('may overlap each other');
  });
});
