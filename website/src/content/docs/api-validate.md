---
title: edfcore/validate
description: Reference for the validate entry point — validateHeader, validateRecording, ValidateOptions, ValidationReport and ObservedSignalStats, field by field.
section: Reference
order: 6
lead: A separate entry point holding the conformance checks that do not affect a single byte offset. Nothing here changes how a byte is interpreted, and a program that never imports it reads exactly the same samples.
---

## The surface

```ts
import { validateHeader, validateRecording } from 'edfcore/validate';
import type { ObservedSignalStats, ValidateOptions, ValidationReport } from 'edfcore/validate';

function validateHeader(header: EdfHeader): readonly EdfDiagnostic[];
function validateRecording(
  recording: EdfRecording,
  options?: ValidateOptions,
): Promise<ValidationReport>;
```

Two functions and three types. The three types are declared in the same file as every other public
shape and are re-exported here, so you can name a `ValidationReport` without reaching into the
universal entry point for it.

[The validation guide](/docs/validation) covers why the split exists and what an observed digital
range tells you about a recording. This page is the field-by-field reference.

## validateHeader

Pure, synchronous, and independent of `header.diagnostics`. It performs no I/O, takes a parsed
header from anywhere — `openEdf`, `readHeader` or `parseHeader` — and returns a frozen array.

```ts
import { formatDiagnostics, readHeader } from 'edfcore';
import { fileSource } from 'edfcore/node';
import { validateHeader } from 'edfcore/validate';

const source = await fileSource('night.edf');
try {
  const header = await readHeader(source);      // two reads, no records
  console.log(formatDiagnostics(validateHeader(header)));
} finally {
  await source.close?.();
}
```

It reports in a fixed order: the record size; then, for each **data** signal in
`header.dataSignalIndices` order, the label convention, the prefiltering field and a blank
transducer type; then the EDF+ patient and recording identification; then the dates. Annotation
signals are skipped throughout — their header fields describe a text region, not a channel.

| code | condition |
|---|---|
| `RECORD_SIZE_ABOVE_RECOMMENDED` | `header.recordByteLength` exceeds 61,440 bytes |
| `LABEL_CONVENTION_NONCONFORMANT` | the label is not `"<type> <sensor>"` with a recognised type |
| `PREFILTERING_NONCONFORMANT` | the prefiltering field is neither blank, nor a "no filtering" spelling, nor space-separated `HP:`/`LP:`/`N:`/`G:` terms |
| `TRANSDUCER_TYPE_BLANK` | a data signal leaves the transducer field empty |
| `PATIENT_ID_NONCONFORMANT` | `header.patient.conformant` is false, on an EDF+ or BDF+ file |
| `RECORDING_ID_NONCONFORMANT` | `header.recording.conformant` is false, on an EDF+ or BDF+ file |
| `DATE_UNPARSEABLE` | `header.startTime.dateSource` is `'none'` |
| `DATE_FIELDS_DISAGREE` | the header date and the recording-id `Startdate` name different days |
| `DATE_IMPLAUSIBLE` | the start date is not a real day, or the patient birthdate is after it |

Four of those exist nowhere else in edfcore: `LABEL_CONVENTION_NONCONFORMANT`,
`PREFILTERING_NONCONFORMANT` and `TRANSDUCER_TYPE_BLANK`, which are the recommendations of EDF+
additional specification 9, and `DATE_IMPLAUSIBLE`. None of them can ever be fatal.
`EdfDiagnosticCode` is an open union precisely so codes can be added here without breaking a
`switch` in your code — keep the `default` branch.

The other five are also emitted by the parser, deliberately, so a report stands on its own instead
of only making sense when read next to `header.diagnostics`.

A few details are easy to trip over:

The label check wants a type from `EEG`, `ECG`, `EOG`, `ERG`, `EMG`, `MEG`, `MCG`, `EP`, `Temp`,
`Resp`, `SaO2`, `Light`, `Sound` and `Event`, matched case-sensitively, followed by more text — a
bare `'EEG'` with no sensor is reported. This is a recommendation and nothing more: a label outside
the list is readable, decodable and extremely common. edfcore has no montage vocabulary and never
infers a channel type from a label.

The prefiltering check passes a completely blank field, and passes `'None'`, `'none'`, `'NONE'` and
`'No filtering'`. Anything else must be entirely made of `HP:`, `LP:`, `N:` and `G:` terms.

The identification checks are skipped entirely when `header.variant` has no `+` in it. Those two
fields are free text in plain EDF and BDF, so reporting a "non-conformance" there would be a false
report.

`DATE_IMPLAUSIBLE` covers two conditions, and in practice you will only see the second. A start date
that is not a real day is rejected by the parser before it gets here — both date fields are refused
outright when they do not name an existing day, which is what `DATE_UNPARSEABLE` reports. The
birthdate check is the reachable one, and its usual cause is a two-digit header year resolved
through the 1985–2084 rule for a recording made outside that window.

## validateRecording

The full sweep. It reads, and it says how much it read.

```ts
import { buildRecordIndex, openEdf } from 'edfcore';
import { fileSource } from 'edfcore/node';
import { validateRecording } from 'edfcore/validate';

const source = await fileSource('night.edf');
try {
  const recording = await openEdf(source);
  const index = await buildRecordIndex(recording);

  const report = await validateRecording(recording, {
    index,
    scanSamples: true,
    onProgress: (done, total) => process.stderr.write(`\r${done}/${total} records`),
  });

  console.log(report.ok, report.recordsScanned, report.bytesRead);
} finally {
  await source.close?.();
}
```

`report.diagnostics` concatenates five sources in a fixed order: `header.diagnostics`, then
`validateHeader(header)`, then `timeline.diagnostics`, then whatever the traversal decoded, then the
structural findings below. Duplicates between them are left in — deduplicating would silently drop
the second of two genuinely different occurrences of the same code, which on a per-record code is
exactly the information you wanted.

Two codes come from the structural check and from nowhere else in this module:
`DISCONTINUITY_IN_CONTINUOUS_FILE`, when the reserved field says the file is continuous but the
onsets fall into more than one segment, and `RECORD_ONSET_SPACING_VIOLATION`, for a gap whose
duration is negative, meaning two segments overlap in time.

One thing still throws rather than being reported: record onsets that go backwards. That is
`TIMELINE_NOT_MONOTONIC`, an `EdfFormatError`, and it is fatal everywhere in edfcore because no
answer derived from those onsets would mean anything. A sweep is where a file that hid the violation
from the two opening probes gets caught. I/O failures propagate too — `validateRecording` reads, so
an `EdfSourceError` or an aborted `options.signal` reaches you unchanged.

### ValidateOptions

```ts
interface ValidateOptions extends ReadOptions {
  readonly signal?: AbortSignalLike;
  readonly maxMaterializeBytes?: number;
  readonly index?: EdfRecordIndex;
  readonly scanSamples?: boolean;
  readonly onProgress?: (done: number, total: number) => void;
}
```

| option | default | effect |
|---|---|---|
| `signal` | none | passed to every read; an aborted signal throws an `Error` named `'AbortError'` |
| `maxMaterializeBytes` | 256 MiB | the per-read ceiling, and it also sizes the traversal's working set |
| `index` | none | a **complete** index whose onsets the sweep reuses instead of reading them again |
| `scanSamples` | `false` | read every sample and fill `signalStats` |
| `onProgress` | none | called once per chunk with `(recordsScanned, header.recordCount)` |

The traversal walks the file in chunks of at most 4 MiB, or `maxMaterializeBytes`, whichever is
smaller, and never fewer than one record even when a single record is larger than that. That bound
is shared with `buildRecordIndex`, so a sweep and an index build have the same working set.

`index` is used only when it covers this file completely: `coverage === 'complete'`, a
`recordCount` equal to `header.recordCount`, and both `segments` and `gaps` present. A probed index
— the one `openEdf` gives you — is silently ignored and the sweep reads the file itself. Passing it
is not an error; it buys nothing.

`onProgress` fires once per chunk while the traversal runs, and does not fire at all when the sweep
reads nothing.

`scanSamples` is never implied. It is the only part of validation that touches sample data, it is
proportional to the size of the recording, and on a 13 GiB BDF that is a decision to make on
purpose.

### What the sweep reads

Two conditions decide whether it reads at all. It must read if you asked for `scanSamples`. It must
read if the file carries per-record timestamps and nothing has told it what they are. Otherwise it
reads nothing, and `recordsScanned` and `bytesRead` come back as `0` to say so.

| situation | records scanned |
|---|---|
| plain EDF or BDF, no `scanSamples` | none |
| EDF+ or BDF+, no usable index, no `scanSamples` | every record |
| EDF+ or BDF+, complete index supplied, no `scanSamples` | none |
| any file, `scanSamples: true` | every record |

A plain EDF has no annotation signal and therefore no timekeeping TALs: record `r` starts at
`r * recordDuration` by definition, so there is nothing to verify and the sweep is pure header
arithmetic.

### ValidationReport

```ts
interface ValidationReport {
  readonly ok: boolean;
  readonly diagnostics: readonly EdfDiagnostic[];
  readonly recordsScanned: number;
  readonly bytesRead: number;
  readonly signalStats: readonly ObservedSignalStats[];
}
```

| field | type | meaning |
|---|---|---|
| `ok` | `boolean` | true when no diagnostic has severity `'error'` |
| `diagnostics` | `readonly EdfDiagnostic[]` | frozen; everything known about the recording, duplicates included |
| `recordsScanned` | `number` | records the traversal actually read; `0` when it read nothing |
| `bytesRead` | `number` | bytes the traversal actually read |
| `signalStats` | `readonly ObservedSignalStats[]` | frozen; empty unless `scanSamples: true` |

`ok` is not a claim that the file is conformant, and a false `ok` is not a claim that it is
unreadable. In practice the error-severity codes that survive to a report are the four scaling ones
— `DEGENERATE_DIGITAL_RANGE`, `DEGENERATE_PHYSICAL_RANGE`, `INVERTED_DIGITAL_RANGE` and
`LOG_TRANSFORMED_CHANNEL` — each of which means one signal has no defined conversion to physical
units while `decodeDigital` on that same signal keeps returning the right integers. The always-fatal
codes never reach a report, because a file carrying one cannot be opened.

`recordsScanned` and `bytesRead` are what actually happened, not an estimate. A report claiming a
file is clean also tells you how much of the file was looked at.

### ObservedSignalStats

```ts
interface ObservedSignalStats {
  readonly signalIndex: number;
  readonly observedDigitalMin: number;
  readonly observedDigitalMax: number;
  readonly outOfDigitalRangeCount: number;
  readonly sampleCount: number;
}
```

| field | type | meaning |
|---|---|---|
| `signalIndex` | `number` | index into `header.signals` |
| `observedDigitalMin` | `number` | smallest digital value seen in the whole file |
| `observedDigitalMax` | `number` | largest digital value seen |
| `outOfDigitalRangeCount` | `number` | samples outside the declared digital range |
| `sampleCount` | `number` | samples examined for this signal |

One entry per data signal, in `header.dataSignalIndices` order. Annotation signals are not included,
because their bytes are text.

These are digital counts — the raw integers on disk, before any scaling — so comparing them with the
range the header declares is the cheapest recording-quality check available. An observed range far
narrower than the declared one means the acquisition range was set much wider than the signal ever
used; observed extremes sitting exactly on the declared bounds is the signature of a clipped
amplifier.

`outOfDigitalRangeCount` above zero means the declared range is wrong, not that the samples are.
edfcore never clamps. The count is compared against the `min`/`max` of the declared pair rather than
against the pair as written, so an inverted declaration does not report every sample in the file as
out of range.

A `sampleCount` of `0` means the signal has no samples in the file at all — a signal declaring zero
samples per record, or a file with zero records. `observedDigitalMin` and `observedDigitalMax` are
both `0` in that case rather than infinities, so the struct stays numeric; `sampleCount === 0` is
what tells you it is empty.

## What this module does not do

It does not repair, and nothing in edfcore writes. It does not modify the recording, the header or
the source: call `validateRecording` twice and you get the same report. And it does not gate
reading — a file with a hundred warnings is a file you can read. If you want failures to be loud at
parse time instead, that is `strict: true` on `openEdf`, a different mechanism on the core side of
the line.

It also does not certify anything. edfcore is 0.1 and has not been compared element by element against the established readers on the public
corpora that would let anyone claim it agrees with the established readers across real files. Treat
a clean report as "edfcore found nothing to complain about", which is a useful statement and a
smaller one than "this file is conformant".

## Where to go next

- [Validation](/docs/validation) — the narrative, with a full conformance report end to end.
- [Errors and diagnostic codes](/docs/api-errors) — the complete code table, including the four
  codes this module owns.
- [Types](/docs/api-types) — `EdfDiagnostic`, `EdfRecordIndex` and every other shape named above.
