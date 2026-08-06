/**
 * What `npx edfcore` actually does, with the process factored out.
 *
 * `cli.ts` is a shell that supplies real `node:fs` and `node:process`; everything decidable lives
 * here, behind an injected `CliIo`. That is not ceremony — a CLI tested by spawning a subprocess
 * can only be tested once the package is built, so the tests either skip in CI or test a stale
 * binary. This way the exit codes and the output are ordinary unit tests.
 */

import { countAnnotationsByText } from './annotations-query.js';
import { VERSION } from './constants.js';
import { formatDiagnostics } from './diagnostics/format.js';
import { formatHeader } from './format-header.js';
import { formatValidationReport } from './format-report.js';
import { byteSource } from './io/bytes.js';
import { buildRecordIndex } from './record-index.js';
import { openEdf, readAnnotations } from './recording.js';
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

  --version                       print the version and exit

Exit codes: 0 success, 1 the file is unreadable or failed validation, 2 bad usage.
`;

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
          io.out(
            `${event.onsetSecondsFromFirstRecord}\t${duration}\t${event.text}\t` +
              `${event.channelLabel ?? ''}\n`,
          );
        }
        // Say what was withheld. A silently truncated listing reads as a complete one.
        if (annotations.length > limit) {
          io.out(`\n... ${annotations.length - limit} more (raise --limit to see them)\n`);
        }
        return 0;
      }

      for (const { text, count } of countAnnotationsByText(annotations)) {
        io.out(`${String(count).padStart(8)}  ${text}\n`);
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
      io.out(`${gaps.length} gap(s) in ${index.recordCount} records\n\n`);
      for (const gap of gaps) {
        io.out(
          `after segment ${gap.beforeSegmentIndex}\t${gap.startSeconds}s..${gap.endSeconds}s\t+${gap.durationSeconds}s\n`,
        );
      }
      return 0;
    }

    case 'signals': {
      // Tab-separated and one line per signal: `header` is for reading, this is for piping.
      const recording = await open(io, file);
      for (const signal of recording.header.signals) {
        io.out(
          [
            signal.index,
            signal.label,
            signal.kind,
            signal.sampleRateHz ?? '',
            signal.physicalDimension.trim(),
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
            ...(args.patient ? { patient: header.patient.raw.trim() } : {}),
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
      io.err(`edfcore: unknown command ${JSON.stringify(command)}\n\n${USAGE}`);
      return 2;
  }
}
