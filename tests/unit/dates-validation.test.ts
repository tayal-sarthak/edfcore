/**
 * Which date defect produces which code, pinned from both sides.
 *
 * `DATE_IMPLAUSIBLE` is documented as covering two conditions — a start date that is not a real
 * day, and a patient birthdate after the recording — with a note that only the second is reachable
 * in practice. That note was prose. This is the same claim as a test, because the reason it holds
 * is an INTERACTION between two modules: `resolveStartTime` refuses an impossible date outright
 * and leaves `resolvedDate` undefined, so `validateRecording`'s start-date branch never sees one.
 *
 * If that ever changes — if the parser starts resolving a best-effort date rather than refusing —
 * these tests are what says so, and the idle branch in `checkDates` becomes live rather than
 * silently staying dead while the docs claim otherwise.
 */

import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../src/header/parse.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfHeader } from '../../src/types.js';
import { validateHeader, validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

async function codesFor(spec: Parameters<typeof buildEdf>[0]) {
  const recording = await openEdf(byteSource(buildEdf(spec)));
  const report = await validateRecording(recording);
  return {
    recording,
    header: [...new Set(recording.header.diagnostics.map((d) => d.code))],
    validation: [...new Set(report.diagnostics.map((d) => d.code))],
  };
}

const BASE = {
  plus: 'C',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 4 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
} as const;

describe('a start date that names no real day', () => {
  it('is refused by the parser, so validation never sees an invalid resolved date', async () => {
    // 31 February. The parser reports DATE_UNPARSEABLE and resolves nothing, which is precisely
    // why validateRecording's own start-date branch cannot fire.
    const { recording, header, validation } = await codesFor({
      ...BASE,
      raw: { startDate: '31.02.20' },
    });

    expect(header).toContain('DATE_UNPARSEABLE');
    expect(recording.header.startTime.resolvedDate).toBeUndefined();
    expect(validation).toContain('DATE_UNPARSEABLE');
    expect(validation).not.toContain('DATE_IMPLAUSIBLE');
  });
});

describe('a patient birthdate after the recording', () => {
  it('is the reachable half of DATE_IMPLAUSIBLE', async () => {
    const { validation } = await codesFor({
      ...BASE,
      patientId: 'MCH-01 F 02-MAY-2099 Someone',
    });
    expect(validation).toContain('DATE_IMPLAUSIBLE');
  });

  it('says nothing for an ordinary birthdate', async () => {
    const { validation } = await codesFor({
      ...BASE,
      patientId: 'MCH-01 F 02-MAY-1951 Someone',
    });
    expect(validation).not.toContain('DATE_IMPLAUSIBLE');
  });
});

describe('validateHeader sees a refused wall clock', () => {
  /**
   * `validateHeader` is documented as independent of `header.diagnostics` — "running both costs
   * nothing and neither can mask the other" — so a caller taking the two-read, no-I/O path both
   * doc pages recommend saw NOTHING about a starttime field the parse had refused, and concluded
   * the header's timing fields were conformant while `startTime.clock` held a substituted
   * midnight the file never stated.
   *
   * 0.3.17 corrected the prose to describe this and 0.3.27 rewrote it again for the split code.
   * Both times the page described a check that was never added (fixed in 0.3.34).
   */
  function headerWith(startTime: string): EdfHeader {
    const bytes = buildEdf({
      recordCount: 2,
      recordDurationSeconds: 1,
      startDate: '11.03.19',
      signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 2 }],
      raw: { startTime },
    });
    return parseHeader(bytes, bytes.byteLength);
  }

  it('reports STARTTIME_UNPARSEABLE for a blank starttime with a good date', () => {
    const header = headerWith('        ');
    expect(header.startTime.clockSource).toBe('none');
    // The date is fine, so nothing about the date is reported.
    expect(header.startTime.dateSource).not.toBe('none');

    const diagnostic = validateHeader(header).find((d) => d.code === 'STARTTIME_UNPARSEABLE');
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.field).toBe('startTime');
    expect(diagnostic?.byteOffset).toBe(176);
    expect(diagnostic?.byteLength).toBe(8);
    expect(diagnostic?.severity).toBe('warning');
  });

  it('reports it for a clock that parses as digits but is not a time', () => {
    expect(
      validateHeader(headerWith('23.59.60')).some((d) => d.code === 'STARTTIME_UNPARSEABLE'),
    ).toBe(true);
  });

  it('says nothing about the clock when the file states a real one', () => {
    const header = headerWith('09.30.00');
    expect(header.startTime.clockSource).toBe('headerField');
    expect(validateHeader(header).some((d) => d.code === 'STARTTIME_UNPARSEABLE')).toBe(false);
  });
});
