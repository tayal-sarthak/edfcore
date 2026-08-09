/**
 * What `npx edfcore` actually does, with the process factored out.
 *
 * `cli.ts` is a shell that supplies real `node:fs` and `node:process`; everything decidable lives
 * here, behind an injected `CliIo`. That is not ceremony — a CLI tested by spawning a subprocess
 * can only be tested once the package is built, so the tests either skip in CI or test a stale
 * binary. This way the exit codes and the output are ordinary unit tests.
 */

import { countAnnotationsByText } from './annotations-query.js';
import { trimEdfField } from './bytes/latin1.js';
import { VERSION } from './constants.js';
import { formatDiagnostics } from './diagnostics/format.js';
import { formatHeader } from './format-header.js';
import { formatValidationReport } from './format-report.js';
import { byteSource } from './io/bytes.js';
import { buildRecordIndex } from './record-index.js';
import { openEdf, readAnnotations } from './recording.js';
import { printable } from './text/printable.js';
import { validateRecording } from './validate.js';

/**
 * A mistake in the command line, as opposed to a mistake in the file.
 *
 * The documented exit codes are 0 success, 1 the file is unreadable or failed validation, 2 bad
 * usage — and a script gates on them without parsing output. `parseArgs` used to throw a plain
 * `RangeError`, which `cli.ts` caught with everything else and reported as 1, so `--limit all` was
 * indistinguishable from a corrupt recording. This type is what lets the shell tell them apart.
 *
 * It EXTENDS `RangeError` rather than `Error`, so a caller who was already catching `RangeError`
 * from `parseArgs` — the package's convention for a caller mistake, and what the existing test
 * pins — keeps working unchanged. The new class narrows that, it does not replace it.
 */
export class CliUsageError extends RangeError {
  readonly usage = true as const;

  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

/** Everything the CLI touches outside itself. */
export interface CliIo {
  readFile(path: string): Promise<Uint8Array>;
  out(text: string): void;
  err(text: string): void;
}

const USAGE = `edfcore — read EDF, EDF+, BDF and BDF+ files

  npx edfcore header <file>       the header, the signals, and any diagnostics
  npx edfcore validate <file>     a full conformance sweep, scanning every sample
  npx edfcore events <file>       the annotations, counted by text
  npx edfcore gaps <file>         the discontinuities, after a full scan
  npx edfcore signals <file>      one line per signal, for grep and awk
  npx edfcore json <file>         the header as JSON, for piping into jq

Options
  --help, -h                      print this and exit 0
  --patient                       include patient identification (header, json)
  --list                          list events one per line instead of counting (events)
  --limit <n>                     individual diagnostics or events to print (default 20)

  --version, -v                   print the version and exit

Exit codes: 0 success, 1 the file is unreadable or failed validation, 2 bad usage.
`;

/**
 * Every command the switch below handles, so an unrecognised one is refused before the file is
 * looked for. The two must stay in step; the switch's `default` is the backstop if they drift.
 */
const COMMANDS: ReadonlySet<string> = new Set([
  'header',
  'validate',
  'events',
  'gaps',
  'signals',
  'json',
]);

export interface Args {
  readonly command: string | undefined;
  readonly file: string | undefined;
  readonly patient: boolean;
  readonly list: boolean;
  readonly version: boolean;
  readonly help: boolean;
  readonly limit: number | undefined;
}

export function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  let patient = false;
  let list = false;
  let version = false;
  let help = false;
  let limit: number | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--patient') patient = true;
    else if (arg === '--list') list = true;
    else if (arg === '--version' || arg === '-v') version = true;
    else if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--limit') {
      const value = Number(argv[i + 1]);
      // A NaN limit would disable the cap silently, which is the opposite of what was asked for.
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new CliUsageError(
          `--limit needs a whole number, received ${String(argv[i + 1])}. Next: pass a count, ` +
            'or omit --limit for the default of 20.',
        );
      }
      limit = value;
      i += 1;
    } else if (arg?.startsWith('-')) {
      // An unrecognised flag is bad usage, not something to ignore: a misspelled --patinet would
      // otherwise print the output the caller was trying to avoid, quietly and with exit 0.
      throw new CliUsageError(
        `unknown option ${JSON.stringify(arg)}. Next: run \`edfcore --help\` for the list.`,
      );
    } else if (arg !== undefined) positional.push(arg);
  }

  if (positional.length > 2) {
    // Silently dropping the rest is the dangerous shape: `edfcore validate *.edf` would check the
    // first file, exit 0, and report success for every other file the shell expanded — in a CI
    // gate, which is what the exit code exists for.
    throw new CliUsageError(
      `expected one file, received ${positional.length - 1}: ` +
        `${positional
          .slice(1)
          .map((value) => JSON.stringify(value))
          .join(', ')}. ` +
        'edfcore reads one file per invocation. Next: loop in the shell — ' +
        'for f in *.edf; do edfcore validate "$f" || exit 1; done',
    );
  }

  return { command: positional[0], file: positional[1], patient, list, version, help, limit };
}

/**
 * What `--patient` actually has to gate.
 *
 * Withholding the identification line from `formatHeader` is not enough on its own. A diagnostic
 * names the raw bytes as written — that is the message contract, and it is what makes a report
 * actionable — so a NON-CONFORMANT identification field gets its whole content printed in the
 * diagnostics block underneath. That is not a rare file: a writer that packs the name into a
 * single token fails the EDF+ grammar, and a file that behaves oddly is exactly the one someone
 * runs `edfcore header` on and pastes into an issue.
 *
 * So the two must be gated together, by the same flag, in every command that prints either.
 */
function redaction(args: Args): { redactFields?: readonly string[] } {
  return args.patient ? {} : { redactFields: ['patientId', 'recordingId'] };
}

async function open(io: CliIo, file: string) {
  // Read whole rather than fileSource: a CLI invocation is one pass over one file, and holding
  // it in memory removes any question of a descriptor outliving the process.
  return openEdf(byteSource(await io.readFile(file)));
}

export async function runCli(args: Args, io: CliIo): Promise<number> {
  const { command, file } = args;
  // Before the command check: `edfcore --version` has no command, and a bare --version must not
  // fall through to the usage text and exit 2.
  if (args.version) {
    io.out(`${VERSION}\n`);
    return 0;
  }
  // `--help` is a FLAG, handled here alongside `--version`, because `parseArgs` never puts a
  // dash-prefixed argument in `command`: the old `command === '--help'` branch could not be
  // reached, so `edfcore --help` fell through to "no command" and exited 2 — on the first thing
  // most people type.
  if (args.help || command === 'help') {
    io.out(USAGE);
    return 0;
  }
  if (command === undefined) {
    io.out(USAGE);
    return 2;
  }
  /*
   * The command is checked BEFORE the file, because otherwise the commonest slip of all is
   * misdiagnosed. `parseArgs` puts the first non-flag argument in `command`, so
   * `edfcore recording.edf` — forgetting the subcommand — reported "edfcore recording.edf: no
   * file given", printing the filename that WAS given as though it were the command and blaming
   * the argument that is not missing. The mistake is an unrecognised command, and the branch
   * below already names that correctly (fixed in 0.3.36).
   */
  if (!COMMANDS.has(command)) {
    // A bare filename is the likely intent, so say which word is missing rather than only which
    // one is wrong.
    const looksLikeAFile = /[./\\]/.test(command);
    io.err(
      `edfcore: unknown command ${JSON.stringify(command)}` +
        (looksLikeAFile ? ' — that looks like a file, so the command before it is missing' : '') +
        `\n\n${USAGE}`,
    );
    return 2;
  }
  if (file === undefined) {
    io.err(`edfcore ${command}: no file given\n\n${USAGE}`);
    return 2;
  }

  switch (command) {
    case 'header': {
      const recording = await open(io, file);
      io.out(`${formatHeader(recording.header, { includePatientId: args.patient })}\n`);
      if (recording.header.diagnostics.length > 0) {
        io.out(
          `\n${formatDiagnostics(recording.header.diagnostics, {
            maxItems: args.limit ?? 20,
            ...redaction(args),
          })}\n`,
        );
      }
      return 0;
    }

    case 'validate': {
      const recording = await open(io, file);
      const report = await validateRecording(recording, { scanSamples: true });
      io.out(
        `${formatValidationReport(report, {
          header: recording.header,
          maxItems: args.limit ?? 20,
          ...redaction(args),
        })}\n`,
      );
      // Exit 1 on failure so a CI job can gate on it without parsing the output.
      return report.ok ? 0 : 1;
    }

    case 'events': {
      const recording = await open(io, file);
      const { annotations } = await readAnnotations(recording, {
        start: 0,
        count: recording.header.recordCount,
      });
      if (annotations.length === 0) {
        io.out('no annotations\n');
        return 0;
      }
      io.out(`${annotations.length} annotation(s)\n\n`);

      if (args.list) {
        const limit = args.limit ?? 20;
        // `onsetSecondsFromFirstRecord`, because that is the axis the rest of this CLI reports on:
        // `gaps` prints it, `header` counts records from it, and t = 0 is the start of record 0.
        // The on-disk value is `onsetSecondsFromHeaderStart`, and mixing the two in one output
        // would put two lines of the same listing on different clocks.
        for (const event of annotations.slice(0, limit)) {
          const duration = event.durationSeconds === undefined ? '' : `${event.durationSeconds}`;
          // `printable`, because this format is tab-separated and the text is arbitrary bytes
          // from the file. A tab inside an annotation invents a column, so `cut -f4` returns the
          // rest of the text instead of the channel; a newline invents a whole row.
          io.out(
            `${event.onsetSecondsFromFirstRecord}\t${duration}\t${printable(event.text)}\t` +
              `${printable(event.channelLabel ?? '')}\n`,
          );
        }
        // Say what was withheld. A silently truncated listing reads as a complete one.
        if (annotations.length > limit) {
          io.out(`\n... ${annotations.length - limit} more (raise --limit to see them)\n`);
        }
        return 0;
      }

      for (const { text, count } of countAnnotationsByText(annotations)) {
        // Counted on the verbatim text — two labels differing only in a control byte are two
        // labels — and printed through `printable`, so the count column cannot be split.
        io.out(`${String(count).padStart(8)}  ${printable(text)}\n`);
      }
      return 0;
    }

    case 'gaps': {
      const recording = await open(io, file);
      // A full scan, not the two probes openEdf makes: the probed index cannot see a gap in the
      // middle, and reporting "none" from it would be a claim nobody verified.
      const index = await buildRecordIndex(recording);
      const gaps = index.gaps ?? [];
      if (gaps.length === 0) {
        io.out(`no gaps in ${index.recordCount} records\n`);
        return 0;
      }

      // An OVERLAP travels in the same array with a negative duration — 0.2.69 documented that —
      // and until 0.3.3 this command called every entry a gap and printed its duration with a
      // hardcoded `+`, so an overlap came out as `+-1s` inside a line reading "2 gap(s)". A
      // directory sweep counting gaps counted overlaps among them, which is the opposite claim:
      // a gap is time no record covers, an overlap is one instant two records both claim.
      const overlaps = gaps.filter((gap) => gap.durationSeconds < 0).length;
      const counted =
        overlaps === 0
          ? `${gaps.length} gap(s)`
          : `${gaps.length - overlaps} gap(s) and ${overlaps} overlap(s)`;
      io.out(`${counted} in ${index.recordCount} records\n\n`);

      for (const gap of gaps) {
        const overlap = gap.durationSeconds < 0;
        // The kind is a FOURTH column, appended: columns 1-3 keep their meaning and position, so
        // an existing `cut -f3` still reads a duration. The duration carries its own sign, and
        // the interval is printed as the gap reports it — for an overlap it runs backwards,
        // from where the earlier segment ends to where the later one already started.
        io.out(
          `after segment ${gap.beforeSegmentIndex}\t${gap.startSeconds}s..${gap.endSeconds}s\t` +
            `${gap.durationSeconds}s\t${overlap ? 'overlap' : 'gap'}\n`,
        );
      }
      /*
       * Exit 0 either way: this command reports, it does not gate.
       *
       * It used to add that `edfcore validate` "is the gate, and it already exits 1 on an overlap
       * through RECORD_ONSET_SPACING_VIOLATION". It does not. That code's disposition is `warning`
       * — deliberately, and `diagnostics.md` lists it in the warning table — so `report.ok` stays
       * true and `validate` prints `PASS` and exits 0 on the same file this command has just
       * printed an overlap for. A reader who took the comment at its word gated CI on a command
       * that passes the defect (fixed in 0.3.91).
       *
       * The disposition is the considered half: an overlapping file is still readable, which is
       * why `mergeChunks` refuses the join rather than the reader refusing the file. Backwards
       * onsets — `TIMELINE_NOT_MONOTONIC` — are the fatal case.
       */
      return 0;
    }

    case 'signals': {
      // Tab-separated and one line per signal: `header` is for reading, this is for piping.
      //
      // `samplesPerRecord` is last and was missing until 0.2.42. It is the AUTHORITATIVE field —
      // `sampleRateHz` is derived from it and the record duration, and is empty for the legal
      // zero-duration file — so a listing meant for a script that omitted it forced the reader
      // back to `json` for the one number they could safely index by. Appended rather than
      // inserted, so no existing column moves.
      const recording = await open(io, file);
      for (const signal of recording.header.signals) {
        io.out(
          [
            signal.index,
            // A label is arbitrary bytes. In a format whose whole purpose is `cut -f2`, a tab in
            // one shifts every field after it for that row alone, so a script reading column 6
            // gets a physical dimension where it expected a sample count — with no error, and
            // only on the file that has the problem (fixed in 0.3.2).
            printable(signal.label),
            signal.kind,
            signal.sampleRateHz ?? '',
            printable(signal.physicalDimension.trim()),
            signal.samplesPerRecord,
          ].join('\t') + '\n',
        );
      }
      return 0;
    }

    case 'json': {
      const recording = await open(io, file);
      const { header } = recording;
      io.out(
        `${JSON.stringify(
          {
            variant: header.variant,
            recordCount: header.recordCount,
            recordDurationSeconds: header.recordDurationSeconds,
            spanSeconds: recording.timeline.spanSeconds,
            // Patient identification is opt-in here for the same reason it is in formatHeader:
            // the obvious thing to do with this output is pipe it somewhere.
            // `trimEdfField`, for the reason formatHeader uses it: `.trim()` leaves NUL padding
            // in place, and JSON.stringify escapes it into a run of `\u0000` in the value.
            ...(args.patient ? { patient: trimEdfField(header.patient.raw) } : {}),
            signals: header.signals.map((signal) => ({
              index: signal.index,
              label: signal.label,
              kind: signal.kind,
              samplesPerRecord: signal.samplesPerRecord,
              sampleRateHz: signal.sampleRateHz,
              physicalDimension: signal.physicalDimension,
            })),
            diagnostics: header.diagnostics.map((d) => ({ code: d.code, severity: d.severity })),
          },
          null,
          2,
        )}\n`,
      );
      return 0;
    }

    default:
      // Unreachable: `COMMANDS` above is the same set, and a command outside it was already
      // refused. Kept so the switch stays total if a case is ever removed without the set.
      io.err(`edfcore: unknown command ${JSON.stringify(command)}\n\n${USAGE}`);
      return 2;
  }
}
