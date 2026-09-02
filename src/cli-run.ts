/**
 * What `npx edfcore` actually does, with the process factored out.
 *
 * Layer 7. `cli.ts` is a shell that supplies real `node:fs` and `node:process`; everything
 * decidable lives here, behind an injected `CliIo`. That is not ceremony — a CLI tested by
 * spawning a subprocess can only be tested once the package is built, so the tests either skip in
 * CI or test a stale binary. This way the exit codes and the output are ordinary unit tests.
 */

import { countAnnotationsByText } from './annotations-query.js';
import { trimEdfField } from './bytes/latin1.js';
import { VERSION } from './constants.js';
import { formatDiagnostics } from './diagnostics/format.js';
import { formatHeader } from './format-header.js';
import { formatValidationReport } from './format-report.js';
import { formatCalendarDate, formatClockTime } from './header/dates.js';
import { byteSource } from './io/bytes.js';
import { buildRecordIndex } from './record-index.js';
import { openEdf, readAnnotations } from './recording.js';
import { pluralise } from './text/counted.js';
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

/**
 * Diagnostics or events printed when `--limit` is not given.
 *
 * Stated in four places besides this one — the usage text, the message a bad `--limit` raises, the
 * README, and `cli.md` — and applied at four call sites. It was the literal `20` at every one of
 * them until 0.4.390, which is the shape of number that ends up meaning two different things.
 */
const DEFAULT_ITEM_LIMIT = 20;

const USAGE = `edfcore — read EDF, EDF+, BDF and BDF+ files

  npx edfcore header <file>       the header, the signals, and any diagnostics
  npx edfcore validate <file>     a full conformance sweep, scanning every sample
  npx edfcore events <file>       the annotations, counted by text
  npx edfcore gaps <file>         the discontinuities, after a full scan
  npx edfcore signals <file>      one tab-separated line per signal, for grep and awk
  npx edfcore json <file>         the header as JSON, for piping into jq

Options
  --help, -h                      print this and exit 0
  --patient                       include both identification fields (header, validate, json)
  --list                          list events one per line instead of counting (events)
  --limit <n>                     diagnostics, events or gaps to print, default ${DEFAULT_ITEM_LIMIT}
                                  (header, validate, events --list, gaps)
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

/**
 * A parsed command line, with nothing decided yet. `command` and `file` are `undefined` rather
 * than defaulted because a missing one is bad usage and exits 2 — supplying a default here would
 * turn `edfcore` alone into a silent success.
 */
export interface Args {
  readonly command: string | undefined;
  readonly file: string | undefined;
  readonly patient: boolean;
  readonly list: boolean;
  readonly version: boolean;
  readonly help: boolean;
  readonly limit: number | undefined;
}

/**
 * Turns argv into `Args`, and refuses anything it does not recognise. An unknown flag throws
 * `CliUsageError` rather than being ignored: a misspelled `--patinet` that silently did nothing
 * would print a header without the identification the caller believed they had asked for.
 */
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
            `or omit --limit for the default of ${DEFAULT_ITEM_LIMIT}.`,
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

/**
 * The one thing `formatDiagnostics` cannot say.
 *
 * Its own notice is `... and N more`, which is right for a library caller: they would raise
 * `maxItems`. In a terminal that line leaves the reader with no way forward, while
 * `events --list` two commands over says "raise --limit to see them". Same CLI, same situation,
 * one actionable answer and one dead end (fixed in 0.4.183).
 */
function truncationHint(total: number, limit: number): string {
  return total > limit ? '\nRaise --limit to see the rest.\n' : '';
}

async function open(io: CliIo, file: string) {
  // Read whole rather than fileSource: a CLI invocation is one pass over one file, and holding
  // it in memory removes any question of a descriptor outliving the process.
  return openEdf(byteSource(await io.readFile(file)));
}

/**
 * Runs one command and RETURNS an exit code rather than setting one. Every side effect arrives
 * through `io`, which is what lets the CLI be driven from a test without spawning a process or
 * building `dist` first — `cli.ts` is the only place a real process is touched.
 */
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
      io.out(
        `${formatHeader(recording.header, { includePatientId: args.patient, diagnosticsHint: false })}\n`,
      );
      const limit = args.limit ?? DEFAULT_ITEM_LIMIT;
      if (recording.header.diagnostics.length > 0) {
        io.out(
          `\n${formatDiagnostics(recording.header.diagnostics, {
            maxItems: limit,
            ...redaction(args),
          })}\n${truncationHint(recording.header.diagnostics.length, limit)}`,
        );
      }
      /*
       * The probe's findings too. `openEdf` reads record 0 and the last record and puts what it
       * learned on `recording.timeline.diagnostics` — this command has already paid for that read.
       *
       * They were dropped, so an EDF+C file with a real hole printed "1 diagnostic(s): 1 info" and
       * never mentioned `DISCONTINUITY_IN_CONTINUOUS_FILE`, while `edfcore gaps` on the same file
       * reported a 20-second hole. `formatHeader`'s own summary line is scoped honestly — it names
       * `header.diagnostics` — so the omission was the command's, not the formatter's
       * (fixed in 0.3.94).
       */
      const timelineDiagnostics = recording.timeline.diagnostics;
      if (timelineDiagnostics.length > 0) {
        io.out(
          `\nFrom the record probes:\n${formatDiagnostics(timelineDiagnostics, {
            maxItems: limit,
            ...redaction(args),
          })}\n${truncationHint(timelineDiagnostics.length, limit)}`,
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
          maxItems: args.limit ?? DEFAULT_ITEM_LIMIT,
          ...redaction(args),
        })}\n${truncationHint(report.diagnostics.length, args.limit ?? DEFAULT_ITEM_LIMIT)}`,
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
      io.out(`${pluralise(annotations.length, 'annotation')}\n\n`);

      if (args.list) {
        const limit = args.limit ?? DEFAULT_ITEM_LIMIT;
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
        //
        // The blank line separates the notice from the rows above it, so it belongs to those rows:
        // `--limit 0` prints none, and emitting it anyway left two blank lines and a notice
        // hanging under the count (fixed in 0.4.181).
        if (annotations.length > limit) {
          const gap = limit > 0 ? '\n' : '';
          io.out(`${gap}... ${annotations.length - limit} more (raise --limit to see them)\n`);
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
        io.out(`no gaps in ${pluralise(index.recordCount, 'record')}\n`);
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
          ? pluralise(gaps.length, 'gap')
          : `${pluralise(gaps.length - overlaps, 'gap')} and ${pluralise(overlaps, 'overlap')}`;
      io.out(`${counted} in ${pluralise(index.recordCount, 'record')}\n\n`);

      /*
       * Capped, like `events --list`, and for the reason that command gives: a silently truncated
       * listing reads as a complete one.
       *
       * This was the one listing with no bound at all. `signals` is bounded by the header's signal
       * count and the spec caps that at 9999; `events --list` and the diagnostics blocks have
       * always capped. A gap list is bounded only by the record count, and a recorder that stops
       * and restarts every minute across a night produces hundreds — so the command written for
       * discontinuous files was the one that flooded on them (0.6.29).
       */
      const limit = args.limit ?? DEFAULT_ITEM_LIMIT;
      for (const gap of gaps.slice(0, limit)) {
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
      // The blank line belongs to the rows above it, so `--limit 0` prints none and gets none —
      // the shape 0.4.181 fixed for the events listing.
      if (gaps.length > limit) {
        io.out(
          `${limit > 0 ? '\n' : ''}... ${gaps.length - limit} more (raise --limit to see them)\n`,
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
          `${[
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
          ].join('\t')}\n`,
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
            /*
             * What the records COVER, beside what they SPAN.
             *
             * `spanSeconds` alone is the number `formatHeader` refuses to print unlabelled: on a
             * file with a hole it is the last record's end minus the first's start, gaps included,
             * so a script sizing a buffer or counting samples from it is out by the gaps.
             * `edfcore header` switches its label from `duration` to `covered` and adds two lines
             * saying where the span comes from; this had the one number and no label at all.
             *
             * The pair is also measured rather than declared, which is what makes it worth more
             * here than `variant`. `variant` and `header.continuity` both carry the CLAIM the
             * writer made, and `DISCONTINUITY_IN_CONTINUOUS_FILE` exists for the file where that
             * claim is false — so the field a script would have branched on is the field that is
             * wrong. Read the difference with its sign: positive is a hole, negative means records
             * overlap and the coverage double-counts the instants two of them share (0.6.42).
             *
             * Not the only measured answer in this document, and it stopped being one below:
             * 0.6.12 added the record probes' diagnostics, so `DISCONTINUITY_IN_CONTINUOUS_FILE`
             * and `RECORD_ONSET_SPACING_VIOLATION` now travel here with `source: "recordProbe"`
             * and contradict the same `variant`.
             */
            coveredSeconds: recording.timeline.coveredSeconds,
            /*
             * The start, which this command was alone in not reporting. `header` prints it on its
             * second line and needs no flag for it, `signals` is per-signal and `gaps` is about
             * onsets, so the machine-readable output was the only one a script could not get the
             * recording's date and time out of.
             *
             * That is worse than an omission, because of where the package sends people:
             * DATE_CLIPPED_TO_1985_2084 fires on any file with a two-digit year and its Next:
             * clause says to read the four-digit year the EDF+ recording identification spells
             * out. `edfcore json` reported the diagnostic and not the field it points at.
             *
             * Both sources are named rather than resolved away. A date that came from the
             * recording identification is the unambiguous one; a clock with `clockSource: 'none'`
             * is a substituted midnight rather than a file that starts at midnight, and 0.3.17 is
             * what happens when those two are one value. `null`, not an omitted key: JSON drops
             * `undefined`, and a reader doing `.start.clock` should get the answer rather than
             * nothing.
             */
            start: {
              date:
                header.startTime.resolvedDate === undefined
                  ? null
                  : formatCalendarDate(header.startTime.resolvedDate),
              dateSource: header.startTime.dateSource,
              clock:
                header.startTime.clockSource === 'none'
                  ? null
                  : formatClockTime(header.startTime.clock),
              clockSource: header.startTime.clockSource,
              /*
               * The sub-second start, which is the number that joins this document's two clocks.
               *
               * `date` and `clock` are header fields, on the header's timebase. Every other time
               * in this document — `spanSeconds`, `coveredSeconds`, and the onsets `edfcore
               * events` prints — is on record 0's, where `t = 0` is the start of record 0. Record
               * 0's timekeeping TAL says how far apart those two are, in [0, 1), and it was the
               * one number here a script could not get. Adding the clock to an event onset was
               * therefore up to a second early, silently, and only on the files that carry an
               * offset — the format's one piece of sub-second timing.
               *
               * From the probe `openEdf` already paid for, which is why `formatHeader` cannot
               * print it and this command can: a header alone does not know it.
               */
              offsetSeconds: recording.timeline.startOffsetSeconds,
            },
            /*
             * Identification is opt-in here for the same reason it is in `formatHeader`: the
             * obvious thing to do with this output is pipe it somewhere.
             *
             * BOTH fields, on the one flag. `redaction()` above states the rule — the two must be
             * gated together, by the same flag, in every command that prints either — and until
             * 0.6.7 this command printed one of them. `header --patient` shows a `recording` line
             * and `json --patient` did not, so the same flag meant two different things two
             * commands apart, and the field holding the technician code, the equipment code and
             * the only unambiguous startdate was unreachable from the machine-readable output.
             *
             * `trimEdfField`, for the reason formatHeader uses it: `.trim()` leaves NUL padding
             * in place, and JSON.stringify escapes it into a run of `\u0000` in the value.
             */
            ...(args.patient
              ? {
                  patient: trimEdfField(header.patient.raw),
                  recording: trimEdfField(header.recording.raw),
                }
              : {}),
            /*
             * The four declared range numbers and the derived gain, which is what makes this
             * output enough to act on rather than only enough to read. Without them a script has
             * the samples' units and no way to reach the units: `toPhysical` needs the scale, and
             * `edfcore header` shows the range to a human while this showed a script nothing.
             *
             * `scale` is absent rather than null when the header has no usable gain — a degenerate
             * or inverted range, or the `Filtered` dimension — which is the same convention
             * `sampleRateHz` already uses here for the legal zero-duration file. An absent key is
             * the honest shape: `JSON.stringify` drops `undefined`, and a reader who checks for
             * the key gets the same answer the library gives, which is that there is no gain.
             */
            signals: header.signals.map((signal) => ({
              index: signal.index,
              label: signal.label,
              kind: signal.kind,
              samplesPerRecord: signal.samplesPerRecord,
              sampleRateHz: signal.sampleRateHz,
              physicalDimension: signal.physicalDimension,
              physicalMinimum: signal.physicalMinimum,
              physicalMaximum: signal.physicalMaximum,
              digitalMinimum: signal.digitalMinimum,
              digitalMaximum: signal.digitalMaximum,
              scale: signal.scale,
            })),
            /*
             * The probe's findings too, which is the fix 0.3.94 made to `edfcore header` and did
             * not make here. `openEdf` reads record 0 and the last record and puts what it learned
             * on `recording.timeline.diagnostics`; this command has already paid for that read and
             * reports the span it produced two lines up.
             *
             * Dropping them cost more here than it did there. An EDF+C file with a real hole
             * reported one `info` and never mentioned DISCONTINUITY_IN_CONTINUOUS_FILE, while
             * `edfcore gaps` on the same file printed a 20-second gap — and this is the output a
             * pipeline branches on, so `select(.severity == "warning")` saw a clean file. The
             * `variant` field is not a substitute: the whole point of that code is a file whose
             * reserved field says continuous when its onsets do not.
             *
             * `source` keeps the distinction `edfcore header` shows by printing them under their
             * own heading. One array, because a consumer filtering by severity wants one array.
             */
            diagnostics: [
              /*
               * `signalIndex` too, absent when the diagnostic is about the file rather than a
               * channel. A real file earns one code many times — `chb01_01.edf` reports
               * LABEL_CONVENTION_NONCONFORMANT twenty-three times, once per channel — and without
               * the index a script could count them and not name one.
               *
               * A number, not the field's bytes: `json-command-privacy.test.ts` holds the line
               * that this command emits no diagnostic text, because an identification diagnostic
               * quotes the name it is complaining about.
               */
              ...header.diagnostics.map((d) => ({
                code: d.code,
                severity: d.severity,
                source: 'header' as const,
                signalIndex: d.signalIndex,
              })),
              ...recording.timeline.diagnostics.map((d) => ({
                code: d.code,
                severity: d.severity,
                source: 'recordProbe' as const,
                signalIndex: d.signalIndex,
              })),
            ],
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
