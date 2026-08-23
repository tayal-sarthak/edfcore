/**
 * A birthdate after the recording, compared at every level and not just the year.
 *
 * `DATE_IMPLAUSIBLE` is the reachable half of a code documented for two conditions, and the half
 * it catches is a patient born after the recording that captured them. That is not a hypothetical
 * shape: EDF's start date is two digits, resolved by the EDF+ rule that 00..84 mean 2000..2084, so
 * a recording made in 1974 reads as 2074 and every birthdate in the file is suddenly in the past
 * of a future recording — or the inverse, which is the case this reports.
 *
 * The comparison behind it is three lines: year, then month, then day. Every fixture that reached
 * it differed in the YEAR, so two of the three lines had never run. A comparison that stopped at
 * the year would still catch the two-digit-year case that motivated the check, and would silently
 * stop catching a birthdate later in the same year — which is what a mistyped month produces, and
 * what a `dd-MMM-yyyy` subfield with its day and month transposed produces on any date before the
 * thirteenth.
 *
 * The equality boundary is the other half, and it is the one worth getting right in this
 * direction. A recording made on the day of birth is a neonatal EEG, which is an ordinary thing
 * for this library to be pointed at. `> 0` rather than `>= 0` is what keeps that file clean, and
 * an off-by-one there would report a defect on every recording taken in a delivery suite.
 */

import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../src/header/parse.js';
import { validateHeader } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

/** A conformant EDF+ header, with the start date and the patient's birthdate as given. */
const codesFor = (startDate: string, birth: string): readonly string[] => {
  const bytes = buildEdf({
    plus: 'C',
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: [
      {
        label: 'EEG Fpz-Cz',
        transducerType: 'AgAgCl electrode',
        prefiltering: 'HP:0.1Hz',
        samplesPerRecord: 8,
      },
    ],
    annotationSignals: [{ samplesPerRecord: 30 }],
    patientId: `MRN1 F ${birth} Name`,
    raw: { startDate },
  });
  return validateHeader(parseHeader(bytes, bytes.byteLength)).map((one) => one.code);
};

const reports = (startDate: string, birth: string): boolean =>
  codesFor(startDate, birth).includes('DATE_IMPLAUSIBLE');

describe('a birthdate after the recording', () => {
  it('is reported when the year is later', () => {
    // The case the check was written for: a two-digit year resolved into the future.
    expect(reports('01.01.20', '02-MAY-2050')).toBe(true);
  });

  it('is reported when only the month is later', () => {
    // A mistyped month, or a `dd-MMM-yyyy` subfield with its day and month transposed. A
    // comparison that stopped at the year would call this file clean.
    expect(reports('01.06.20', '02-DEC-2020')).toBe(true);
  });

  it('is reported when only the day is later', () => {
    expect(reports('15.06.20', '20-JUN-2020')).toBe(true);
  });
});

describe('a birthdate at or before it', () => {
  it('says nothing about an ordinary one', () => {
    expect(codesFor('01.01.20', '02-MAY-1951')).toEqual([]);
  });

  it('says nothing when only the month is earlier', () => {
    expect(codesFor('01.06.20', '02-FEB-2020')).toEqual([]);
  });

  it('says nothing when only the day is earlier', () => {
    expect(codesFor('15.06.20', '10-JUN-2020')).toEqual([]);
  });

  it('says nothing about a baby recorded on the day it was born', () => {
    // A neonatal EEG. `> 0` rather than `>= 0` is what keeps this file clean, and an off-by-one
    // would report a defect on every recording taken in a delivery suite.
    expect(codesFor('15.06.20', '15-JUN-2020')).toEqual([]);
  });
});

describe('the message it prints', () => {
  it('names both dates, because the reader has to see which is wrong', () => {
    const bytes = buildEdf({
      plus: 'C',
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [
        {
          label: 'EEG Fpz-Cz',
          transducerType: 'AgAgCl electrode',
          prefiltering: 'HP:0.1Hz',
          samplesPerRecord: 8,
        },
      ],
      annotationSignals: [{ samplesPerRecord: 30 }],
      patientId: 'MRN1 F 02-DEC-2020 Name',
      raw: { startDate: '01.06.20' },
    });
    const found = validateHeader(parseHeader(bytes, bytes.byteLength)).find(
      (one) => one.code === 'DATE_IMPLAUSIBLE',
    );
    expect(found?.message).toContain('2020-12-02');
    expect(found?.message).toContain('2020-06-01');
    // And the usual cause, which is a header year rather than a wrong birthdate.
    expect(found?.message).toContain('two-digit header year');
    expect(found?.field).toBe('patientId');
  });
});
