/**
 * The four-row table on `validation.md`, and the claim it exists to support.
 *
 * "Conformance costs one traversal rather than two" is the reason `validateRecording` takes an
 * `index` at all, and the page backs it with a table of four situations and a snippet printing
 * `0 0` for the one that matters. `budget-invariance.test.ts` checks that the budget cannot change
 * what the sweep REPORTS; nothing checked what it READS.
 *
 * Every row is a different reason to read or not read, and each is a claim about cost that a
 * caller plans around: a plain EDF is pure header arithmetic, an EDF+ without an index has to
 * traverse, a complete index means it does not, and `scanSamples` means it does regardless. The
 * three sentences under the table qualify the third row — the index has to be complete, covering
 * exactly `header.recordCount` records, with segments and gaps present — and a probed index is
 * ignored rather than refused, which is the sentence most likely to be quietly wrong.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { minimalEdf, minimalEdfPlus } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('validation.md') ?? '';

const PLAIN = minimalEdf({ recordCount: 8, recordDurationSeconds: 1 });
const PLUS = minimalEdfPlus({ recordCount: 8, recordDurationSeconds: 1 });

describe('the table was read', () => {
  it('states the four situations this file checks', () => {
    const prose = PAGE.replace(/\s+/g, ' ');
    expect(prose).toContain('Plain EDF or BDF, no `scanSamples` | none');
    expect(prose).toContain('EDF+ or BDF+, no index, no `scanSamples` | every record');
    expect(prose).toContain('EDF+ or BDF+, complete index supplied, no `scanSamples` | none');
    expect(prose).toContain('Any file, `scanSamples: true` | every record');
  });
});

describe('what the sweep reads', () => {
  it('is nothing at all on a plain EDF, which stores no onsets', async () => {
    const recording = await openEdf(byteSource(PLAIN));
    const report = await validateRecording(recording);

    expect(report.recordsScanned).toBe(0);
    expect(report.bytesRead).toBe(0);
  });

  it('is every record on an EDF+ with no index', async () => {
    const recording = await openEdf(byteSource(PLUS));
    const report = await validateRecording(recording);

    expect(report.recordsScanned).toBe(recording.header.recordCount);
    expect(report.bytesRead).toBe(recording.header.recordCount * recording.header.recordByteLength);
  });

  it('is nothing again once a complete index is handed over', async () => {
    // The snippet: `console.log(report.recordsScanned, report.bytesRead);  // 0 0`.
    const printed =
      /console\.log\(report\.recordsScanned, report\.bytesRead\);\s*\/\/ (\d+) (\d+)/.exec(PAGE);
    expect(printed, 'no zero-cost snippet on validation.md').not.toBeNull();

    const recording = await openEdf(byteSource(PLUS));
    const index = await buildRecordIndex(recording);
    const report = await validateRecording(recording, { index });

    expect(report.recordsScanned).toBe(Number(printed?.[1]));
    expect(report.bytesRead).toBe(Number(printed?.[2]));
  });

  it('is every record whenever scanSamples is on, index or not', async () => {
    const recording = await openEdf(byteSource(PLUS));
    const index = await buildRecordIndex(recording);

    for (const options of [{ scanSamples: true }, { scanSamples: true, index }]) {
      const report = await validateRecording(recording, options);
      expect(report.recordsScanned).toBe(recording.header.recordCount);
    }
  });
});

describe('an index that is not complete', () => {
  it('is ignored rather than refused, and the sweep reads the file itself', async () => {
    // "Passing one is not an error; it buys nothing." A probed index is what `openEdf` gives you,
    // so this is the mistake a caller makes by passing what they already have.
    const recording = await openEdf(byteSource(PLUS));
    expect(recording.index.coverage).toBe('probed');

    const report = await validateRecording(recording, { index: recording.index });

    expect(report.recordsScanned).toBe(recording.header.recordCount);
    expect(report.diagnostics.some((one) => one.severity === 'error')).toBe(false);
  });

  it('is not one that covers a different number of records', async () => {
    // "covering exactly `header.recordCount` records" — an index from another file has the right
    // shape and the wrong length, and using it would date every record from the wrong onsets.
    const shorter = await openEdf(byteSource(minimalEdfPlus({ recordCount: 4 })));
    const other = await buildRecordIndex(shorter);
    const recording = await openEdf(byteSource(PLUS));

    const report = await validateRecording(recording, { index: other });
    expect(report.recordsScanned).toBe(recording.header.recordCount);
  });
});
