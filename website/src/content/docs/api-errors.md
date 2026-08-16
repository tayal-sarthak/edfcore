---
title: Errors and diagnostic codes
description: The seven error classes and their fields, how to discriminate them without instanceof, and the complete diagnostic code table grouped by disposition.
section: Reference
order: 5
lead: One rule decides which of these you get. edfcore throws when proceeding would mean making up a value, and records a diagnostic on the result when it can proceed without one. There is no third category, and there is no console call anywhere in the package.
---

## `edfErrorKind`

Every error edfcore throws carries a string `edfErrorKind`, and `isEdfError` is the one spelling of
the check:

```ts
import { isEdfError, readWindow } from 'edfcore';

try {
  return await readWindow(recording, selection);
} catch (error) {
  if (!isEdfError(error)) throw error;

  switch (error.edfErrorKind) {
    case 'budget':
      return askForLess(error.budgetBytes);
    case 'range':
      return clampToFile(error.available);
    case 'source':
      return retry();
    default:
      throw error;
  }
}
```

`instanceof` compares constructor identity, and constructor identity is per-realm. An error thrown
inside a worker or an iframe and passed out fails `instanceof EdfFormatError` in the receiving
context even though it is one. So does an error from a second copy of edfcore that some dependency
pulled into the tree. A string property survives all three.

> **Note**
> No cast is needed in any branch. `isEdfError` narrows to `AnyEdfError`, a discriminated union over
> the seven concrete classes, so `switch (error.edfErrorKind)` reaches `budgetBytes` and `available`
> directly. Narrowing against the abstract `EdfError` would not: it declares `edfErrorKind` and
> nothing else, which is exactly why the union exists.

```ts
function isEdfError(value: unknown): value is AnyEdfError;
```

It tests for an object with a string `edfErrorKind` and nothing else. `AnyEdfError` and `EdfError`
are both exported: the first is the union you switch over, the second is the abstract base. It's the abstract base every class below extends, and `error.name` is the concrete
class's name — `'EdfFormatError'` rather than `'Error'` — so a stack trace says which one you got.

That name is a **string literal**, not `new.target.name`. A minifier rewrites `class
EdfFormatError` to `class t` and `Function.prototype.name` follows it, so until 0.3.12 any
consumer bundle built with `esbuild --minify`, rollup + terser or webpack in production mode saw
`error.name === 't'` — in exactly the browser build where `error.name` is what you branch on.

```ts
type EdfErrorKind = 'format' | 'scaling' | 'range' | 'source' | 'budget' | 'channel';
```

Six kinds, seven classes: the two channel errors share `'channel'` because a caller recovering from
"I could not resolve that label" recovers the same way for both.

## The error classes

| class | `edfErrorKind` | thrown when |
|---|---|---|
| `EdfFormatError` | `'format'` | the file is wrong, or `strict` caught a diagnostic |
| `EdfScalingError` | `'scaling'` | physical units are undefined for one signal |
| `EdfRangeError` | `'range'` | you asked for records that do not exist |
| `EdfSourceError` | `'source'` | a `ByteSource` broke its contract, or could not be reached |
| `EdfBudgetError` | `'budget'` | an allocation was refused before it happened |
| `EdfAmbiguousChannelError` | `'channel'` | a label matched more than one signal |
| `EdfChannelNotFoundError` | `'channel'` | a label or index matched none |

Each carries the context for its own failure, so you never have to parse the message.

### EdfFormatError

| field | type | meaning |
|---|---|---|
| `code` | `EdfDiagnosticCode` | the diagnostic code that fired |
| `diagnostic` | `EdfDiagnostic \| undefined` | the whole diagnostic it would otherwise have recorded |
| `collected` | `readonly EdfDiagnostic[]` | everything already found when this became fatal, in order; empty when the fatal was raised before any collection existed |
| `field` | `string \| undefined` | the header field at fault |
| `byteOffset` | `number \| undefined` | where in the file |
| `signalIndex` | `number \| undefined` | which signal |
| `recordIndex` | `number \| undefined` | which record |

The last four default to the matching fields of `diagnostic`, so nothing is lost by throwing rather
than collecting:

```ts
import { isEdfError, openEdf } from 'edfcore';
import type { EdfFormatError } from 'edfcore';

try {
  await openEdf(source, { strict: true });
} catch (error) {
  if (isEdfError(error) && error.edfErrorKind === 'format') {
    const formatError = error as EdfFormatError;
    console.log(formatError.code);                           // 'DEGENERATE_DIGITAL_RANGE'
    console.log(formatError.field, formatError.byteOffset);  // 'digitalMinimum' 504
    console.log(formatError.signalIndex);                    // 1
    console.log(formatError.diagnostic?.specReference);      // 'EDF+ additional specification 5'
  }
}
```

The public initialiser type is exported too, as `EdfFormatErrorInit`: `{ code, diagnostic?, field?,
byteOffset?, signalIndex?, recordIndex?, cause? }`. You need it only if you construct one yourself.

### EdfScalingError

| field | type | meaning |
|---|---|---|
| `code` | `EdfDiagnosticCode` | which of the four scaling conditions applies |
| `signalIndex` | `number` | the signal with no defined gain |
| `label` | `string` | that signal's trimmed label |

Thrown by `toPhysical` for a signal whose `scale` is `undefined`. The code is re-derived from the
signal by applying the same four tests the header applied, in the same order. For those four it
names the same cause the header recorded. A signal that matches none of them yet still has no scale
reports `SCALE_UNAVAILABLE` rather than the nearest-looking code — including `buildScale`'s fifth
refusal, a derived gain that is not a usable float64, which the header records as
`DEGENERATE_PHYSICAL_RANGE` and which cannot be re-derived from an `EdfSignal` alone.

### EdfRangeError

| field | type | meaning |
|---|---|---|
| `requested` | `RecordRange` | what you asked for |
| `available` | `RecordRange` | what the file has, always starting at `0` |

Your bug, not the file's. `readRecordBytes`, `readRecords` and `index.onsetTicks` all throw it.

### EdfSourceError

| field | type | meaning |
|---|---|---|
| `offset` | `number` | the byte offset of the read that failed |
| `requestedLength` | `number` | how many bytes were asked for |
| `receivedLength` | `number \| undefined` | how many arrived, when that is knowable |

The `ByteSource` contract is one sentence: a read resolves with exactly `length` bytes or rejects,
never padding and never truncating. It's checked on every call, including calls into a source you
wrote. `receivedLength` is `number | undefined` because a misbehaving source may resolve with
something that is not a byte array at all.

`httpSource` uses this class for its own failures too. It throws when no `fetch` implementation is
available, when a server reports no usable size, on a non-success status, and when a server ignores
the `Range` header. Those carry an `offset` and a `requestedLength` describing the read that
provoked them.

### EdfBudgetError

| field | type | meaning |
|---|---|---|
| `requiredBytes` | `number` | the allocation that was refused |
| `budgetBytes` | `number` | the ceiling in force |
| `optionName` | `'maxMaterializeBytes'` | the option to raise, as a literal |

The check happens before the allocation is attempted rather than during it. Float64 physical output
is four times the on-disk size for EDF, so one large call can take down a browser tab. The default
ceiling is 256 MiB. Decode fewer records per call, reuse an `out` array, or raise the option.

### EdfAmbiguousChannelError and EdfChannelNotFoundError

| `EdfAmbiguousChannelError` | type | meaning |
|---|---|---|
| `label` | `string` | the trimmed label you asked for |
| `matchingIndices` | `readonly number[]` | every signal carrying it |

| `EdfChannelNotFoundError` | type | meaning |
|---|---|---|
| `selector` | `string \| number` | the label or index you passed |
| `availableLabels` | `readonly string[]` | every label in the file, in signal order |

Real files ship duplicate labels: CHB-MIT carries `T8-P8` twice. Returning the first without a word
is how the wrong channel ends up in a paper. `getSignal` throws and hands you the indices;
`findSignals` returns them all when that is what you want.

> **Note**
> Not everything edfcore throws is an `EdfError`. Passing an annotations signal to `readRecords`
> throws a plain `RangeError`, and so does a bad argument shape passed to a primitive. So does
> asking a probed index to map a time window on a file that has a gap. `isEdfError` returns `false`
> for all three. An `EdfError` says something about the file; a `RangeError` says something about
> the call. Aborting through `options.signal` throws an `Error` whose `name` is `'AbortError'`, the
> property the platform's own consumers branch on.

## Dispositions

Every code has exactly one severity and one disposition, both fixed in one file. The disposition is
what the code *does*; the severity is what it *is*.

| disposition | `severity` | behaviour |
|---|---|---|
| fatal | `'error'` | throws `EdfFormatError`, whether or not `strict` is set |
| deferred | `'error'` | recorded; `signal.scale` becomes `undefined` and `toPhysical` throws |
| warning | `'warning'` | recorded; the file is non-conformant and what you got back is true |
| info | `'info'` | recorded; the file is correct and the situation surprises people |

Severity is derived from the code rather than passed in at the reporting site, so one code cannot
acquire two severities in two places. Under `strict: true` the first would-be diagnostic throws
instead — except an `info` one, which is exempt and is still collected. So a strict parse of a file
whose only note is `info` resolves, carrying it.

## Always fatal

Nine codes. Each names something the file does not supply, so these throw whether or not `strict`
is set.

| code | what it means | what to do |
|---|---|---|
| `NOT_AN_EDF_FILE` | no recognisable EDF or BDF version block at offset 0 | check the file is not gzipped, a vendor container, or a truncated download; `inspectEdf` reports this without throwing |
| `SOURCE_TOO_SMALL` | fewer than 256 bytes, or fewer than `256 * (ns + 1)` | the header is incomplete; check the whole file arrived, and that the source was built over the whole file rather than a prefix |
| `SIGNAL_COUNT_INVALID` | `ns` is blank, non-numeric, or outside 1..9999 | every later offset is a multiple of `ns`, so nothing can be read; hexdump bytes 252-255 |
| `NUMERIC_FIELD_INVALID` | a field the file geometry depends on failed its grammar end to end | the error names the field and its offset; the file needs repairing at the writer |
| `COMMA_DECIMAL_SEPARATOR` | a numeric field uses `,` as its decimal separator | `'0,5'` and `'1,024'` are indistinguishable, and guessing turns 1024 into 1.024; rewrite the field with `.` |
| `RECORD_SIZE_ZERO` | every signal declares 0 samples per record | records have no size to step by, so no record can be located |
| `EDFPLUS_WITHOUT_ANNOTATION_SIGNAL` | an EDF+ marker with no annotations signal | no per-record timing exists, so any time reported would be invented; either the marker or the signal is wrong |
| `TIMELINE_NOT_MONOTONIC` | record onsets went backwards | every time-based answer would be wrong; read by record index with `readRecords`, or repair the timekeeping TALs |
| `RECORDING_SPAN_UNREPRESENTABLE` | `recordCount * recordDuration` exceeds the signed 64-bit tick range | onsets are stored as 100 ns ticks, so the later records have no representable start; the record duration field is wrong |

`TIMELINE_NOT_MONOTONIC` is the one that fires late, and only where a violating pair is actually
observed. `openEdf` sees the two probes; `locate` sees the pairs its binary search touches;
`readRecords` sees the records in the chunk; `buildRecordIndex` and `validateRecording` see every
pair in the file. A file whose only violation sits between the two probes opens fine and throws
when you read across it.

## Deferred-fatal

Five codes. The header parses, the file is readable, and one signal has no defined conversion to
physical units. Their severity is `error`, and they do not throw at parse time.

| code | what it means | what to do |
|---|---|---|
| `DEGENERATE_DIGITAL_RANGE` | `digitalMinimum === digitalMaximum`, so the gain is a division by zero | use `decodeDigital` on that signal; the other signals are unaffected |
| `DEGENERATE_PHYSICAL_RANGE` | `physicalMinimum === physicalMaximum`, so every sample maps to one value | as above |
| `INVERTED_DIGITAL_RANGE` | `digitalMinimum > digitalMaximum`, which has no sanctioned meaning | as above; edfcore will not guess which one the writer meant |
| `LOG_TRANSFORMED_CHANNEL` | the physical dimension is exactly `Filtered`, so values are log-compressed | the linear formula would be wrong by orders of magnitude; apply the log transform yourself over `decodeDigital` output |
| `SCALE_UNAVAILABLE` | none of the four above applies and there is still no scale — including the annotations channel, whose fields describe TAL text rather than measurements | `toPhysical` names which case it is; for the annotations channel call `readAnnotations` |

The failure lands on the exact call that cannot be answered. `signal.scale` is
`EdfScale | undefined`, so the compiler makes you check before reading the gain, though
`toPhysical` itself accepts any `EdfSignal` and throws at runtime. See
[physical values](/docs/physical-values) for the whole story.

## Warnings

Twenty-nine codes. The file stays readable and what edfcore returns about it is true. Two further
names appear in the tables below and carry no disposition, because nothing emits them — see the
note under **I/O**.

### Header structure

| code | what it means | what to do |
|---|---|---|
| `HEADER_SIZE_MISMATCH` | byte 184 disagrees with `256 * (ns + 1)` | nothing; the computed size wins and `declaredHeaderByteLength` keeps the claim |
| `RECORD_COUNT_RECOVERED` | the record count was `-1`, negative or unreadable, and was recovered from the source length | check that the source's `byteLength` is the true file size; `recordCountSource` is `'sourceByteLength'` |
| `TRUNCATED_FILE` | the source is shorter than the declared record count implies | the whole records present are exposed; the rest of the file never arrived |
| `PARTIAL_FINAL_RECORD` | the source ends part-way into a record | nothing; only whole records are exposed and nothing is zero-padded, because padding would decode as real samples |
| `TRAILING_BYTES` | bytes exist beyond the last declared data record | nothing; they are never decoded and `dataByteLength` counts only the declared records |
| `RECORD_SIZE_ABOVE_RECOMMENDED` | a data record exceeds the 61,440-byte recommendation | nothing; but every read is record-aligned, so this is also the smallest amount of data any read of this file can return |
| `NONSTANDARD_RESERVED_FIELD` | the reserved field is neither blank nor a recognised marker, or its marker names the other family | the file is read as whatever the version block says; a `D` marker's continuity is still honoured |
| `NON_ASCII_HEADER_FIELD` | a header field carries bytes outside printable ASCII | nothing is lost; the text is decoded as Latin-1 and `raw` keeps the bytes |
| `NUMERIC_FIELD_NOT_LEFT_JUSTIFIED` | a numeric field is right-justified where the spec asks for left | nothing; the value is used as read |

### Dates and identification

| code | what it means | what to do |
|---|---|---|
| `DATE_FIELDS_DISAGREE` | the header `dd.mm.yy` field and the EDF+ `Startdate` subfield name different days | both stay on `header.startTime`; `dateSource` says which one was used |
| `DATE_UNPARSEABLE` | the 8-byte `dd.mm.yy` startdate field is not a readable date | `startTime.headerDate` is `undefined`. The EDF+ `Startdate` subfield may still supply the date, in which case `dateSource` is `'recordingIdField'` and nothing is lost; when it does not, `dateSource` is `'none'`, every elapsed time is still unaffected, and `formatStartTimeNaive` has nothing to return |
| `STARTTIME_UNPARSEABLE` | the starttime field is not a clock | `startTime.clockSource` is `'none'` and `clock` is a substituted midnight; the calendar date is unaffected |
| `PATIENT_ID_NONCONFORMANT` | the patient field does not follow the EDF+ four-subfield grammar | `header.patient` keeps every subfield that could be read plus the raw text; nothing about the samples changes |
| `RECORDING_ID_NONCONFORMANT` | the recording field does not follow the EDF+ grammar | as above; a `Startdate` that could not be read leaves the two-digit year as the only date source |

### Signals

| code | what it means | what to do |
|---|---|---|
| `DUPLICATE_SIGNAL_LABEL` | two or more signals share a label | `getSignal` by label throws `EdfAmbiguousChannelError`; use `findSignals`, or select by index |
| `DIGITAL_RANGE_EXCEEDS_FORMAT` | the declared digital range exceeds what the sample width can represent | the range is used for scaling exactly as written — edfcore never clamps — so expect physical values that extrapolate beyond the declared physical range |
| `ZERO_SAMPLES_PER_RECORD` | a signal declares 0 samples per record | the signal is still exposed with `sampleCount` 0 and a zero-length block; the other signals' offsets skip it exactly |
| `ZERO_RECORD_DURATION` | the record duration is 0 | legal in EDF+ for an annotations-only recording; `sampleRateHz` is `undefined` for every signal, so index by `samplesPerRecord` and never divide by the duration |
| `ANNOTATION_SIGNAL_HEADER_NONCONFORMANT` | an annotation signal's header fields deviate from the EDF+ requirements | the annotations are read anyway; the header block of an annotations channel describes a text region, not measurements |
| `MISSING_EDFPLUS_MARKER` | an `EDF Annotations` signal exists with no EDF+ marker in the reserved field | the annotations are parsed anyway and the channel is never exposed as an ordinary signal |

### Annotations and timekeeping

| code | what it means | what to do |
|---|---|---|
| `TIMEKEEPING_TAL_MISSING` | a data record carries no timekeeping TAL | that record's onset was derived as `start + recordIndex * duration`; the diagnostic names the record, so the derivation is never invisible |
| `TIMEKEEPING_TAL_NONCONFORMANT` | the timekeeping TAL deviates, typically the widespread `+t 0x14 0x00` shorthand | the onset was used as the record's start and the file was kept; reported once per call, not once per record |
| `START_OFFSET_OUT_OF_RANGE` | record 0's sub-second start offset fell outside [0, 1) | the value was used as written; compare it with the header `starttime`, because a writer that encodes the start time twice produces exactly this |
| `TAL_MALFORMED` | a TAL did not match the grammar | that TAL is skipped and the rest of the region and the file are kept; hexdump at the reported offset |
| `TAL_TRUNCATED_AT_REGION_END` | a TAL ran past the end of its annotation region | the TAL is discarded; check the writer's `samplesPerRecord` for that annotation signal, which is usually too small |
| `TAL_REGION_NOT_NUL_TERMINATED` | the region tail after the last TAL was not NUL padding | parsing resumes at those bytes; trailing bytes from an earlier, longer record mean the writer reused a buffer without clearing it |
| `ANNOTATION_TEXT_NOT_UTF8` | annotation text was not valid UTF-8 | the affected annotations report `textEncoding: 'latin-1-fallback'`, so you can re-decode the bytes yourself if the writer used another code page |

### Timeline

| code | what it means | what to do |
|---|---|---|
| `RECORD_ONSET_SPACING_VIOLATION` | consecutive record onsets are closer together than the record duration, i.e. records overlap in time | the onsets were used as written and nothing was reordered; `buildRecordIndex` reports which records are involved |
| `DISCONTINUITY_IN_CONTINUOUS_FILE` | the reserved field says `EDF+C` but the onsets do not line up | treat the file as discontinuous: build a complete index, and `readWindow` then returns one chunk per contiguous run instead of crossing a gap |

### I/O

| code | what it means | what to do |
|---|---|---|
| `SOURCE_SHORT_READ_RECOVERED` | reserved for a `ByteSource` that returned fewer bytes than asked and was retried successfully | nothing; see the note below |
| `HTTP_RANGE_IGNORED` | an HTTP server answered `200 OK` instead of `206 Partial Content` | serve the file from an origin or CDN that supports byte ranges, or pass `allowFullDownload: true` to fetch it once and serve reads from memory |

> **Note**
> Those last two are in the vocabulary but are not emitted as diagnostics by the 0.1 release.
> `HTTP_RANGE_IGNORED` is named inside the message of the `EdfSourceError` that `httpSource` throws
> when a server ignores the `Range` header. With `allowFullDownload: true` the download proceeds
> and nothing is reported. `SOURCE_SHORT_READ_RECOVERED` has no emitting call site at all: there is
> no retry, and a short read throws `EdfSourceError` instead. Do not write a handler that waits for
> either code.

## Info

Three codes. The file is correct; the note exists because the situation surprises people.

| code | what it means | what to do |
|---|---|---|
| `DATE_CLIPPED_TO_1985_2084` | a two-digit year was resolved through the 85–99 / 00–84 rule | nothing; the mandated `dd.mm.yy` startdate cannot express a year outside 1985–2084, so nearly every file carries this. For an unambiguous year read `startTime.recordingIdDate`, which EDF+ spells out in four digits |
| `INVERTED_PHYSICAL_RANGE` | `physicalMinimum > physicalMaximum`, which encodes a negative amplifier gain | nothing; it is sanctioned by the EDF FAQ, and swapping the two inverts the signal's polarity |
| `NEGATIVE_ANNOTATION_ONSET` | an annotation onset is negative, i.e. before the file start | nothing; this is how EDF+ writes a pre-stimulus event, and `onsetTicks` is exact and signed |

## The code union

```ts
type EdfKnownDiagnosticCode = 'NOT_AN_EDF_FILE' | 'SOURCE_TOO_SMALL' | /* ... */;
type EdfDiagnosticCode = EdfKnownDiagnosticCode | (string & {});
```

`EdfDiagnosticCode` is open. Known codes autocomplete, and a `default` branch in your `switch`
stays mandatory. A code added in a later minor release can't break exhaustive handling, so the
vocabulary can grow without a major version. **An unrecognised code is treated as a warning**, so
an unknown note never escalates into an error.

Codes outside the core vocabulary already exist, and none of them can ever be fatal:

| code | emitted by | what it means |
|---|---|---|
| `INSPECTION_FAILED` | `inspectEdf` | an `EdfError` that was not a format error stopped the inspection; the message names what was refused |
| `HEADER_EXCEEDS_INSPECTION_BUDGET` | `inspectEdf` | the declared header is larger than the 128 KiB ceiling triage reads; call `readHeader` or `openEdf`, which read the whole header however large |
| `SCALE_UNAVAILABLE` | `toPhysical`, `toPhysicalEnvelope` | a signal has no scale and matches none of the four known conditions |
| `LABEL_CONVENTION_NONCONFORMANT` | `edfcore/validate` | the label is not the EDF+ `"<type> <sensor>"` form |
| `PREFILTERING_NONCONFORMANT` | `edfcore/validate` | the prefiltering field is not written as `HP:`/`LP:`/`N:`/`G:` terms |
| `TRANSDUCER_TYPE_BLANK` | `edfcore/validate` | a data signal leaves the transducer field empty |
| `DATE_IMPLAUSIBLE` | `edfcore/validate` | the recording start date is not a real day, or the patient birthdate is after it |

## Diagnostics are values

A diagnostic is a plain object sitting on whatever produced it, never a log line. Every field of
`EdfDiagnostic` is documented in [types](/docs/api-types). The arrays are:

```ts
recording.header.diagnostics;    // header parsing
recording.timeline.diagnostics;  // the record-onset probes openEdf made
chunk.diagnostics;               // the annotation regions inside the records you read
result.diagnostics;              // readAnnotations / decodeAnnotations
inspection.diagnostics;          // inspectEdf
report.diagnostics;              // validateRecording, from edfcore/validate
```

Each is frozen when it's attached, so a result you're holding cannot grow later.
`formatDiagnostics` renders any of them for a human, deterministically enough to snapshot in a test.

Diagnostic volume is bounded by one test: does another occurrence of this code carry information
available nowhere else? `TIMEKEEPING_TAL_MISSING` names a record whose onset had to be derived, so
it's reported per record. `NEGATIVE_ANNOTATION_ONSET` is a property of the writer, so it's reported
once per call. Defects inside a single annotation region are deduplicated and carry an occurrence
count, because a corrupt region can hold thousands of malformed TALs.

## Where to go next

- [Diagnostics and errors](/docs/diagnostics): the narrative version, `strict` mode, and the
  `inspectEdf` triage workflow.
- [Types](/docs/api-types): `EdfDiagnostic` field by field, and every other public shape.
- [API: reading](/docs/api-reading): which call throws which of these, and when.
- [edfcore/validate](/docs/api-validate): the four codes that only that module emits.
- [Physical values](/docs/physical-values): what the deferred group means for `toPhysical`.
