/**
 * Every date rule in EDF, in one place.
 *
 * Layer 2. Sole owner of: the `dd.mm.yy` header startdate, the `hh.mm.ss` clock, the
 * `dd-MMM-yyyy` subfield date used by the patient birthdate and the recording-identification
 * `Startdate`, the 1985-2084 two-digit-year rule, the literal `'yy'` post-2084 escape, and the
 * resolution between the two dates a file can carry.
 *
 * A JavaScript `Date` is never constructed. EDF stores local time at the patient with no
 * timezone, so a `Date` would silently apply the reader's zone — worst exactly at DST
 * boundaries — and `lib: ["ES2022"]` gives us no reason to reach for one anyway. Month lengths
 * and leap years are arithmetic, and `'31.02.99'` must never quietly become 3 March.
 *
 * Separators and stray spaces are tolerated (`' 2. 8.51'` is in the EDF FAQ). A tolerated
 * deviation is reported through `conformant` on the parse result rather than as a diagnostic:
 * the vocabulary in `diagnostics/codes.ts` has no code for a date that parsed but was written
 * oddly, and inventing one is not this module's call.
 */

import { trimEdfField } from '../bytes/latin1.js';
import { HEADER_FIELDS } from '../constants.js';
import type { DiagnosticSink } from '../diagnostics/collector.js';
import type { EdfCalendarDate, EdfClockTime, EdfStartTime } from '../types.js';

const MONTH_ABBREVIATIONS: readonly string[] = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

const DAYS_IN_MONTH: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const MONTHS_PER_YEAR = 12;
const FEBRUARY = 2;
const LEAP_FEBRUARY_DAYS = 29;

const MAX_HOUR = 23;
const MAX_MINUTE = 59;
/** No leap seconds: EDF has no field that could express one, and none is expected. */
const MAX_SECOND = 59;

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** 85..99 mean 1985..1999; 00..84 mean 2000..2084. The escape past 2084 is a literal `'yy'`. */
const TWO_DIGIT_YEAR_PIVOT = 85;
const TWENTIETH_CENTURY = 1900;
const TWENTY_FIRST_CENTURY = 2000;

const DIGIT_ZERO = 0x30;
const DIGIT_NINE = 0x39;

/** `'.'`, `':'`, `'-'`, `'/'` and stray spaces all occur in the wild. */
const DATE_FIELD_SEPARATORS = /[\s.:/-]+/;
/** Exactly `dd.mm.yy`, including the post-2084 escape in the year position. */
const CONFORMANT_HEADER_DATE = /^\d{2}\.\d{2}\.(?:\d{2}|yy)$/;
/** Exactly `hh.mm.ss`. */
const CONFORMANT_HEADER_TIME = /^\d{2}\.\d{2}\.\d{2}$/;
/** Exactly `dd-MMM-yyyy`: zero-padded day, uppercase English month, four-digit year. */
const CONFORMANT_SUBFIELD_DATE = /^\d{2}-[A-Z]{3}-\d{4}$/;
const YEAR_ESCAPE = /^yy$/i;

const MIDNIGHT: EdfClockTime = { hour: 0, minute: 0, second: 0 };

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === FEBRUARY && isLeapYear(year)) return LEAP_FEBRUARY_DAYS;
  return DAYS_IN_MONTH[month - 1] ?? 0;
}

/** The longest that month can ever be, for validating a day whose year is not yet known. */
function maxDaysInMonth(month: number): number {
  if (month === FEBRUARY) return LEAP_FEBRUARY_DAYS;
  return DAYS_IN_MONTH[month - 1] ?? 0;
}

export function isValidCalendarDate(date: EdfCalendarDate): boolean {
  if (!Number.isInteger(date.year) || date.year < 1 || date.year > 9999) return false;
  if (!Number.isInteger(date.month) || date.month < 1 || date.month > MONTHS_PER_YEAR) return false;
  if (!Number.isInteger(date.day) || date.day < 1) return false;
  return date.day <= daysInMonth(date.year, date.month);
}

export function calendarDatesEqual(a: EdfCalendarDate, b: EdfCalendarDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** `'1951-08-02'`. Used in diagnostic messages and by `formatStartTimeNaive`. */
export function formatCalendarDate(date: EdfCalendarDate): string {
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

/** `'09:00:00'`. */
export function formatClockTime(clock: EdfClockTime): string {
  return `${pad(clock.hour, 2)}:${pad(clock.minute, 2)}:${pad(clock.second, 2)}`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** All digits, `maxLength` of them at most, no sign and no separators. */
function parseDigits(text: string, maxLength: number): number | undefined {
  if (text.length === 0 || text.length > maxLength) return undefined;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < DIGIT_ZERO || code > DIGIT_NINE) return undefined;
  }
  return Number(text);
}

/**
 * Split a date or time field into exactly three parts, tolerating any of the separators real
 * writers emit and any amount of stray space. Returns `undefined` when there are not three.
 */
function threeFields(text: string): readonly [string, string, string] | undefined {
  const parts = trimEdfField(text)
    .split(DATE_FIELD_SEPARATORS)
    .filter((part) => part.length > 0);
  if (parts.length !== 3) return undefined;
  const first = parts[0];
  const second = parts[1];
  const third = parts[2];
  if (first === undefined || second === undefined || third === undefined) return undefined;
  return [first, second, third];
}

export function resolveTwoDigitYear(twoDigitYear: number): number {
  return twoDigitYear >= TWO_DIGIT_YEAR_PIVOT
    ? TWENTIETH_CENTURY + twoDigitYear
    : TWENTY_FIRST_CENTURY + twoDigitYear;
}

/**
 * `parsed` — a full date. `yearEscape` — the year position held the literal `'yy'`, so only the
 * recording-identification `Startdate` knows the year. `unparseable` — nothing usable.
 */
export type HeaderStartDateStatus = 'parsed' | 'yearEscape' | 'unparseable';

export interface HeaderStartDateParse {
  readonly status: HeaderStartDateStatus;
  /** Present only when `status === 'parsed'`. */
  readonly date: EdfCalendarDate | undefined;
  /** Present when the day and month parsed, including under the year escape. */
  readonly day: number | undefined;
  readonly month: number | undefined;
  /** The 1985-2084 rule was applied to a two-digit year. */
  readonly clippedYear: boolean;
  /** The field is exactly `dd.mm.yy`. False means it parsed only because we tolerate. */
  readonly conformant: boolean;
  readonly raw: string;
}

function unparseableDate(raw: string, conformant: boolean): HeaderStartDateParse {
  return {
    status: 'unparseable',
    date: undefined,
    day: undefined,
    month: undefined,
    clippedYear: false,
    conformant,
    raw,
  };
}

/**
 * The `dd.mm.yy` startdate at offset 168.
 *
 * A four-digit year is accepted where it fits (`'2.8.1951'`), because a writer that spells the
 * year out is unambiguous and the two-digit rule would be a downgrade. Three digits are
 * corruption, not a convention, and are refused.
 */
export function parseHeaderStartDate(raw: string): HeaderStartDateParse {
  const conformant = CONFORMANT_HEADER_DATE.test(raw);
  const fields = threeFields(raw);
  if (fields === undefined) return unparseableDate(raw, conformant);

  const [dayText, monthText, yearText] = fields;
  const day = parseDigits(dayText, 2);
  const month = parseDigits(monthText, 2);
  if (day === undefined || month === undefined) return unparseableDate(raw, conformant);
  if (month < 1 || month > MONTHS_PER_YEAR) return unparseableDate(raw, conformant);

  if (YEAR_ESCAPE.test(yearText)) {
    // The year is genuinely unknown here, so the day can only be checked against the longest
    // that month ever gets; the real year re-checks it in `resolveStartTime`.
    if (day < 1 || day > maxDaysInMonth(month)) return unparseableDate(raw, conformant);
    return {
      status: 'yearEscape',
      date: undefined,
      day,
      month,
      clippedYear: false,
      conformant,
      raw,
    };
  }

  const yearDigits = parseDigits(yearText, 4);
  if (yearDigits === undefined) return unparseableDate(raw, conformant);
  if (yearText.length === 3) return unparseableDate(raw, conformant);
  const clippedYear = yearText.length <= 2;
  const year = clippedYear ? resolveTwoDigitYear(yearDigits) : yearDigits;

  const date: EdfCalendarDate = { year, month, day };
  if (!isValidCalendarDate(date)) return unparseableDate(raw, conformant);
  return { status: 'parsed', date, day, month, clippedYear, conformant, raw };
}

export interface HeaderStartTimeParse {
  readonly clock: EdfClockTime | undefined;
  /** The field is exactly `hh.mm.ss`. */
  readonly conformant: boolean;
  readonly raw: string;
}

/** The `hh.mm.ss` starttime at offset 176. Whole seconds only — EDF has no finer field. */
export function parseHeaderStartTime(raw: string): HeaderStartTimeParse {
  const conformant = CONFORMANT_HEADER_TIME.test(raw);
  const fields = threeFields(raw);
  if (fields === undefined) return { clock: undefined, conformant, raw };

  const [hourText, minuteText, secondText] = fields;
  const hour = parseDigits(hourText, 2);
  const minute = parseDigits(minuteText, 2);
  const second = parseDigits(secondText, 2);
  if (hour === undefined || minute === undefined || second === undefined) {
    return { clock: undefined, conformant, raw };
  }
  if (hour > MAX_HOUR || minute > MAX_MINUTE || second > MAX_SECOND) {
    return { clock: undefined, conformant, raw };
  }
  return { clock: { hour, minute, second }, conformant, raw };
}

export interface SubfieldDateParse {
  readonly date: EdfCalendarDate | undefined;
  /** The text is exactly `dd-MMM-yyyy` with an uppercase English month, and names a real day. */
  readonly conformant: boolean;
}

/**
 * The `dd-MMM-yyyy` subfield date — `'02-AUG-1951'` — used by the patient birthdate and the
 * recording-identification `Startdate`.
 *
 * The month is accepted case-insensitively and a two-digit numeric month is accepted too, both
 * marked non-conformant. The year must be four digits: this field exists precisely to be
 * unambiguous, so applying the two-digit rule to it would throw away the one thing it is for.
 */
export function parseSubfieldDate(text: string): SubfieldDateParse {
  const fields = threeFields(text);
  if (fields === undefined) return { date: undefined, conformant: false };

  const [dayText, monthText, yearText] = fields;
  const day = parseDigits(dayText, 2);
  const year = parseDigits(yearText, 4);
  if (day === undefined || year === undefined || yearText.length !== 4) {
    return { date: undefined, conformant: false };
  }

  const namedMonth = MONTH_ABBREVIATIONS.indexOf(monthText.toUpperCase()) + 1;
  const month = namedMonth > 0 ? namedMonth : parseDigits(monthText, 2);
  if (month === undefined || month < 1 || month > MONTHS_PER_YEAR) {
    return { date: undefined, conformant: false };
  }

  const date: EdfCalendarDate = { year, month, day };
  if (!isValidCalendarDate(date)) return { date: undefined, conformant: false };
  return { date, conformant: CONFORMANT_SUBFIELD_DATE.test(text) && namedMonth > 0 };
}

export interface StartTimeInput {
  /** The raw eight bytes of the startdate field, as text, padding included. */
  readonly rawStartDate: string;
  /** The raw eight bytes of the starttime field, as text. */
  readonly rawStartTime: string;
  /** From `parseRecordingId`. The only unambiguous four-digit year a file can carry. */
  readonly recordingIdDate: EdfCalendarDate | undefined;
}

/**
 * Build the whole `EdfStartTime`, including the cross-field resolution.
 *
 * The recording-identification date wins when both exist, because its year is unambiguous —
 * but a disagreement is always reported and both dates stay on the result, so no winner is
 * picked silently. `dateSource` says which one `resolvedDate` came from.
 */
export function resolveStartTime(input: StartTimeInput, sink: DiagnosticSink): EdfStartTime {
  const dateParse = parseHeaderStartDate(input.rawStartDate);
  const timeParse = parseHeaderStartTime(input.rawStartTime);
  const recordingIdDate = input.recordingIdDate;
  const dateOffset = HEADER_FIELDS.startDate.offset;

  if (dateParse.status === 'unparseable') {
    sink.report({
      code: 'DATE_UNPARSEABLE',
      message:
        `startdate field (8 bytes at offset ${dateOffset}) is ` +
        `${JSON.stringify(dateParse.raw)}, which is not a real date in dd.mm.yy form: the ` +
        'day must exist in that month of that year, and the month must be 01..12. EDF ' +
        'specification, header record bytes 168-175. Next: header.raw.startDate keeps the ' +
        'text verbatim, and startTime.recordingIdDate is used instead when the EDF+ ' +
        'recording identification carries a Startdate.',
      field: 'startDate',
      byteOffset: dateOffset,
      byteLength: HEADER_FIELDS.startDate.length,
      raw: dateParse.raw,
      expected: 'dd.mm.yy',
      actual: trimEdfField(dateParse.raw),
      specReference: 'EDF specification, header record bytes 168-175',
    });
  }

  if (dateParse.clippedYear && dateParse.date !== undefined) {
    sink.report({
      code: 'DATE_CLIPPED_TO_1985_2084',
      message:
        `startdate field (8 bytes at offset ${dateOffset}) is ` +
        `${JSON.stringify(dateParse.raw)}: its two-digit year was resolved to ` +
        `${dateParse.date.year} by the EDF+ rule that 85..99 mean 1985..1999 and 00..84 mean ` +
        '2000..2084, so the field cannot express a year outside that span. EDF+ additional ' +
        'specification 2 (1985 is the clipping date). Next: for an unambiguous year read ' +
        'startTime.recordingIdDate, which the EDF+ recording identification spells out in ' +
        'four digits.',
      field: 'startDate',
      byteOffset: dateOffset,
      byteLength: HEADER_FIELDS.startDate.length,
      raw: dateParse.raw,
      expected: '1985..2084',
      actual: String(dateParse.date.year),
      specReference: 'EDF+ additional specification 2 (startdate and starttime)',
    });
  }

  if (dateParse.status === 'yearEscape' && recordingIdDate === undefined) {
    sink.report({
      code: 'DATE_UNPARSEABLE',
      message:
        `startdate field (8 bytes at offset ${dateOffset}) is ` +
        `${JSON.stringify(dateParse.raw)}: the literal "yy" is the EDF+ escape for a ` +
        'recording after 2084, and it requires the year to be given by the Startdate ' +
        'subfield of the recording identification, which this file does not carry. EDF+ ' +
        'additional specifications 2 and 4. Next: the recording has no resolvable date; ' +
        'startTime.clock is still valid.',
      field: 'startDate',
      byteOffset: dateOffset,
      byteLength: HEADER_FIELDS.startDate.length,
      raw: dateParse.raw,
      expected: 'a Startdate subfield in the local recording identification',
      actual: trimEdfField(dateParse.raw),
      specReference: 'EDF+ additional specifications 2 and 4',
    });
  }

  const headerDate = dateParse.date;
  const disagrees =
    recordingIdDate !== undefined &&
    ((headerDate !== undefined && !calendarDatesEqual(headerDate, recordingIdDate)) ||
      // Under the escape the header still states a day and a month, and they must match.
      (dateParse.status === 'yearEscape' &&
        (dateParse.day !== recordingIdDate.day || dateParse.month !== recordingIdDate.month)));

  if (disagrees && recordingIdDate !== undefined) {
    const headerText =
      headerDate === undefined
        ? `day ${String(dateParse.day)}, month ${String(dateParse.month)}`
        : formatCalendarDate(headerDate);
    sink.report({
      code: 'DATE_FIELDS_DISAGREE',
      message:
        `startdate field (8 bytes at offset ${dateOffset}) is ` +
        `${JSON.stringify(dateParse.raw)}, i.e. ${headerText}, but the Startdate subfield of ` +
        `the local recording identification says ${formatCalendarDate(recordingIdDate)}. ` +
        'EDF+ additional specifications 2 and 4 both define the start of the recording, so ' +
        'the two must name the same day; when only the year differs the usual cause is that ' +
        'the dd.mm.yy field cannot express a year outside 1985..2084. Next: both are ' +
        'exposed as ' +
        'startTime.headerDate and startTime.recordingIdDate and edfcore picks no silent ' +
        'winner; resolvedDate is the four-digit recording-identification date, and ' +
        'dateSource says so.',
      field: 'startDate',
      byteOffset: dateOffset,
      byteLength: HEADER_FIELDS.startDate.length,
      raw: dateParse.raw,
      expected: formatCalendarDate(recordingIdDate),
      actual: headerText,
      specReference: 'EDF+ additional specifications 2 and 4',
    });
  }

  if (timeParse.clock === undefined) {
    // Its OWN code, not DATE_UNPARSEABLE. That code is emitted three other times, all of them
    // about the calendar date, and its documented meaning — repeated in `validation.md` and
    // `api-validate.md` — was "the file has no calendar date at all". Here the date may be
    // perfectly good and it is the clock that was refused, so a caller branching on the code
    // acted on the wrong half of the start time. 0.3.17 corrected the prose that described this
    // as one condition; this splits the condition (fixed in 0.3.27).
    //
    // "No calendar date at all" was itself too strong, and 0.3.107 corrected it everywhere:
    // DATE_UNPARSEABLE is about the 8-BYTE FIELD, which can be unreadable while the EDF+
    // recording-identification Startdate still supplies the date. What the code does say in every
    // case is that `startTime.headerDate` is undefined.
    sink.report({
      code: 'STARTTIME_UNPARSEABLE',
      message:
        `starttime field (8 bytes at offset ${HEADER_FIELDS.startTime.offset}) is ` +
        `${JSON.stringify(timeParse.raw)}, which is not a clock time in hh.mm.ss form with ` +
        'hour 00..23, minute 00..59 and second 00..59. EDF specification, header record ' +
        'bytes 176-183. Next: startTime.clock reports 00:00:00 because the type admits no ' +
        'absent clock; header.raw.startTime keeps the text verbatim, and every sample offset ' +
        'is relative to the recording start regardless.',
      field: 'startTime',
      byteOffset: HEADER_FIELDS.startTime.offset,
      byteLength: HEADER_FIELDS.startTime.length,
      raw: timeParse.raw,
      expected: 'hh.mm.ss',
      actual: trimEdfField(timeParse.raw),
      specReference: 'EDF specification, header record bytes 176-183',
    });
  }

  const clock = timeParse.clock ?? MIDNIGHT;
  const resolvedDate = recordingIdDate ?? headerDate;
  const dateSource: EdfStartTime['dateSource'] =
    recordingIdDate !== undefined
      ? 'recordingIdField'
      : headerDate !== undefined
        ? 'headerField'
        : 'none';

  return {
    headerDate,
    recordingIdDate,
    resolvedDate,
    dateSource,
    clock,
    clockSource: timeParse.clock === undefined ? 'none' : 'headerField',
    secondsSinceMidnight:
      clock.hour * SECONDS_PER_HOUR + clock.minute * SECONDS_PER_MINUTE + clock.second,
  };
}

/**
 * `'1951-08-02T09:00:00.000'` — no zone designator, because EDF has no zone.
 *
 * The milliseconds are always `.000`: the header stores whole seconds, and the sub-second start
 * of an EDF+ recording lives in record 0's timekeeping TAL, not here.
 */
export function formatStartTimeNaive(startTime: EdfStartTime): string | undefined {
  const date = startTime.resolvedDate;
  if (date === undefined) return undefined;
  // A refused clock has no timestamp either. `clock` is a substituted midnight in that case, and
  // returning `2019-03-11T00:00:00.000` for a file whose starttime field says `23.59.60` states a
  // wall-clock instant the file never gave — which is what this function exists to report, so
  // there is nothing left to return. `api-errors.md` already told readers this was the behaviour
  // under DATE_UNPARSEABLE; until 0.3.17 it was not.
  if (startTime.clockSource === 'none') return undefined;
  return `${formatCalendarDate(date)}T${formatClockTime(startTime.clock)}.000`;
}
