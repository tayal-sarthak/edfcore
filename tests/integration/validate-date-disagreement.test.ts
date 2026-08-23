/**
 * The ordinary date disagreement, through `validateHeader` rather than through the parser.
 *
 * `checkDates` in `validate.ts` reports `DATE_FIELDS_DISAGREE` from two arms: one for the EDF+
 * `yy` escape, where the header states a day and a month but no year, and one for the ordinary
 * case where both fields resolve to a full date and the dates differ. `resolveStartTime` in
 * `header/dates.ts` reports the same code from its own two arms, on the read path, and that is the
 * whole reason both exist — `validateHeader` is documented as standing on its own so a caller can
 * sweep a header it did not open, and 0.3.81 fixed it precisely because the escape arm was missing
 * from this copy and the two functions disagreed about the same file.
 *
 * Only the escape arm was ever run through `validateHeader`. The ordinary arm — the 1951-written-as-
 * 2051 case that the code was named for, the one every doc page uses as the example — reached
 * `resolveStartTime` in five tests and this function in none. Deleting the comparison here left the
 * suite green, because the header's own `diagnostics` still carried the code from the other file.
 *
 * So the discriminator matters: both messages name both dates, and the way to tell which function
 * produced one is its `specReference`. `validate.ts` cites specification 4 and names the field it
 * read; `dates.ts` cites specifications 2 and 4 and quotes the raw bytes. Asserting on the code
 * alone would pass on the parser's copy and prove nothing about this one.
 */

import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../src/header/parse.js';
import { validateHeader } from '../../src/validate.js';
import { minimalEdfPlus } from '../support/writer.js';

/** `validate.ts`'s arm cites this; the parser's arm cites "specifications 2 and 4". */
const FROM_VALIDATE = 'EDF+ additional specification 4 (local recording identification)';

function headerFor(startDate: string, startdateSubfield: string) {
  const bytes = minimalEdfPlus({
    startDate,
    recordingId: `Startdate ${startdateSubfield} Emergency05 NN Telemetry03`,
  });
  return parseHeader(bytes, bytes.byteLength);
}

describe('validateHeader on two dates that name different days', () => {
  it('reports the disagreement from its own arm, not the parser’s', () => {
    const header = headerFor('02.08.51', '02-AUG-1951');

    // The premise: this is the ORDINARY arm. The escape arm needs `headerDate` undefined, and
    // without this line a fixture that drifted into the escape would satisfy everything below.
    expect(header.startTime.headerDate).toEqual({ year: 2051, month: 8, day: 2 });
    expect(header.startTime.recordingIdDate).toEqual({ year: 1951, month: 8, day: 2 });

    const reported = validateHeader(header).filter((d) => d.code === 'DATE_FIELDS_DISAGREE');
    expect(reported.map((d) => d.specReference)).toEqual([FROM_VALIDATE]);
  });

  it('names both days, and says which one the header resolved to', () => {
    const header = headerFor('02.08.51', '02-AUG-1951');
    const [reported] = validateHeader(header).filter((d) => d.specReference === FROM_VALIDATE);

    // Both dates, spelled out: the whole point of the code is that a reader can see the pair.
    expect(reported?.expected).toBe('1951-08-02');
    expect(reported?.actual).toBe('2051-08-02');
    expect(reported?.message).toContain('resolves to 2051-08-02');
    expect(reported?.message).toContain('Startdate says 1951-08-02');
    // And the field it read, which is what makes this diagnostic actionable on a fixed-width header.
    expect(reported?.field).toBe('startDate');
    expect(reported?.byteOffset).toBe(168);
    expect(reported?.byteLength).toBe(8);
  });

  it('quotes the dateSource, because that is the only winner edfcore picks', () => {
    const header = headerFor('02.08.51', '02-AUG-1951');
    const [reported] = validateHeader(header).filter((d) => d.specReference === FROM_VALIDATE);

    // `"recordingIdField"` with the quotes: the message says what to read on the header, and
    // `dateSource` is a string union, so a reader comparing it needs the value as it is written.
    expect(header.startTime.dateSource).toBe('recordingIdField');
    expect(reported?.message).toContain('dateSource, which is "recordingIdField" here');
  });

  it('stays quiet when the two name the same day', () => {
    const header = headerFor('02.08.90', '02-AUG-1990');
    expect(header.startTime.headerDate).toEqual({ year: 1990, month: 8, day: 2 });
    expect(validateHeader(header).map((d) => d.code)).not.toContain('DATE_FIELDS_DISAGREE');
  });

  it('stays quiet when only one of the two states a date at all', () => {
    // No Startdate subfield, so there is nothing to compare and no defect to report. A guard
    // dropped from the `recordingIdDate !== undefined` half would fire here on every plain EDF+
    // file that leaves the identification blank, which is most of them.
    const header = headerFor('02.08.90', '');
    expect(header.startTime.recordingIdDate).toBeUndefined();
    expect(validateHeader(header).map((d) => d.code)).not.toContain('DATE_FIELDS_DISAGREE');
  });
});
