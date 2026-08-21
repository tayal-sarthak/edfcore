/**
 * When `validateRecording` reads, against the truth table on `validation.md`.
 *
 * Four rows over two independent conditions — does the file carry per-record timestamps, and did
 * you ask for `scanSamples` — plus the escape hatch that collapses the expensive row to nothing:
 * hand over a complete index you already built.
 *
 * Both halves of that are worth holding, and for opposite reasons.
 *
 * The `none` rows are a promise about cost. A conformance sweep that quietly started traversing a
 * plain EDF would return exactly the same report, and the only evidence would be the wall clock on
 * a 13 GiB file. `recordsScanned` and `bytesRead` are on the report precisely so this is
 * observable, and this checks them against the table rather than against themselves.
 *
 * The `every record` rows are a promise about correctness. An EDF+ file stores each record's true
 * onset, and a sweep that skipped them would report a clean file it had not checked — the failure
 * the page describes as a report "claiming a file is clean" without saying how much was looked at.
 *
 * The last row of the table is the one with a trap in it: a PROBED index — what `openEdf` hands
 * you, and the obvious thing to pass — is ignored rather than trusted, and the sweep reads anyway.
 * "Passing one is not an error; it buys nothing." A version that accepted it would report a clean
 * file on the strength of two records.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('validation.md') ?? '';
const FLAT = PAGE.replace(/\s+/g, ' ');
const RECORDS = 12;

/** The `| Situation | Records scanned |` rows. */
const ROWS = (() => {
  const at = FLAT.indexOf('| Situation | Records scanned |');
  if (at === -1) throw new Error('validation.md no longer tabulates what a sweep costs');
  return [...FLAT.slice(at).matchAll(/\| ([^|]+?) \| (none|every record) \|/g)].map(
    ([, situation = '', scanned = '']) => ({ situation: situation.trim(), scanned }),
  );
})();

const scannedFor = (startsWith: string): string => {
  const row = ROWS.find((entry) => entry.situation.startsWith(startsWith));
  if (row === undefined) throw new Error(`no row starting ${JSON.stringify(startsWith)}`);
  return row.scanned;
};

/** `none` -> 0, `every record` -> the record count. */
const expected = (scanned: string): number => (scanned === 'none' ? 0 : RECORDS);

const PLAIN = buildEdf({
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

const PLUS = minimalEdfPlus({
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

describe('the truth table', () => {
  it('has the four rows the page draws', () => {
    expect(ROWS).toHaveLength(4);
    expect(FLAT).toContain('Two conditions decide whether the sweep reads at all');
  });

  it('reads nothing on a plain file with no scanSamples', async () => {
    // "A plain EDF has no annotation signal and therefore no timekeeping TALs … so there's nothing
    //  to verify and the sweep is pure header arithmetic."
    const recording = await openEdf(byteSource(PLAIN));
    const report = await validateRecording(recording);
    expect(report.recordsScanned).toBe(expected(scannedFor('Plain EDF')));
    expect(report.bytesRead).toBe(0);
  });

  it('reads every record on an EDF+ with no index and no scanSamples', async () => {
    const recording = await openEdf(byteSource(PLUS));
    const report = await validateRecording(recording);
    expect(report.recordsScanned).toBe(expected(scannedFor('EDF+ or BDF+, no index')));
    expect(report.bytesRead).toBeGreaterThan(0);
  });

  it('reads nothing on an EDF+ when a complete index is supplied', async () => {
    const opened = await openEdf(byteSource(PLUS));
    const index = await buildRecordIndex(opened);
    const report = await validateRecording(opened, { index });
    expect(report.recordsScanned).toBe(expected(scannedFor('EDF+ or BDF+, complete index')));
    expect(report.bytesRead).toBe(0);
  });

  it('reads every record whenever scanSamples is asked for', async () => {
    // "`scanSamples` is never implied", and it overrides the cheap rows above.
    for (const bytes of [PLAIN, PLUS]) {
      const opened = await openEdf(byteSource(bytes));
      const index = await buildRecordIndex(opened);
      const report = await validateRecording(opened, { index, scanSamples: true });
      expect(report.recordsScanned).toBe(expected(scannedFor('Any file, `scanSamples')));
    }
  });
});

describe('the index that buys nothing', () => {
  it('is what openEdf hands you, and it is a probed one', async () => {
    expect(FLAT).toContain('Passing one is not an error; it buys nothing');
    const recording = await openEdf(byteSource(PLUS));
    expect(recording.index.coverage).toBe('probed');
  });

  it('is ignored rather than trusted, so the sweep still reads', async () => {
    // The trap: a probed index describes the first and last record only. Accepting it would report
    // a clean file on the strength of two records.
    const recording = await openEdf(byteSource(PLUS));
    const report = await validateRecording(recording, { index: recording.index });
    expect(report.recordsScanned).toBe(RECORDS);
    expect(report.bytesRead).toBeGreaterThan(0);
  });

  it('costs one traversal instead of two when the index really is complete', async () => {
    // `console.log(report.recordsScanned, report.bytesRead);  // 0 0`
    const printed = /report\.recordsScanned, report\.bytesRead\);\s*\/\/ (\d+) (\d+)/.exec(PAGE);
    expect(printed).not.toBeNull();
    const opened = await openEdf(byteSource(PLUS));
    const index = await buildRecordIndex(opened);
    expect(index.coverage).toBe('complete');
    const report = await validateRecording(opened, { index });
    expect(report.recordsScanned).toBe(Number(printed?.[1]));
    expect(report.bytesRead).toBe(Number(printed?.[2]));
  });
});
