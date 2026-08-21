/**
 * `readHeader` and `buildTimeline` cost what `api-reading.md` says they cost.
 *
 * That page opens by inviting this: "Read counts on this page mean calls to `ByteSource.read`.
 * They are exact and testable: wrap your source in a recorder and count."
 *
 * Two of its claims are about the paths a well-formed file never takes, which is why neither had a
 * test. `readHeader` is "**Exactly two reads**" — and one, when the signal-count field is
 * unreadable, because the size of the second read is computed from that field and a speculative
 * read of an unknown size is the thing being avoided. Then "the 256 bytes are handed to
 * `parseHeader` so it can report the real problem": the point is not the saved read, it is that
 * the caller gets `SIGNAL_COUNT_INVALID` instead of a complaint about a byte range.
 *
 * The same distinction again on the next line: "A file too short for the header it declares is
 * reported as a file defect (`SOURCE_TOO_SMALL`), not as an `EdfSourceError` about a range past
 * the end." Both reads are clamped to the source length so the file's problem is described as the
 * file's problem. Getting that backwards is not a crash — it is a truncated recording reported as
 * an I/O error, which sends the reader to their network stack instead of to their file.
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader } from '../../src/io/read.js';
import { buildTimeline } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { truncate } from '../support/corrupt.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { spySource } from '../support/spy-source.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('api-reading.md') ?? '';
const FLAT = PAGE.replace(/\s+/g, ' ');

const WELL_FORMED = buildEdf({
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 8 },
    { label: 'Fp2', samplesPerRecord: 8 },
  ],
});

describe('readHeader', () => {
  it('claims exactly two reads, and takes them', async () => {
    expect(FLAT).toContain('**Exactly two reads**');
    const spy = spySource(byteSource(WELL_FORMED));
    await readHeader(spy);
    expect(spy.reads).toHaveLength(2);
    // "256 bytes to learn the signal count, then the remaining `256 * ns` as one range."
    expect(spy.reads[0]).toMatchObject({ offset: 0, length: 256 });
    expect(spy.reads[1]).toMatchObject({ offset: 256, length: 256 * 2 });
  });

  it('takes one when the signal-count field is unreadable', async () => {
    // "When the signal-count field is unreadable, the second read is skipped … That case costs
    //  one read."
    expect(FLAT).toContain('That case costs one read');
    const damaged = buildEdf({
      recordCount: 6,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
      raw: { signalCount: 'xx  ' },
    });
    const spy = spySource(byteSource(damaged));
    await expect(readHeader(spy)).rejects.toThrow();
    expect(spy.reads).toHaveLength(1);
  });

  it('reports the file’s problem rather than a byte range, on that path', async () => {
    // The reason the read is skipped: a size computed from an unreadable field is not a size.
    const damaged = buildEdf({
      recordCount: 6,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
      raw: { signalCount: 'xx  ' },
    });
    let thrown: unknown;
    try {
      await readHeader(byteSource(damaged));
    } catch (error) {
      thrown = error;
    }
    expect(isEdfError(thrown)).toBe(true);
    expect((thrown as { edfErrorKind?: string }).edfErrorKind).toBe('format');
    expect((thrown as Error).message).toContain('SIGNAL_COUNT_INVALID');
  });

  it('calls a short file a file defect, not an I/O error', async () => {
    // "A file too short for the header it declares is reported as a file defect
    //  (`SOURCE_TOO_SMALL`), not as an `EdfSourceError` about a range past the end."
    expect(FLAT).toContain('not as an `EdfSourceError` about a range past the end');
    const short = truncate(WELL_FORMED, 400);
    let thrown: unknown;
    try {
      await readHeader(byteSource(short));
    } catch (error) {
      thrown = error;
    }
    expect((thrown as { edfErrorKind?: string }).edfErrorKind).toBe('format');
    expect((thrown as { edfErrorKind?: string }).edfErrorKind).not.toBe('source');
    expect((thrown as Error).message).toContain('SOURCE_TOO_SMALL');
  });

  it('clamps the second read to the source rather than asking past the end', async () => {
    const short = truncate(WELL_FORMED, 400);
    const spy = spySource(byteSource(short));
    await expect(readHeader(spy)).rejects.toThrow();
    for (const read of spy.reads) {
      expect(read.offset + read.length).toBeLessThanOrEqual(short.byteLength);
    }
  });
});

describe('the timeline probe', () => {
  const PLUS = minimalEdfPlus({
    recordCount: 6,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
    annotationSignals: [{ samplesPerRecord: 40 }],
  });

  it('costs nothing on a file with no annotations signal', async () => {
    // "A file with no annotations signal costs none. Without a timekeeping TAL there are no
    //  per-record onsets on disk."
    expect(FLAT).toContain('A file with no annotations signal costs none');
    const spy = spySource(byteSource(WELL_FORMED));
    const header = await readHeader(spy);
    const before = spy.reads.length;
    await buildTimeline(spy, header);
    expect(spy.reads.length - before).toBe(0);
  });

  it('memoises both probes into the index, so asking again is free', async () => {
    // "Both probes are memoised into the returned index, so `index.onsetTicks(0)` and
    //  `index.onsetTicks(recordCount - 1)` are free afterwards."
    expect(FLAT).toContain('are free afterwards');
    const spy = spySource(byteSource(PLUS));
    const recording = await openEdf(spy);
    const settled = spy.reads.length;

    await recording.index.onsetTicks(0);
    await recording.index.onsetTicks(recording.header.recordCount - 1);
    expect(spy.reads.length).toBe(settled);
  });

  it('pays for a record in between, which is what makes the memo worth having', async () => {
    const spy = spySource(byteSource(PLUS));
    const recording = await openEdf(spy);
    const settled = spy.reads.length;
    await recording.index.onsetTicks(2);
    expect(spy.reads.length).toBeGreaterThan(settled);
  });
});
