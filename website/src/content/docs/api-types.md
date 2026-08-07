---
title: Types
description: Every public data shape in edfcore (the header model, the time axis, chunks and annotations, and the result objects) with each field's type and meaning.
section: Reference
order: 4
lead: All of these live in one file, src/types.ts, and none of them emits runtime code. Import them with `import type { EdfHeader } from 'edfcore'` and they disappear at build time.
---

## Conventions

**A field that may be absent is `T | undefined`, and the key is always there.** Optional (`?`) is
reserved for options *you* pass in. Reading a result never requires knowing whether a key exists. On
a file with no readable date, `header.startTime.resolvedDate` is `undefined` rather than missing.

**Anything checkable against the file is exposed twice**, as the parsed value and as the raw bytes
it came from. `signal.digitalMinimum` is `-2048`; `signal.raw.digitalMinimum` is `'-2048   '`, with
the padding intact. A header field that disagrees with what edfcore made of it is what you need to
see when a file misbehaves, so both stay on the object.

## The header model

`openEdf` and `readHeader` both give you an `EdfHeader`, and so does `parseHeader` if you already
hold the bytes.

```ts
import { openEdf } from 'edfcore';
import { fileSource } from 'edfcore/node';

const source = await fileSource('night.edf');
try {
  const { header, timeline, index } = await openEdf(source);

  console.log(header.variant, header.continuity);   // 'EDF+D' 'discontinuous'
  console.log(`${header.recordCount} records of ${header.recordDurationSeconds} s`);
  console.log(`${timeline.spanSeconds} s span, ${timeline.coveredSeconds} s covered`);
  console.log(index.coverage);                      // 'probed'
} finally {
  await source.close?.();
}
```

### EdfHeader

| field | type | meaning |
|---|---|---|
| `variant` | `EdfVariant` | the dialect the file claims |
| `continuity` | `'continuous' \| 'discontinuous'` | `'discontinuous'` only for `EDF+D` and `BDF+D` |
| `bytesPerSample` | `2 \| 3` | 2 for EDF, 3 for BDF; decided by the version block alone |
| `headerByteLength` | `number` | the computed `256 * (signalCount + 1)`, never the declared value |
| `declaredHeaderByteLength` | `number` | what the file writes at byte offset 184 |
| `recordByteLength` | `number` | bytes of one data record, summed over all signals |
| `dataByteLength` | `number` | `recordCount * recordByteLength` |
| `recordDurationSeconds` | `number` | may legitimately be `0`; never divide by it |
| `recordDurationTicks` | `bigint` | the same duration in exact 100 ns ticks |
| `recordCount` | `number` | resolved and non-negative |
| `declaredRecordCount` | `number` | verbatim; `-1` means the writer never closed the file |
| `recordCountSource` | `'headerField' \| 'sourceByteLength'` | which of the two `recordCount` came from |
| `startTime` | `EdfStartTime` | the date and clock, and where each came from |
| `patient` | `EdfPatientId` | the 80 bytes at offset 8, parsed against the EDF+ subfield grammar |
| `recording` | `EdfRecordingId` | the 80 bytes at offset 88, likewise |
| `signals` | `readonly EdfSignal[]` | every signal, in file order, annotation channels included |
| `dataSignalIndices` | `readonly number[]` | indices into `signals` whose `kind` is `'data'` |
| `annotationSignalIndices` | `readonly number[]` | indices whose `kind` is `'annotations'` |
| `reserved` | `string` | the full 44 reserved bytes, verbatim, padding included |
| `raw` | `EdfRawHeaderFields` | the ten fixed-header fields as written |
| `rawBytes` | `Uint8Array` | the whole header, for hexdumps and bug reports |
| `diagnostics` | `readonly EdfDiagnostic[]` | what parsing found, frozen |

`signals` holds every channel, so `signals.length` is the file's declared signal count and
`signals[i].index === i`. Pass `dataSignalIndices` when you want samples: an annotations channel
holds TAL text, and decoding it as samples produces numbers that look exactly like a signal.

### Declared and computed values

Two pairs ship both numbers, and in both cases edfcore uses the computed one:

```ts
header.headerByteLength;          // 768 — always 256 * (signalCount + 1)
header.declaredHeaderByteLength;  // 768 — what byte 184 says

header.recordCount;               // 6 — resolved
header.declaredRecordCount;       // 6 — verbatim, may be -1
header.recordCountSource;         // 'headerField'
```

The header byte count is derived, and the writer also had to write it down. A mismatch means the
writer's arithmetic and edfcore's disagree, and every signal offset in the file depends on that
arithmetic. edfcore takes the computed value, records `HEADER_SIZE_MISMATCH`, and leaves the
declared value on the header so you can see which writer produced it.

`recordCount` is the more common one. A writer that streams to disk and never gets to close the
file leaves `-1` in the field, which is legal and explicitly means "count the file yourself". When
that happens `recordCount` comes from the source length, `declaredRecordCount` stays `-1`, and
`recordCountSource` is `'sourceByteLength'`. `RECORD_COUNT_RECOVERED` records the substitution. The
same substitution happens for a truncated file, with `TRUNCATED_FILE` instead.

### EdfVariant

```ts
type EdfVariant = 'EDF' | 'EDF+C' | 'EDF+D' | 'BDF' | 'BDF+C' | 'BDF+D';
```

The family (EDF or BDF, and therefore 2 or 3 bytes per sample) comes from the 8-byte version block
at offset 0 and from nothing else. EDF+ keeps that block as `'0       '` so legacy readers still
open the file, so the `+C`/`+D` part comes from the reserved field at offset 192 instead. BDF's
version block is not ASCII at all: byte 0 is `0xFF`, followed by `'BIOSEMI'`.

### EdfSignal

```ts
import { getSignal } from 'edfcore';

const signal = getSignal(header, 'EEG Fpz-Cz');

signal.index;              // 0
signal.kind;               // 'data'
signal.samplesPerRecord;   // 100 — authoritative
signal.sampleRateHz;       // 100 — derived
signal.sampleCount;        // 600 — samplesPerRecord * header.recordCount
signal.scale;              // { bitValue: 0.1221001221001221, offset: 0.5 }
signal.raw.digitalMinimum; // '-2048   '
```

| field | type | meaning |
|---|---|---|
| `index` | `number` | position in `header.signals`, and the value you pass as a `signalIndex` |
| `kind` | `'data' \| 'annotations'` | `'annotations'` for the reserved `EDF Annotations` / `BDF Annotations` labels |
| `label` | `string` | trimmed; `raw.label` keeps the padding |
| `transducerType` | `string` | trimmed free text, e.g. `'AgAgCl electrode'` |
| `prefiltering` | `string` | trimmed free text, e.g. `'HP:0.1Hz LP:75Hz'`; never parsed |
| `physicalDimension` | `string` | the unit exactly as written |
| `unit` | `string` | `physicalDimension` with every spelling of micro collapsed to `u`, for comparison only |
| `physicalMinimum` | `number` | as declared |
| `physicalMaximum` | `number` | as declared; **may be below the minimum** |
| `digitalMinimum` | `number` | as declared |
| `digitalMaximum` | `number` | as declared |
| `samplesPerRecord` | `number` | authoritative — sample indexing uses this, never a rate |
| `sampleRateHz` | `number \| undefined` | `samplesPerRecord / recordDurationSeconds`; `undefined` exactly when that duration is `0` |
| `sampleCount` | `number` | `samplesPerRecord * header.recordCount` |
| `scale` | `EdfScale \| undefined` | `undefined` when the header does not define a usable gain |
| `recordByteOffset` | `number` | byte offset of this signal's block **within one data record** |
| `recordByteLength` | `number` | `samplesPerRecord * header.bytesPerSample` |
| `raw` | `EdfRawSignalFields` | the ten per-signal fields as written |

Three of these repay a second look.

`physicalMaximum` below `physicalMinimum` is legal: it encodes a negative amplifier gain, and the
EDF FAQ sanctions it. edfcore never swaps the two, because swapping them inverts the signal's
polarity. You get `INVERTED_PHYSICAL_RANGE` at `info` severity and a scale that maps the file's
intent.

`sampleRateHz` is derived and `samplesPerRecord` is not. A record duration of `0` is legal in EDF+,
which makes a sample rate meaningless (hence `undefined` rather than `Infinity`).
`samplesPerRecord` is always there, and every offset in the file is computed from it. Index by
`samplesPerRecord`.

`unit` exists so you can compare units without deciding what the file meant. `'µV'`, `'μV'` and
`'uV'` all normalise to `'uV'`. Nothing else is touched, case is meaningful (`mV` is not `MV`), and
edfcore does not convert to SI volts. To print what the file said, print `physicalDimension`.

An annotations signal carries the same fields, but they describe a text region rather than a
channel. `scale` is `undefined`, `unit` is `''`, and `recordByteLength` is the size of the TAL
region in that record.

### EdfScale

```ts
interface EdfScale {
  readonly bitValue: number;
  readonly offset: number;
}
```

The conversion is `physical = bitValue * (offset + digital)`. That's EDFlib's exact expression,
kept verbatim rather than rewritten into the numerically better form. It targets float64 bit-parity
with pyEDFlib, so the same file gives the same doubles in both libraries.

`scale` is `undefined` when the declared ranges do not define a usable gain: a degenerate or
inverted digital range, a degenerate physical range, or a log-transformed channel. `decodeDigital`
keeps working on such a signal, and `toPhysical` throws `EdfScalingError`. See
[physical values](/docs/physical-values) for the whole story.

### EdfStartTime, EdfCalendarDate, EdfClockTime

EDF records local time at the patient with no timezone, so edfcore never produces a `Date`. You get
plain fields instead. [Design decisions](/docs/design-decisions) has the reasoning.

```ts
import { formatStartTimeNaive } from 'edfcore';

const { startTime } = header;

startTime.headerDate;            // { year: 2002, month: 3, day: 2 }
startTime.recordingIdDate;       // { year: 2002, month: 3, day: 2 }
startTime.resolvedDate;          // { year: 2002, month: 3, day: 2 }
startTime.dateSource;            // 'recordingIdField'
startTime.clock;                 // { hour: 22, minute: 30, second: 0 }
startTime.secondsSinceMidnight;  // 81000

formatStartTimeNaive(startTime);  // '2002-03-02T22:30:00.000'
```

| field | type | meaning |
|---|---|---|
| `headerDate` | `EdfCalendarDate \| undefined` | from the 8-byte `dd.mm.yy` field, through the 1985–2084 rule |
| `recordingIdDate` | `EdfCalendarDate \| undefined` | from the EDF+ recording-identification `Startdate` subfield |
| `resolvedDate` | `EdfCalendarDate \| undefined` | the one edfcore uses; `undefined` when neither could be read |
| `dateSource` | `'headerField' \| 'recordingIdField' \| 'none'` | which field `resolvedDate` came from |
| `clock` | `EdfClockTime` | always present; the header stores whole seconds |
| `secondsSinceMidnight` | `number` | `clock` as a single number |

`recordingIdDate` wins when both are readable, because it is the only unambiguous four-digit year
and the only way past 2084. The two-digit header field resolves `85`–`99` to 1985–1999 and `00`–`84`
to 2000–2084, which is why nearly every EDF file carries `DATE_CLIPPED_TO_1985_2084`. If the two
fields name different days you get `DATE_FIELDS_DISAGREE`. Both values stay on the object, and
`dateSource` says which one was used.

```ts
interface EdfCalendarDate {
  readonly year: number;
  readonly month: number;  // 1-12, NOT a JavaScript month index
  readonly day: number;
}

interface EdfClockTime {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}
```

The `month` is 1-based. It's the single most likely thing to go wrong when you hand these numbers
to a `Date` constructor, which is 0-based.

### EdfPatientId and EdfRecordingId

Both fields are 80 bytes of free text in plain EDF and a defined subfield grammar in EDF+. edfcore
parses the grammar, reports whether it fitted, and keeps the raw text either way.

| `EdfPatientId` | type | meaning |
|---|---|---|
| `raw` | `string` | the 80 bytes as written, padding included |
| `conformant` | `boolean` | true when the EDF+ four-subfield grammar fitted |
| `code` | `string \| undefined` | subfield 1, the hospital's patient code |
| `sex` | `'F' \| 'M' \| undefined` | subfield 2 |
| `birthDate` | `EdfCalendarDate \| undefined` | subfield 3, `dd-MMM-yyyy` |
| `name` | `string \| undefined` | subfield 4 |
| `extraSubfields` | `readonly string[]` | anything past the fourth, in order |

| `EdfRecordingId` | type | meaning |
|---|---|---|
| `raw` | `string` | the 80 bytes as written |
| `conformant` | `boolean` | true when the EDF+ grammar fitted |
| `startDate` | `EdfCalendarDate \| undefined` | the `Startdate` subfield, `dd-MMM-yyyy` |
| `investigationCode` | `string \| undefined` | the hospital's investigation code |
| `technicianCode` | `string \| undefined` | who ran the recording |
| `equipmentCode` | `string \| undefined` | what recorded it |
| `extraSubfields` | `readonly string[]` | anything past the fifth |

A subfield that the grammar could not place is `undefined` rather than guessed.
`conformant: false` means the text is not in the EDF+ shape, which is normal for plain EDF. The
conformance checks in [`edfcore/validate`](/docs/api-validate) skip these two fields entirely for
non-`+` files.

### The raw field interfaces

Every property of both is a `string`, holding the field exactly as written before trimming or
interpretation. A diagnostic (or you) can then quote the bytes rather than a reconstruction of them.

`EdfRawHeaderFields` covers the ten fixed-header fields, at these offsets:

| field | offset | length |
|---|---|---|
| `version` | 0 | 8 |
| `patientId` | 8 | 80 |
| `recordingId` | 88 | 80 |
| `startDate` | 168 | 8 |
| `startTime` | 176 | 8 |
| `headerByteLength` | 184 | 8 |
| `reserved` | 192 | 44 |
| `recordCount` | 236 | 8 |
| `recordDuration` | 244 | 8 |
| `signalCount` | 252 | 4 |

`EdfRawSignalFields` covers the ten per-signal fields, whose widths are:

| field | width |
|---|---|
| `label` | 16 |
| `transducerType` | 80 |
| `physicalDimension` | 8 |
| `physicalMinimum` | 8 |
| `physicalMaximum` | 8 |
| `digitalMinimum` | 8 |
| `digitalMaximum` | 8 |
| `prefiltering` | 80 |
| `samplesPerRecord` | 8 |
| `reserved` | 32 |

Those widths sum to 256, which is why each signal adds exactly one 256-byte block. The layout is
**field-major**: all `ns` labels, then all `ns` transducer types, and so on. Reading it as a struct
per signal produces plausible output for a one-signal file, which is how that bug survives a first
test.

## The time axis

`t = 0` is the **start of record 0**, not the header start time. Record 0's own timekeeping onset
is `timeline.startOffsetTicks`, the bridge back to the header clock. Every other second edfcore
reports (segment, gap, chunk, window bound) is elapsed recording time. This is the
EDFlib/pyEDFlib/MNE convention. Under it, sample `n` of a signal sits at exactly
`n * recordDuration / samplesPerRecord` with no sub-second constant to remember.

### RecordRange

```ts
interface RecordRange {
  readonly start: number;
  readonly count: number;
}
```

Start plus count, never start plus end, so there's no inclusive/exclusive question to get wrong.
It's the argument type for `readRecords` and `readAnnotations`, and it comes back on
`chunk.records` and `segment.records`.

### EdfTimeline

`openEdf` builds one from at most two reads: the timekeeping onsets of the first and last records.

| field | type | meaning |
|---|---|---|
| `recordCount` | `number` | records the timeline covers |
| `recordDurationSeconds` | `number` | copied from the header |
| `recordDurationTicks` | `bigint` | the same, exact |
| `startOffsetSeconds` | `number` | record 0's sub-second start, in [0, 1) |
| `startOffsetTicks` | `bigint` | the same value in exact 100 ns ticks |
| `spanSeconds` | `number` | last record end minus first record start; includes gaps |
| `spanTicks` | `bigint` | the same, exact |
| `coveredSeconds` | `number` | sum of the record durations |
| `coveredTicks` | `bigint` | the same, exact |
| `diagnostics` | `readonly EdfDiagnostic[]` | including whatever decoding the probed records turned up |

The span and the coverage are computed independently rather than derived from each other. Their
being equal is the statement "this file is contiguous as far as two reads can tell" — ask it of
`spanTicks` and `coveredTicks`, which is what edfcore's own checks compare. On the
discontinuous file used throughout this page (six one-second records with a ten-second gap in the
middle) they are `16` and `6`.

> **Note**
> Two probes detect any *net* drift of the timeline, but they are not a proof of contiguity: a gap
> that a later overlap cancels exactly leaves both ends where a contiguous file puts them.
> `buildRecordIndex` reads every onset and does see it.

### EdfRecordIndex

The index answers "which record holds second *t*". How much it can answer depends on `coverage`.

```ts
import { buildRecordIndex } from 'edfcore';

const index = await buildRecordIndex(recording);

index.coverage;   // 'complete'
index.segments;   // two EdfSegment entries
index.gaps;       // one EdfGap between them

await index.onsetTicks(3);  // 130000000n
await index.locate(12.5);   // undefined — that second is inside the gap
await index.locate(13);     // { recordIndex: 3, recordStartSeconds: 13, offsetInRecordSeconds: 0 }
```

| field | type | meaning |
|---|---|---|
| `coverage` | `'probed' \| 'complete'` | `'probed'` = record 0 and the last record only; `'complete'` = every record verified |
| `recordCount` | `number` | records the index covers |
| `segments` | `readonly EdfSegment[] \| undefined` | present only when `coverage === 'complete'` |
| `gaps` | `readonly EdfGap[] \| undefined` | likewise |
| `onsetTicks` | `(recordIndex: number, options?: ReadOptions) => Promise<bigint>` | one targeted read of that record's annotation region, memoised |
| `locate` | `(seconds: number, options?: ReadOptions) => Promise<EdfLocation \| undefined>` | binary search, O(log recordCount) probes |

`segments` and `gaps` are `undefined` on a probed index (the one `openEdf` hands you), which isn't
a claim that the file has no gaps. Nobody has read the onsets in between.

`locate` returns `undefined` for a second that falls inside a gap or outside the recording, which
is a different thing from an error. It verifies monotonicity at every pair its search touches, and
a violation throws `EdfFormatError` with `TIMELINE_NOT_MONOTONIC` rather than returning a plausible
record. `onsetTicks` throws `EdfRangeError` for a record index that does not exist.

### EdfSegment, EdfGap, EdfLocation

A segment is a maximal run of records whose onsets are spaced by exactly one record duration, in
exact ticks. The comparison is exact rather than "within an epsilon": a float tolerance is how a
one-sample overlap becomes invisible.

| `EdfSegment` | type | meaning |
|---|---|---|
| `index` | `number` | position in `index.segments` |
| `records` | `RecordRange` | the records in this run |
| `startSeconds` | `number` | elapsed recording time at the run's first record |
| `startTicks` | `bigint` | the same instant, exact |
| `durationSeconds` | `number` | how long the run covers |
| `durationTicks` | `bigint` | the same, exact |
| `endSeconds` | `number` | the first instant the run no longer covers |
| `endTicks` | `bigint` | the same, exact |

| `EdfGap` | type | meaning |
|---|---|---|
| `beforeSegmentIndex` | `number` | the segment that ends at the gap |
| `afterSegmentIndex` | `number` | the segment that starts after it |
| `startSeconds` | `number` | where the earlier segment ends |
| `startTicks` | `bigint` | the same, exact |
| `endSeconds` | `number` | where the later segment starts |
| `endTicks` | `bigint` | the same, exact |
| `durationSeconds` | `number` | `endSeconds - startSeconds` |
| `durationTicks` | `bigint` | the same, exact |

Every second on these two is a float64 conversion of the tick beside it. Compare and sum the
**ticks**: `segmentAt` and `gapAt` decide their boundaries on `startTicks`/`endTicks`, so a caller
who wants to agree with them must too, and totalling the time a recording lost is a sum over
`durationTicks`.

There is exactly one gap per adjacent pair of segments, so `gaps.length === segments.length - 1`
(or `0`). A gap's duration is non-negative on any file whose onsets are monotonic and correctly
spaced. A negative one means two records overlap in time, which `validateRecording` reports as
`RECORD_ONSET_SPACING_VIOLATION`.

| `EdfLocation` | type | meaning |
|---|---|---|
| `recordIndex` | `number` | the record containing the requested second |
| `recordStartSeconds` | `number` | that record's start, in elapsed recording time |
| `offsetInRecordSeconds` | `number` | how far into the record the requested second falls |

## Samples and annotations

### EdfChunk and EdfChunkSignal

A chunk is what a read returns. It's always **record-aligned**, so it's usually wider than the
window you asked for. `trimToWindow` narrows one signal exactly.

```ts
import { readRecords } from 'edfcore';

const chunk = await readRecords(
  { ...recording, index },
  { records: { start: 3, count: 1 }, signalIndices: [0] },
);

chunk.records;         // { start: 3, count: 1 }
chunk.startSeconds;    // 13 — this record's TRUE start, read from its timekeeping TAL
chunk.durationSeconds; // 1
chunk.byteOffset;      // 1548 — where in the file these records begin
chunk.byteLength;      // 260 — bytes actually read
chunk.precededByGap;   // the EdfGap immediately before, or undefined

const [first] = chunk.signals;
first.digital;         // Int32Array(100)
first.firstSampleIndex;// 300 — index on this signal's own sample grid
```

| `EdfChunk` | type | meaning |
|---|---|---|
| `records` | `RecordRange` | the records this chunk holds |
| `startSeconds` | `number` | the first record's true start, in elapsed recording time |
| `startTicks` | `bigint` | the same instant, exact |
| `durationSeconds` | `number` | the chunk's **span**: last record end minus first record start |
| `durationTicks` | `bigint` | the same, exact |
| `byteOffset` | `number` | `header.headerByteLength + records.start * header.recordByteLength` |
| `byteLength` | `number` | bytes actually read from the source |
| `signals` | `readonly EdfChunkSignal[]` | one entry per requested signal, in the order you asked |
| `precededByGap` | `EdfGap \| undefined` | the gap immediately before these records |
| `diagnostics` | `readonly EdfDiagnostic[]` | defects in the annotation regions inside these records |

`durationSeconds` is a span, not a coverage. The two are equal for one contiguous run, which is
what `readWindow` produces, and they differ when you name records across a gap yourself.

`startTicks` is what `trimToWindow` measures a window from, and it is not always a whole number of
ticks' worth of information: after a trim a signal starts at
`chunkStart + firstIndex * recordDuration / samplesPerRecord`, and that division rarely lands on a
tick — 3 s records of 256 samples put one every 117187.5. `startTicks` is then the tick the sample
is already running in, floored, and `startSeconds` keeps the remainder. Compare in ticks.

`byteLength` is on the object so overread is visible. `precededByGap` is `undefined` on a probed
index for the same reason `index.segments` is: nobody has read the onsets in between. `diagnostics`
costs nothing. The annotation regions of a record live in the same bytes as its samples, so a
defect there is found while decoding the data you already asked for.

| `EdfChunkSignal` | type | meaning |
|---|---|---|
| `signalIndex` | `number` | index into `header.signals` |
| `sampleCount` | `number` | the truth; never padded to a round number |
| `digital` | `Int32Array` | the samples, sign-extended, unscaled and unclamped |
| `firstSampleIndex` | `number` | `records.start * signal.samplesPerRecord`, on this signal's own grid |
| `startSeconds` | `number` | the chunk's start; per-signal because `samplesPerRecord` differs between signals |
| `startTicks` | `bigint` | the same instant, exact — floored to the tick the sample starts in |
| `outOfDigitalRangeCount` | `number` | samples outside the **declared** digital range |

`digital` is an `Int32Array` for both EDF and BDF, because a 24-bit sample doesn't fit an
`Int16Array` and a `Float64Array` quadruples the memory to hold integers. Pass it to `toPhysical`
when you want units.

`outOfDigitalRangeCount` above zero means the declared range is wrong, not that the samples are.
edfcore never clamps. The count is produced by the same pass that decodes the samples, so it costs
nothing.

### EdfAnnotation and EdfAnnotationsResult

```ts
import { readAnnotations } from 'edfcore';

const result = await readAnnotations(recording, { start: 0, count: header.recordCount });
const [event] = result.annotations;

event.onsetSecondsFromHeaderStart;  // 1.5
event.onsetSecondsFromFirstRecord;  // 1.5
event.onsetTicks;                   // 15000000n — compare with this
event.onsetRaw;                     // '+1.5'
event.durationSeconds;              // 0.25
event.text;                         // 'Lights off'
event.recordIndex;                  // 1

result.recordOnsetTicks;  // BigInt64Array [0n, 10000000n, 20000000n, 130000000n, ...]
```

| `EdfAnnotation` | type | meaning |
|---|---|---|
| `onsetSecondsFromHeaderStart` | `number` | the verbatim on-disk value, relative to the header startdate/starttime (EDF+ 2.2.4) |
| `onsetSecondsFromFirstRecord` | `number` | rebased to the first record's true start — the EDFlib/pyEDFlib/MNE convention |
| `onsetTicks` | `bigint` | exact, in 100 ns units, on the same axis as the rebased value |
| `onsetRaw` | `string` | the original digits, including the mandatory sign |
| `durationSeconds` | `number \| undefined` | `undefined` when the TAL carried no duration |
| `durationTicks` | `bigint \| undefined` | the same, exact |
| `durationRaw` | `string \| undefined` | the original digits |
| `text` | `string` | verbatim; never trimmed, never case-folded |
| `channelLabel` | `string \| undefined` | from the EDF+ `description@@channel` convention |
| `signalIndex` | `number` | which annotation signal carried it |
| `recordIndex` | `number` | which data record it was written into |
| `byteOffsetInRecord` | `number` | where inside that record, for a hexdump |
| `textEncoding` | `'utf-8' \| 'latin-1-fallback'` | `'latin-1-fallback'` when the bytes were not valid UTF-8 |

Both onset conventions ship as separately named fields rather than as an option, so a downstream
comparison never depends on how the call was configured. Compare event times with `onsetTicks` and
nothing else. Float equality on event times is how ERP alignment breaks without anyone noticing.

| `EdfAnnotationsResult` | type | meaning |
|---|---|---|
| `annotations` | `readonly EdfAnnotation[]` | timekeeping TALs and empty texts excluded |
| `recordOnsetTicks` | `BigInt64Array` | one entry per record in the decoded range |
| `diagnostics` | `readonly EdfDiagnostic[]` | TAL and timekeeping defects |

`annotations` is stably sorted by `(onsetTicks, signalIndex, byteOffsetInRecord)`, so two files
that carry the same events in the same records give you the same order.

`recordOnsetTicks` always has one entry for every record in the decoded range, never a hole and
never a sentinel. A record whose timekeeping TAL is missing gets the derived onset
`start + recordIndex * duration`. `TIMEKEEPING_TAL_MISSING` carries that record's index, so the
derivation stays visible. Every timeline in edfcore is built from this array.

## Results

### EdfRecording

```ts
interface EdfRecording {
  readonly source: ByteSource;
  readonly header: EdfHeader;
  readonly timeline: EdfTimeline;
  readonly index: EdfRecordIndex;
}
```

A plain struct with no methods and no hidden state, which is what makes upgrading the index a
spread rather than an API:

```ts
import { buildRecordIndex, readWindow } from 'edfcore';

const index = await buildRecordIndex(recording);
const chunks = await readWindow(
  { ...recording, index },
  { startSeconds: 0, durationSeconds: 30, signalIndices: [0] },
);
```

It doesn't own the source. Closing is yours: `await recording.source.close?.()`.

### EdfDiagnostic

| field | type | meaning |
|---|---|---|
| `code` | `EdfDiagnosticCode` | a stable identifier, e.g. `'HEADER_SIZE_MISMATCH'` |
| `severity` | `EdfSeverity` | `'error' \| 'warning' \| 'info'`, derived from the code |
| `message` | `string` | names the field, the bytes as written, the rule, and a next step |
| `field` | `string \| undefined` | the header field or structure at fault |
| `byteOffset` | `number \| undefined` | where in the file |
| `byteLength` | `number \| undefined` | how many bytes |
| `rawBytes` | `Uint8Array \| undefined` | a copy of the offending bytes, capped in length |
| `raw` | `string \| undefined` | those bytes as text, padding included |
| `expected` | `string \| undefined` | the rule, as a short string |
| `actual` | `string \| undefined` | the observation |
| `signalIndex` | `number \| undefined` | which signal |
| `recordIndex` | `number \| undefined` | which record |
| `specReference` | `string \| undefined` | the clause it violates, e.g. `'EDF+ additional specification 5'` |

`rawBytes` is a copy rather than a view, because a diagnostic outlives the read that produced it
and an I/O adapter is free to reuse its buffer. The full code table and the error classes are in
[errors and diagnostic codes](/docs/api-errors).

### EdfInspection

Header-only triage. `inspectEdf` reads at most 128 KiB and never throws about content, so a file
that isn't an EDF at all comes back as a value rather than an exception.

```ts
import { inspectEdf } from 'edfcore';

const inspection = await inspectEdf(source);

inspection.ok;          // true
inspection.variant;     // 'EDF+D'
inspection.byteLength;  // 2328 — the source's size
inspection.bytesRead;   // 768 — what inspection actually cost
```

| field | type | meaning |
|---|---|---|
| `ok` | `boolean` | the header parsed **and** carried no error-severity diagnostic |
| `variant` | `EdfVariant \| undefined` | a separate best effort; readable long after the rest stops making sense |
| `header` | `EdfHeader \| undefined` | `undefined` when parsing was refused |
| `byteLength` | `number` | the source's size |
| `bytesRead` | `number` | what the inspection cost |
| `headerBytes` | `Uint8Array \| undefined` | the bytes it looked at, for a hexdump |
| `diagnostics` | `readonly EdfDiagnostic[]` | including the one that would otherwise have been thrown |

A signal with no defined scale makes `ok` false even when the header itself is readable, because
physical units are unavailable for that channel. Warnings leave `ok` true. See
[diagnostics and errors](/docs/diagnostics) for the triage workflow.

## The rest of types.ts

The remaining exports are options and selections rather than results. They describe what you hand
edfcore, not what it hands back.

| type | what it is |
|---|---|
| `ReadOptions` | `signal` and `maxMaterializeBytes`, accepted by every call that reads |
| `ParseOptions` | `strict`; [diagnostics](/docs/diagnostics) lists which calls take it and which do not |
| `OpenOptions` | `ParseOptions & ReadOptions` |
| `ByteSource` | the random-access reader everything is built over |
| `RecordSelection` | `{ records, signalIndices }` for `readRecords` |
| `WindowSelection` | `{ startSeconds, durationSeconds, signalIndices }` for `readWindow` |
| `DecodeAnnotationsOptions` | `ParseOptions` plus `signalIndices` |
| `BuildIndexOptions` | `ParseOptions & ReadOptions` plus `onProgress` |
| `HttpSourceOptions` | `fetch`, `headers`, `byteLength`, `maxConcurrency`, `allowFullDownload` |
| `CacheOptions` | `blockBytes` and `maxBytes` for `cachedSource` |
| `AbortSignalLike`, `BlobLike`, `FetchLike`, `HttpResponseLike` | structural shims so the published types name neither the DOM nor `@types/node` |

`signalIndices` is required on both selections, with no "all signals" default: a 256-channel file
must never be read wholesale because an argument was omitted.

[API — sources](/docs/api-sources) is the reference for `ByteSource` and its adapters, and
[API — reading](/docs/api-reading) is the reference for the calls that consume these options.
[Data sources](/docs/data-sources), [large files](/docs/large-files) and
[reading signals](/docs/reading-signals) are the guides behind them.
