/**
 * No line edfcore prints for a human ends in whitespace.
 *
 * A trailing space is invisible where it is produced and visible everywhere it is pasted: a diff
 * flags it, a code fence keeps it, a strict linter on someone else's repository rejects the file
 * it was pasted into, and `git diff` paints it red in a bug report that was only ever meant to be
 * evidence. It is also the failure that no amount of reading the output finds.
 *
 * There was one, on the last column of the signal table in `edfcore header`, whenever a signal's
 * physical dimension was blank — which is not a corner case: EDF requires nothing of that field,
 * and two of the seven files in the real-world corpus leave it empty, including the PhysioNet
 * polysomnogram. The separator was being printed with the range rather than with the dimension,
 * so a signal with no dimension got the space and nothing after it.
 *
 * The two tab-separated outputs are exempt and are checked against the stronger rule instead. A
 * row of `events --list` ends in a tab whenever the event names no channel, and that trailing tab
 * is not stray whitespace — it is the fourth column, present and empty, which is what keeps
 * `cut -f4` reading a channel rather than the end of the line. So those two are checked for a
 * constant number of columns per row, which is the promise `cli.md` actually makes about them.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import { formatAnnotations } from '../../src/format-annotations.js';
import { formatHeader } from '../../src/format-header.js';
import { formatValidationReport } from '../../src/format-report.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { AWKWARD } from '../support/awkward-files.js';
import { buildEdf } from '../support/writer.js';

/** A signal with no physical dimension, which is what the PhysioNet polysomnogram has. */
const NO_DIMENSION = buildEdf({
  plus: 'C',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Event marker', samplesPerRecord: 1, physicalDimension: '' },
    { label: 'EEG Fpz-Cz', samplesPerRecord: 4 },
  ],
  annotationSignals: [
    {
      samplesPerRecord: 40,
      tals: (r) => (r === 0 ? [{ onset: '+0.5', texts: ['Lights off'] }] : []),
    },
  ],
});

/** The commands whose output is prose and a table. */
const PROSE = ['header', 'validate', 'gaps', 'events'] as const;

/** The commands whose output is columns, where a trailing empty field is the last column. */
const COLUMNS = [
  ['signals', [] as readonly string[]],
  ['events', ['--list']],
] as const;

const FILES: ReadonlyArray<readonly [string, Uint8Array]> = [
  ...AWKWARD.map((file) => [file.name, file.bytes] as const),
  ['a blank physical dimension', NO_DIMENSION],
];

async function cli(command: string, argv: readonly string[], bytes: Uint8Array): Promise<string> {
  const chunks: string[] = [];
  const io: CliIo = {
    out: (text) => chunks.push(text),
    err: (text) => chunks.push(text),
    readFile: async () => bytes,
  };
  await runCli(parseArgs([command, ...argv, 'a.edf']), io);
  return chunks.join('');
}

async function formatters(bytes: Uint8Array): Promise<readonly string[]> {
  const recording = await openEdf(byteSource(bytes));
  const { annotations } = await readAnnotations(recording, {
    start: 0,
    count: recording.header.recordCount,
  });
  return [
    formatHeader(recording.header),
    formatHeader(recording.header, { includePatientId: true }),
    formatDiagnostics(recording.header.diagnostics),
    formatValidationReport(await validateRecording(recording, { scanSamples: true }), {
      header: recording.header,
    }),
    formatAnnotations(annotations, { includeChannel: true }),
  ];
}

/** Lines ending in a space or a tab. An empty line is a deliberate separator, not whitespace. */
const trailing = (text: string): readonly string[] =>
  text.split('\n').filter((line) => line !== '' && /[ \t]$/.test(line));

describe('the fixture this was found on', () => {
  it('really has a signal with no physical dimension, and prints its row', async () => {
    const recording = await openEdf(byteSource(NO_DIMENSION));
    expect(recording.header.signals[0]?.physicalDimension).toBe('');
    // The row is there and it ends in the range, with nothing after it.
    const row = formatHeader(recording.header)
      .split('\n')
      .find((line) => line.includes('Event marker'));
    expect(row).toMatch(/\.\.\d+$/);
  });

  it('is the eleven shapes plus that one', () => {
    expect(AWKWARD).toHaveLength(11);
    expect(FILES).toHaveLength(12);
  });
});

describe.each(FILES)('for %s', (_name, bytes) => {
  it('no formatter ends a line in whitespace', async () => {
    for (const text of await formatters(bytes)) expect(trailing(text)).toEqual([]);
  });

  it.each(PROSE)('no line of `edfcore %s` ends in whitespace', async (command) => {
    expect(trailing(await cli(command, [], bytes))).toEqual([]);
  });

  it.each(COLUMNS)(
    '`edfcore %s %s` gives every row the same column count',
    async (command, argv) => {
      const rows = (await cli(command, argv, bytes))
        .split('\n')
        .filter((line) => line.includes('\t'));
      const widths = new Set(rows.map((row) => row.split('\t').length));
      expect([...widths].length).toBeLessThanOrEqual(1);
    },
  );
});

describe('the scan itself', () => {
  it('finds a trailing space and a trailing tab, and forgives an empty line', () => {
    expect(trailing('a \nb')).toEqual(['a ']);
    expect(trailing('a\t\nb')).toEqual(['a\t']);
    expect(trailing('a\n\nb')).toEqual([]);
  });
});
