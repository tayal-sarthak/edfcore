/**
 * `src/header/dates.ts` — every date rule EDF has.
 *
 * The centrepiece is the 1985-2084 two-digit-year rule and the fact that no calendar arithmetic
 * here is allowed to roll an impossible date over into a plausible one. DESIGN.md section 5
 * (offsets 168 and 176) and section 6 (`DATE_CLIPPED_TO_1985_2084`, `DATE_FIELDS_DISAGREE`,
 * `DATE_UNPARSEABLE`) are the contract; the "`Date` in the API — Never" row of section 2 is
 * asserted structurally at the bottom of this file.
 */

import { describe, expect, it } from 'vitest';

import { DiagnosticSink } from '../../../src/diagnostics/collector.js';
import {
  formatStartTimeNaive,
  parseHeaderStartDate,
  parseHeaderStartTime,
  parseSubfieldDate,
  resolveStartTime,
  resolveTwoDigitYear,
} from '../../../src/header/dates.js';
import { parseHeader } from '../../../src/header/parse.js';
import type { EdfCalendarDate, EdfDiagnostic, EdfStartTime } from '../../../src/types.js';
import { minimalEdf, minimalEdfPlus } from '../../support/writer.js';

interface Resolved {
  readonly startTime: EdfStartTime;
  readonly codes: readonly string[];
  readonly diagnostics: readonly EdfDiagnostic[];
}

function resolve(
  rawStartDate: string,
  rawStartTime = '10.00.00',
  recordingIdDate: EdfCalendarDate | undefined = undefined,
): Resolved {
  const sink = new DiagnosticSink();
  const startTime = resolveStartTime({ rawStartDate, rawStartTime, recordingIdDate }, sink);
  const diagnostics = sink.diagnostics;
  return { startTime, diagnostics, codes: diagnostics.map((diagnostic) => diagnostic.code) };
}

function codesOf(bytes: Uint8Array): readonly string[] {
  return parseHeader(bytes, bytes.byteLength).diagnostics.map((diagnostic) => diagnostic.code);
}

describe('the 1985-2084 two-digit year rule', () => {
  interface YearCase {
    readonly behaviour: string;
    readonly raw: string;
    readonly date: EdfCalendarDate;
  }

  // EDF+ additional specification 2: yy 85..99 mean 1985..1999, yy 00..84 mean 2000..2084.
  const CASES: readonly YearCase[] = [
    {
      behaviour: "'01.01.85' is 1985, the first year the field can express",
      raw: '01.01.85',
      date: { year: 1985, month: 1, day: 1 },
    },
    {
      behaviour: "'31.12.84' is 2084, the last year the field can express",
      raw: '31.12.84',
      date: { year: 2084, month: 12, day: 31 },
    },
    {
      behaviour: "'31.12.99' stays in the twentieth century",
      raw: '31.12.99',
      date: { year: 1999, month: 12, day: 31 },
    },
    {
      behaviour: "'01.01.00' is 2000, not 1900",
      raw: '01.01.00',
      date: { year: 2000, month: 1, day: 1 },
    },
    {
      behaviour: "'02.08.51' is 2051, so a 1951 recording needs the recording-id Startdate",
      raw: '02.08.51',
      date: { year: 2051, month: 8, day: 2 },
    },
  ];

  for (const { behaviour, raw, date } of CASES) {
    it(behaviour, () => {
      const parsed = parseHeaderStartDate(raw);
      expect(parsed.status).toBe('parsed');
      expect(parsed.date).toEqual(date);
      expect(parsed.clippedYear).toBe(true);
      expect(parsed.conformant).toBe(true);
    });
  }

  it('pivots at 85 on both sides in one step', () => {
    expect(resolveTwoDigitYear(84)).toBe(2084);
    expect(resolveTwoDigitYear(85)).toBe(1985);
    expect(resolveTwoDigitYear(0)).toBe(2000);
    expect(resolveTwoDigitYear(99)).toBe(1999);
  });

  it('numbers months from 1, not from 0 as a JavaScript Date would', () => {
    // A Date-backed implementation reports August as 7. `EdfCalendarDate.month` is 1-12.
    expect(parseHeaderStartDate('02.08.51').date?.month).toBe(8);
    expect(parseHeaderStartDate('01.01.85').date?.month).toBe(1);
    expect(parseHeaderStartDate('31.12.84').date?.month).toBe(12);
  });

  it('reports DATE_CLIPPED_TO_1985_2084 so the caller knows the span is bounded', () => {
    const { startTime, codes } = resolve('02.08.51');
    expect(codes).toEqual(['DATE_CLIPPED_TO_1985_2084']);
    expect(startTime.headerDate).toEqual({ year: 2051, month: 8, day: 2 });
  });

  it('does not clip a year the writer spelled out in four digits', () => {
    // A writer that spells the year out is unambiguous, and the two-digit rule would be a
    // downgrade — so no clipping diagnostic and no 1985..2084 ceiling.
    const parsed = parseHeaderStartDate('2.8.1951');
    expect(parsed.date).toEqual({ year: 1951, month: 8, day: 2 });
    expect(parsed.clippedYear).toBe(false);
    expect(resolve('2.8.1951').codes).toEqual([]);
  });

  it('refuses a three-digit year, which is corruption rather than a convention', () => {
    expect(parseHeaderStartDate('02.08.195').status).toBe('unparseable');
  });
});

describe('an impossible calendar date is refused, never rolled over', () => {
  // THE BUG CLASS THIS TEST EXISTS FOR: `new Date(1999, 1, 31)` is 3 March 1999. Any
  // implementation that reaches for a Date, or that adds days without checking the month
  // length, turns a corrupt field into a plausible date that no diagnostic ever mentions.
  const IMPOSSIBLE: readonly string[] = [
    '31.02.99', // 31 February — the canonical rollover-to-3-March case
    '29.02.99', // 1999 is not a leap year
    '31.04.20', // April has 30 days
    '32.01.20', // no month has 32 days
    '00.01.20', // days are 1-based
    '01.13.20', // months are 1..12
    '01.00.20', // month 0 is a JavaScript index, not an EDF month
  ];

  for (const raw of IMPOSSIBLE) {
    it(`refuses '${raw}' outright instead of producing a nearby date`, () => {
      const parsed = parseHeaderStartDate(raw);
      expect(parsed.status).toBe('unparseable');
      expect(parsed.date).toBeUndefined();

      const { startTime, codes } = resolve(raw);
      expect(codes).toContain('DATE_UNPARSEABLE');
      expect(startTime.headerDate).toBeUndefined();
      expect(startTime.resolvedDate).toBeUndefined();
      expect(startTime.dateSource).toBe('none');
    });
  }

  it('accepts 29 February in a leap year and refuses it in a common one', () => {
    // 2000 is a leap year (divisible by 400); 1900 would not be, and cannot be expressed here.
    expect(parseHeaderStartDate('29.02.00').date).toEqual({ year: 2000, month: 2, day: 29 });
    expect(parseHeaderStartDate('29.02.04').date).toEqual({ year: 2004, month: 2, day: 29 });
    expect(parseHeaderStartDate('29.02.99').status).toBe('unparseable');
  });

  it('exposes the raw bytes of a date it refused', () => {
    // DESIGN.md section 6: every message names the field and the raw bytes as written.
    const { diagnostics } = resolve('31.02.99');
    const reported = diagnostics.find((diagnostic) => diagnostic.code === 'DATE_UNPARSEABLE');
    expect(reported?.field).toBe('startDate');
    expect(reported?.byteOffset).toBe(168);
    expect(reported?.byteLength).toBe(8);
    expect(reported?.raw).toBe('31.02.99');
    expect(reported?.severity).toBe('warning');
  });
});

describe('tolerated separators and stray spaces', () => {
  // The EDF FAQ shows ' 2. 8.51' in the wild; ':', '-' and '/' all occur too. These parse,
  // and are marked non-conformant rather than refused.
  const TOLERATED: readonly string[] = ['02:08:51', '02-08-51', '02/08/51', ' 2. 8.51', '2.8.51'];

  for (const raw of TOLERATED) {
    it(`reads '${raw}' as 2 August 2051 and marks it non-conformant`, () => {
      const parsed = parseHeaderStartDate(raw);
      expect(parsed.status).toBe('parsed');
      expect(parsed.date).toEqual({ year: 2051, month: 8, day: 2 });
      expect(parsed.conformant).toBe(false);
    });

    it(`warns rather than failing on '${raw}'`, () => {
      const { codes, diagnostics } = resolve(raw);
      expect(codes).not.toContain('DATE_UNPARSEABLE');
      // The only note is the two-digit-year rule, which is informational: applying the
      // spec's own 1985-2084 mapping is correct behaviour, not a defect.
      expect(codes).toEqual(['DATE_CLIPPED_TO_1985_2084']);
      for (const diagnostic of diagnostics) expect(diagnostic.severity).toBe('info');
    });
  }

  it("marks exactly 'dd.mm.yy' conformant", () => {
    expect(parseHeaderStartDate('02.08.51').conformant).toBe(true);
    expect(parseHeaderStartDate('02.08.yy').conformant).toBe(true);
  });

  it('refuses a field that does not hold three parts at all', () => {
    for (const raw of ['        ', '02.08', '02.08.51.99', 'not a date']) {
      expect(parseHeaderStartDate(raw).status).toBe('unparseable');
    }
  });
});

describe("the literal 'yy' escape past 2084", () => {
  it('reports a year escape while still stating the day and the month', () => {
    const parsed = parseHeaderStartDate('02.08.yy');
    expect(parsed.status).toBe('yearEscape');
    expect(parsed.date).toBeUndefined();
    expect(parsed.day).toBe(2);
    expect(parsed.month).toBe(8);
    expect(parsed.clippedYear).toBe(false);
  });

  it('falls through to the recording-id Startdate for the year', () => {
    // EDF+ additional specifications 2 and 4: the four-digit Startdate subfield is the only
    // way to express a year outside 1985..2084.
    const { startTime, codes } = resolve('02.08.yy', '10.00.00', { year: 2100, month: 8, day: 2 });
    expect(startTime.resolvedDate).toEqual({ year: 2100, month: 8, day: 2 });
    expect(startTime.dateSource).toBe('recordingIdField');
    expect(startTime.headerDate).toBeUndefined();
    expect(codes).toEqual([]);
  });

  it('reports DATE_UNPARSEABLE when nothing supplies the year', () => {
    const { startTime, codes } = resolve('02.08.yy');
    expect(codes).toEqual(['DATE_UNPARSEABLE']);
    expect(startTime.resolvedDate).toBeUndefined();
    expect(startTime.dateSource).toBe('none');
  });

  it('still checks the day and month it does state against the Startdate', () => {
    const { codes } = resolve('02.08.yy', '10.00.00', { year: 2100, month: 9, day: 2 });
    expect(codes).toContain('DATE_FIELDS_DISAGREE');
  });

  it('refuses a day that is impossible in that month even without a year', () => {
    // The year is unknown, so the day is checked against the longest that month ever gets.
    expect(parseHeaderStartDate('31.02.yy').status).toBe('unparseable');
    expect(parseHeaderStartDate('29.02.yy').status).toBe('yearEscape');
  });
});

describe('two dates that disagree', () => {
  it('exposes both, picks no silent winner, and says which one it used', () => {
    // The canonical case: 'dd.mm.yy' cannot express 1951, so it says 2051 while the EDF+
    // recording identification spells the real year out.
    const { startTime, codes } = resolve('02.08.51', '09.00.00', { year: 1951, month: 8, day: 2 });
    expect(codes).toContain('DATE_FIELDS_DISAGREE');
    expect(startTime.headerDate).toEqual({ year: 2051, month: 8, day: 2 });
    expect(startTime.recordingIdDate).toEqual({ year: 1951, month: 8, day: 2 });
    expect(startTime.resolvedDate).toEqual({ year: 1951, month: 8, day: 2 });
    expect(startTime.dateSource).toBe('recordingIdField');
  });

  it('names both dates in the diagnostic', () => {
    const { diagnostics } = resolve('02.08.51', '09.00.00', { year: 1951, month: 8, day: 2 });
    const reported = diagnostics.find((d) => d.code === 'DATE_FIELDS_DISAGREE');
    expect(reported?.expected).toBe('1951-08-02');
    expect(reported?.actual).toBe('2051-08-02');
    expect(reported?.field).toBe('startDate');
    expect(reported?.byteOffset).toBe(168);
  });

  it('stays quiet when the two agree', () => {
    const { startTime, codes } = resolve('02.08.90', '09.00.00', { year: 1990, month: 8, day: 2 });
    expect(codes).not.toContain('DATE_FIELDS_DISAGREE');
    expect(startTime.dateSource).toBe('recordingIdField');
    expect(startTime.resolvedDate).toEqual({ year: 1990, month: 8, day: 2 });
  });

  it("reports 'headerField' when only the header carries a date", () => {
    const { startTime } = resolve('02.08.90');
    expect(startTime.dateSource).toBe('headerField');
    expect(startTime.recordingIdDate).toBeUndefined();
    expect(startTime.resolvedDate).toEqual({ year: 1990, month: 8, day: 2 });
  });

  it("reports 'none' when neither field yields a date", () => {
    const { startTime } = resolve('31.02.99');
    expect(startTime.dateSource).toBe('none');
    expect(startTime.resolvedDate).toBeUndefined();
  });

  it('surfaces the disagreement through parseHeader on a real EDF+ file', () => {
    const bytes = minimalEdfPlus({
      startDate: '02.08.51',
      recordingId: 'Startdate 02-AUG-1951 Emergency05 NN Telemetry03',
    });
    const header = parseHeader(bytes, bytes.byteLength);
    const codes = header.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain('DATE_FIELDS_DISAGREE');
    expect(codes).toContain('DATE_CLIPPED_TO_1985_2084');
    expect(header.startTime.headerDate).toEqual({ year: 2051, month: 8, day: 2 });
    expect(header.startTime.recordingIdDate).toEqual({ year: 1951, month: 8, day: 2 });
    expect(header.startTime.dateSource).toBe('recordingIdField');
  });
});

describe('the hh.mm.ss clock', () => {
  interface ClockCase {
    readonly behaviour: string;
    readonly raw: string;
    readonly clock: { hour: number; minute: number; second: number } | undefined;
    readonly seconds: number;
  }

  const CASES: readonly ClockCase[] = [
    {
      behaviour: "'00.00.00' is a valid midnight, not a missing time",
      raw: '00.00.00',
      clock: { hour: 0, minute: 0, second: 0 },
      seconds: 0,
    },
    {
      behaviour: "'23.59.59' is the last second of the day",
      raw: '23.59.59',
      clock: { hour: 23, minute: 59, second: 59 },
      seconds: 86399,
    },
    {
      behaviour: "'09.30.15' is read as nine thirty and fifteen seconds",
      raw: '09.30.15',
      clock: { hour: 9, minute: 30, second: 15 },
      seconds: 34215,
    },
    { behaviour: "'24.00.00' has no hour 24", raw: '24.00.00', clock: undefined, seconds: 0 },
    { behaviour: "'12.60.00' has no minute 60", raw: '12.60.00', clock: undefined, seconds: 0 },
    {
      // EDF has no field that could express a leap second, and none is expected.
      behaviour: "'12.00.60' has no second 60",
      raw: '12.00.60',
      clock: undefined,
      seconds: 0,
    },
    { behaviour: 'a blank starttime is not a time', raw: '        ', clock: undefined, seconds: 0 },
  ];

  for (const { behaviour, raw, clock, seconds } of CASES) {
    it(behaviour, () => {
      expect(parseHeaderStartTime(raw).clock).toEqual(clock);

      const resolved = resolve('02.08.90', raw);
      expect(resolved.startTime.secondsSinceMidnight).toBe(seconds);
      if (clock === undefined) {
        // STARTTIME_UNPARSEABLE, not DATE_UNPARSEABLE. The date here is perfectly good; only the
        // clock was refused, and one code for both meant a caller branching on it acted on the
        // wrong half of the start time (split in 0.3.27).
        expect(resolved.codes).toContain('STARTTIME_UNPARSEABLE');
        expect(resolved.codes).not.toContain('DATE_UNPARSEABLE');
        expect(resolved.startTime.clockSource).toBe('none');
        expect(resolved.startTime.resolvedDate).toBeDefined();
      } else {
        expect(resolved.codes).not.toContain('STARTTIME_UNPARSEABLE');
        expect(resolved.codes).not.toContain('DATE_UNPARSEABLE');
        expect(resolved.startTime.clockSource).toBe('headerField');
      }
    });
  }

  it('distinguishes a real midnight from a fallback midnight by the diagnostic alone', () => {
    // Both report 00:00:00, because the type admits no absent clock. The difference has to be
    // visible somewhere, and that somewhere is `diagnostics`.
    // A four-digit year keeps the clipping warning out of the way, so the clock is the only
    // thing either result can be reporting.
    const real = resolve('2.8.1990', '00.00.00');
    const fallback = resolve('2.8.1990', '24.00.00');
    expect(real.startTime.clock).toEqual(fallback.startTime.clock);
    expect(real.codes).toEqual([]);
    expect(fallback.codes).toEqual(['STARTTIME_UNPARSEABLE']);
    expect(fallback.diagnostics.find((d) => d.code === 'STARTTIME_UNPARSEABLE')?.field).toBe(
      'startTime',
    );
    // And the structured field says the same thing without reading a message.
    expect(real.startTime.clockSource).toBe('headerField');
    expect(fallback.startTime.clockSource).toBe('none');
  });

  it('tolerates stray spaces in the clock too', () => {
    expect(parseHeaderStartTime(' 9. 5. 0').clock).toEqual({ hour: 9, minute: 5, second: 0 });
    expect(parseHeaderStartTime(' 9. 5. 0').conformant).toBe(false);
    expect(parseHeaderStartTime('09.05.00').conformant).toBe(true);
  });
});

describe('the dd-MMM-yyyy subfield date', () => {
  it("reads '02-AUG-1951' and marks it conformant", () => {
    const parsed = parseSubfieldDate('02-AUG-1951');
    expect(parsed.date).toEqual({ year: 1951, month: 8, day: 2 });
    expect(parsed.conformant).toBe(true);
  });

  it('never applies the two-digit rule here, because this field exists to be unambiguous', () => {
    // EDF+ additional specification 4: the recording-id Startdate is the only four-digit year
    // in the file. Accepting '51' would throw away the one thing the field is for.
    expect(parseSubfieldDate('02-AUG-51').date).toBeUndefined();
    expect(parseSubfieldDate('02-AUG-951').date).toBeUndefined();
  });

  it('reads a lowercase or numeric month but marks it non-conformant', () => {
    expect(parseSubfieldDate('02-aug-1951').date).toEqual({ year: 1951, month: 8, day: 2 });
    expect(parseSubfieldDate('02-aug-1951').conformant).toBe(false);
    expect(parseSubfieldDate('02-08-1951').date).toEqual({ year: 1951, month: 8, day: 2 });
    expect(parseSubfieldDate('02-08-1951').conformant).toBe(false);
  });

  it('refuses an impossible day here as well', () => {
    expect(parseSubfieldDate('31-FEB-1951').date).toBeUndefined();
    expect(parseSubfieldDate('29-FEB-1951').date).toBeUndefined();
    expect(parseSubfieldDate('29-FEB-1952').date).toEqual({ year: 1952, month: 2, day: 29 });
  });

  it('refuses a month name that is not one of the twelve', () => {
    expect(parseSubfieldDate('02-AUGUST-1951').date).toBeUndefined();
    expect(parseSubfieldDate('02-XXX-1951').date).toBeUndefined();
  });
});

describe('no JavaScript Date is ever produced', () => {
  /**
   * DESIGN.md section 2, "`Date` in the API — Never": EDF stores local time at the patient with
   * no timezone, so a `Date` would silently apply the reader's zone and be worst exactly at DST
   * boundaries. This walks the whole result rather than naming fields, so a `Date` appearing
   * anywhere in a future refactor fails here.
   */
  function assertNoDate(value: unknown, path: string, seen: Set<object>): void {
    if (value === null || typeof value !== 'object') return;
    expect(value instanceof Date, `${path} is a JavaScript Date`).toBe(false);
    if (seen.has(value)) return;
    seen.add(value);
    if (ArrayBuffer.isView(value)) return;
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        assertNoDate(value[index], `${path}[${index}]`, seen);
      }
      return;
    }
    for (const [key, child] of Object.entries(value)) assertNoDate(child, `${path}.${key}`, seen);
  }

  it('returns plain calendar and clock structs from resolveStartTime', () => {
    const { startTime } = resolve('02.08.51', '09.00.00', { year: 1951, month: 8, day: 2 });
    assertNoDate(startTime, 'startTime', new Set());
    expect(Object.keys(startTime.clock).sort()).toEqual(['hour', 'minute', 'second']);
    const resolved = startTime.resolvedDate;
    expect(resolved).toBeDefined();
    if (resolved !== undefined) {
      expect(Object.keys(resolved).sort()).toEqual(['day', 'month', 'year']);
    }
  });

  it('returns no Date anywhere in a parsed header', () => {
    const bytes = minimalEdfPlus();
    assertNoDate(parseHeader(bytes, bytes.byteLength), 'header', new Set());
  });

  it('formats a start time with no zone designator', () => {
    // "1951-08-02T09:00:00.000" — no Z, no +hh:mm, because EDF has no zone to name.
    const { startTime } = resolve('02.08.51', '09.00.00', { year: 1951, month: 8, day: 2 });
    const formatted = formatStartTimeNaive(startTime);
    expect(formatted).toBe('1951-08-02T09:00:00.000');
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(formatted).not.toContain('Z');
    expect(formatted).not.toContain('+');
  });

  it('formats nothing at all when no date resolved', () => {
    expect(formatStartTimeNaive(resolve('31.02.99').startTime)).toBeUndefined();
  });

  it('always reports .000 milliseconds, because the header stores whole seconds', () => {
    const { startTime } = resolve('01.01.85', '23.59.59');
    expect(formatStartTimeNaive(startTime)).toBe('1985-01-01T23:59:59.000');
  });
});

describe('date handling through a whole file', () => {
  it('reports the clipping warning for the writer default of 01.01.20', () => {
    const bytes = minimalEdf();
    expect(codesOf(bytes)).toContain('DATE_CLIPPED_TO_1985_2084');
    expect(parseHeader(bytes, bytes.byteLength).startTime.resolvedDate).toEqual({
      year: 2020,
      month: 1,
      day: 1,
    });
  });

  it('keeps the startdate bytes verbatim on header.raw even when they do not parse', () => {
    const bytes = minimalEdf({ startDate: '31.02.99' });
    const header = parseHeader(bytes, bytes.byteLength);
    expect(header.raw.startDate).toBe('31.02.99');
    expect(header.startTime.resolvedDate).toBeUndefined();
    expect(codesOf(bytes)).toContain('DATE_UNPARSEABLE');
  });

  it('is fatal under strict, where the first would-be diagnostic throws', () => {
    // Strict throws on the first would-be diagnostic whose severity is not `info`, and
    // DATE_UNPARSEABLE is a warning, so it throws rather than being collected.
    const bytes = minimalEdf({ startDate: '31.02.99' });
    expect(() => parseHeader(bytes, bytes.byteLength, { strict: true })).toThrow();
  });
});
