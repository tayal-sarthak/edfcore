/**
 * `resolveTimeWindow`, against the example `api-primitives.md` works through.
 *
 * The function exists so the price of a window is auditable "**before** a byte is read", and the
 * page demonstrates that with one straddle: a one-second window from t = 2.5 on a file with
 * one-second records costs records 2 and 3. Record alignment is the whole answer — a window that
 * starts halfway through a record still pays for all of it — and a reader who plans a viewport
 * from this example is doing arithmetic that has to hold.
 *
 * Also checked here is the empty case, which the page lists three ways into: entirely inside a
 * gap, entirely outside the recording, or a non-positive duration. Returning `[]` rather than
 * throwing is what lets a caller loop over ranges without a special case, and returning `[]` for
 * a zero-length window is a statement about the interval being half-open rather than an accident.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { resolveTimeWindow } from '../../src/time/window.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('api-primitives.md') ?? '';

/** `const ranges = resolveTimeWindow(recording.timeline, recording.index, 2.5, 1);` */
const CALL =
  /resolveTimeWindow\(recording\.timeline, recording\.index, ([\d.]+), (\d+)\);\s*\n\/\/ \[ \{ start: (\d+), count: (\d+) \} \]/.exec(
    PAGE,
  );

const CONTINUOUS = buildEdf({
  recordCount: 20,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

describe('the straddle the page works through', () => {
  it('is still printed with its answer', () => {
    expect(CALL).not.toBeNull();
    // "on a file with 1 s records: it straddles records 2 and 3"
    expect(PAGE).toContain('it straddles records 2 and 3');
  });

  it('resolves to the single range the page prints', async () => {
    const recording = await openEdf(byteSource(CONTINUOUS));
    const ranges = resolveTimeWindow(
      recording.timeline,
      recording.index,
      Number(CALL?.[1]),
      Number(CALL?.[2]),
    );
    expect(ranges).toEqual([{ start: Number(CALL?.[3]), count: Number(CALL?.[4]) }]);
  });

  it('costs more than the window asked for, because a record is the unit', async () => {
    // "Ranges are record-aligned and are therefore usually wider than the window."
    const recording = await openEdf(byteSource(CONTINUOUS));
    const ranges = resolveTimeWindow(recording.timeline, recording.index, 2.5, 1);
    const records = ranges.reduce((total, range) => total + range.count, 0);
    // One second of a one-second-record file, and two records paid for.
    expect(records).toBe(2);
    // The page's own cost arithmetic, in bytes.
    const bytes = ranges.reduce(
      (total, range) => total + range.count * recording.header.recordByteLength,
      0,
    );
    expect(bytes).toBe(2 * recording.header.recordByteLength);
  });

  it('needs no read to answer, which is the point of it', async () => {
    // Asserted structurally: the function is synchronous and takes no source.
    const recording = await openEdf(byteSource(CONTINUOUS));
    const answer = resolveTimeWindow(recording.timeline, recording.index, 2.5, 1);
    expect(Array.isArray(answer)).toBe(true);
  });
});

describe('the three ways to get nothing back', () => {
  it('returns empty for a non-positive duration', async () => {
    // "a zero-length window contains no time and therefore no samples"
    const recording = await openEdf(byteSource(CONTINUOUS));
    expect(resolveTimeWindow(recording.timeline, recording.index, 2.5, 0)).toEqual([]);
    expect(resolveTimeWindow(recording.timeline, recording.index, 2.5, -1)).toEqual([]);
  });

  it('returns empty outside the recording', async () => {
    const recording = await openEdf(byteSource(CONTINUOUS));
    expect(resolveTimeWindow(recording.timeline, recording.index, 1_000, 1)).toEqual([]);
    expect(resolveTimeWindow(recording.timeline, recording.index, -50, 1)).toEqual([]);
  });

  it('returns empty inside a gap, on an index that knows where the gaps are', async () => {
    const opened = await openEdf(
      byteSource(
        minimalEdfPlus({
          plus: 'D',
          recordCount: 6,
          recordDurationSeconds: 1,
          signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
          annotationSignals: [{ samplesPerRecord: 40 }],
          recordOnsetSeconds: (record) => (record <= 2 ? record : record + 10),
        }),
      ),
    );
    const index = await buildRecordIndex(opened);
    expect(index.coverage).toBe('complete');
    expect(resolveTimeWindow(opened.timeline, index, 6, 1)).toEqual([]);
    // And not empty either side of it, so the emptiness is about the gap.
    expect(resolveTimeWindow(opened.timeline, index, 1, 1)).not.toEqual([]);
    expect(resolveTimeWindow(opened.timeline, index, 14, 1)).not.toEqual([]);
  });

  it('refuses to guess on a probed index over a file with gaps', async () => {
    // "Otherwise this function throws a plain `RangeError` rather than guessing at onsets nobody
    //  has read."
    const probed = await openEdf(
      byteSource(
        minimalEdfPlus({
          plus: 'D',
          recordCount: 6,
          recordDurationSeconds: 1,
          signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
          annotationSignals: [{ samplesPerRecord: 40 }],
          recordOnsetSeconds: (record) => (record <= 2 ? record : record + 10),
        }),
      ),
    );
    expect(probed.index.coverage).toBe('probed');
    let thrown: unknown;
    try {
      resolveTimeWindow(probed.timeline, probed.index, 1, 1);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RangeError);
  });
});
