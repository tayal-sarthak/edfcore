/**
 * Bytes appended after the last record: exactly one diagnostic, and nothing else moves.
 *
 * `header-recovery-advice.test.ts` covers what the two codes CLAIM — that the extra bytes are never
 * decoded, and that reaching them by record number is refused. What nothing covered is the
 * transformation itself: appending bytes to a well-formed file must change one thing and leave
 * every other answer exactly as it was.
 *
 * That matters because the recovery is arithmetic on the file's length. `parseHeader` computes the
 * record count the file can actually hold and compares it with the declared one, so a change in the
 * length reaches `recordCount`, `dataByteLength`, the timeline and everything derived from them.
 * Getting the recovery right and the arithmetic around it wrong would look, from any single
 * assertion, like the recovery working.
 *
 * The boundary is the sharpest part and is checked at the byte. Fewer bytes than a record is a
 * `PARTIAL_FINAL_RECORD` — a writer that stopped mid-record. A whole record's worth or more is
 * `TRAILING_BYTES` — something else entirely, appended after a complete file. One byte either side
 * of `recordByteLength` decides which, and edfcore never reports both.
 *
 * Everything else is compared against the untouched file: the samples of every record, the
 * annotations and the record onsets, `recordCount` and `dataByteLength`, and the whole diagnostic
 * list of a full validation sweep minus the one code that was added.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations, readRecords } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { appendBytes } from '../support/corrupt.js';
import { buildEdf } from '../support/writer.js';

const RECORDS = 8;

const BASE = buildEdf({
  plus: 'C',
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 16, sample: (record, index) => record * 16 + index }],
  annotationSignals: [
    {
      samplesPerRecord: 40,
      tals: (record) =>
        record % 3 === 0 ? [{ onset: `+${record}.5`, texts: [`e${record}`] }] : [],
    },
  ],
});

const RECORD_BYTES = 112;

const junk = (count: number): Uint8Array => new Uint8Array(count).fill(0x5a);

async function summarise(bytes: Uint8Array): Promise<{
  recording: EdfRecording;
  codes: readonly string[];
  reportCodes: readonly string[];
  samples: string;
  onsets: string;
  events: string;
}> {
  const recording = await openEdf(byteSource(bytes));
  const chunk = await readRecords(recording, {
    records: { start: 0, count: recording.header.recordCount },
    signalIndices: [0],
  });
  const series = chunk.signals[0];
  const annotations = await readAnnotations(recording, {
    start: 0,
    count: recording.header.recordCount,
  });
  const report = await validateRecording(recording, { scanSamples: true });
  return {
    recording,
    codes: recording.header.diagnostics.map((diagnostic) => diagnostic.code),
    reportCodes: report.diagnostics.map((diagnostic) => diagnostic.code),
    samples: [...(series?.digital.subarray(0, series.sampleCount) ?? [])].join(','),
    onsets: [...annotations.recordOnsetTicks].join(','),
    events: annotations.annotations.map((event) => `${event.onsetTicks}:${event.text}`).join('|'),
  };
}

const CLEAN = await summarise(BASE);

describe('the file the appends are made to', () => {
  it('has the geometry the boundary below is stated in, and nothing to complain about', () => {
    expect(CLEAN.recording.header.recordByteLength).toBe(RECORD_BYTES);
    expect(CLEAN.recording.header.recordCount).toBe(RECORDS);
    expect(CLEAN.codes).not.toContain('PARTIAL_FINAL_RECORD');
    expect(CLEAN.codes).not.toContain('TRAILING_BYTES');
    // A real waveform and real events, so the comparisons below are comparisons.
    expect(new Set(CLEAN.samples.split(',')).size).toBeGreaterThan(100);
    expect(CLEAN.events.split('|')).toHaveLength(3);
  });
});

describe('the boundary is exactly one record', () => {
  it('calls anything short of a record a partial final record', async () => {
    for (const count of [1, 7, RECORD_BYTES - 1]) {
      const { codes } = await summarise(appendBytes(BASE, junk(count)));
      expect(codes, `+${count}`).toContain('PARTIAL_FINAL_RECORD');
      expect(codes, `+${count}`).not.toContain('TRAILING_BYTES');
    }
  });

  it('and a record’s worth or more trailing bytes', async () => {
    for (const count of [RECORD_BYTES, RECORD_BYTES + 3, 2 * RECORD_BYTES]) {
      const { codes } = await summarise(appendBytes(BASE, junk(count)));
      expect(codes, `+${count}`).toContain('TRAILING_BYTES');
      expect(codes, `+${count}`).not.toContain('PARTIAL_FINAL_RECORD');
    }
  });

  it('with one byte deciding between them', async () => {
    const short = await summarise(appendBytes(BASE, junk(RECORD_BYTES - 1)));
    const exact = await summarise(appendBytes(BASE, junk(RECORD_BYTES)));
    expect(short.codes).toContain('PARTIAL_FINAL_RECORD');
    expect(exact.codes).toContain('TRAILING_BYTES');
  });
});

describe('and nothing else moves', () => {
  it.each([1, 7, RECORD_BYTES - 1, RECORD_BYTES, RECORD_BYTES + 3, 2 * RECORD_BYTES])(
    'appending %d bytes leaves the recording exactly as it was',
    async (count) => {
      const after = await summarise(appendBytes(BASE, junk(count)));

      expect(after.recording.header.recordCount).toBe(CLEAN.recording.header.recordCount);
      expect(after.recording.header.dataByteLength).toBe(CLEAN.recording.header.dataByteLength);
      expect(after.recording.header.recordByteLength).toBe(RECORD_BYTES);
      expect(after.recording.timeline.spanSeconds).toBe(CLEAN.recording.timeline.spanSeconds);
      expect(after.recording.timeline.coveredSeconds).toBe(CLEAN.recording.timeline.coveredSeconds);

      expect(after.samples).toBe(CLEAN.samples);
      expect(after.onsets).toBe(CLEAN.onsets);
      expect(after.events).toBe(CLEAN.events);
    },
  );

  it.each([7, RECORD_BYTES])(
    'and adds exactly one code to the header and to a full sweep, for %d bytes',
    async (count) => {
      const after = await summarise(appendBytes(BASE, junk(count)));
      const added = after.codes.filter((code) => !CLEAN.codes.includes(code));
      expect(added).toHaveLength(1);
      expect(CLEAN.codes.filter((code) => !after.codes.includes(code))).toEqual([]);

      const addedToReport = after.reportCodes.filter((code) => !CLEAN.reportCodes.includes(code));
      expect(addedToReport).toEqual(added);
    },
  );
});
