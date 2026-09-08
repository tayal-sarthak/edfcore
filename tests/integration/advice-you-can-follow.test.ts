/**
 * `DATE_CLIPPED_TO_1985_2084`'s advice, followed — which it could not be, on any file.
 *
 * The clause said "for an unambiguous year read `startTime.recordingIdDate`, which the EDF+
 * recording identification spells out in four digits". Resolution runs the other way. The
 * recording-identification date WINS when both are readable, so:
 *
 * - a file that carries one has already resolved to it. `dateSource` is `"recordingIdField"` and
 *   `resolvedDate` IS the four-digit year, so the reader is told to go and do what edfcore did;
 * - a file that carries none has `recordingIdDate === undefined`, so the reader is sent to a field
 *   with nothing in it.
 *
 * Those are the only two cases there are, which is why this is not a wording quibble: the clause
 * was wrong on every file that earns the diagnostic. Four of the seven files in the test corpus are
 * the first case and three are the second.
 *
 * `the-advice-works.test.ts` covers the same property for refusals — provoke it, read the clause
 * off the message, do what it says. It could not reach this one, because a diagnostic is reported
 * rather than thrown, and nothing was checking those.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfDiagnostic, EdfStartTime } from '../../src/types.js';
import { setHeaderField } from '../support/corrupt.js';
import { buildEdf } from '../support/writer.js';

/** `85..99` are 1985..1999 and `00..84` are 2000..2084, so any two-digit year is clipped. */
const base = (recording?: string): Uint8Array =>
  buildEdf({
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    ...(recording === undefined ? {} : { recordingId: recording }),
  });

const WITH_A_STARTDATE = base('Startdate 01-JAN-2020 X X X');
const WITHOUT_ONE = setHeaderField(
  base('an ordinary free-text recording note'),
  'startDate',
  '01.01.20',
);

async function clipped(bytes: Uint8Array): Promise<{
  diagnostic: EdfDiagnostic;
  startTime: EdfStartTime;
}> {
  const recording = await openEdf(byteSource(bytes));
  const diagnostic = recording.header.diagnostics.find(
    (one) => one.code === 'DATE_CLIPPED_TO_1985_2084',
  );
  expect(diagnostic).toBeDefined();
  return { diagnostic: diagnostic as EdfDiagnostic, startTime: recording.header.startTime };
}

const adviceOf = (diagnostic: EdfDiagnostic): string => {
  const at = diagnostic.message.indexOf('Next:');
  expect(at, diagnostic.message).toBeGreaterThan(-1);
  return diagnostic.message.slice(at);
};

describe('both files earn the diagnostic', () => {
  it('so neither branch is reached by a file that never sees it', async () => {
    expect((await clipped(WITH_A_STARTDATE)).diagnostic.code).toBe('DATE_CLIPPED_TO_1985_2084');
    expect((await clipped(WITHOUT_ONE)).diagnostic.code).toBe('DATE_CLIPPED_TO_1985_2084');
  });

  it('and they differ in the one field the advice turns on', async () => {
    expect((await clipped(WITH_A_STARTDATE)).startTime.recordingIdDate).toBeDefined();
    expect((await clipped(WITHOUT_ONE)).startTime.recordingIdDate).toBeUndefined();
  });
});

describe('when the file carries a four-digit year', () => {
  it('says the date is already resolved from it, rather than sending the reader to fetch it', async () => {
    const { diagnostic, startTime } = await clipped(WITH_A_STARTDATE);
    expect(adviceOf(diagnostic)).toContain('already that four-digit year');
    // Following the old advice meant reading a field whose value edfcore had already used.
    expect(startTime.dateSource).toBe('recordingIdField');
    expect(startTime.resolvedDate?.year).toBe(2020);
    expect(startTime.recordingIdDate?.year).toBe(2020);
  });

  it('names the source the reader can check, and it is the one on the object', async () => {
    const { diagnostic, startTime } = await clipped(WITH_A_STARTDATE);
    expect(adviceOf(diagnostic)).toContain('"recordingIdField"');
    expect(startTime.dateSource).toBe('recordingIdField');
  });
});

describe('when the file carries none', () => {
  it('says so, rather than naming a field that is undefined', async () => {
    const { diagnostic, startTime } = await clipped(WITHOUT_ONE);
    const advice = adviceOf(diagnostic);
    expect(advice).toContain('no four-digit year to fall back on');
    expect(startTime.recordingIdDate).toBeUndefined();
    // Following the old advice on this file produced `undefined` and no explanation.
    expect(advice).not.toContain('for an unambiguous year read startTime.recordingIdDate');
  });

  it('leaves the clipped year as the date, which is what the clause now says', async () => {
    const { startTime } = await clipped(WITHOUT_ONE);
    expect(startTime.dateSource).toBe('headerField');
    expect(startTime.resolvedDate?.year).toBe(2020);
  });
});

describe('what did not change', () => {
  it('is the code, the evidence and the spec reference', async () => {
    const { diagnostic } = await clipped(WITHOUT_ONE);
    expect(diagnostic.code).toBe('DATE_CLIPPED_TO_1985_2084');
    expect(diagnostic.severity).toBe('info');
    expect(diagnostic.field).toBe('startDate');
    expect(diagnostic.byteOffset).toBe(168);
    expect(diagnostic.expected).toBe('1985..2084');
    expect(diagnostic.actual).toBe('2020');
    expect(diagnostic.specReference).toContain('EDF+ additional specification 2');
  });

  it('is the sentence before the clause, which both branches still share', async () => {
    for (const bytes of [WITH_A_STARTDATE, WITHOUT_ONE]) {
      const { diagnostic } = await clipped(bytes);
      expect(diagnostic.message).toContain('85..99 mean 1985..1999 and 00..84 mean 2000..2084');
    }
  });
});
