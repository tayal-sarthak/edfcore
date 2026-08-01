---
title: Validation
description: "The edfcore/validate entry point: header conformance, the full-file sweep, and what an observed digital range tells you about a recording."
section: Guides
order: 8
lead: Reading a file and auditing a file are different jobs. Every check that decides where a byte is lives in the core and is always on. Checks that only report a deviation from the spec live in edfcore/validate, where you pay for them when you ask.
---

## Start here

`edfcore/validate` has two functions. `validateHeader` is pure and synchronous and looks only at a parsed header. `validateRecording` is the full sweep, and it reads.

```ts
import { openEdf } from 'edfcore';
import { fileSource } from 'edfcore/node';
import { validateRecording } from 'edfcore/validate';

const source = await fileSource('night.edf');
try {
  const recording = await openEdf(source);
  const report = await validateRecording(recording);

  console.log(report.ok ? 'no errors' : 'errors present');
  for (const diagnostic of report.diagnostics) {
    console.log(`${diagnostic.severity} [${diagnostic.code}] ${diagnostic.message}`);
  }
} finally {
  await source.close?.();
}
```

A file with warnings is still a readable file. Nothing in this module changes how a single byte is interpreted, and a program that never imports it reads exactly the same samples.

## The split rule

There's one line between the core and this module: **does the check affect a byte offset?**

If it does, it belongs to the core and runs on every open. A signal count outside 1..9999 makes every later offset in the header wrong, so `parseHeader` rejects it whether or not you asked for validation. A record size of zero leaves no stride to step records by. A comma decimal separator makes `1,024` and `0,5` indistinguishable. Those throw.

If it only reports a deviation from the recommendations, it lives here. A transducer field left blank, a label not written as `"<type> <sensor>"`, a prefiltering field that spells out "bandpass 0.1-75" instead of `HP:0.1Hz LP:75Hz`: none of these move a byte. A full-file conformance sweep stays off the open path of a program that wants ten seconds of channel 3.

Some codes appear in both places. `RECORD_SIZE_ABOVE_RECOMMENDED` and `PATIENT_ID_NONCONFORMANT` are emitted by the parser and re-emitted here, so a validation report stands on its own without `header.diagnostics` beside it.

Four codes are unique to this module and appear nowhere in the core vocabulary. `LABEL_CONVENTION_NONCONFORMANT`, `PREFILTERING_NONCONFORMANT` and `TRANSDUCER_TYPE_BLANK` are the recommendations of EDF+ additional specification 9. `DATE_IMPLAUSIBLE` covers a date that cannot be real. None of them can ever be fatal. `EdfDiagnosticCode` is an open union, so codes can be added here without breaking a `switch` in your code. Keep the `default` branch.

## validateHeader

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

`validateHeader` itself performs no I/O and is not async. It takes an `EdfHeader` (from `readHeader`, from `openEdf`, or from `parseHeader` if you already hold the bytes) and returns a frozen `readonly EdfDiagnostic[]`. It does not read `header.diagnostics` and does not depend on what the parser found, so running both costs nothing and neither can mask the other.

What it checks, in the order it reports them: the record size against the 61,440-byte recommendation; then, for each data signal, the label convention, the prefiltering field and a blank transducer type; then the EDF+ patient and recording identification grammars; then the dates.

The label check wants the EDF+ form `"<type> <sensor>"`, with the type drawn from `EEG`, `ECG`, `EOG`, `ERG`, `EMG`, `MEG`, `MCG`, `EP`, `Temp`, `Resp`, `SaO2`, `Light`, `Sound` and `Event`. Matching is case-sensitive. This is a recommendation and nothing more: a label outside the list is readable, decodable and extremely common. edfcore has no montage vocabulary and never infers a channel type from a label. The list exists to report a deviation.

The identification checks are skipped entirely for plain EDF and BDF, where those two fields are free text.

The date checks are the ones most likely to matter. `DATE_UNPARSEABLE` means the file has no calendar date at all. Elapsed times are unaffected, but there's no day to put them on. `DATE_FIELDS_DISAGREE` means the `dd.mm.yy` header field and the EDF+ `Startdate` subfield name different days. Both are exposed on `header.startTime`, and edfcore reports which one it used. `DATE_IMPLAUSIBLE` covers a day that does not exist and a patient birthdate after the recording start. That's usually a two-digit year resolved through the 1985-2084 rule for a recording made outside that window.

## validateRecording

```ts
import { buildRecordIndex } from 'edfcore';
import { validateRecording } from 'edfcore/validate';

const controller = new AbortController();
const index = await buildRecordIndex(recording);

const report = await validateRecording(recording, {
  index,
  scanSamples: true,
  onProgress: (done, total) => console.log(`${done}/${total} records`),
  signal: controller.signal,
  maxMaterializeBytes: 8 * 1024 * 1024,
});
```

`ValidateOptions` extends `ReadOptions`, so `signal` and `maxMaterializeBytes` work here as they do on any other read. `maxMaterializeBytes` also sizes the traversal's working set. The sweep walks the file in chunks of at most 4 MiB, or your budget, whichever is smaller. A chunk is never fewer than one record, even when a single record is larger than that. `onProgress(done, total)` fires once per chunk, counting records.

The report gathers everything known about the recording into one array: what the header parse found, what `validateHeader` re-checks, what the timeline probes saw, and what the traversal decoded. Duplicates between those sources are left in, so two genuinely different occurrences of the same per-record code both appear.

One thing still throws rather than reporting: a timeline whose record onsets go backwards. That's fatal everywhere in edfcore, because no answer derived from those onsets would mean anything. A sweep is where a file that hid it from the two opening probes gets caught.

```ts
import { isEdfError } from 'edfcore';
import type { EdfFormatError } from 'edfcore';

try {
  await validateRecording(recording);
} catch (error) {
  if (isEdfError(error) && error.edfErrorKind === 'format') {
    console.log((error as EdfFormatError).code);   // TIMELINE_NOT_MONOTONIC
  }
}
```

### What a sweep costs

`recordsScanned` and `bytesRead` on the report are what actually happened, not an estimate. A report claiming a file is clean also tells you how much of the file was looked at.

Two conditions decide whether the sweep reads at all. It must read if you asked for `scanSamples`. It must read if the file carries per-record timestamps and nothing has told it what they are. It reads nothing otherwise.

| Situation | Records scanned |
| --- | --- |
| Plain EDF or BDF, no `scanSamples` | none |
| EDF+ or BDF+, no index, no `scanSamples` | every record |
| EDF+ or BDF+, complete index supplied, no `scanSamples` | none |
| Any file, `scanSamples: true` | every record |

A plain EDF has no annotation signal and therefore no timekeeping TALs. Record `r` starts at `r * recordDuration` by definition, so there's nothing to verify and the sweep is pure header arithmetic. An EDF+ file stores each record's true onset in its first annotation signal. Checking that the records are spaced the way the file claims means reading all of them, unless you already did and hand over the result:

```ts
import { buildRecordIndex } from 'edfcore';

const index = await buildRecordIndex(recording);      // one traversal
const report = await validateRecording(recording, { index });

console.log(report.recordsScanned, report.bytesRead);  // 0 0
```

That's what the option is for: conformance costs one traversal rather than two. The index has to be a complete one, meaning `coverage === 'complete'`, covering exactly `header.recordCount` records, with its segments and gaps present. A probed index, which is what `openEdf` gives you, describes only the first and last record. It's ignored, and the sweep reads the file itself. Passing one is not an error; it buys nothing.

`scanSamples` is never implied. It's the only part of validation that touches sample data, and its cost is proportional to the size of the recording. On a 13 GiB BDF, that is every record.

## The report

```ts
interface ValidationReport {
  readonly ok: boolean;
  readonly diagnostics: readonly EdfDiagnostic[];
  readonly recordsScanned: number;
  readonly bytesRead: number;
  readonly signalStats: readonly ObservedSignalStats[];
}
```

`ok` is true when no diagnostic has severity `error`. It is not a claim that the file is conformant, and a false `ok` is not a claim that the file is unreadable. In practice the error-severity codes that survive to a report are the scaling ones (`DEGENERATE_DIGITAL_RANGE`, `DEGENERATE_PHYSICAL_RANGE`, `INVERTED_DIGITAL_RANGE`, `LOG_TRANSFORMED_CHANNEL`). Each of them means one signal has no defined conversion to physical units. `signal.scale` is `undefined` for it, `toPhysical` throws `EdfScalingError`, and `decodeDigital` on that same signal keeps working and returns the right integers. The always-fatal codes never reach a report at all, because a file carrying one of them cannot be opened. The single exception is `TIMELINE_NOT_MONOTONIC`, which the sweep throws rather than reports.

`signalStats` is empty unless you passed `scanSamples: true`. It has one entry per data signal, in `header.dataSignalIndices` order; annotation signals are not included, because their bytes are text.

### Observed signal statistics

```ts
interface ObservedSignalStats {
  readonly signalIndex: number;
  readonly observedDigitalMin: number;
  readonly observedDigitalMax: number;
  readonly outOfDigitalRangeCount: number;
  readonly sampleCount: number;
}
```

These are digital counts (the raw integers on disk, before any scaling). Comparing them with the range the header declares is the cheapest recording-quality check you can run.

**Observed range far narrower than declared** means the acquisition range was set much wider than the signal ever used. A channel declared `-32768..32767` whose samples never leave `-180..180` is using about half a percent of the converter's range. The physical values are still correct, since the header's gain maps the range it declared. The effective resolution of that channel is far below the 16 bits the file's format suggests. That's worth knowing before you compare it against a recording made with a sensible range.

**Observed extremes sitting exactly on the declared bounds, with a large sample count there**, is the signature of clipping. edfcore cannot distinguish a clipped sample from a genuine one at the rail, and it does not try. A channel whose observed maximum equals its declared maximum, on a recording that should be nowhere near it, is a saturated amplifier.

**`outOfDigitalRangeCount` above zero** means the declared range is wrong, not that the samples are. edfcore never clamps. The count comes from the same pass that decodes the samples, so it's free. It's compared against `min`/`max` of the declared pair rather than the pair as written. An inverted declaration therefore doesn't report every sample in the file as out of range. `toPhysical` applies the header's linear gain to those samples like any other, which extrapolates past the declared physical range. To reproduce a clamping reader such as EDFlib, `clampToDigitalRange` is exported; it is never on the read path.

**A `sampleCount` of zero** means the signal has no samples in the file at all. `observedDigitalMin` and `observedDigitalMax` are both reported as `0` in that case rather than as infinities, so the struct stays numeric; `sampleCount === 0` is what tells you it's empty.

## A conformance report end to end

```ts
import { formatDiagnostics, getSignal, openEdf } from 'edfcore';
import { fileSource } from 'edfcore/node';
import { validateRecording } from 'edfcore/validate';

const path = process.argv[2];
if (path === undefined) throw new Error('usage: conformance <file.edf>');

const source = await fileSource(path);
try {
  const recording = await openEdf(source);
  const { header } = recording;

  const report = await validateRecording(recording, {
    scanSamples: true,
    onProgress: (done, total) => {
      process.stderr.write(`\rscanning ${done}/${total} records`);
    },
  });
  process.stderr.write('\n');

  console.log(`${path}: ${header.variant}, ${header.recordCount} records of `
    + `${header.recordDurationSeconds} s, ${header.signals.length} signals`);
  console.log(`${report.ok ? 'no errors' : 'ERRORS'}, ${report.diagnostics.length} diagnostics, `
    + `${report.recordsScanned} records and ${report.bytesRead} bytes read`);

  if (report.diagnostics.length > 0) {
    console.log('');
    console.log(formatDiagnostics(report.diagnostics));
  }

  console.log('');
  for (const stats of report.signalStats) {
    const signal = getSignal(header, stats.signalIndex);
    const declared = Math.abs(signal.digitalMaximum - signal.digitalMinimum);
    const observed = stats.observedDigitalMax - stats.observedDigitalMin;
    const used = declared === 0 ? 0 : (100 * observed) / declared;

    console.log(
      `${signal.label.padEnd(16)} declared ${signal.digitalMinimum}..${signal.digitalMaximum}`
        + `  observed ${stats.observedDigitalMin}..${stats.observedDigitalMax}`
        + `  (${used.toFixed(1)}% of range)`
        + `  ${stats.outOfDigitalRangeCount} of ${stats.sampleCount} outside`,
    );
  }
} finally {
  await source.close?.();
}
```

Run it against a ten-minute EDF+C file whose second channel is labelled `Fp1`. That channel carries a free-text prefiltering field and a blank transducer type, and declares a digital range of `-100..100` that its samples do not respect. It prints this, with two diagnostic blocks elided:

```
scanning 600/600 records
sample.edf: EDF+C, 600 records of 1 s, 3 signals
no errors, 4 diagnostics, 600 records and 650400 bytes read

warning [DATE_CLIPPED_TO_1985_2084] startdate field (8 bytes at offset 168) is "02.03.02": its two-digit year was resolved to 2002 by the EDF+ rule that 85..99 mean 1985..1999 and 00..84 mean 2000..2084, so the field cannot express a year outside that span. EDF+ additional specification 2 (1985 is the clipping date). Next: for an unambiguous year read startTime.recordingIdDate, which the EDF+ recording identification spells out in four digits.
  at byte offset 168 (8 bytes), startDate
  raw: "02.03.02"
  expected: 1985..2084
  actual: 2002
  spec: EDF+ additional specification 2 (startdate and starttime)
warning [LABEL_CONVENTION_NONCONFORMANT] signal 1 is labelled "Fp1", which is not the EDF+ form "<type> <sensor>" such as "EEG Fpz-Cz" with the type taken from EEG, ECG, EOG, ERG, EMG, MEG, MCG, EP, Temp, Resp, SaO2, Light, Sound, Event. EDF+ additional specification 9 (standard texts and labels). Next: nothing is affected — edfcore never infers a channel type from a label, and getSignal(header, label) matches the trimmed text exactly as written.
  at byte offset 272 (16 bytes), label, signal 1
  raw: "Fp1             "
  expected: "<type> <sensor>", e.g. "EEG Fpz-Cz"
  actual: Fp1
  spec: EDF+ additional specification 9 (standard texts and labels)

EEG Fpz-Cz       declared -32768..32767  observed -180..180  (0.5% of range)  0 of 153600 outside
Fp1              declared -100..100  observed -150..150  (150.0% of range)  81806 of 153600 outside
```

Both stat lines say something. The first channel uses half a percent of the range its header declares, which is legal and lossy: the physical values are right, and the channel carries far less than 16 bits of real resolution. The second is the more serious one. 81,806 of its 153,600 samples fall outside the range the header declares, so that declaration is wrong. Any consumer that clamps to it returns different numbers for this file than edfcore does.

`formatDiagnostics` is in the main entry point, not this one. It renders any `EdfDiagnostic` array, so the same call formats `header.diagnostics`, `chunk.diagnostics` and a validation report. Pass `{ maxItems: 20 }` to cap a long report and `{ color: true }` for ANSI severity colours. The output is otherwise deterministic, with no locale-sensitive formatting anywhere.

## Limits

It does not repair. Nothing in edfcore writes, and nothing here corrects a field. Every diagnostic carries the raw bytes it was raised on so you can see what was actually written.

It does not modify the recording, the header or the source. `validateRecording` reads and returns; call it twice and you get the same report.

It does not gate reading. A file with a hundred warnings is a file you can read, and a file with an error-severity scaling diagnostic is a file you can read in digital units. For failures at parse time instead, `strict: true` on `openEdf` turns the first would-be diagnostic into a thrown `EdfFormatError`.

And it does not certify anything. edfcore reads PhysioNet's Sleep-EDF and the teuniz test files correctly, but its output has not yet been compared against pyEDFlib or MNE element by element. Treat a clean report as "edfcore found nothing to complain about", which is a useful statement and a smaller one than "this file is conformant".

Related: [data sources](/docs/data-sources) covers the `ByteSource` a recording is opened over, including the `signal` you can pass to cancel a long sweep.
