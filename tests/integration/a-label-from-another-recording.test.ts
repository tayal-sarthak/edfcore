/**
 * `formatValidationReport(report, { header })`, where the header is a different file's.
 *
 * The two arrive as separate arguments and are only ever paired by a caller — the shape
 * `resolveTimeWindow` guards for its timeline and index, where it is "not a wrong number but a
 * wrong FILE". Here it is a wrong file's NAMES on a right file's numbers, and this option's whole
 * job is those names: the difference between `EEG Fpz-Cz` and `signal 0`.
 *
 * It answered. Row 0 took the other recording's signal 0 label, and the rows that header had no
 * signal for fell back to `signal 1`, `signal 2` — so the output reads as a file where only some
 * channels are named, which makes the wrong one harder to notice rather than easier. A reader
 * comparing an observed range against a channel name is reading two different recordings on one
 * line.
 *
 * `validate-index-reuse.test.ts` lists the routes for the sibling mistake and they are the same
 * here: "a viewer holding indices for several open recordings, a helper that caches one per
 * session, a loop that forgets to rebuild".
 *
 * What the check is: every signal the report mentions has to exist in the header. A header that
 * cannot name every row is certainly not this report's. It is a floor rather than a proof — a wrong
 * header with enough signals still passes — and that is stated rather than hidden, because the two
 * share no identifier to compare.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfHeader, EdfRecording, ValidationReport } from '../../src/types.js';
import { formatValidationReport, validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

const THREE = buildEdf({
  format: 'EDF',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fp1', samplesPerRecord: 4 },
    { label: 'EEG C3', samplesPerRecord: 4 },
    { label: 'ECG', samplesPerRecord: 4 },
  ],
});

const ONE = buildEdf({
  format: 'EDF',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'PLETHWAVE', samplesPerRecord: 4 }],
});

const open = (bytes: Uint8Array): Promise<EdfRecording> => openEdf(byteSource(bytes));

async function reportOf(bytes: Uint8Array): Promise<ValidationReport> {
  return validateRecording(await open(bytes), { scanSamples: true });
}

const refusal = (call: () => unknown): string => {
  let thrown: Error | undefined;
  try {
    call();
  } catch (error) {
    thrown = error as Error;
  }
  expect(thrown, 'nothing was refused').toBeDefined();
  return (thrown as Error).message;
};

describe('a header from another recording', () => {
  it('is refused rather than used to label the rows', async () => {
    const report = await reportOf(THREE);
    const other = (await open(ONE)).header;
    expect(() => formatValidationReport(report, { header: other })).toThrow(RangeError);
  });

  it('names both counts and the row it could not account for', async () => {
    const report = await reportOf(THREE);
    const other = (await open(ONE)).header;
    const message = refusal(() => formatValidationReport(report, { header: other }));
    expect(message).toContain('options.header has 1 signals');
    expect(message).toContain('rows for signal 1');
    expect(message).toContain('not the header this file was validated with');
  });

  it('says what to pass instead', async () => {
    const report = await reportOf(THREE);
    const other = (await open(ONE)).header;
    expect(refusal(() => formatValidationReport(report, { header: other }))).toContain(
      'the header of the recording you passed to validateRecording(recording)',
    );
  });

  it('would have printed the other recording’s label on row 0', async () => {
    // What the old behaviour produced, stated so the cost is not just asserted in prose.
    const report = await reportOf(THREE);
    const own = (await open(THREE)).header;
    const text = formatValidationReport(report, { header: own });
    expect(text).toContain('EEG Fp1');
    // `PLETHWAVE` rather than a real channel type: the label-convention diagnostic prints the whole
    // list of standard EDF+ types, so a name from it would appear in the report either way.
    expect(text).not.toContain('PLETHWAVE');
  });
});

describe('the fallback the mismatch hid behind', () => {
  it('is what an omitted option gives, and that is still allowed', async () => {
    const report = await reportOf(THREE);
    const text = formatValidationReport(report);
    expect(text).toContain('signal 0');
    expect(text).not.toContain('EEG Fp1');
  });
});

describe('a header the report could be about', () => {
  it('still names every row', async () => {
    const report = await reportOf(THREE);
    const own = (await open(THREE)).header;
    const text = formatValidationReport(report, { header: own });
    for (const label of ['EEG Fp1', 'EEG C3', 'ECG']) expect(text).toContain(label);
  });

  it('is a floor, not a proof: a wrong header with enough signals still passes', async () => {
    const report = await reportOf(ONE);
    const bigger = (await open(THREE)).header;
    // One signal mentioned, three available — nothing here can tell these two files apart.
    expect(() => formatValidationReport(report, { header: bigger })).not.toThrow();
  });

  it('and a report with no rows at all is unchanged', async () => {
    const recording = await open(THREE);
    const cheap = await validateRecording(recording);
    expect(cheap.signalStats).toHaveLength(0);
    expect(() => formatValidationReport(cheap, { header: recording.header })).not.toThrow();
  });
});

describe('the guard above it', () => {
  it('still refuses a value that is not a header at all', async () => {
    const report = await reportOf(THREE);
    const asHeader = (value: unknown): EdfHeader => value as EdfHeader;
    expect(() => formatValidationReport(report, { header: asHeader(0) })).toThrow(
      /is not a header/,
    );
  });
});
