---
title: Diagnostics and errors
description: "How edfcore reports a bad file: the diagnostic values on every result, the codes that always throw, strict mode, and the error classes."
section: Guides
order: 6
lead: Real EDF files are full of small deviations. This page covers what edfcore records, what it stops on, and how to tell the two apart in code.
---

## The one rule

**If edfcore cannot proceed without inventing something, it throws. Otherwise it records a
diagnostic on the result and carries on.**

There's no third category. There's no logger to configure, no callback to register, no verbosity
setting, and no `console` call anywhere in the package.

A header with a wrong byte-count field parses: the computed size wins, and the mismatch is
recorded. A header with no recognisable version block does not, because there's no version to
substitute. A signal whose declared ranges do not define a gain gets `scale: undefined` rather than
a fabricated gain of 1.

## Diagnostics are values

A diagnostic is a plain object sitting on whatever produced it. You read the array, or you don't:

```ts
recording.header.diagnostics;    // header parsing
recording.timeline.diagnostics;  // the record-onset probes openEdf made
chunk.diagnostics;               // the annotation regions inside the records you read
result.diagnostics;              // readAnnotations / decodeAnnotations
inspection.diagnostics;          // inspectEdf
report.diagnostics;              // validateRecording, from edfcore/validate
```

Two of those are worth a note. `timeline.diagnostics` folds in whatever decoding the probed records
turned up, so one array explains the whole timeline. `chunk.diagnostics` costs nothing. The
annotation regions of a record live in the same bytes as its samples, so a defect there is found
while decoding the data you already asked for.

Each array is frozen when it is attached, so a result you're holding cannot grow later.

## What a diagnostic carries

```ts
for (const diagnostic of recording.header.diagnostics) {
  console.log(diagnostic.severity, diagnostic.code, diagnostic.byteOffset);
  console.log(diagnostic.message);
}
```

| field | meaning |
|---|---|
| `code` | a stable identifier, e.g. `HEADER_SIZE_MISMATCH` |
| `severity` | `'error'`, `'warning'` or `'info'`, derived from the code |
| `message` | names the field, the bytes as written, the rule, and a next step |
| `field` | the header field or structure at fault, e.g. `'digitalMinimum'` |
| `byteOffset`, `byteLength` | where in the file, for a hexdump |
| `rawBytes` | a copy of the offending bytes, capped in length |
| `raw` | those bytes as text, exactly as written including padding |
| `expected`, `actual` | the rule and the observation, as short strings |
| `signalIndex`, `recordIndex` | which signal and which record, when applicable |
| `specReference` | the clause it violates, e.g. `'EDF+ additional specification 5'` |

Every field is always present as a key; ones that don't apply are `undefined`. Reading a diagnostic
never requires knowing whether a key exists.

`severity` is derived from the code rather than passed in at the reporting site, so one code can't
acquire two severities in two places. `rawBytes` is a copy rather than a view. A diagnostic
outlives the read that produced it, and an I/O adapter is free to reuse its buffer.

`specReference` names a spec clause rather than the behaviour of another library.

## Reading a report

`formatDiagnostics` lays an array out for a human. It adds structure and no wording of its own,
since the message contract already covers the substance:

```ts
import { formatDiagnostics } from 'edfcore';

console.log(formatDiagnostics(recording.header.diagnostics));
```

```text
error [DEGENERATE_DIGITAL_RANGE] signal 1 "Temp rectal" declares digitalMinimum ==
digitalMaximum == 0, so physical scale is undefined (division by zero) (raw "0       " at byte
offset 504). EDF+ additional specification 5: "Digital maximum must be larger than Digital
minimum". Next: decodeDigital() still works on this signal; edfcore will not invent a gain.
  at byte offset 504, digitalMinimum, signal 1
  raw: "0       "
  expected: digitalMaximum > digitalMinimum
  actual: 0 == 0
  spec: EDF+ additional specification 5
```

The output is deterministic (no locale-sensitive formatting, no ANSI escapes unless you ask), so
it's safe to snapshot in a test. It takes two options:

```ts
formatDiagnostics(diagnostics, { color: true, maxItems: 20 });
```

`color` adds ANSI escapes for a terminal, and `maxItems` caps the blocks rendered and appends a
dimmed `... and N more`. `formatDiagnostics([])` returns `''` rather than a blank line, so it
concatenates into a larger report cleanly. When `rawBytes` is present the block includes a hex dump
of up to 24 bytes:

```text
  bytes: 63 61 66 e9  |caf.|
```

### Counting them instead

`formatDiagnostics` produces text for a person. `summarizeDiagnostics` produces numbers for a
program — the question "is anything wrong with this header, and how wrong" has no answer on
`EdfHeader` itself, and `report.ok` needs a full scan.

```ts
import { summarizeDiagnostics } from 'edfcore';

const summary = summarizeDiagnostics(recording.header.diagnostics);

summary.total;      // 4
summary.errors;     // 1
summary.warnings;   // 1
summary.infos;      // 2
summary.worst;      // 'error' — or undefined when there are none at all
summary.byCode;     // [{ code, severity, count }, ...] most frequent first
```

`worst` ranks `error` above `warning` above `info`, not by whichever arrived first, and it is
`undefined` for an empty list rather than `'info'` — so `summary.worst !== undefined` is the
spelling of "anything to report at all".

`byCode` is ordered by count because on a damaged file one code usually accounts for most of the
list: `TIMEKEEPING_TAL_MISSING` is reported per record, so a 130,000-record file can produce
130,000 of them and one of everything else.

> **`errors > 0` does not mean the file failed to read.** The deferred group below carries `error`
> severity while the file parses, reads and decodes perfectly — one signal has no `scale` and
> every other signal is fine. Gating a read on this count throws away good data. Gate on the
> thrown `EdfError`, or on `validateRecording`'s `report.ok`.

## `strict: true`

Pass `strict` and the first would-be diagnostic throws `EdfFormatError` carrying it, instead of
being collected. Under strict, every `diagnostics` array is therefore empty by construction:

```ts
try {
  await openEdf(source, { strict: true });
} catch (error) {
  if (isEdfError(error) && error.edfErrorKind === 'format') {
    console.log(error.code, error.field, error.byteOffset, error.signalIndex);
    console.log(error.diagnostic?.specReference);
  }
}
// DEGENERATE_DIGITAL_RANGE digitalMinimum 504 1
// EDF+ additional specification 5
```

The error carries the whole `diagnostic` it would otherwise have recorded, so nothing is lost by
throwing. The order the checks run in is pinned and tested, which is what makes the error identity
stable across refactors of the parser.

`strict` is part of `ParseOptions`, so it's accepted by the calls that interpret the file:

| accepts `strict` | does not |
|---|---|
| `openEdf`, `readHeader`, `parseHeader` | `readRecords`, `readWindow` |
| `readAnnotations`, `decodeAnnotations` | `inspectEdf` |
| `buildRecordIndex` | `readRecordBytes`, `decodeDigital` |

`readRecords` and `readWindow` decode the annotation regions of the records they read, and those
defects land on `chunk.diagnostics` next to the data they were found beside. `inspectEdf` is
triage, and it has to describe exactly the files whose fields are bad.

> **Warning**
> `strict` is genuinely strict, and almost no real file survives it. The 8-byte header date field
> holds a two-digit year by construction, so nearly every EDF file emits
> `DATE_CLIPPED_TO_1985_2084`. That includes fully conformant EDF+ files that also spell the year
> out in four digits in the recording identification. Use `strict` as an ingest gate, not as a
> default for reading.

## Codes that always throw

Four dispositions decide what a code does when it fires:

| disposition | severity | behaviour |
|---|---|---|
| fatal | `error` | always throws, whether or not `strict` is set |
| deferred | `error` | recorded; `signal.scale` becomes `undefined` and `toPhysical` throws |
| warning | `warning` | recorded; the file deviates from the spec and what you got back is accurate |
| info | `info` | recorded; the file is correct and the situation surprises people |

Eight codes are always fatal. In each case the missing information has no substitute:

| code | why nothing can be substituted |
|---|---|
| `NOT_AN_EDF_FILE` | no EDF or BDF version block at offset 0; there is no format to parse |
| `SOURCE_TOO_SMALL` | fewer than 256 bytes, or fewer than `256 × (ns + 1)` |
| `SIGNAL_COUNT_INVALID` | `ns` outside 1..9999, blank or non-numeric; every later offset is a multiple of it |
| `NUMERIC_FIELD_INVALID` | a field the file geometry depends on failed its grammar end to end |
| `COMMA_DECIMAL_SEPARATOR` | `'0,5'` and `'1,024'` are indistinguishable; guessing turns 1024 into 1.024 |
| `RECORD_SIZE_ZERO` | every signal declares 0 samples per record, so records have no size to step by |
| `EDFPLUS_WITHOUT_ANNOTATION_SIGNAL` | an EDF+ marker with no annotations signal: no per-record timing exists |
| `TIMELINE_NOT_MONOTONIC` | record onsets went backwards; every time-based answer for the file would be wrong |

All eight throw `EdfFormatError` with the matching `code`. `strict: false` does not soften them.

`TIMELINE_NOT_MONOTONIC` is the one that fires late, and only where a violating pair is actually
observed. `openEdf` sees the two probes; `locate` sees the pairs its binary search touches;
`readRecords` sees the records in the chunk; `buildRecordIndex` and `validateRecording` see every
pair in the file. A file whose only violation sits between the two probes therefore opens fine and
throws when you read across it.

## The deferred group

Four codes mean the header parsed but one signal cannot be scaled:

| code | condition |
|---|---|
| `DEGENERATE_DIGITAL_RANGE` | `digitalMinimum === digitalMaximum`; the gain is a division by zero |
| `DEGENERATE_PHYSICAL_RANGE` | `physicalMinimum === physicalMaximum`, or a derived gain that is not a usable float64 |
| `INVERTED_DIGITAL_RANGE` | `digitalMinimum > digitalMaximum`, which has no sanctioned meaning |
| `LOG_TRANSFORMED_CHANNEL` | the physical dimension is exactly `Filtered`: values are log-compressed, so the linear map would be wrong by orders of magnitude |

Their severity is `error`, but they do not throw at parse time. The file is readable and the other
signals are unaffected. The failure is deferred to the exact call that cannot be answered:

```ts
const temp = recording.header.signals[1];
temp.scale;  // undefined — visible in the type, not just at runtime

const chunk = await readRecords(recording, {
  records: { start: 0, count: 1 },
  signalIndices: [temp.index],
});
chunk.signals[0].digital;  // Int32Array — decoding still works

toPhysical(temp, chunk.signals[0].digital);
// EdfScalingError: [DEGENERATE_DIGITAL_RANGE] signal 1 "Temp rectal" declares digitalMinimum ==
// digitalMaximum == 0, which makes the gain a division by zero, so physical units are undefined
// for it. ... Next: decodeDigital() still works on this signal; edfcore will not invent a gain.
```

`signal.scale` is `EdfScale | undefined`, so the compiler makes you check before reading the
gain. Handing the signal straight to `toPhysical` still compiles, and throws at runtime rather
than inventing a number. The reference C implementation substitutes a gain of 1
here and returns ADC counts labelled as microvolts. See
[physical values](/docs/physical-values) for the rest of the scaling story.

`EdfScalingError` carries `code`, `signalIndex` and `label`. The code it reports is re-derived from
the signal in the same fixed order the header used, so it names the same cause the header recorded.
A signal with no scale that matches none of the four conditions reports `SCALE_UNAVAILABLE` rather
than the nearest-looking code.

## Warnings and info

Everything else is recorded and the file keeps working. Thirty-one warning codes, grouped by what
they are about:

| area | codes |
|---|---|
| header structure | `HEADER_SIZE_MISMATCH`, `RECORD_COUNT_RECOVERED`, `TRUNCATED_FILE`, `PARTIAL_FINAL_RECORD`, `TRAILING_BYTES`, `RECORD_SIZE_ABOVE_RECOMMENDED`, `NONSTANDARD_RESERVED_FIELD`, `NON_ASCII_HEADER_FIELD`, `NUMERIC_FIELD_NOT_LEFT_JUSTIFIED` |
| dates and identification | `DATE_CLIPPED_TO_1985_2084`, `DATE_FIELDS_DISAGREE`, `DATE_UNPARSEABLE`, `PATIENT_ID_NONCONFORMANT`, `RECORDING_ID_NONCONFORMANT` |
| signals | `DUPLICATE_SIGNAL_LABEL`, `DIGITAL_RANGE_EXCEEDS_FORMAT`, `ZERO_SAMPLES_PER_RECORD`, `ZERO_RECORD_DURATION`, `ANNOTATION_SIGNAL_HEADER_NONCONFORMANT`, `MISSING_EDFPLUS_MARKER` |
| annotations | `TIMEKEEPING_TAL_MISSING`, `TIMEKEEPING_TAL_NONCONFORMANT`, `START_OFFSET_OUT_OF_RANGE`, `TAL_MALFORMED`, `TAL_TRUNCATED_AT_REGION_END`, `TAL_REGION_NOT_NUL_TERMINATED`, `ANNOTATION_TEXT_NOT_UTF8` |
| timeline | `RECORD_ONSET_SPACING_VIOLATION`, `DISCONTINUITY_IN_CONTINUOUS_FILE` |
| I/O | `SOURCE_SHORT_READ_RECOVERED`, `HTTP_RANGE_IGNORED` |

Two codes are `info`, meaning the file is correct and the note exists only because the situation
surprises people. `INVERTED_PHYSICAL_RANGE` is a physical minimum above the physical maximum. It
encodes a negative amplifier gain and is sanctioned by the EDF FAQ, and edfcore leaves the two as
written, because swapping them flips polarity. `NEGATIVE_ANNOTATION_ONSET` is a pre-stimulus event,
which is how EDF+ writes one.

Diagnostic volume is bounded. A code is repeated only when another occurrence carries information
available nowhere else. `TIMEKEEPING_TAL_MISSING` names a record whose onset had to be derived, so
it's reported per record. `NEGATIVE_ANNOTATION_ONSET` is a property of the writer and is reported
once per call. Defects inside a single annotation region are deduplicated and carry an occurrence
count, because a corrupt region can hold thousands of malformed TALs.

### The code union is open

```ts
type EdfDiagnosticCode = EdfKnownDiagnosticCode | (string & {});
```

Known codes autocomplete, and a `default` branch in your `switch` stays mandatory, so a code added
in a later minor release cannot break exhaustive handling. Codes outside the core vocabulary
already exist. `inspectEdf` adds `INSPECTION_FAILED` and `HEADER_EXCEEDS_INSPECTION_BUDGET`,
`toPhysical` adds `SCALE_UNAVAILABLE`, and `edfcore/validate` adds
`LABEL_CONVENTION_NONCONFORMANT`, `PREFILTERING_NONCONFORMANT`, `TRANSDUCER_TYPE_BLANK` and
`DATE_IMPLAUSIBLE`. An unrecognised code is treated as a warning.

## Error classes

Seven error classes across six kinds, all extending an abstract `EdfError`:

| class | `edfErrorKind` | thrown when |
|---|---|---|
| `EdfFormatError` | `'format'` | the file is wrong, or `strict` caught a diagnostic |
| `EdfScalingError` | `'scaling'` | physical units are undefined for a signal |
| `EdfRangeError` | `'range'` | you asked for records that do not exist |
| `EdfSourceError` | `'source'` | a `ByteSource` returned a different number of bytes than asked |
| `EdfBudgetError` | `'budget'` | an allocation was rejected before it happened |
| `EdfAmbiguousChannelError`, `EdfChannelNotFoundError` | `'channel'` | a label matched several signals, or none |

Each carries the context for its own failure: `EdfRangeError` has `requested` and `available`,
`EdfBudgetError` has `requiredBytes` and `budgetBytes`, `EdfAmbiguousChannelError` has
`matchingIndices`, and so on.

Discriminate on `edfErrorKind`, not `instanceof`:

```ts
import { isEdfError } from 'edfcore';

try {
  return await readWindow(recording, selection);
} catch (error) {
  if (!isEdfError(error)) throw error;

  switch (error.edfErrorKind) {
    case 'budget':  return askForLess(error.budgetBytes);
    case 'range':   return clampToFile(error.available);
    case 'source':  return retry();
    default:        throw error;
  }
}
```

`instanceof` compares constructor identity, and constructor identity is per-realm. An error thrown
inside a worker or an iframe and passed out fails `instanceof EdfFormatError` in the receiving
context even though it is one. So does an error from a second copy of edfcore that a dependency
pulled into the tree. `edfErrorKind` is a string on the object, so it survives all three.
`isEdfError(value)` is the single spelling of that check. It tests for a string `edfErrorKind` and
nothing else.

> **Note**
> Not everything edfcore throws is an `EdfError`, and `isEdfError` returns `false` for those.
> Passing a data signal to `readAnnotations` throws a plain `RangeError`. So does passing an
> annotations signal to `readRecords`, or asking a probed index to map a time window on a file that
> has a gap. An `EdfError` says something about the file; those three say something about the call.

## `inspectEdf`

`inspectEdf` does not throw about the content of a file. For an unfamiliar file (a directory of
them, a user upload, anything you didn't write yourself), it's the first call:

```ts
import { inspectEdf, formatDiagnostics } from 'edfcore';

const inspection = await inspectEdf(source);

inspection.ok;          // true when it parsed and carried no error-severity diagnostic
inspection.variant;     // 'EDF' | 'EDF+C' | ... | undefined
inspection.header;      // EdfHeader | undefined
inspection.byteLength;  // the source's size
inspection.bytesRead;   // what inspection actually cost
inspection.headerBytes; // the bytes it looked at, for a hexdump

console.log(formatDiagnostics(inspection.diagnostics));
```

It reads at most 128 KiB (exactly `256 × 512`, the full header of a 511-signal file). A malformed
file comes back as `ok: false` plus the diagnostic that would otherwise have been thrown, with byte
offset and raw bytes intact. There's no wrapping `try`/`catch` to write per file.

```ts
// A file that is not an EDF at all — a gzip, a vendor container, a truncated download.
const bad = await inspectEdf(byteSource(bytes));
bad.ok;                  // false
bad.header;              // undefined
bad.variant;             // undefined
bad.diagnostics[0].code; // 'NOT_AN_EDF_FILE'
```

The `variant` is a separate best effort. The version block and the reserved field are the first 8
and 44 bytes of the header, and they stay readable long after everything else has stopped making
sense. A file whose signal count is garbage is still reported as `'BDF'` rather than as nothing at
all.

`ok` is true only when the header parsed *and* carried no error-severity diagnostic. A signal whose
scale is unavailable makes `ok` false even though the header itself is readable, since physical
units are genuinely unavailable for that channel. Warnings leave `ok` true, and what's reported
about the file is still accurate.

Two boundaries bound that promise. Only an `EdfError` is converted, and anything else is a bug in
edfcore and is rethrown. The reads happen outside the `catch`, so a dead socket or a file that
vanished still rejects. `inspectEdf` does not throw about *content*, and it does not hide I/O.

A header larger than the 128 KiB ceiling is reported as `HEADER_EXCEEDS_INSPECTION_BUDGET` rather
than half-parsed; `readHeader` and `openEdf` read the whole header however large it is.

## Going further

[`edfcore/validate`](/docs/validation) is a separate entry point holding the checks that do not
affect a single byte offset (label conventions, prefiltering syntax, implausible dates, segment
structure). It also holds a full-file sweep that reports how much of the file it actually read:

```ts
import { validateRecording } from 'edfcore/validate';

const report = await validateRecording(recording, { scanSamples: true });

report.ok;              // every diagnostic is below error severity
report.recordsScanned;  // how many records the sweep actually read
report.bytesRead;       // what it cost, stated rather than implied
report.signalStats;     // observed digital min/max per signal, and out-of-range counts
report.diagnostics;     // header parse + header conformance + timeline + traversal
```

A sweep with `scanSamples: false` reads nothing at all when the onsets are already known. That
covers a complete `index` you passed in, and a plain EDF whose onsets are arithmetic.
`recordsScanned` and `bytesRead` come back as `0` to say so.

It gathers everything known about the recording into one array and leaves duplicates in. Two
genuinely different occurrences of the same code are both reported.

## Where to go next

- [Physical values](/docs/physical-values): the deferred group in full, and what happens to
  `toPhysical` when a header does not define a gain.
- [Annotations](/docs/annotations): the TAL and timekeeping codes, and what each one means for the
  events you get back.
- [Discontinuous recordings](/docs/discontinuous): `DISCONTINUITY_IN_CONTINUOUS_FILE`,
  `TIMELINE_NOT_MONOTONIC`, and the traversal that finds them.
- [Validation](/docs/validation): the conformance checks that live outside the read path, and what
  a full sweep costs.
