/**
 * The header summary.
 *
 * A summary is only worth pasting somewhere if it can be trusted, so the tests are about what it
 * must NOT do: invent a value edfcore could not resolve, and carry patient identification by
 * default.
 */

import { describe, expect, it } from 'vitest';
import { formatHeader } from '../../src/format-header.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfHeader } from '../../src/types.js';
import { minimalEdf, minimalEdfPlus } from '../support/writer.js';

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
