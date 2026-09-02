---
title: "CLI"
description: The six commands, their flags, the tab-separated columns, and the exit codes a CI job can gate on.
section: Reference
order: 8
lead: edfcore ships a command line so you can look at a file before writing any code. Every command reads one file, prints to stdout, and returns an exit code a script can branch on.
---

```bash
npx edfcore header <file>      # the header, the signals, and any diagnostics
npx edfcore validate <file>    # a full conformance sweep, scanning every sample
npx edfcore events <file>      # the annotations, counted by text
npx edfcore signals <file>     # one tab-separated line per signal, for grep and awk
npx edfcore gaps <file>        # the discontinuities, from a full scan
npx edfcore json <file>        # the header as JSON, for piping into jq
npx edfcore --version          # the installed version
```

Flags: `--patient` includes both identification fields, local patient and local recording
(`header`, `validate`, `json`), and stops the diagnostics that quote them being redacted. `--list`
makes
`events` print one event per line instead of counting them by text, and `--limit <n>` caps the
diagnostics, events or gaps printed (`header`, `validate`, `events --list`, `gaps`). Each is accepted and ignored
by the commands it does not name, and the counted `events` output is never capped.

```bash
npx edfcore events recording.edf --list --limit 100
# 0<TAB>30<TAB>Sleep stage W<TAB>
```

The onset column is `onsetSecondsFromFirstRecord` — the axis `gaps` and every read use, where
`t = 0` is the start of record 0. A truncated listing says how many events it withheld, because a
silently cut one reads as a complete one.

`json` emits the geometry, the start, one entry per signal and the diagnostic codes. A signal entry carries the four declared range numbers and `scale`, so the document is enough to reach physical units on its own — `scale.bitValue * (scale.offset + digital)`. The key is absent when the header has no usable gain, the way `sampleRateHz` is absent for a legal zero record duration. A diagnostic carries `signalIndex` when it is about a channel rather than the file. It reports
`spanSeconds` and `coveredSeconds` as a pair: they differ by the gaps, which is the only thing in
the document that finds a hole without believing the file's own `variant`. The
diagnostics are both sets the library holds — the header's and the record probes' — each entry
carrying `source: "header"` or `source: "recordProbe"`. Before 0.6.12 only the header's were
emitted, so an EDF+C file with a real hole reported nothing about it here while `edfcore gaps`
reported the gap. The start
carries `dateSource` and `clockSource` alongside the values, because a `null` clock and a file that
starts at midnight are otherwise the same output, and a date resolved from the EDF+ recording
identification is the unambiguous one. It was added in 0.6.6; before that the command reported
`DATE_CLIPPED_TO_1985_2084` and not the field that diagnostic tells you to read.

```json
"start": { "date": "2095-04-24", "dateSource": "recordingIdField",
           "clock": "22:30:00", "clockSource": "headerField" }
```

`header` is for reading and `signals` is for piping. The second emits six tab-separated columns,
in this order, annotations channel included:

| # | Column | Note |
|---|---|---|
| 1 | `index` | |
| 2 | `label` | trimmed |
| 3 | `kind` | `data` or `annotations` |
| 4 | `sampleRateHz` | **empty** for a legal zero record duration — it is derived |
| 5 | `physicalDimension` | trimmed |
| 6 | `samplesPerRecord` | the authoritative count; index by this, never by the rate |

Column 6 was added in 0.2.42 and appended rather than inserted, so nothing that parsed the first
five by position moved. Before that this page claimed the command emitted samples per record when
it emitted `kind` instead, and the authoritative field was in no column at all. `gaps` runs a full scan rather
than the two probes `openEdf` makes, because a probed index cannot see a gap in the middle and
reporting "none" from it would be a claim nobody verified.

Exit codes are the contract, so a script can act on them without parsing the output:

| Code | Meaning |
|---|---|
| `0` | success |
| `1` | the file could not be read, or validation failed |
| `2` | bad usage — unknown command or option, missing file, extra files, bad flag value |

Bad usage really does exit 2 since 0.2.27; before that `parseArgs` threw a plain `RangeError` that
the shell reported as 1, so `--limit all` was indistinguishable from a corrupt recording to the job
gating on it. Three related things changed with it:

- An **unknown option** is refused rather than ignored. A misspelled `--patinet` used to be dropped
  silently, so the command printed the identification the caller was trying to withhold, and
  exited 0.
- **Extra files** are refused. `edfcore validate *.edf` used to validate the first file the shell
  expanded, exit 0, and say nothing about the rest — inside the CI gate the exit code exists for.
  Loop instead: `for f in *.edf; do edfcore validate "$f" || exit 1; done`
- **`--help` and `-h`** exit 0. They are flags, and `parseArgs` never puts a dash-prefixed argument
  in the command slot, so the old `command === '--help'` branch was unreachable and
  `npx edfcore --help` fell through to "no command" and exited 2.

`edfcore validate` exiting non-zero is the intended way to gate a CI job on file conformance.

Patient identification is omitted from `header`, `validate` and `json` unless `--patient` is passed, for the
same reason `formatHeader` withholds it: the obvious thing to do with CLI output is pipe it
somewhere.

That covers the diagnostics too, which is the part that is easy to miss. A diagnostic names the
raw bytes as written — that is the message contract, and it is what makes a report actionable —
so a NON-CONFORMANT identification field had its whole content printed in the diagnostics block
underneath the summary that had just withheld it. That is not a rare file: a writer that packs the
name into a single token fails the EDF+ grammar, and a file that behaves oddly is exactly the one
someone runs `edfcore header` on and pastes into an issue. Since 0.2.26 both are gated by the same
flag, and the diagnostic still reports its code, severity, byte offset and rule with the value
replaced by `[redacted]`.

`formatDiagnostics` and `formatValidationReport` take `redactFields` for the same purpose:

```ts
formatDiagnostics(header.diagnostics, { redactFields: ['patientId', 'recordingId'] });
```
