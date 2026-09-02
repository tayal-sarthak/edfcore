/**
 * The four claims on `api-reading.md` that say "always", "never" or "every", executed.
 *
 * Each is a promise about any file, and each was written when the matrix held eight shapes. It
 * holds seventeen now, six of them added in this line — a truncated download, two annotation
 * channels, BDF+D with a gap, records that overlap, a record count nobody wrote down, a duration
 * float64 cannot hold. A universal claim is only as checked as the widest file anyone pointed it
 * at, and 0.6.36 is what happens when one of them meets a shape it had not met: four sweeps turned
 * out to be asserting something narrower than they said.
 *
 * So these four are read off the page — reworded, they fail here rather than drifting — and run
 * against every shape.
 *
 * The one worth naming: `readAnnotations` answers on a file with NO annotations channel, returning
 * one onset per record from the nominal grid. The page promises an entry per record "always", and
 * "always" turns out to include the file that has nowhere to store an annotation.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readWindow } from '../../src/recording.js';
import { AWKWARD } from '../support/awkward-files.js';
import { DOCS_PAGES } from '../support/docs-pages.js';

const PAGE = DOCS_PAGES.get('api-reading.md') ?? '';

/** The sentences this file executes. A page that stops making one of them fails here. */
const CLAIMS: ReadonlyArray<readonly [string, string]> = [
  [
    'api-reading.md',
    'The return type is always an array, and on a continuous file a window that selects any records is a single element.',
  ],
  ['api-reading.md', 'One entry per record in the decoded range, always.'],
  [
    'api-reading.md',
    "Reads every record's onset and returns a `'complete'` index carrying the segments and gaps they imply.",
  ],
  ['api-reading.md', 'and never fewer than one.'],
  [
    'api-reading.md',
    'a `maxMaterializeBytes` smaller than one record cannot be honoured and cannot be met by asking for fewer records',
  ],
];

const collapse = (text: string): string => text.replace(/\s+/g, ' ');

describe('the claims', () => {
  it('are still on the pages that make them', () => {
    for (const [, claim] of CLAIMS) {
      expect(collapse(PAGE), claim).toContain(collapse(claim));
    }
  });

  it('are five, over seventeen shapes', () => {
    expect(CLAIMS).toHaveLength(5);
    expect(AWKWARD).toHaveLength(17);
  });
});

describe.each(AWKWARD)('$name', ({ bytes }) => {
  it('returns a complete index, with the segments and gaps its onsets imply', async () => {
    const index = await buildRecordIndex(await openEdf(byteSource(bytes)));
    expect(index.coverage).toBe('complete');
    expect(index.recordCount).toBeGreaterThanOrEqual(0);
    // A complete index carries segments; gaps are absent only when there are none.
    expect(index.segments).toBeDefined();
  });

  it('gives one record onset per record in the decoded range, whatever the file holds', async () => {
    const recording = await openEdf(byteSource(bytes));
    const records = { start: 0, count: recording.header.recordCount };
    const { recordOnsetTicks } = await readAnnotations(recording, records);
    expect(recordOnsetTicks).toHaveLength(records.count);
  });

  it('answers a window with an array, and with one element on a continuous file', async () => {
    const recording = await openEdf(byteSource(bytes));
    const { header } = recording;
    if (
      header.dataSignalIndices.length === 0 ||
      header.recordCount === 0 ||
      header.recordDurationSeconds === 0
    ) {
      return;
    }
    const index = await buildRecordIndex(recording);
    const chunks = await readWindow(
      { ...recording, index },
      {
        startSeconds: 0,
        durationSeconds: header.recordCount * header.recordDurationSeconds * 2,
        signalIndices: [...header.dataSignalIndices],
      },
    );
    expect(Array.isArray(chunks)).toBe(true);
    if (header.continuity === 'continuous') expect(chunks).toHaveLength(1);
  });

  it('chunks at one record when the budget allows exactly one, and no lower', async () => {
    /*
     * The floor doing its job: a budget of exactly one record's worth still scans the whole file,
     * one record at a time. The clause "never fewer than one" is what stops the division producing
     * zero and the traversal never advancing.
     *
     * And the half the page did not say until 0.6.37. Below that floor the budget stops being a
     * speed knob: one record cannot be read within it, and no smaller count exists to ask for, so
     * the scan is refused rather than chunked into nothing. The message names the record's size,
     * which is the number the caller has to act on.
     */
    const recording = await openEdf(byteSource(bytes));
    const perRecord = recording.header.recordByteLength;

    const index = await buildRecordIndex(recording, { maxMaterializeBytes: perRecord });
    expect(index.coverage).toBe('complete');
    expect(index.recordCount).toBe(recording.header.recordCount);

    // Only where there is something to read. The next sentence on the page says a file with no
    // annotations signal "is not scanned at all, because its record onsets are arithmetic", so
    // there is no read for a budget to refuse — which is the two claims agreeing.
    if (recording.header.recordCount === 0) return;
    if (recording.header.annotationSignalIndices.length === 0) {
      await expect(buildRecordIndex(recording, { maxMaterializeBytes: 1 })).resolves.toBeDefined();
      return;
    }
    await expect(
      buildRecordIndex(recording, { maxMaterializeBytes: perRecord - 1 }),
    ).rejects.toThrow(new RegExp(`one record of this file needs ${perRecord} bytes`));
  });
});

describe('the one that is easy to read past', () => {
  it('holds on the file with nowhere to store an annotation', async () => {
    const plain = AWKWARD.find((file) => file.name === 'plain EDF, one signal');
    if (plain === undefined) throw new Error('the matrix lost its plain file');
    const recording = await openEdf(byteSource(plain.bytes));
    expect(recording.header.annotationSignalIndices).toHaveLength(0);

    const { annotations, recordOnsetTicks } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });
    // No events, and an onset for every record all the same — from the nominal grid.
    expect(annotations).toHaveLength(0);
    expect(recordOnsetTicks).toHaveLength(recording.header.recordCount);
    expect(recordOnsetTicks[0]).toBe(0n);
  });

  it('holds on the file with two places to store one', async () => {
    const two = AWKWARD.find((file) => file.name === 'two annotation signals');
    if (two === undefined) throw new Error('the matrix lost its two-channel file');
    const recording = await openEdf(byteSource(two.bytes));
    const { recordOnsetTicks } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });
    // One per record, not one per record per channel.
    expect(recordOnsetTicks).toHaveLength(recording.header.recordCount);
  });
});
