/**
 * Nothing edfcore prints says `1 records`.
 *
 * 0.4.421 fixed this inside `formatValidationReport` and wrote down the reason: one function, two
 * conventions, and the ungrammatical one on the line a reader sees first. The fix was a private
 * `pluralise`, so it reached that formatter and nothing else — and the line a reader sees first is
 * not in that formatter. `edfcore header` opened with `EDF · 1 signals · 6 records` on the
 * one-signal file most of this suite is built from, `edfcore gaps` on a one-record file said `no
 * gaps in 1 records`, and the diagnostic summary said `2 warning` directly underneath a heading
 * that had already counted them correctly. Two commands over one file disagreed about the same
 * number: `validate` said `scanned 1 record` and `header` said `1 records`.
 *
 * The check is not a list of the sites that were wrong. It is the whole output of every printer
 * and every command, over every shape in the matrix, scanned for a count of one followed by a
 * plural — so a seventh site added later fails here rather than being found by reading a terminal.
 * That is what the private helper could not do.
 *
 * `1 gap(s)` and `1 diagnostic(s)` are not defects and are not flagged: the parenthesised form is
 * correct, just a third convention, and it is left for a change that is about consistency rather
 * than about grammar.
 *
 * The scan looks only at text edfcore wrote itself. Annotation text and header fields come from
 * the file and are printed verbatim by design, so the fixtures below never spell a count in one —
 * asserted, rather than assumed, at the bottom.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import { formatAnnotations } from '../../src/format-annotations.js';
import { formatHeader } from '../../src/format-header.js';
import { formatValidationReport } from '../../src/format-report.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { AWKWARD } from '../support/awkward-files.js';
import { buildEdf } from '../support/writer.js';

/** One of everything: one signal, one record, one sample, one annotation, one diagnostic. */
const SINGULAR = buildEdf({
  plus: 'C',
  recordCount: 1,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 1 }],
  annotationSignals: [
    {
      samplesPerRecord: 40,
      tals: (record) => (record === 0 ? [{ onset: '+0.25', texts: ['Lights off'] }] : []),
    },
  ],
});

/**
 * A count of one followed by a plural of something edfcore counts.
 *
 * The nouns are named rather than matched as "any word ending in s". `signal 1 is labelled "Resp"`
 * is a real diagnostic and a real `1 …s`, and no rule about the shape of the text tells it apart
 * from `1 signals`. A list is honest about that, and it is short: this package counts eleven kinds
 * of thing and prints all of them.
 */
const COUNTED_NOUNS = [
  'annotation',
  'byte',
  'bucket',
  'chunk',
  'diagnostic',
  'error',
  'gap',
  'info',
  'overlap',
  'record',
  'sample',
  'segment',
  'signal',
  'warning',
] as const;
const ONE_PLURAL = new RegExp(`\\b1 (${COUNTED_NOUNS.join('|')})s\\b`, 'g');

const COMMANDS = ['header', 'validate', 'gaps', 'signals', 'events', 'json'] as const;

async function everythingPrinted(name: string, bytes: Uint8Array): Promise<readonly string[]> {
  const printed: string[] = [];
  const recording = await openEdf(byteSource(bytes));
  const index = await buildRecordIndex(recording);

  printed.push(formatHeader(recording.header));
  printed.push(formatHeader(recording.header, { includePatientId: true }));
  printed.push(formatDiagnostics(recording.header.diagnostics));
  printed.push(formatDiagnostics(recording.timeline.diagnostics));
  // With the scanned index, so the sweep that reports segments and gaps is the one printed.
  const report = await validateRecording(recording, { index, scanSamples: true });
  printed.push(formatValidationReport(report, { header: recording.header }));
  const { annotations } = await readAnnotations(recording, {
    start: 0,
    count: recording.header.recordCount,
  });
  printed.push(formatAnnotations(annotations, { includeChannel: true }));

  for (const command of COMMANDS) {
    const lines: string[] = [];
    const io: CliIo = {
      out: (text) => lines.push(text),
      err: (text) => lines.push(text),
      readFile: async () => bytes,
    };
    await runCli(parseArgs([command, `${name}.edf`]), io);
    printed.push(lines.join(''));
  }
  return printed;
}

const FILES: ReadonlyArray<readonly [string, Uint8Array]> = [
  ...AWKWARD.map((file) => [file.name, file.bytes] as const),
  ['one of everything', SINGULAR],
];

describe('the matrix this file sweeps', () => {
  it('is the eleven shapes it was written against, plus one built here', () => {
    expect(AWKWARD).toHaveLength(11);
    expect(FILES).toHaveLength(12);
  });
});

describe.each(FILES)('everything printed for %s', (name, bytes) => {
  it('never follows a count of one with a plural', async () => {
    const offenders: string[] = [];
    for (const text of await everythingPrinted(name, bytes)) {
      for (const line of text.split('\n')) {
        for (const match of line.matchAll(ONE_PLURAL)) offenders.push(`${match[0]} — ${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the scan itself', () => {
  it('finds the shape it is looking for, so a passing run is not a vacuous one', () => {
    // Without this, a regex that matched nothing would pass on every file above.
    expect([...'no gaps in 1 records'.matchAll(ONE_PLURAL)].map((m) => m[0])).toEqual([
      '1 records',
    ]);
    expect([...'EDF · 1 signals · 6 records'.matchAll(ONE_PLURAL)]).toHaveLength(1);
    expect([...'over 1 samples'.matchAll(ONE_PLURAL)]).toHaveLength(1);
    // And the shape that is not a count: a diagnostic naming signal 1.
    expect([...'signal 1 is labelled "Resp"'.matchAll(ONE_PLURAL)]).toEqual([]);
  });

  it('leaves the forms that are correct alone', () => {
    for (const line of [
      '1 gap(s)',
      '1 diagnostic(s)',
      'record 1 s · 16 bytes',
      'scanned 1 record',
    ]) {
      expect([...line.matchAll(ONE_PLURAL)]).toEqual([]);
    }
  });

  it('has real output to scan, and not much of it is one of anything', async () => {
    const printed = await everythingPrinted('one of everything', SINGULAR);
    expect(printed.length).toBeGreaterThan(10);
    expect(printed.join('\n')).toContain('· 1 record');
    expect(printed.join('\n')).toContain('scanned 1 record');
  });
});

describe('the fixtures', () => {
  it("spell no count of their own, so every hit above is edfcore's", () => {
    for (const [, bytes] of FILES) {
      expect([...new TextDecoder('latin1').decode(bytes).matchAll(ONE_PLURAL)]).toEqual([]);
    }
  });
});
