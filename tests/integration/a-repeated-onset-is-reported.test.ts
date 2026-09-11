/**
 * What a file with repeating record onsets actually reports.
 *
 * `sample-locate.ts` names one limit that belongs to the file rather than to its functions: two
 * records covering the same instant means two samples exist there and no function can return
 * both. It described that timeline as one "which EDF+ does not forbid and which edfcore reports
 * without a diagnostic".
 *
 * The second half is false wherever the limit can be reached. A record duration above zero makes
 * a repeated onset an overlap — the later record starts before the earlier one ends — so the two
 * probes `openEdf` issues report `RECORD_ONSET_SPACING_VIOLATION`, and a complete index reports
 * one per overlapping pair. The only file where repeats pass unremarked is `recordDuration = 0`,
 * where every record legally starts at the same instant; and `sampleAt` refuses such a file
 * outright, so it never reaches the limit the paragraph is about (fixed in 0.6.74).
 *
 * A docblock that says a condition is unreported is read as "check for it yourself". It is
 * reported, and `assertMonotonicOnsets` says why equal onsets are spacing rather than a fatal.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

const MODULE = readFileSync(new URL('../../src/sample-locate.ts', import.meta.url), 'utf8');
/**
 * The docblock with its wrapping collapsed. The sentence being removed broke across two lines at
 * "which edfcore / reports without a diagnostic", so matching the raw file for it never matched —
 * a guard that would have passed on the defect it was written for.
 */
const PROSE = MODULE.replace(/\s*\n\s*\*\s?/g, ' ');

/** Records 2 and 3 share an onset, so they cover the same second. */
const REPEATED = buildEdf({
  plus: 'D',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
  recordOnsetSeconds: (record) => (record <= 2 ? record : record - 1),
});

/** Every record at the same instant, which a zero duration makes legal. */
const ZERO_DURATION = buildEdf({
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 0,
  signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
  recordOnsetSeconds: () => 0,
});

const codesOf = (diagnostics: readonly { code: string }[]): readonly string[] =>
  diagnostics.map((diagnostic) => diagnostic.code);

describe('a repeated onset on a file whose records occupy time', () => {
  it('is reported by the two probes openEdf issues', async () => {
    const recording = await openEdf(byteSource(REPEATED));
    expect(codesOf(recording.timeline.diagnostics)).toContain('RECORD_ONSET_SPACING_VIOLATION');
  });

  it('is reported again, per overlapping pair, once every onset is read', async () => {
    const recording = await openEdf(byteSource(REPEATED));
    const index = await buildRecordIndex(recording);
    const report = await validateRecording({ ...recording, index });
    expect(
      codesOf(report.diagnostics).filter((code) => code === 'RECORD_ONSET_SPACING_VIOLATION'),
    ).not.toHaveLength(0);
  });

  it('really does repeat, so the fixture is the shape the paragraph describes', async () => {
    const recording = await openEdf(byteSource(REPEATED));
    const index = await buildRecordIndex(recording);
    expect(index.gaps?.some((gap) => gap.durationTicks < 0n)).toBe(true);
  });
});

describe('the one file where repeats really are silent', () => {
  it('is a zero record duration, where every record starts at the same instant', async () => {
    const recording = await openEdf(byteSource(ZERO_DURATION));
    expect(recording.header.recordDurationTicks).toBe(0n);
    expect(codesOf(recording.timeline.diagnostics)).not.toContain('RECORD_ONSET_SPACING_VIOLATION');
  });
});

describe('the docblock', () => {
  it('no longer says a repeated onset goes unreported', () => {
    expect(PROSE).not.toContain('which edfcore reports without a diagnostic');
  });

  it('names the code and the one file it does not fire on', () => {
    const head = PROSE.slice(0, PROSE.indexOf(' */'));
    expect(head).toContain('RECORD_ONSET_SPACING_VIOLATION');
    expect(head).toContain('`recordDuration` of 0');
  });
});
