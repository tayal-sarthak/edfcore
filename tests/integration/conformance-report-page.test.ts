/**
 * The conformance report `validation.md` prints, printed.
 *
 * That page ends with a whole program and the output it produces on one file: a header line, a
 * summary line, two diagnostic blocks, and two per-signal stat lines. `validate-page.test.ts`
 * covers the code table higher up the page and `validation-report.test.ts` the `report.ok` rule.
 * The transcript itself — the thing a reader compares their own terminal against — was prose.
 *
 * The stat lines are the reason it is worth running. They are not printed by edfcore at all: the
 * page composes them from `report.signalStats`, `getSignal` and arithmetic of its own, and the
 * paragraph under them is an argument built on the result. "The first channel uses half a percent
 * of the range its header declares, which is legal and lossy." "81,806 of its 153,600 samples fall
 * outside the range the header declares, so that declaration is wrong." Both sentences are about
 * numbers the snippet computed, and a change to `observedDigitalMin`, `outOfDigitalRangeCount` or
 * `sampleCount` would leave the page arguing from figures the library no longer produces.
 *
 * So the snippet is run rather than restated: the two stat lines below are built by the same
 * expression the page shows, and compared against the page's own text character for character.
 *
 * The fixture is built to the page's description — "a ten-minute EDF+C file whose second channel is
 * labelled `Fp1`", carrying "a free-text prefiltering field and a blank transducer type", declaring
 * `-100..100` — and its geometry falls out of the transcript: 600 one-second records at 650,400
 * bytes is 1,084 bytes a record, which is two 256-sample channels and a 30-sample annotation
 * region, and 153,600 samples is 600 x 256. The one number that cannot be derived is how many of
 * them fall outside: that is read off the page and built into the sample generator, which is what
 * makes the count an assertion about the counter rather than about the waveform.
 */

import { describe, expect, it } from 'vitest';
import { clampToDigitalRange } from '../../src/decode/physical.js';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { type ValidationReport, validateRecording } from '../../src/validate.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('validation.md') ?? '';

/** The two stat lines from the transcript, exactly as printed. */
const PRINTED = [...PAGE.matchAll(/^(\S[^\n]*? declared -?\d+\.\.[^\n]*outside)$/gm)].map(
  (match) => match[1] ?? '',
);

const asNumber = (text: string | undefined): number => Number((text ?? '').replace(/,/g, ''));

const RECORD_COUNT = 600;
const SAMPLES_PER_RECORD = 256;
/** `81806 of 153600 outside`, off the page: the count the generator below is built to produce. */
const OUT_OF_RANGE = asNumber(/(\d+) of \d+ outside/.exec(PRINTED[1] ?? '')?.[1]);

const BYTES = buildEdf({
  plus: 'C',
  recordCount: RECORD_COUNT,
  recordDurationSeconds: 1,
  startDate: '02.03.02',
  signals: [
    {
      label: 'EEG Fpz-Cz',
      samplesPerRecord: SAMPLES_PER_RECORD,
      // Observed -180..180, well inside the declared 16-bit range: "legal and lossy".
      sample: (record, index) => {
        const at = record * SAMPLES_PER_RECORD + index;
        return at === 0 ? -180 : at === 1 ? 180 : (at % 41) - 20;
      },
    },
    {
      label: 'Fp1',
      samplesPerRecord: SAMPLES_PER_RECORD,
      prefiltering: 'free text',
      transducerType: '',
      raw: {
        physicalMinimum: '-100',
        physicalMaximum: '100',
        digitalMinimum: '-100',
        digitalMaximum: '100',
      },
      // Exactly `OUT_OF_RANGE` samples at +/-150, the rest inside. Observed -150..150.
      sample: (record, index) => {
        const at = record * SAMPLES_PER_RECORD + index;
        return at < OUT_OF_RANGE ? (at % 2 === 0 ? 150 : -150) : (at % 41) - 20;
      },
    },
  ],
  annotationSignals: [{ samplesPerRecord: 30 }],
});

async function reported(): Promise<{ recording: EdfRecording; report: ValidationReport }> {
  const recording = await openEdf(byteSource(BYTES));
  return { recording, report: await validateRecording(recording, { scanSamples: true }) };
}

/** The page's own loop body, transcribed. Nothing here is edfcore's formatting. */
function statLines(recording: EdfRecording, report: ValidationReport): readonly string[] {
  const { header } = recording;
  return report.signalStats.map((stats) => {
    const signal = getSignal(header, stats.signalIndex);
    const declared = Math.abs(signal.digitalMaximum - signal.digitalMinimum);
    const observed = stats.observedDigitalMax - stats.observedDigitalMin;
    const used = declared === 0 ? 0 : (100 * observed) / declared;
    return (
      `${signal.label.padEnd(16)} declared ${signal.digitalMinimum}..${signal.digitalMaximum}` +
      `  observed ${stats.observedDigitalMin}..${stats.observedDigitalMax}` +
      `  (${used.toFixed(1)}% of range)` +
      `  ${stats.outOfDigitalRangeCount} of ${stats.sampleCount} outside`
    );
  });
}

describe('the transcript', () => {
  it('has the two stat lines, so a passing run is not a vacuous one', () => {
    expect(PRINTED).toHaveLength(2);
    expect(PRINTED[0]).toContain('EEG Fpz-Cz');
    expect(PRINTED[1]).toContain('Fp1');
    expect(OUT_OF_RANGE).toBe(81_806);
  });

  it('describes the file the fixture builds', async () => {
    const { recording } = await reported();
    const { header } = recording;
    // 650,400 bytes over 600 records is 1,084 a record, which is what this geometry comes to.
    expect(header.recordByteLength).toBe(1084);
    expect(header.signals).toHaveLength(3);
    expect(header.variant).toBe('EDF+C');
    expect(header.recordCount).toBe(RECORD_COUNT);
  });
});

describe('the summary line', () => {
  it('prints what the page prints, field for field', async () => {
    const { recording, report } = await reported();
    const { header } = recording;

    const first = `${header.variant}, ${header.recordCount} records of ${header.recordDurationSeconds} s, ${header.signals.length} signals`;
    const second = `${report.ok ? 'no errors' : 'ERRORS'}, ${report.diagnostics.length} diagnostics, ${report.recordsScanned} records and ${report.bytesRead} bytes read`;

    expect(PAGE).toContain(`sample.edf: ${first}`);
    expect(PAGE).toContain(second);
  });

  it('scans every record, which is what the progress line counts to', async () => {
    const { report } = await reported();
    expect(report.recordsScanned).toBe(RECORD_COUNT);
    expect(PAGE).toContain(`scanning ${RECORD_COUNT}/${RECORD_COUNT} records`);
  });
});

describe('the stat lines', () => {
  it('are what the page prints, character for character', async () => {
    const { recording, report } = await reported();
    expect(statLines(recording, report)).toEqual(PRINTED);
  });

  it('leave the first channel legal and lossy, as the paragraph says', async () => {
    const { recording, report } = await reported();
    const stats = report.signalStats[0];
    const signal = getSignal(recording.header, 0);
    expect(stats?.outOfDigitalRangeCount).toBe(0);
    expect(stats?.observedDigitalMin).toBeGreaterThan(signal.digitalMinimum);
    expect(stats?.observedDigitalMax).toBeLessThan(signal.digitalMaximum);
  });

  it('and make the second channel’s declaration wrong, which is the stronger claim', async () => {
    const { report } = await reported();
    const stats = report.signalStats[1];
    expect(stats?.outOfDigitalRangeCount).toBe(OUT_OF_RANGE);
    expect(stats?.sampleCount).toBe(RECORD_COUNT * SAMPLES_PER_RECORD);
    // Over half the channel, which is why the page calls it the more serious line.
    expect(OUT_OF_RANGE * 2).toBeGreaterThan(RECORD_COUNT * SAMPLES_PER_RECORD);
  });
});

describe('"any consumer that clamps to it returns different numbers"', () => {
  it('is true of this file, and edfcore is not one of them', async () => {
    const { recording } = await reported();
    const signal = getSignal(recording.header, 1);
    const chunk = await readRecords(recording, {
      records: { start: 0, count: 1 },
      signalIndices: [signal.index],
    });
    const series = chunk.signals[0];
    if (series === undefined) throw new Error('one signal was asked for and none came back');

    // What a read returns: the bytes as written, outside the declaration and unaltered.
    expect(Math.max(...series.digital)).toBe(150);
    expect(Math.min(...series.digital)).toBe(-150);

    // What a consumer that clamps would return instead.
    const clamped = clampToDigitalRange(signal, series.digital);
    expect(Math.max(...clamped)).toBe(100);
    expect(Math.min(...clamped)).toBe(-100);
    expect([...clamped]).not.toEqual([...series.digital]);
  });
});
