/**
 * The three option tables on `api-helpers.md`, and the defaults they promise.
 *
 * "Each formatter's second argument has a name, exported from the same entry as the function. You
 * need it to build one of these ahead of the call, or to accept one in a wrapper of your own." Then
 * three tables: `FormatHeaderOptions`, `FormatAnnotationsOptions`, `FormatReportOptions`, seven
 * fields with a stated default each.
 *
 * A default is the part of an option nobody passes and everybody depends on, and one of these had
 * never appeared in a test at all. `diagnosticsHint` defaults to `true` and appends "Call
 * formatDiagnostics(header.diagnostics) for the detail" under the counts; `edfcore header` turns it
 * off because it is already printing that detail. Both halves — that it is on by default, and that
 * turning it off removes exactly that line — were documented in two places and asserted in none.
 *
 * The page argues about two of them together: "The two defaults point opposite ways on purpose.
 * `includePatientId` withholds until asked, because the cost of forgetting is a person's name in an
 * issue tracker. `diagnosticsHint` prints until told not to, because the cost of forgetting is one
 * redundant line." That is a claim about a pair, so it is asserted as a pair.
 *
 * The hypnogram transcript above the tables is run with them, since it is the same formatter at its
 * defaults: two rows, one with a duration and one without, and the column the missing duration
 * leaves blank. `08:30:30.000` is 30,630 seconds — past the point where a clock built from float
 * seconds starts losing milliseconds, which is the paragraph under it.
 *
 * What this does NOT check: the clock's own arithmetic, the 24-hour rule, or negative onsets. Those
 * are `format-annotations.test.ts`. This is about what happens when the second argument is absent.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatAnnotations } from '../../src/format-annotations.js';
import { formatHeader } from '../../src/format-header.js';
import { formatValidationReport } from '../../src/format-report.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import type { EdfAnnotation, EdfRecording } from '../../src/types.js';
import { type ValidationReport, validateRecording } from '../../src/validate.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('api-helpers.md') ?? '';

/** Free text rather than the four EDF+ subfields, so the report quotes it and can redact it. */
const PATIENT = 'Haagse Harry';

/** The page's hypnogram: one event with no duration at t = 0, one at 08:30:30 lasting two minutes. */
const BYTES = buildEdf({
  plus: 'C',
  recordCount: 3,
  recordDurationSeconds: 1,
  patientId: PATIENT,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 8 }],
  annotationSignals: [
    {
      samplesPerRecord: 60,
      tals: (record) =>
        record === 0
          ? [
              { onset: '+0', texts: ['Sleep stage W'] },
              { onset: '+30630', duration: 120, texts: ['Sleep stage 1@@EEG Fpz-Cz'] },
            ]
          : [],
    },
  ],
});

async function opened(): Promise<{
  recording: EdfRecording;
  annotations: readonly EdfAnnotation[];
}> {
  const recording = await openEdf(byteSource(BYTES));
  const { annotations } = await readAnnotations(recording, { start: 0, count: 3 });
  return { recording, annotations };
}

const reported = async (): Promise<{ recording: EdfRecording; report: ValidationReport }> => {
  const recording = await openEdf(byteSource(BYTES));
  return { recording, report: await validateRecording(recording, { scanSamples: true }) };
};

/** `| \`field\` | \`default\` | …` from the table under a heading. */
function statedDefault(table: string, field: string): string {
  const start = PAGE.indexOf(`\`${table}\``);
  const block = PAGE.slice(start, PAGE.indexOf('\n\n', PAGE.indexOf('|---|', start)));
  const row = new RegExp(`\\|\\s*\`${field}\`\\s*\\|\\s*([^|]+?)\\s*\\|`).exec(block);
  return (row?.[1] ?? '').replace(/`/g, '');
}

describe('the tables', () => {
  it('state a default for every field, so a passing run is not a vacuous one', () => {
    expect(statedDefault('FormatHeaderOptions', 'includePatientId')).toBe('false');
    expect(statedDefault('FormatHeaderOptions', 'diagnosticsHint')).toBe('true');
    expect(statedDefault('FormatAnnotationsOptions', 'maxItems')).toBe('every row');
    expect(statedDefault('FormatAnnotationsOptions', 'includeChannel')).toBe('false');
    expect(statedDefault('FormatReportOptions', 'header')).toBe('none');
    expect(statedDefault('FormatReportOptions', 'maxItems')).toBe('20');
    expect(statedDefault('FormatReportOptions', 'redactFields')).toBe('none');
  });
});

describe('FormatHeaderOptions', () => {
  it('withholds the identification line until asked', async () => {
    const { recording } = await opened();
    expect(formatHeader(recording.header)).not.toContain(PATIENT);
    expect(formatHeader(recording.header, { includePatientId: true })).toContain(PATIENT);
  });

  it('prints the diagnostics hint until told not to', async () => {
    const { recording } = await opened();
    const HINT = 'Call formatDiagnostics(header.diagnostics) for the detail.';
    expect(formatHeader(recording.header)).toContain(HINT);
    expect(formatHeader(recording.header, { diagnosticsHint: false })).not.toContain(HINT);
  });

  it('removes exactly that line and nothing else with it', async () => {
    const { recording } = await opened();
    const on = formatHeader(recording.header).split('\n');
    const off = formatHeader(recording.header, { diagnosticsHint: false }).split('\n');
    expect(on.filter((line) => !line.startsWith('Call formatDiagnostics'))).toEqual(off);
    // And the counts it sits under are still there, which is what makes it a hint and not the data.
    expect(off.some((line) => /\d+ diagnostic\(s\)/.test(line))).toBe(true);
  });

  it('points the two defaults opposite ways, which the page says is deliberate', async () => {
    const { recording } = await opened();
    const bare = formatHeader(recording.header);
    // One is opt-IN and absent; the other is opt-OUT and present.
    expect(bare).not.toContain(PATIENT);
    expect(bare).toContain('Call formatDiagnostics');
    expect(PAGE.replace(/\s+/g, ' ')).toContain('The two defaults point opposite ways on purpose.');
  });
});

describe('FormatAnnotationsOptions', () => {
  /** The two `// …` lines under the `formatAnnotations` call on the page. */
  const TRANSCRIPT = [...PAGE.matchAll(/^\/\/ (\d\d:\d\d:\d\d\.\d\d\d[^\n]*)$/gm)].map(
    (match) => match[1] ?? '',
  );

  it('prints the two rows the page prints, spacing and all', async () => {
    const { annotations } = await opened();
    expect(TRANSCRIPT).toHaveLength(2);
    expect(formatAnnotations(annotations, { maxItems: 20 }).split('\n')).toEqual(TRANSCRIPT);
  });

  it('prints every row when maxItems is left off', async () => {
    const { annotations } = await opened();
    const rows = formatAnnotations(annotations).split('\n');
    expect(rows).toHaveLength(annotations.length);
    expect(rows.some((row) => /\band \d+ more\b/.test(row))).toBe(false);
  });

  it('and states the count of the rest when it is not', async () => {
    const { annotations } = await opened();
    const capped = formatAnnotations(annotations, { maxItems: 1 }).split('\n');
    expect(capped[0]).toBe(TRANSCRIPT[0]);
    expect(capped[1]).toMatch(/\band 1 more\b/);
  });

  it('hides the channel label until asked, which most files do not carry', async () => {
    const { annotations } = await opened();
    expect(annotations.some((event) => event.channelLabel !== undefined)).toBe(true);
    expect(formatAnnotations(annotations)).not.toContain('@@');
    expect(formatAnnotations(annotations, { includeChannel: true })).toContain('@@EEG Fpz-Cz');
  });
});

describe('FormatReportOptions', () => {
  it('reads fine with no header, naming signals by index instead', async () => {
    const { report } = await reported();
    expect(formatValidationReport(report)).toContain('signal 0');
  });

  it('and names them by label when one is given, which is all the header is for', async () => {
    const { recording, report } = await reported();
    const withHeader = formatValidationReport(report, { header: recording.header });
    expect(withHeader).toContain('EEG Fpz-Cz');
    expect(withHeader).not.toContain('signal 0 ');
  });

  it('caps individual diagnostics at the number the table states', () => {
    const source = new URL('../../src/format-report.ts', import.meta.url);
    // The default lives in one constant; the page states it as a number.
    const declared = /const DEFAULT_MAX_ITEMS = (\d+);/.exec(readFileSync(source, 'utf8'))?.[1];
    expect(declared).toBe(statedDefault('FormatReportOptions', 'maxItems'));
  });

  it('redacts nothing unless asked, and everything named when it is', async () => {
    const { recording, report } = await reported();
    const bare = formatValidationReport(report, { header: recording.header });
    // The default prints the identification this file carries, verbatim and in full.
    expect(bare).toContain(PATIENT);

    const redacted = formatValidationReport(report, {
      header: recording.header,
      redactFields: ['patientId', 'recordingId'],
    });
    expect(redacted).not.toContain(PATIENT);
    expect(redacted).toContain('[redacted]');
    // Everything else survives: the codes, the counts and the advice are all still there.
    expect(redacted).toContain('PATIENT_ID_NONCONFORMANT');
    expect(redacted).toContain('EDF+ additional specification 3');
  });
});
