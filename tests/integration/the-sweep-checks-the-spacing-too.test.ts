/**
 * Who enforces the record-onset spacing rule, asked of both enforcers.
 *
 * `time/timeline.ts` called itself sole owner and added "so monotonicity and record-onset spacing
 * are enforced here and nowhere else". `validate.ts` enforces the spacing rule too, and its
 * check is the stronger one: `reportStructure` walks the gaps of a COMPLETE index and reports
 * `RECORD_ONSET_SPACING_VIOLATION` for each negative one, naming the two segments that overlap.
 * The check in `timeline.ts` sees the probed pair — record 0 and the last record — so it can only
 * report NET drift, and a gap that a later overlap cancels leaves it nothing to report at all.
 *
 * That is not a detail for a reader of `timeline.ts`: taking "nowhere else" at its word means
 * believing the conformance sweep does not look at spacing, which is the opposite of true, and
 * that the probed verdict is the only one available, which is the weaker of the two (0.6.59).
 *
 * The file below builds the case that separates them — a gap and an overlap that cancel — so the
 * probed timeline reports nothing and the sweep reports the overlap.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

const TIMELINE_MODULE = readFileSync(
  new URL('../../src/time/timeline.ts', import.meta.url),
  'utf8',
);

/**
 * Six one-second records whose onsets jump forward two seconds and then back one, so the last
 * record ends exactly where a contiguous file's would. Net drift is zero.
 */
const CANCELLING = buildEdf({
  plus: 'D',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
  recordOnsetSeconds: (record) => (record < 3 ? record : record + (record === 3 ? 2 : 1)),
});

const codesOf = (diagnostics: readonly { code: string }[]): readonly string[] =>
  diagnostics.map((diagnostic) => diagnostic.code);

describe('a file whose gap and overlap cancel', () => {
  it('tells the probed timeline nothing, because net drift is what two reads see', async () => {
    const recording = await openEdf(byteSource(CANCELLING));
    expect(recording.index.coverage).toBe('probed');
    expect(codesOf(recording.timeline.diagnostics)).not.toContain('RECORD_ONSET_SPACING_VIOLATION');
  });

  it('is reported by the sweep, which walks a complete index', async () => {
    const recording = await openEdf(byteSource(CANCELLING));
    const index = await buildRecordIndex(recording);
    const report = await validateRecording({ ...recording, index });
    expect(codesOf(report.diagnostics)).toContain('RECORD_ONSET_SPACING_VIOLATION');
  });
});

describe('the docblock that claimed sole ownership', () => {
  it('no longer says the rule is enforced nowhere else', () => {
    expect(TIMELINE_MODULE).not.toContain(
      'record-onset spacing are enforced here and nowhere else',
    );
  });

  it('names the other enforcer', () => {
    const head = TIMELINE_MODULE.slice(0, TIMELINE_MODULE.indexOf('\n */'));
    expect(head).toContain('validateRecording');
  });
});
