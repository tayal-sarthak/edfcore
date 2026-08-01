/**
 * `src/header/identification.ts` — the two EDF+ identification grammars.
 *
 * DESIGN.md section 5, offsets 8 and 88:
 *   - local patient identification: 4 space-separated subfields — code, `F`/`M`,
 *     `dd-MMM-yyyy` (CAPS, zero-padded), name. `X` = unknown.
 *   - local recording identification: `Startdate dd-MMM-yyyy <investigation> <technician>
 *     <equipment>`, and the only source of a four-digit year in the whole file.
 *
 * Plain EDF puts FREE TEXT in both fields, which is normal and not a defect. The two
 * `*_NONCONFORMANT` diagnostics must therefore fire only when the file carries an EDF+/BDF+
 * marker — the last describe block pins that, because it is the easiest thing to regress.
 */

import { describe, expect, it } from 'vitest';

import { DiagnosticSink } from '../../../src/diagnostics/collector.js';
import { parsePatientId, parseRecordingId } from '../../../src/header/identification.js';
import { parseHeader } from '../../../src/header/parse.js';
import type { EdfPatientId, EdfRecordingId } from '../../../src/types.js';
import { minimalEdf, minimalEdfPlus } from '../../support/writer.js';

interface Parsed<T> {
  readonly value: T;
  readonly codes: readonly string[];
}

function patient(raw: string, edfPlus = true): Parsed<EdfPatientId> {
  const sink = new DiagnosticSink();
  const value = parsePatientId(raw, { edfPlus }, sink);
  return { value, codes: sink.diagnostics.map((diagnostic) => diagnostic.code) };
}

function recording(raw: string, edfPlus = true): Parsed<EdfRecordingId> {
  const sink = new DiagnosticSink();
  const value = parseRecordingId(raw, { edfPlus }, sink);
  return { value, codes: sink.diagnostics.map((diagnostic) => diagnostic.code) };
}

/** An 80-byte field as it actually sits in the header: right-padded with spaces. */
function padded(text: string): string {
  return text.padEnd(80, ' ');
}

function codesOf(bytes: Uint8Array): readonly string[] {
  return parseHeader(bytes, bytes.byteLength).diagnostics.map((diagnostic) => diagnostic.code);
}

describe('the local patient identification', () => {
  it('reads the four subfields of a conforming field', () => {
    // The example from EDF+ additional specification 3.
    const { value, codes } = patient(padded('MCH-0234567 F 02-MAY-1951 Haagse_Harry'));
    expect(value.code).toBe('MCH-0234567');
    expect(value.sex).toBe('F');
    expect(value.birthDate).toEqual({ year: 1951, month: 5, day: 2 });
    expect(value.name).toBe('Haagse_Harry');
    expect(value.extraSubfields).toEqual([]);
    expect(value.conformant).toBe(true);
    expect(codes).toEqual([]);
  });

  it("reads 'M' as well as 'F', and nothing else", () => {
    expect(patient(padded('code M 02-MAY-1951 name')).value.sex).toBe('M');
    // Neither a spelt-out word nor a lowercase letter is the F/M the grammar names.
    expect(patient(padded('code Male 02-MAY-1951 name')).value.sex).toBeUndefined();
    expect(patient(padded('code f 02-MAY-1951 name')).value.sex).toBeUndefined();
    expect(patient(padded('code Q 02-MAY-1951 name')).value.sex).toBeUndefined();
  });

  it('keeps underscores verbatim, because a real underscore is indistinguishable', () => {
    // EDF+ says a space inside a subfield must be replaced and suggests '_', but mandates
    // neither the character nor a way back: 'Mac_Donald' and a substituted space look alike.
    expect(patient(padded('X F X Haagse_Harry')).value.name).toBe('Haagse_Harry');
    expect(patient(padded('X F X Mac_Donald')).value.name).toBe('Mac_Donald');
  });
});

describe("'X' means unknown in ANY subfield and becomes undefined", () => {
  it('maps every X to undefined, never to the string "X"', () => {
    const { value, codes } = patient(padded('X X X X'));
    expect(value.code).toBeUndefined();
    expect(value.sex).toBeUndefined();
    expect(value.birthDate).toBeUndefined();
    expect(value.name).toBeUndefined();
    // 'X X X X' is the fully-unknown but fully-conforming field, so it is not a defect.
    expect(value.conformant).toBe(true);
    expect(codes).toEqual([]);
  });

  it('maps X in one position without disturbing the others', () => {
    const { value } = patient(padded('MCH-0234567 X 02-MAY-1951 Haagse_Harry'));
    expect(value.code).toBe('MCH-0234567');
    expect(value.sex).toBeUndefined();
    expect(value.birthDate).toEqual({ year: 1951, month: 5, day: 2 });
    expect(value.name).toBe('Haagse_Harry');
    expect(value.conformant).toBe(true);
  });

  it('maps X in every recording-identification subfield to undefined', () => {
    const { value, codes } = recording(padded('Startdate X X X X'));
    expect(value.startDate).toBeUndefined();
    expect(value.investigationCode).toBeUndefined();
    expect(value.technicianCode).toBeUndefined();
    expect(value.equipmentCode).toBeUndefined();
    expect(value.conformant).toBe(true);
    expect(codes).toEqual([]);
  });

  it('does not treat a longer field beginning with X as unknown', () => {
    // Only the whole subfield 'X' is the placeholder.
    expect(patient(padded('XY F 02-MAY-1951 name')).value.code).toBe('XY');
    expect(recording(padded('Startdate X XRay X X')).value.investigationCode).toBe('XRay');
  });
});

describe('the local recording identification', () => {
  it('reads the five subfields of a conforming field', () => {
    // The example from EDF+ additional specification 4.
    const { value, codes } = recording(padded('Startdate 02-MAR-2002 Emergency05 NN Telemetry03'));
    expect(value.startDate).toEqual({ year: 2002, month: 3, day: 2 });
    expect(value.investigationCode).toBe('Emergency05');
    expect(value.technicianCode).toBe('NN');
    expect(value.equipmentCode).toBe('Telemetry03');
    expect(value.extraSubfields).toEqual([]);
    expect(value.conformant).toBe(true);
    expect(codes).toEqual([]);
  });

  it('is the only field in an EDF file that can carry a four-digit year', () => {
    expect(recording(padded('Startdate 02-AUG-1951 X X X')).value.startDate).toEqual({
      year: 1951,
      month: 8,
      day: 2,
    });
    expect(recording(padded('Startdate 02-AUG-2100 X X X')).value.startDate).toEqual({
      year: 2100,
      month: 8,
      day: 2,
    });
  });

  it('refuses to read a date that is not standing behind the Startdate keyword', () => {
    // The subfield is only meaningful in the position the grammar gives it; a date behind a
    // missing keyword is some other date, and reading it as the start would be a guess.
    const { value, codes } = recording(padded('Recording 02-MAR-2002 Emergency05 NN Tele03'));
    expect(value.startDate).toBeUndefined();
    expect(value.conformant).toBe(false);
    expect(codes).toEqual(['RECORDING_ID_NONCONFORMANT']);
  });

  it('accepts a misspelt-case keyword but marks the field non-conformant', () => {
    const { value, codes } = recording(padded('STARTDATE 02-MAR-2002 Emergency05 NN Tele03'));
    expect(value.startDate).toEqual({ year: 2002, month: 3, day: 2 });
    expect(value.conformant).toBe(false);
    expect(codes).toEqual(['RECORDING_ID_NONCONFORMANT']);
  });

  it('leaves the start date undefined when the date subfield cannot be read', () => {
    const { value, codes } = recording(padded('Startdate 2002-03-02 Emergency05 NN Tele03'));
    expect(value.startDate).toBeUndefined();
    expect(value.conformant).toBe(false);
    expect(codes).toEqual(['RECORDING_ID_NONCONFORMANT']);
  });
});

describe('subfields beyond the ones the spec names', () => {
  it('collects extra patient subfields rather than calling the field non-conformant', () => {
    // EDF+ says the field must START WITH its subfields, so trailing extras are legal.
    const { value, codes } = patient(padded('MCH-0234567 F 02-MAY-1951 Haagse_Harry left-handed'));
    expect(value.name).toBe('Haagse_Harry');
    expect(value.extraSubfields).toEqual(['left-handed']);
    expect(value.conformant).toBe(true);
    expect(codes).toEqual([]);
  });

  it('collects extra recording subfields the same way', () => {
    const { value, codes } = recording(
      padded('Startdate 02-MAR-2002 Emergency05 NN Telemetry03 room4 shift2'),
    );
    expect(value.equipmentCode).toBe('Telemetry03');
    expect(value.extraSubfields).toEqual(['room4', 'shift2']);
    expect(value.conformant).toBe(true);
    expect(codes).toEqual([]);
  });

  it('does not confuse a run of spaces for an empty subfield', () => {
    const { value } = patient(padded('code   F   02-MAY-1951   name'));
    expect(value.sex).toBe('F');
    expect(value.name).toBe('name');
    expect(value.extraSubfields).toEqual([]);
  });
});

describe('non-conforming text is reported and still preserved verbatim', () => {
  interface NonConformantCase {
    readonly behaviour: string;
    readonly raw: string;
  }

  const PATIENT_CASES: readonly NonConformantCase[] = [
    { behaviour: 'free text with fewer than four subfields', raw: 'John Doe' },
    { behaviour: 'a completely blank field', raw: '' },
    { behaviour: 'a sex that is not F or M', raw: 'code Q 02-MAY-1951 name' },
    { behaviour: 'a birthdate that is not dd-MMM-yyyy', raw: 'code F 1951-05-02 name' },
    { behaviour: 'a lowercase month in the birthdate', raw: 'code F 02-may-1951 name' },
    { behaviour: 'a two-digit year in the birthdate', raw: 'code F 02-MAY-51 name' },
  ];

  for (const { behaviour, raw } of PATIENT_CASES) {
    it(`marks ${behaviour} non-conformant and keeps the raw text`, () => {
      const { value, codes } = patient(padded(raw));
      expect(value.conformant).toBe(false);
      expect(codes).toEqual(['PATIENT_ID_NONCONFORMANT']);
      // Raw is the 80 bytes exactly as passed in, padding included: edfcore never destroys
      // evidence, and a field that failed its grammar is where that matters most.
      expect(value.raw).toBe(padded(raw));
      expect(value.raw).toHaveLength(80);
    });
  }

  it('still exposes every subfield it could read from a non-conforming field', () => {
    // A lowercase month is readable; the file is impolite, not unreadable.
    const { value } = patient(padded('MCH-0234567 F 02-may-1951 Haagse_Harry'));
    expect(value.conformant).toBe(false);
    expect(value.code).toBe('MCH-0234567');
    expect(value.sex).toBe('F');
    expect(value.birthDate).toEqual({ year: 1951, month: 5, day: 2 });
    expect(value.name).toBe('Haagse_Harry');
  });

  it('reports the field, the offset and the raw bytes on the diagnostic', () => {
    // DESIGN.md section 6: the message names the field, the raw bytes, the rule and a next step.
    const sink = new DiagnosticSink();
    parsePatientId(padded('John Doe'), { edfPlus: true }, sink);
    const reported = sink.diagnostics[0];
    expect(reported?.code).toBe('PATIENT_ID_NONCONFORMANT');
    expect(reported?.severity).toBe('warning');
    expect(reported?.field).toBe('patientId');
    expect(reported?.byteOffset).toBe(8);
    expect(reported?.byteLength).toBe(80);
    expect(reported?.raw).toBe(padded('John Doe'));
    expect(reported?.specReference).toContain('EDF+ additional specification 3');
  });

  it('reports the recording identification at its own offset', () => {
    const sink = new DiagnosticSink();
    parseRecordingId(padded('a routine EEG'), { edfPlus: true }, sink);
    const reported = sink.diagnostics[0];
    expect(reported?.code).toBe('RECORDING_ID_NONCONFORMANT');
    expect(reported?.field).toBe('recordingId');
    expect(reported?.byteOffset).toBe(88);
    expect(reported?.byteLength).toBe(80);
    expect(reported?.raw).toBe(padded('a routine EEG'));
    expect(reported?.specReference).toContain('EDF+ additional specification 4');
  });
});

describe('plain EDF has free text here, and that is not a defect', () => {
  // The most likely regression in this module: firing the EDF+ subfield diagnostics on a file
  // that never claimed EDF+. Under `strict` that would refuse a perfectly legal plain-EDF file.
  const FREE_TEXT: readonly string[] = ['John Doe', 'Sleep study, patient 17', '', 'a routine EEG'];

  for (const raw of FREE_TEXT) {
    it(`emits no patient diagnostic for ${JSON.stringify(raw)} without an EDF+ marker`, () => {
      const { value, codes } = patient(padded(raw), false);
      expect(codes).toEqual([]);
      // `conformant` is still set honestly — it describes the text, not the dialect.
      expect(value.conformant).toBe(false);
      expect(value.raw).toBe(padded(raw));
    });

    it(`emits no recording diagnostic for ${JSON.stringify(raw)} without an EDF+ marker`, () => {
      const { value, codes } = recording(padded(raw), false);
      expect(codes).toEqual([]);
      expect(value.conformant).toBe(false);
      expect(value.raw).toBe(padded(raw));
    });
  }

  it('stays silent on a whole plain-EDF file carrying free text', () => {
    const bytes = minimalEdf({
      patientId: 'John Doe',
      recordingId: 'a routine EEG in the sleep lab',
    });
    const codes = codesOf(bytes);
    expect(codes).not.toContain('PATIENT_ID_NONCONFORMANT');
    expect(codes).not.toContain('RECORDING_ID_NONCONFORMANT');
  });

  it('parses a plain-EDF file with free text even under strict', () => {
    // Nothing about free text in these two fields may throw when there is no EDF+ marker.
    const bytes = minimalEdf({
      patientId: 'John Doe',
      recordingId: 'a routine EEG in the sleep lab',
      startDate: '2.8.1990',
    });
    const header = parseHeader(bytes, bytes.byteLength, { strict: true });
    expect(header.patient.conformant).toBe(false);
    expect(header.patient.raw.trimEnd()).toBe('John Doe');
    expect(header.recording.conformant).toBe(false);
    expect(header.diagnostics).toEqual([]);
  });

  it('reports the same free text on an EDF+ file, where the grammar is required', () => {
    const bytes = minimalEdfPlus({
      patientId: 'John Doe',
      recordingId: 'a routine EEG in the sleep lab',
    });
    const codes = codesOf(bytes);
    expect(codes).toContain('PATIENT_ID_NONCONFORMANT');
    expect(codes).toContain('RECORDING_ID_NONCONFORMANT');
  });
});

describe('identification through a whole file', () => {
  it('exposes the parsed subfields and the raw 80-byte fields on the header', () => {
    const bytes = minimalEdfPlus({
      patientId: 'MCH-0234567 F 02-MAY-1951 Haagse_Harry',
      recordingId: 'Startdate 02-MAR-2002 Emergency05 NN Telemetry03',
      startDate: '02.03.02',
    });
    const header = parseHeader(bytes, bytes.byteLength);

    expect(header.patient.code).toBe('MCH-0234567');
    expect(header.patient.sex).toBe('F');
    expect(header.patient.birthDate).toEqual({ year: 1951, month: 5, day: 2 });
    expect(header.patient.name).toBe('Haagse_Harry');
    expect(header.patient.raw).toHaveLength(80);
    expect(header.recording.raw).toHaveLength(80);
    expect(header.raw.patientId).toBe(header.patient.raw);
    expect(header.raw.recordingId).toBe(header.recording.raw);

    // The Startdate subfield feeds the date resolution, and the two agree here.
    expect(header.startTime.recordingIdDate).toEqual({ year: 2002, month: 3, day: 2 });
    expect(header.startTime.dateSource).toBe('recordingIdField');
    expect(codesOf(bytes)).not.toContain('DATE_FIELDS_DISAGREE');
  });
});
