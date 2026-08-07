/**
 * The header summary.
 *
 * A summary is only worth pasting somewhere if it can be trusted, so the tests are about what it
 * must NOT do: invent a value edfcore could not resolve, and carry patient identification by
 * default.
 */

import { describe, expect, it } from 'vitest';
import { formatHeader } from '../../src/format-header.js';
import { parseHeader } from '../../src/header/parse.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfHeader } from '../../src/types.js';
import { buildEdf, minimalEdf, minimalEdfPlus } from '../support/writer.js';

async function headerOf(file: Uint8Array): Promise<EdfHeader> {
  return (await openEdf(byteSource(file))).header;
}

describe('formatHeader', () => {
  it('leads with the shape of the file', async () => {
    const header = await headerOf(minimalEdfPlus({ recordCount: 4, recordDurationSeconds: 1 }));
    const [first] = formatHeader(header).split('\n');
    expect(first).toContain('EDF+C');
    expect(first).toContain('4 records');
  });

  it('omits patient identification unless asked', async () => {
    // A header carries a name and a birth date. The obvious thing to do with this string is
    // paste it into an issue, so the default has to be the safe one.
    const header = await headerOf(
      minimalEdf({ patientId: 'MCH-0234567 F 02-MAY-1951 Haagse_Harry' }),
    );

    const withheld = formatHeader(header);
    expect(withheld).not.toContain('Haagse_Harry');

    const included = formatHeader(header, { includePatientId: true });
    expect(included).toContain('Haagse_Harry');
  });

  it('prints an unresolved date as unknown rather than a plausible default', async () => {
    const header = await headerOf(minimalEdf({ raw: { startDate: '        ' } }));
    expect(header.startTime.resolvedDate).toBeUndefined();
    expect(formatHeader(header)).toContain('unknown');
    // The point: nothing that looks like a real date appears.
    expect(formatHeader(header)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('shows an em dash for a rate that is genuinely undefined', async () => {
    // A zero record duration is legal EDF and leaves every rate undefined. Printing 0 Hz or
    // Infinity Hz would both be inventions.
    const header = await headerOf(minimalEdf({ recordDurationSeconds: 0 }));
    expect(header.signals[0]?.sampleRateHz).toBeUndefined();
    expect(formatHeader(header)).not.toContain('Infinity');
    expect(formatHeader(header)).not.toContain('NaN');
  });

  it('says when the record count came from the file size, not the header', async () => {
    const header = await headerOf(minimalEdf({ raw: { recordCount: '-1      ' } }));
    expect(header.recordCountSource).toBe('sourceByteLength');
    expect(formatHeader(header)).toContain('recovered from the source length');
  });

  it('lists every signal exactly once', async () => {
    const header = await headerOf(minimalEdfPlus({ recordCount: 2 }));
    const body = formatHeader(header);
    for (const signal of header.signals) {
      expect(body).toContain(signal.label.slice(0, 20));
    }
    // One header row plus one row per signal.
    const rows = body.split('\n').filter((line) => /^\s{2}\d+\s{2}/.test(line));
    expect(rows).toHaveLength(header.signals.length);
  });
});

describe('the duration line is computed in ticks, not in float seconds', () => {
  function durationLine(recordCount: number, recordDurationSeconds: number): string {
    const bytes = buildEdf({
      recordCount,
      recordDurationSeconds,
      signals: [{ label: 'Fp1', samplesPerRecord: 2 }],
    });
    const header = parseHeader(bytes, bytes.byteLength);
    return (
      formatHeader(header)
        .split('\n')
        .find((l) => l.startsWith('duration')) ?? ''
    );
  }

  it('does not lose a second to a record duration with no exact binary form', () => {
    // 100 x 0.29 is exactly 29 s and computes as 28.999999999999996 in float64, which floors to
    // 28. The header line then reported the recording a whole second shorter than it is.
    expect(durationLine(100, 0.29)).toContain('00:00:29');
    expect(durationLine(3, 0.1)).toContain('00:00:00');
    expect(durationLine(30, 0.1)).toContain('00:00:03');
  });

  it('still truncates a genuine fraction rather than rounding it up', () => {
    // 7 x 0.7 is 4.9 s. Truncating to 4 is right; rounding to 5 would name a time the file does
    // not reach.
    expect(durationLine(7, 0.7)).toContain('00:00:04');
  });

  it('keeps the declared arithmetic visible beside it', () => {
    expect(durationLine(100, 0.29)).toContain('(100 × 0.29 s)');
  });
});

describe('the duration line does not overclaim on a discontinuous file', () => {
  it('calls it "covered" and says the gaps are not in it', async () => {
    // `recordCount * recordDuration` is the DECLARED coverage. On an EDF+D file the recording
    // reaches further by whatever the gaps add up to, and calling that number the duration made a
    // four-record file with an hour-long hole print `duration 00:00:04` — a summary someone pastes
    // into a bug report as "a 4-second file" (fixed in 0.3.11).
    const recording = await openEdf(
      byteSource(
        minimalEdfPlus({
          plus: 'D',
          recordCount: 4,
          recordDurationSeconds: 1,
          recordOnsetSeconds: (i: number) => (i < 2 ? i : i + 3600),
        }),
      ),
    );
    const out = formatHeader(recording.header);

    expect(out).toContain('covered      00:00:04 (4 × 1 s)');
    expect(out).not.toContain('duration');
    expect(out).toContain('the gaps between them are not in it');
    expect(out).toContain('buildRecordIndex');
    // The number itself is unchanged and still correct for what it measures. The span is more
    // than three orders of magnitude larger, and a header alone cannot know it.
    expect(recording.timeline.coveredSeconds).toBe(4);
    expect(recording.timeline.spanSeconds).toBe(3604);
  });

  it('still says "duration" for a file whose records run end to end', async () => {
    const bytes = minimalEdfPlus({ plus: 'C', recordCount: 4, recordDurationSeconds: 1 });
    const recording = await openEdf(byteSource(bytes));
    const out = formatHeader(recording.header);
    expect(out).toContain('duration     00:00:04 (4 × 1 s)');
    expect(out).not.toContain('covered');
  });

  it('says "duration" for a plain EDF, which has no continuity marker at all', async () => {
    const bytes = minimalEdf({ recordCount: 4, recordDurationSeconds: 1 });
    const recording = await openEdf(byteSource(bytes));
    expect(formatHeader(recording.header)).toContain('duration     00:00:04');
  });
});

describe('a hostile label cannot forge a row or shift a column', () => {
  it('replaces control characters rather than printing them', () => {
    // EDF pads labels with spaces and says nothing about what else may be in them. A newline would
    // render as two rows and invent a signal the file does not contain.
    const bytes = buildEdf({
      recordCount: 2,
      signals: [{ label: 'Fp1', samplesPerRecord: 2, raw: { label: 'A\nB\tC' } }],
    });
    const header = parseHeader(bytes, bytes.byteLength);
    const out = formatHeader(header);

    const rows = out.split('\n').filter((l) => /^\s+\d+\s{2}/.test(l));
    expect(rows).toHaveLength(header.signals.length);
    expect(out).not.toContain('A\nB');
    expect(out).toContain('A.B.C');
    // The raw bytes are still available; only the rendering is sanitised.
    expect(header.signals[0]?.raw.label).toContain('\n');
  });
});

describe('the diagnostic summary is ordered like the validation report', () => {
  it('puts errors before warnings before info, whatever order they arrived in', () => {
    // Ordering by arrival meant two files with the same diagnostics could summarise them
    // differently. formatValidationReport was fixed in 0.2.15; this is the same fix.
    const bytes = buildEdf({
      recordCount: 2,
      signals: [
        { label: 'Inv', samplesPerRecord: 2, physicalMinimum: 500, physicalMaximum: -500 },
        { label: 'Flat', samplesPerRecord: 2, physicalMinimum: 7, physicalMaximum: 7 },
      ],
    });
    const header = parseHeader(bytes, bytes.byteLength);
    const line =
      formatHeader(header)
        .split('\n')
        .find((l) => l.includes('diagnostic(s):')) ?? '';

    const order = ['error', 'warning', 'info'].map((s) => line.indexOf(s)).filter((i) => i >= 0);
    expect(order.length).toBeGreaterThan(1);
    expect([...order]).toEqual([...order].sort((a, b) => a - b));
  });
});
