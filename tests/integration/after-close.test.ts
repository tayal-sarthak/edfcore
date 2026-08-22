/**
 * What survives `close()`, which is the last paragraph of `data-sources.md` and the one every
 * example on the site walks into.
 *
 * > Closing a source does not invalidate the `EdfRecording` built from it. The header, the
 * > timeline and the segment list are plain data and stay readable after the handle is gone.
 * > Anything that goes back for bytes fails: `readRecords`, `readWindow`, `readAnnotations`, and
 * > `index.locate` on a file whose onsets it has not already memoised.
 *
 * Every `fileSource` snippet on the site is wrapped in `try { … } finally { await
 * source.close?.() }`, so the ordinary shape of a program here is a recording that outlives its
 * handle: the reads happen inside the block, and the header is printed, returned or rendered
 * after it. That paragraph is the only statement of which half of the object still works, and
 * nothing executed it.
 *
 * The carve-out in the middle of it is the part that would rot quietly. A probed index memoises
 * records 0 and n−1 at open and every record a search walks over afterwards, so a `locate` that
 * already ran answers again with the handle gone, and one for a time nothing has looked at yet is
 * a binary search that needs a byte. Both are checked, because "it depends what you already asked
 * for" is the kind of rule a later memoisation change makes quietly more generous — and a rule
 * nobody re-reads once it has stopped biting.
 *
 * What this does NOT claim: that the failure is an `EdfError`. It is whatever the source raises —
 * for `fileHandleSource` that is Node's own `Error: file closed`, which `isEdfError` returns false
 * for. The page says these calls fail, not that they fail in edfcore's vocabulary, and a caller
 * closing its own handle is not a file defect.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileSource } from '../../src/node.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { minimalEdfPlus } from '../support/writer.js';

const PAGE = (DOCS_PAGES.get('data-sources.md') ?? '').replace(/\s+/g, ' ');
const DIR = mkdtempSync(join(tmpdir(), 'edfcore-after-close-'));

/** Eight one-second records, contiguous. */
function write(name: string): string {
  const bytes = minimalEdfPlus({
    recordCount: 8,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    annotationSignals: [{ samplesPerRecord: 30 }],
  });
  const path = join(DIR, name);
  writeFileSync(path, bytes);
  return path;
}

/** The same eight, with a ten-second gap after the fourth, so the segment list has two entries. */
function writeDiscontinuous(name: string): string {
  const bytes = minimalEdfPlus({
    recordCount: 8,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    annotationSignals: [{ samplesPerRecord: 30 }],
    raw: { reserved: 'EDF+D'.padEnd(44, ' ') },
    recordOnsetSeconds: (record) => (record < 4 ? record : record + 10),
  });
  const path = join(DIR, name);
  writeFileSync(path, bytes);
  return path;
}

const rejects = async (call: () => Promise<unknown>): Promise<Error> => {
  const error = await call().then(
    () => undefined,
    (thrown: unknown) => thrown as Error,
  );
  if (error === undefined) throw new Error('the call resolved, and the page says it fails');
  return error;
};

describe('the page still says it', () => {
  it('promises the header and the timeline outlive the handle', () => {
    expect(PAGE).toContain('Closing a source does not invalidate the `EdfRecording` built from it');
    expect(PAGE).toContain('stay readable after the handle is gone');
    expect(PAGE).toContain('`index.locate` on a file whose onsets it has not already memoised');
  });
});

describe('a recording whose source has been closed', () => {
  it('still answers everything that is plain data', async () => {
    const source = await fileSource(write('plain-data.edf'));
    const recording = await openEdf(source);
    await source.close?.();

    expect(recording.header.variant).toBe('EDF+C');
    expect(recording.header.recordCount).toBe(8);
    expect(recording.header.signals.map((signal) => signal.label)).toContain('Fp1');
    expect(recording.header.diagnostics).toBeInstanceOf(Array);
    expect(recording.index.coverage).toBe('probed');
  });

  it('fails every call that goes back for bytes', async () => {
    const source = await fileSource(write('goes-back.edf'));
    const recording = await openEdf(source);
    await source.close?.();

    const signalIndices = [...recording.header.dataSignalIndices];
    for (const [name, call] of [
      [
        'readRecords',
        () => readRecords(recording, { records: { start: 0, count: 1 }, signalIndices }),
      ],
      [
        'readWindow',
        () => readWindow(recording, { startSeconds: 0, durationSeconds: 1, signalIndices }),
      ],
      ['readAnnotations', () => readAnnotations(recording, { start: 0, count: 8 })],
    ] as const) {
      const error = await rejects(call);
      expect(error.message, name).toContain('file closed');
    }
  });

  it('answers a locate it already answered, and refuses a new one', async () => {
    const source = await fileSource(write('memoised.edf'));
    const recording = await openEdf(source);
    // Asked while the handle was open, so every record the search walked is now in the memo.
    expect((await recording.index.locate(0.5))?.recordIndex).toBe(0);
    await source.close?.();

    // Opening an EDF+ file probes records 0 and n−1 for their onsets and keeps both.
    expect(await recording.index.onsetTicks(0)).toBe(0n);
    expect(await recording.index.onsetTicks(7)).toBe(70_000_000n);
    expect((await recording.index.locate(0.5))?.recordIndex).toBe(0);

    // Nothing has looked at record 5, so answering for it means a byte that is gone.
    expect((await rejects(() => recording.index.locate(5.5))).message).toContain('file closed');
    expect((await rejects(() => recording.index.onsetTicks(5))).message).toContain('file closed');
  });

  it('locates anywhere once the index is complete, because that is an array', async () => {
    const source = await fileSource(writeDiscontinuous('complete.edf'));
    const recording = await openEdf(source);
    const index = await buildRecordIndex(recording);
    await source.close?.();

    expect(index.coverage).toBe('complete');
    // The gap the file was built with: four records, then a jump.
    expect(index.segments?.map((segment) => segment.records.count)).toEqual([4, 4]);
    expect(index.gaps).toHaveLength(1);

    expect((await index.locate(3.5))?.recordIndex).toBe(3);
    expect((await index.locate(14.5))?.recordIndex).toBe(4);
    expect(await index.onsetTicks(7)).toBe(170_000_000n);
  });
});
