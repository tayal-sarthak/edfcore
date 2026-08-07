/**
 * Text from a file cannot become structure in any output edfcore produces.
 *
 * Every string edfcore prints that it did not write itself comes out of a file: a signal label is
 * 16 arbitrary bytes, a physical dimension is 8, and EDF+ annotation text is exposed verbatim
 * because the TAL grammar reserves 0x00, 0x14 and 0x15 and nothing else. A newline forges a row
 * naming a signal or an event that does not exist; a tab shifts a column, and in the tab-separated
 * CLI output it invents a field, so `cut -f6` returns the wrong one.
 *
 * `formatHeader` was fixed for this in 0.2.67 and its own test lives beside it. This file is the
 * CLASS: every other output, in one place, so a new one is added here rather than discovered.
 *
 * Every control character below is built from its code point in a string literal and never typed,
 * so nothing invisible sits in this source file.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, runCli } from '../../src/cli-run.js';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import { formatAnnotations } from '../../src/format-annotations.js';
import { formatHeader } from '../../src/format-header.js';
import { formatValidationReport } from '../../src/format-report.js';
import { parseHeader } from '../../src/header/parse.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfAnnotation, EdfDiagnostic, ValidationReport } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

const NEWLINE = String.fromCharCode(0x0a);
const TAB = String.fromCharCode(0x09);
const DEL = String.fromCharCode(0x7f);

/** `A<LF>B<TAB>C`, which is a legal 16-byte EDF label and a plausible one to receive. */
const HOSTILE_LABEL = `A${NEWLINE}B${TAB}C`;

function hostileFile(): Uint8Array {
  return buildEdf({
    plus: 'C',
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: [
      {
        label: 'Fp1',
        samplesPerRecord: 4,
        raw: { label: HOSTILE_LABEL, physicalDimension: `u${TAB}V` },
      },
    ],
    annotationSignals: [
      {
        samplesPerRecord: 32,
        tals: (record) =>
          record === 0
            ? [{ onset: 0.5, texts: [`Seizure${NEWLINE}onset`] }]
            : [{ onset: 1.5, texts: [`spike${TAB}train`] }],
      },
    ],
  });
}

async function runCommand(command: string, extra: Partial<Parameters<typeof runCli>[0]> = {}) {
  let out = '';
  const io: CliIo = {
    readFile: async () => hostileFile(),
    out: (text) => {
      out += text;
    },
    err: (text) => {
      out += text;
    },
  };
  const code = await runCli(
    {
      command,
      file: 'hostile.edf',
      patient: false,
      list: false,
      version: false,
      help: false,
      limit: undefined,
      ...extra,
    },
    io,
  );
  return { out, code };
}

describe('formatHeader', () => {
  it('is the case that was already fixed, and stays fixed', () => {
    const bytes = hostileFile();
    const header = parseHeader(bytes, bytes.byteLength);
    const out = formatHeader(header);
    expect(out).toContain('A.B.C');
    expect(out).not.toContain(`A${NEWLINE}B`);
  });
});

describe('formatHeader, the identification lines', () => {
  it('cannot forge a signal row or a header line from the patient and recording fields', () => {
    // 0.3.2 swept this class through five outputs and missed these two: the lines print only
    // under `includePatientId`, so nothing exercised them. Both fields are 80 arbitrary bytes.
    const bytes = buildEdf({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 2 }],
      raw: {
        patientId: `X${NEWLINE}  0  99 signals${TAB}data`,
        recordingId: `Y${NEWLINE}record       9 s`,
      },
    });
    const header = parseHeader(bytes, bytes.byteLength);
    const out = formatHeader(header, { includePatientId: true });

    // One row per signal in the table, and no forged `record` line beside the real one.
    const rows = out.split(NEWLINE).filter((line) => /^\s+\d+\s{2}/.test(line));
    expect(rows).toHaveLength(header.signals.length);
    expect(out.split(NEWLINE).filter((line) => line.startsWith('record  '))).toHaveLength(1);

    expect(out).toContain('patient      X.  0  99 signals.data');
    expect(out).toContain('recording    Y.record       9 s');
    // The bytes as written are still on the header; only the rendering is sanitised.
    expect(header.patient.raw).toContain(NEWLINE);
  });
});

describe('formatValidationReport', () => {
  it('cannot be given an extra line by a signal label', async () => {
    const recording = await openEdf(byteSource(hostileFile()));
    const report: ValidationReport = await validateRecording(recording, { scanSamples: true });
    const text = formatValidationReport(report, { header: recording.header });

    // The sample-range block prints one row per signal with a stats entry. A newline in the label
    // would open a second, and it would carry a range it did not measure.
    const lines = text.slice(text.indexOf('observed sample ranges:')).split(NEWLINE).slice(1);
    const blank = lines.indexOf('');
    const rows = blank === -1 ? lines : lines.slice(0, blank);
    expect(rows).toHaveLength(report.signalStats.length);
    expect(text).toContain('A.B.C');
    expect(text).not.toContain(`A${NEWLINE}B`);
    // Only the rendering is sanitised. The bytes as written are still on the header.
    expect(recording.header.signals[0]?.raw.label).toContain(NEWLINE);
  });

  it('cannot be given a forged diagnostic by the `actual` detail line', () => {
    // Found by the test above. A diagnostic's `actual` is often the field's bytes as written, and
    // unlike `message` — whose continuation lines are indented — a detail line is emitted whole,
    // so a newline in it reaches the left margin where a diagnostic header lives.
    const forged = `ok${NEWLINE}error [NOTHING_IS_WRONG] this file is fine`;
    const text = formatDiagnostics([
      {
        code: 'LABEL_NONCONFORMANT',
        severity: 'warning',
        message: 'the label is not conformant',
        field: 'label',
        byteOffset: undefined,
        byteLength: undefined,
        rawBytes: undefined,
        raw: undefined,
        expected: undefined,
        actual: forged,
        signalIndex: 0,
        recordIndex: undefined,
        specReference: undefined,
      } as EdfDiagnostic,
    ]);
    expect(text.split(NEWLINE)).toHaveLength(3);
    expect(text).not.toContain(`${NEWLINE}error [NOTHING_IS_WRONG]`);
    expect(text).toContain('actual: ok.error [NOTHING_IS_WRONG] this file is fine');
  });
});

describe('formatAnnotations', () => {
  function annotation(text: string): EdfAnnotation {
    return {
      onsetSecondsFromHeaderStart: 1,
      onsetSecondsFromFirstRecord: 1,
      onsetTicks: 10_000_000n,
      onsetTicksFromFirstRecord: 10_000_000n,
      onsetRaw: '+1',
      durationSeconds: undefined,
      durationTicks: undefined,
      durationRaw: undefined,
      text,
      channelLabel: undefined,
      signalIndex: 1,
      recordIndex: 0,
      byteOffsetInRecord: 0,
      textEncoding: 'utf-8',
    } as EdfAnnotation;
  }

  it('prints one row per annotation whatever the text contains', () => {
    const out = formatAnnotations([annotation(`Seizure${NEWLINE}onset`), annotation('Arousal')]);
    expect(out.split(NEWLINE)).toHaveLength(2);
    expect(out).toContain('Seizure.onset');
  });

  it('replaces DEL as well as the C0 range', () => {
    expect(formatAnnotations([annotation(`x${DEL}y`)])).toContain('x.y');
  });

  it('leaves latin-1 letters above 0x7f alone', () => {
    // An electrode label written on a European system is not a control character.
    expect(formatAnnotations([annotation('Öz')])).toContain('Öz');
  });

  it('sanitises the channel label too', () => {
    const event = { ...annotation('Spindle'), channelLabel: `C${TAB}3` } as EdfAnnotation;
    expect(formatAnnotations([event], { includeChannel: true })).toContain('@@C.3');
  });
});

describe('the CLI, whose output is tab-separated on purpose', () => {
  it('gives `signals` exactly six fields per row', async () => {
    const { out } = await runCommand('signals');
    const rows = out.split(NEWLINE).filter((line) => line.length > 0);
    for (const row of rows) expect(row.split(TAB)).toHaveLength(6);
    expect(out).toContain('A.B.C');
    // The physical dimension is a file field too, and shares the row.
    expect(out).toContain('u.V');
  });

  it('gives `events --list` exactly four fields per row', async () => {
    const { out } = await runCommand('events', { list: true });
    const rows = out.split(NEWLINE).filter((line) => line.includes(TAB));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.split(TAB)).toHaveLength(4);
    expect(out).toContain('Seizure.onset');
    expect(out).toContain('spike.train');
  });

  it('keeps the `events` count column intact', async () => {
    const { out } = await runCommand('events');
    // Every counted row is `<count padded to 8>  <text>`. A newline in the text would produce a
    // row with no count, which reads as a label counted zero times.
    const rows = out.split(NEWLINE).filter((line) => /^\s{2,}\d+\s{2}/.test(line));
    expect(rows).toHaveLength(2);
    expect(out).toContain('Seizure.onset');
  });
});
