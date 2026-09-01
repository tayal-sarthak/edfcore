/**
 * The two EDF+ identification grammars.
 *
 * Layer 2. Sole owner of the subfield structure of the 80-byte local patient identification
 * (offset 8) and the 80-byte local recording identification (offset 88).
 *
 * Three rules run through both:
 *
 * - `'X'` means unknown in ANY subfield and becomes `undefined`, never the string `'X'`.
 * - The raw text is ALWAYS preserved, whatever the grammar says, and subfields beyond the ones
 *   the spec names go to `extraSubfields` — EDF+ says the field must *start with* its
 *   subfields, so trailing extras are legal and are not a non-conformance.
 * - Underscores are exposed verbatim. EDF+ says a space inside a subfield must be replaced by
 *   another character and suggests an underscore, but it mandates neither the character nor a
 *   way back: `'Mac_Donald'` and a genuine underscore are indistinguishable, so substituting
 *   here would corrupt one to display the other. `raw` and the subfields both keep what the
 *   file wrote.
 *
 * Plain EDF puts free text in these fields, which is normal and not a defect. The diagnostic
 * therefore fires only when the file carries an EDF+/BDF+ marker; `conformant` is set honestly
 * either way.
 */

import { trimEdfField } from '../bytes/latin1.js';
import { HEADER_FIELDS } from '../constants.js';
import type { DiagnosticSink } from '../diagnostics/collector.js';
import { pluralise } from '../text/counted.js';
import type { EdfCalendarDate, EdfPatientId, EdfRecordingId } from '../types.js';
import { parseSubfieldDate } from './dates.js';

/** The EDF+ placeholder for an unknown subfield, in every position. */
const UNKNOWN_SUBFIELD = 'X';

const RECORDING_ID_PREFIX = 'Startdate';

const PATIENT_SUBFIELD_COUNT = 4;
const RECORDING_SUBFIELD_COUNT = 5;

const PATIENT_GRAMMAR = 'code sex(F|M) birthdate(dd-MMM-yyyy) name';
const RECORDING_GRAMMAR =
  'Startdate startdate(dd-MMM-yyyy) investigationCode technicianCode equipmentCode';

/**
 * Whether the subfield grammar is a requirement or a convention. The same bytes are parsed
 * either way — plain EDF files often follow the convention anyway — and this only decides
 * whether a deviation is worth reporting, which is why it is an option and not a mode.
 */
export interface IdentificationOptions {
  /**
   * The reserved field carries an EDF+/BDF+ marker, so the subfield grammar is required rather
   * than merely conventional. Only then is a deviation worth a diagnostic.
   */
  readonly edfPlus: boolean;
}

/**
 * Subfields are separated by spaces and may not contain one. Runs are tolerated.
 *
 * The ASCII space the spec names, not `/\s+/`. JavaScript's `\s` also matches U+00A0, which is
 * what header byte 0xA0 decodes to — and NO-BREAK SPACE is one of the characters a writer may
 * legitimately pick when EDF+ tells it to replace a space inside a subfield. Splitting on it cut
 * `Mac Donald` into two subfields, so `name` held only `Mac`; and because the split ADDS a
 * subfield rather than removing one, the count check still passed and `conformant` stayed true
 * with no diagnostic. In `parseRecordingId` it shifted every code after it by one position. The
 * docblock's "`raw` and the subfields both keep what the file wrote" was not true of the
 * subfields (fixed in 0.3.49).
 */
function splitSubfields(raw: string): readonly string[] {
  const text = trimEdfField(raw);
  if (text.length === 0) return [];
  return text.split(' ').filter((part) => part.length > 0);
}

/** `'X'` is the spec's "unknown", and an absent subfield is unknown too. */
function subfieldValue(subfields: readonly string[], index: number): string | undefined {
  const value = subfields[index];
  if (value === undefined || value === UNKNOWN_SUBFIELD) return undefined;
  return value;
}

function parseSex(subfield: string | undefined): 'F' | 'M' | undefined {
  if (subfield === 'F' || subfield === 'M') return subfield;
  return undefined;
}

/**
 * A subfield date, or `undefined` for `'X'`/absent/unparseable.
 *
 * `conformant` is false when the text is present but is not exactly `dd-MMM-yyyy` with an
 * uppercase English month — the date is still exposed when it can be read at all.
 */
function parseIdentificationDate(subfield: string | undefined): {
  readonly date: EdfCalendarDate | undefined;
  readonly conformant: boolean;
} {
  if (subfield === undefined) return { date: undefined, conformant: true };
  const parsed = parseSubfieldDate(subfield);
  return { date: parsed.date, conformant: parsed.conformant };
}

/**
 * The local patient identification: code, sex, birthdate, name, then anything else the writer
 * appended.
 *
 * `raw` on the result is the text exactly as it was passed in, padding included.
 */
export function parsePatientId(
  raw: string,
  options: IdentificationOptions,
  sink: DiagnosticSink,
): EdfPatientId {
  const subfields = splitSubfields(raw);
  const sexText = subfields[1];
  const sex = parseSex(sexText);
  const birth = parseIdentificationDate(subfieldValue(subfields, 2));

  const sexConformant =
    sexText === undefined ? false : sex !== undefined || sexText === UNKNOWN_SUBFIELD;
  const conformant =
    subfields.length >= PATIENT_SUBFIELD_COUNT && sexConformant && birth.conformant;

  if (!conformant && options.edfPlus) {
    const offset = HEADER_FIELDS.patientId.offset;
    sink.report({
      code: 'PATIENT_ID_NONCONFORMANT',
      message:
        `local patient identification (80 bytes at offset ${offset}) is ` +
        `${JSON.stringify(trimEdfField(raw))}, which does not follow the EDF+ grammar ` +
        `"${PATIENT_GRAMMAR}": four space-separated subfields, sex written F or M, ` +
        'birthdate written dd-MMM-yyyy such as 02-AUG-1951, X for anything unknown, and no ' +
        `space inside a subfield. Found ${pluralise(subfields.length, 'subfield')}. EDF+ ` +
        `additional ` +
        'specification 3. Next: header.patient.raw keeps the text verbatim and every subfield edfcore ' +
        'could read is still exposed; the rest are undefined.',
      field: 'patientId',
      byteOffset: offset,
      byteLength: HEADER_FIELDS.patientId.length,
      raw,
      expected: PATIENT_GRAMMAR,
      actual: trimEdfField(raw),
      specReference: 'EDF+ additional specification 3 (local patient identification)',
    });
  }

  return {
    raw,
    conformant,
    code: subfieldValue(subfields, 0),
    sex,
    birthDate: birth.date,
    name: subfieldValue(subfields, 3),
    extraSubfields: Object.freeze(subfields.slice(PATIENT_SUBFIELD_COUNT)),
  };
}

/**
 * The local recording identification: the literal `Startdate`, the start date, and the
 * investigation, technician and equipment codes.
 *
 * This is the only field in an EDF file that can carry a four-digit year, which is what makes
 * it the authority `dates.ts` prefers and the only way past 2084.
 */
export function parseRecordingId(
  raw: string,
  options: IdentificationOptions,
  sink: DiagnosticSink,
): EdfRecordingId {
  const subfields = splitSubfields(raw);
  const prefix = subfields[0];
  const startDate = parseIdentificationDate(subfieldValue(subfields, 1));

  // Case-insensitive acceptance, non-conformance noted: the spec spells it 'Startdate'.
  const prefixPresent =
    prefix !== undefined && prefix.toUpperCase() === RECORDING_ID_PREFIX.toUpperCase();
  const prefixConformant = prefix === RECORDING_ID_PREFIX;
  const conformant =
    subfields.length >= RECORDING_SUBFIELD_COUNT && prefixConformant && startDate.conformant;

  if (!conformant && options.edfPlus) {
    const offset = HEADER_FIELDS.recordingId.offset;
    sink.report({
      code: 'RECORDING_ID_NONCONFORMANT',
      message:
        `local recording identification (80 bytes at offset ${offset}) is ` +
        `${JSON.stringify(trimEdfField(raw))}, which does not follow the EDF+ grammar ` +
        `"${RECORDING_GRAMMAR}": five space-separated subfields starting with the literal ` +
        'text Startdate, then the start date written dd-MMM-yyyy such as 02-AUG-1951, then ' +
        'the investigation, technician and equipment codes, with X for anything unknown. ' +
        `Found ${pluralise(subfields.length, 'subfield')}. EDF+ additional specification 4. ` +
        `Next: ` +
        'header.recording.raw keeps the text verbatim; a Startdate that could not be read ' +
        'leaves startTime.recordingIdDate undefined, so the two-digit header year is all ' +
        'that remains.',
      field: 'recordingId',
      byteOffset: offset,
      byteLength: HEADER_FIELDS.recordingId.length,
      raw,
      expected: RECORDING_GRAMMAR,
      actual: trimEdfField(raw),
      specReference: 'EDF+ additional specification 4 (local recording identification)',
    });
  }

  return {
    raw,
    conformant,
    // A date sitting behind a missing or misspelt 'Startdate' keyword is not a Startdate; the
    // subfield is only meaningful in the position the grammar gives it.
    startDate: prefixPresent ? startDate.date : undefined,
    investigationCode: subfieldValue(subfields, 2),
    technicianCode: subfieldValue(subfields, 3),
    equipmentCode: subfieldValue(subfields, 4),
    extraSubfields: Object.freeze(subfields.slice(RECORDING_SUBFIELD_COUNT)),
  };
}
