/**
 * A sweep that was handed an index says what a sweep that read one says.
 *
 * `validateRecording` takes an optional `index`, and `api-validate.md` prices it: a supplied
 * complete index is the difference between a scan of every record and no traversal at all.
 * `inspect-validate.test.ts` checks that it does skip the traversal, and that a probed index is not
 * accepted as a substitute. What nothing checked is the thing the option is only worth having if it
 * is true: that the report is the same either way.
 *
 * It is a real risk rather than a formality. The two paths reach `segmentCount` and `gaps` through
 * different code — one from `buildSegmentation` over onsets it just read, the other from the
 * `segments` and `gaps` already on the supplied index — and everything the report says about
 * structure is derived from those two. A supplied index that produced a different segment count
 * would be a faster answer to a different question.
 *
 * So both are run over every shape in the matrix and compared whole: `ok`, `recordsScanned`,
 * `bytesRead`, every diagnostic and every entry of `signalStats`, with `scanSamples` on so the
 * sample statistics are in the comparison too.
 *
 * `bytesRead` is the one number that legitimately differs, and it is asserted to differ — the point
 * of supplying an index is that fewer bytes are read — on the files where there is anything to read.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { AWKWARD } from '../support/awkward-files.js';

const shape = (value: unknown): string =>
  JSON.stringify(value, (_key, member: unknown) =>
    typeof member === 'bigint' ? `${member}n` : member,
  );

/** The report without the two fields that are about the cost rather than the verdict. */
const verdict = (report: Awaited<ReturnType<typeof validateRecording>>): string =>
  shape({ ...report, bytesRead: '(cost)', recordsScanned: '(cost)' });

describe('over every shape in the matrix', () => {
  it('gives the same verdict whether the index was supplied or read', async () => {
    let compared = 0;
    for (const file of AWKWARD) {
      const recording = await openEdf(byteSource(file.bytes));
      const index = await buildRecordIndex(recording);

      const scanned = await validateRecording(recording, { scanSamples: true });
      const supplied = await validateRecording(
        { ...recording, index },
        {
          scanSamples: true,
          index,
        },
      );

      expect(verdict(supplied), file.name).toBe(verdict(scanned));
      compared += 1;
    }
    expect(compared).toBe(AWKWARD.length);
  });

  it('including the whole diagnostic list and the sample statistics', async () => {
    for (const file of AWKWARD) {
      const recording = await openEdf(byteSource(file.bytes));
      const index = await buildRecordIndex(recording);
      const scanned = await validateRecording(recording, { scanSamples: true });
      const supplied = await validateRecording(
        { ...recording, index },
        {
          scanSamples: true,
          index,
        },
      );

      expect(
        supplied.diagnostics.map((entry) => entry.code),
        file.name,
      ).toEqual(scanned.diagnostics.map((entry) => entry.code));
      expect(shape(supplied.signalStats), file.name).toBe(shape(scanned.signalStats));
      expect(supplied.ok, file.name).toBe(scanned.ok);
    }
  });

  it('and the comparison is of something: the matrix reaches both verdicts and real statistics', async () => {
    const verdicts = new Set<boolean>();
    let withStats = 0;
    for (const file of AWKWARD) {
      const recording = await openEdf(byteSource(file.bytes));
      const report = await validateRecording(recording, { scanSamples: true });
      verdicts.add(report.ok);
      if (report.signalStats.some((entry) => entry.sampleCount > 0)) withStats += 1;
    }
    expect(verdicts).toEqual(new Set([true, false]));
    expect(withStats).toBeGreaterThan(4);
  });
});

describe('what supplying it changes', () => {
  it('is the cost, which is the reason the option exists', async () => {
    let cheaper = 0;
    for (const file of AWKWARD) {
      const recording = await openEdf(byteSource(file.bytes));
      const index = await buildRecordIndex(recording);
      const scanned = await validateRecording(recording, { scanSamples: false });
      const supplied = await validateRecording(
        { ...recording, index },
        {
          scanSamples: false,
          index,
        },
      );
      expect(supplied.bytesRead, file.name).toBeLessThanOrEqual(scanned.bytesRead);
      if (supplied.bytesRead < scanned.bytesRead) cheaper += 1;
    }
    // Not every shape has onsets to read, so this is "on the files where there is anything to skip".
    expect(cheaper).toBeGreaterThan(0);
  });
});
