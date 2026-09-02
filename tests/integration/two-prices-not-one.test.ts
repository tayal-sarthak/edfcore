/**
 * `large-files.md` called the complete index the library's only cost proportional to the file.
 *
 * It is the only one a reading call can spring on you — every other cost on that page follows the
 * window you asked for. It is not the only one in the library. `validateRecording` has two, and
 * `validation.md` describes both on the same site: `scanSamples` "is the only part of validation
 * that touches sample data, and its cost is proportional to the size of the recording. On a 13 GiB
 * BDF, that is every record", and the `index` option exists because "conformance costs one
 * traversal rather than two" — a sentence that presupposes there being two.
 *
 * So the two pages contradicted each other, and the cheap one to believe is the wrong one: a
 * reader who takes "the only price" at face value budgets a conformance sweep as free.
 *
 * This file measures all four cells rather than quoting either page. `recordsScanned` and
 * `bytesRead` are on the report for exactly this purpose.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { AWKWARD } from '../support/awkward-files.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('large-files.md') ?? '';

/** Continuous, and big enough that reading it and not reading it are different numbers. */
const CONTINUOUS = buildEdf({
  recordCount: 40,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 64 }],
});

const DISCONTINUOUS = AWKWARD.find((file) => file.name === 'EDF+D with a gap')?.bytes;

interface Cost {
  readonly recordsScanned: number;
  readonly bytesRead: number;
}

async function cost(
  bytes: Uint8Array,
  options: { scanSamples?: boolean; withIndex?: boolean },
): Promise<Cost> {
  const recording = await openEdf(byteSource(bytes));
  const index = options.withIndex === true ? await buildRecordIndex(recording) : undefined;
  const report = await validateRecording(recording, {
    ...(options.scanSamples === true ? { scanSamples: true } : {}),
    ...(index === undefined ? {} : { index }),
  });
  return { recordsScanned: report.recordsScanned, bytesRead: report.bytesRead };
}

describe('the page', () => {
  it('was read, so a passing run is not a vacuous one', () => {
    expect(PAGE).toContain('Build a complete index only when you need gaps located');
    expect(AWKWARD).toHaveLength(17);
    expect(DISCONTINUOUS).toBeDefined();
  });

  it('no longer calls the index the only price proportional to the file', () => {
    expect(PAGE).not.toContain("it's the only price in the library proportional to the file");
  });

  it('names validateRecording as the other one, and keeps the reading-call carve-out', () => {
    expect(PAGE).toContain("not the library's only cost proportional to the file");
    expect(PAGE).toContain('validateRecording');
    expect(PAGE).toContain('conformance costs one traversal rather than two');
  });
});

describe('what a conformance sweep costs', () => {
  it('reads every record of a continuous file under scanSamples', async () => {
    const swept = await cost(CONTINUOUS, { scanSamples: true });
    expect(swept.recordsScanned).toBe(40);
    // Proportional to the file, which is the property the page denied existed anywhere else.
    expect(swept.bytesRead).toBeGreaterThan(0);
  });

  it('still reads them with a complete index in hand: the index buys the onsets, not the samples', async () => {
    const swept = await cost(CONTINUOUS, { scanSamples: true, withIndex: true });
    expect(swept.recordsScanned).toBe(40);
  });

  it('traverses a discontinuous file for its onsets without being asked to scan', async () => {
    const walked = await cost(DISCONTINUOUS as Uint8Array, {});
    // The same traversal `buildRecordIndex` makes. Two of them is what the `index` option removes.
    expect(walked.recordsScanned).toBeGreaterThan(0);
  });

  it('makes that traversal once when the index is supplied', async () => {
    const supplied = await cost(DISCONTINUOUS as Uint8Array, { withIndex: true });
    expect(supplied).toEqual({ recordsScanned: 0, bytesRead: 0 });
  });
});

describe('what it costs unasked', () => {
  it('is nothing on a continuous file, which is why neither price is a surprise', async () => {
    expect(await cost(CONTINUOUS, {})).toEqual({ recordsScanned: 0, bytesRead: 0 });
  });
});
