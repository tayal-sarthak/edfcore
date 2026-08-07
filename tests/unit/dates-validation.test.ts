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
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
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
