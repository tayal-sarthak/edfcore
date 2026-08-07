---
title: API — reading
description: "Reference for the async reading layer: openEdf, readRecords, readWindow, readAnnotations, inspectEdf, the record index, and every option field."
section: Reference
order: 1
lead: Every function that touches a ByteSource, with its exact signature, what it returns, what it throws, and how many reads it costs.
---

Everything on this page is `async` and takes a [`ByteSource`](/docs/api-sources) either directly or through an `EdfRecording`. The parsing and decoding happen in the [primitives](/docs/api-primitives). These functions decide only which bytes to ask for.

Import everything from the universal entry point:

```ts
import {
  openEdf,
  readRecords,
  readWindow,
  readAnnotations,
  inspectEdf,
  buildTimeline,
  buildRecordIndex,
  readHeader,
  readRecordBytes,
} from 'edfcore';
```

**Read counts on this page mean calls to `ByteSource.read`.** They are exact and testable: wrap your source in a recorder and count. A read of `n` bytes is one read whether it comes from memory or from an HTTP Range request.

Result shapes are summarised here so each entry stands on its own. [Types](/docs/api-types) lists every public data shape. [Errors and diagnostic codes](/docs/api-errors) lists every error and diagnostic code.

## openEdf

```ts
function openEdf(source: ByteSource, options?: OpenOptions): Promise<EdfRecording>
```

Opens a recording: parses the header, then establishes the time axis. It's the entry point for almost everything else. `readRecords`, `readWindow` and `readAnnotations` all take the `EdfRecording` it returns.

`openEdf` never scans the file. On a plain EDF or BDF it costs **two reads** (256 bytes to learn the signal count, then the rest of the header). On a file that carries an annotations signal it costs **four**: the two header reads, plus one whole data record at each end of the file. Those two probes carry the timekeeping onsets of record 0 and record `recordCount - 1`. A single-record file is probed once, for three reads total; a file with no data records is not probed at all.

The returned `index` has `coverage: 'probed'`, and its `segments` and `gaps` are `undefined`. Two probes detect any *net* drift of the timeline, but they can't prove the file is contiguous. [`buildRecordIndex`](#buildrecordindex) promotes it.

Throws `EdfFormatError` for a header defect edfcore cannot proceed past, and under `strict: true` for the first defect of any severity. Throws `EdfSourceError` if the source breaks its length contract. A source-level failure (a dead socket, a vanished file) rejects with whatever the source rejected with.

```ts
import { openEdf } from 'edfcore';
import { fileSource } from 'edfcore/node';

const source = await fileSource('/data/night.edf');
const recording = await openEdf(source);

console.log(recording.header.variant);           // 'EDF+C'
console.log(recording.header.recordCount);       // 2880
console.log(recording.timeline.spanSeconds);     // 28800
console.log(recording.index.coverage);           // 'probed'

await source.close?.();
```

### EdfRecording

A plain struct with no methods and no hidden state, which is what makes `{ ...recording, index }` a supported way to swap in a better index.

| Field | Type | Meaning |
| --- | --- | --- |
| `source` | `ByteSource` | The source it was opened over. |
| `header` | `EdfHeader` | The parsed header. See [parseHeader](/docs/api-primitives#parseheader). |
| `timeline` | `EdfTimeline` | The time axis, from the probed onsets. |
| `index` | `EdfRecordIndex` | Record-to-time lookup. `coverage: 'probed'` after `openEdf`. |

### EdfTimeline

`t = 0` is the start of record 0, not the header start time. Every second edfcore reports anywhere is elapsed recording time on that axis.

| Field | Type | Meaning |
| --- | --- | --- |
| `recordCount` | `number` | Data records on the time axis. |
| `recordDurationSeconds` | `number` | From the header. May legitimately be `0`. |
| `recordDurationTicks` | `bigint` | The same, exact. |
| `startOffsetSeconds` | `number` | Record 0's own timekeeping onset (the sub-second start the header clock cannot express). |
| `startOffsetTicks` | `bigint` | The same value in exact 100 ns ticks. |
| `spanSeconds` | `number` | Last record's end minus first record's start. Includes gaps. |
| `spanTicks` | `bigint` | The same value in exact 100 ns ticks. |
| `coveredSeconds` | `number` | Sum of record durations. |
| `coveredTicks` | `bigint` | The same value in exact 100 ns ticks. |
| `diagnostics` | `readonly EdfDiagnostic[]` | From decoding the probed records, plus the timeline's own checks. |

The span and the coverage are computed independently rather than one from the other. Equality is therefore a real statement: **as far as two probes can tell, this file is contiguous.** When they differ, the file has at least one gap. When they agree, a gap that an overlap elsewhere cancels exactly is still possible, and only a complete index rules it out.

Compare `spanTicks` with `coveredTicks`, not the seconds. The seconds are float64 conversions of those two, and two different tick counts round to one float once an ulp of the span exceeds a tick — around 4 × 10⁸ seconds, which a free-form `recordDuration` field reaches in three bytes. edfcore's own contiguity checks were on the seconds until 0.3.4, and a file whose scanned index reports two segments read as contiguous.

## readRecords

```ts
function readRecords(
  recording: EdfRecording,
  selection: RecordSelection,
  options?: ReadOptions,
): Promise<EdfChunk>
```

Reads a named record range and decodes the requested signals out of it. Exactly one chunk, exactly one read. You named the records, so a gap inside them can't surprise you. A range with `count: 0` issues no read at all and returns an empty chunk.

The read covers every signal in those records, because that's how EDF stores them. The de-interleaving happens in memory afterwards. `chunk.byteLength` reports the bytes actually fetched, so overread is visible.

Throws `EdfRangeError` when `records` is not inside `header.recordCount`, `EdfChannelNotFoundError` for a signal index the file doesn't have, and `EdfBudgetError` when the range exceeds `maxMaterializeBytes`. A `signalIndices` entry naming an annotations channel throws a plain `RangeError`. Its bytes are TAL text, and decoding them as samples produces numbers that look exactly like a signal.

```ts
const chunk = await readRecords(recording, {
  records: { start: 0, count: 2 },
  signalIndices: recording.header.dataSignalIndices,
});

// 2 * header.recordByteLength — the whole record, every channel.
console.log(chunk.byteLength);
// 2 * signal.samplesPerRecord, for the signal at signalIndices[0].
console.log(chunk.signals[0].sampleCount);
```

### RecordSelection

| Field | Type | Meaning |
| --- | --- | --- |
| `records` | `RecordRange` | `{ start, count }`. Start plus count, never start plus end, so there is no inclusive/exclusive ambiguity. |
| `signalIndices` | `readonly number[]` | Required. Duplicates are dropped; the order you give is the order of `chunk.signals`. |

`signalIndices` has no "all signals" default. `header.dataSignalIndices` is the explicit spelling of "all of them", so a 256-channel file is never read wholesale because an argument was omitted.

### EdfChunk

| Field | Type | Meaning |
| --- | --- | --- |
| `records` | `RecordRange` | The records this chunk covers. |
| `startSeconds` | `number` | The first record's *true* start, from its timekeeping TAL (not `start * recordDuration`). |
| `startTicks` | `bigint` | The same instant, exact. |
| `durationSeconds` | `number` | The chunk's **span**: last record's end minus first record's start. Equal to the covered time for one contiguous run, larger when you named records across a gap. |
| `durationTicks` | `bigint` | The same, exact. |
| `byteOffset` | `number` | Where these records begin in the file. |
| `byteLength` | `number` | Bytes actually read from the source. |
| `signals` | `readonly EdfChunkSignal[]` | One per entry of `signalIndices`, in that order. |
| `precededByGap` | `EdfGap \| undefined` | The gap immediately before this chunk. Always `undefined` on a probed index, because nobody has read the onsets in between. |
| `diagnostics` | `readonly EdfDiagnostic[]` | From decoding the annotation regions inside these same bytes. |

Every chunk carries the onsets of its own records, verified from bytes that had to be read anyway. That makes `startSeconds` trustworthy on an EDF+D file even when the index is only probed. Decoding those annotations is never strict, so a malformed TAL in another channel still returns samples.

### EdfChunkSignal

| Field | Type | Meaning |
| --- | --- | --- |
| `signalIndex` | `number` | Index into `header.signals`. |
| `sampleCount` | `number` | Samples actually decoded. Never padded to a round number. |
| `digital` | `Int32Array` | Sign-extended sample values, still in digital units. |
| `firstSampleIndex` | `number` | Index of the first sample on this signal's own sample grid (`records.start * samplesPerRecord`). |
| `startSeconds` | `number` | When the first sample of *this* signal starts. Equal to `chunk.startSeconds` for a record-aligned chunk; after [`trimToWindow`](/docs/api-primitives#trimtowindow) it is this signal's own boundary sample, which differs between signals of different rates. |
| `startTicks` | `bigint` | The same instant, floored to the tick the sample is already running in. This is what `trimToWindow` measures a window from; a trimmed start rarely lands on a whole tick, so `startSeconds` keeps the remainder and this keeps the tick. |
| `outOfDigitalRangeCount` | `number` | Samples outside the declared digital range, counted during the decode so it costs nothing. edfcore never clamps: a non-zero count means the declared range is wrong, not that the samples are. |

To get physical units, pass `digital` to [`toPhysical`](/docs/api-primitives#tophysical).

## readWindow

```ts
function readWindow(
  recording: EdfRecording,
  selection: WindowSelection,
  options?: ReadOptions,
): Promise<readonly EdfChunk[]>
```

Reads a time window as **one chunk per contiguous run of records**. The return type is always an array, including on a continuous file where it always has exactly one element.

An empty array means the window falls entirely inside a gap, entirely outside the recording, or has a non-positive duration. It never means the read failed. Nothing is ever filled in. There's no gap-fill, and no gap-fill option.

A bad selection throws rather than returning `[]`, whether or not the window covers any records. An index outside the file's signals throws `EdfChannelNotFoundError`, and the annotations channel throws a plain `RangeError`. Both are checked before the window is resolved, so a typo can't read back as an empty stretch of recording.

Chunks stay record-aligned and are therefore usually wider than the window you asked for. [`trimToWindow`](/docs/api-primitives#trimtowindow) narrows them to the exact samples, without I/O.

Runs are read one after another rather than concurrently, so the read pattern you observe is the one this function issued, in order. Concurrency belongs to the source. [`httpSource`](/docs/api-sources#httpsource) has `maxConcurrency`.

Costs one read per run. Throws everything `readRecords` throws, plus a plain `RangeError` when the file has a gap and the index is only probed. Mapping seconds to records then depends on onsets nobody has read. Build a complete index and rebuild the recording around it.

```ts
const chunks = await readWindow(recording, {
  startSeconds: 30,
  durationSeconds: 10,
  signalIndices: [0, 1],
});

for (const chunk of chunks) {
  if (chunk.precededByGap !== undefined) {
    console.log(`gap of ${chunk.precededByGap.durationSeconds} s before this run`);
  }
  console.log(chunk.records, chunk.startSeconds);
}
```

On a discontinuous file:

```ts
import { buildRecordIndex, readWindow } from 'edfcore';

const index = await buildRecordIndex(recording);
const chunks = await readWindow({ ...recording, index }, {
  startSeconds: 498,
  durationSeconds: 65,
  signalIndices: [0],
});
// [ { records: { start: 498, count: 2 }, startSeconds: 498 },
//   { records: { start: 500, count: 3 }, startSeconds: 560, precededByGap: {...} } ]
```

### WindowSelection

| Field | Type | Meaning |
| --- | --- | --- |
| `startSeconds` | `number` | Window start in elapsed recording time. |
| `durationSeconds` | `number` | Window length. The interval is half-open, `[start, start + duration)`, so a zero or negative duration selects nothing. |
| `signalIndices` | `readonly number[]` | Required, same rules as `RecordSelection`. |

## readAnnotations

```ts
function readAnnotations(
  recording: EdfRecording,
  records: RecordRange,
  options?: DecodeAnnotationsOptions & ReadOptions,
): Promise<EdfAnnotationsResult>
```

Reads the annotation regions of a record range in one read and decodes them.

`records` is required and has no default. A full-file annotation scan is expensive, so it's always spelled out in your source as `{ start: 0, count: recording.header.recordCount }`.

```ts
const { annotations, recordOnsetTicks } = await readAnnotations(recording, {
  start: 0,
  count: recording.header.recordCount,
});

for (const a of annotations) {
  console.log(a.onsetSecondsFromFirstRecord, a.durationSeconds, a.text);
}
```

### EdfAnnotationsResult

| Field | Type | Meaning |
| --- | --- | --- |
| `annotations` | `readonly EdfAnnotation[]` | Timekeeping TALs and empty texts excluded. Stable sort by `(onsetTicks, signalIndex, byteOffsetInRecord)`. |
| `recordOnsetTicks` | `BigInt64Array` | One entry per record in the decoded range, always. This is the primitive every timeline is built from. |
| `diagnostics` | `readonly EdfDiagnostic[]` | TAL grammar defects, missing timekeeping, non-conformant shorthand. |

A record whose timekeeping TAL is missing gets the derived onset `start + recordIndex * duration` rather than a hole or a sentinel. A `TIMEKEEPING_TAL_MISSING` diagnostic names that record.

### EdfAnnotation

| Field | Type | Meaning |
| --- | --- | --- |
| `onsetSecondsFromHeaderStart` | `number` | The verbatim on-disk value, relative to the header startdate/starttime (EDF+ 2.2.4). |
| `onsetSecondsFromFirstRecord` | `number` | Rebased to record 0's true start (the EDFlib/pyEDFlib/MNE convention). |
| `onsetTicks` | `bigint` | Exact, in 100 ns units. Compare event times with this, never with the floats. |
| `onsetRaw` | `string` | The original digits, so precision survives a round-trip. |
| `durationSeconds` | `number \| undefined` | `undefined` when the TAL carried no duration. |
| `durationTicks` | `bigint \| undefined` | Exact. |
| `durationRaw` | `string \| undefined` | As written. |
| `text` | `string` | Verbatim. Never trimmed, never case-folded. |
| `channelLabel` | `string \| undefined` | From the EDF+ `description@@channel` convention. |
| `signalIndex` | `number` | Which annotations signal carried it. |
| `recordIndex` | `number` | Which record carried it. |
| `byteOffsetInRecord` | `number` | Where in the record, for a hexdump. |
| `textEncoding` | `'utf-8' \| 'latin-1-fallback'` | `latin-1-fallback` means the bytes were not valid UTF-8; re-decode them yourself if you know the writer's code page. |

Both onset conventions are exposed as separately named fields rather than selected by an option. Picking one without saying so is how two analyses of the same file disagree by a fraction of a second.

### DecodeAnnotationsOptions

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `signalIndices` | `readonly number[]` | every annotations signal | Which annotations signals to decode. |
| `strict` | `boolean` | `false` | Inherited from `ParseOptions`. The first would-be diagnostic throws `EdfFormatError`. |

Only the **first** annotations signal of the file carries timekeeping. If you pass `signalIndices` that leaves it out, no timekeeping is read. Every `recordOnsetTicks` entry then falls back to the nominal grid. Passing a data-signal index throws a plain `RangeError`.

## inspectEdf

```ts
function inspectEdf(source: ByteSource, options?: ReadOptions): Promise<EdfInspection>
```

Header-only triage that does not throw about content. This is the call for sorting a directory of unknown files. A malformed file becomes `ok: false` plus the diagnostic that would otherwise have been thrown, so you don't have to wrap each call.

Two boundaries limit that conversion. Only an `EdfError` is converted; anything else is a bug in edfcore and is rethrown. The reads happen outside the catch, so a source-level failure still rejects. `inspectEdf` does not throw about *content*, and it does not hide I/O.

Costs at most two reads and at most 128 KiB, which is exactly the full header of a 511-signal file. A header larger than that is reported as `HEADER_EXCEEDS_INSPECTION_BUDGET` rather than half-parsed. Use `readHeader` or `openEdf`, which read the whole header however large it is. Parsing here is never strict, and passing `strict` isn't possible: `ReadOptions` has no such field.

```ts
const inspection = await inspectEdf(source);

if (!inspection.ok) {
  console.log(inspection.variant ?? 'not an EDF or BDF file');
  console.log(formatDiagnostics(inspection.diagnostics));
}
```

### EdfInspection

| Field | Type | Meaning |
| --- | --- | --- |
| `ok` | `boolean` | The header parsed **and** carried no error-severity diagnostic. Warnings leave `ok` true. |
| `variant` | `EdfVariant \| undefined` | `'EDF' \| 'EDF+C' \| 'EDF+D' \| 'BDF' \| 'BDF+C' \| 'BDF+D'`. Still filled in when the header as a whole failed, because the version block and the reserved field stay readable long after everything else stops making sense. |
| `header` | `EdfHeader \| undefined` | `undefined` when parsing failed. |
| `byteLength` | `number` | The source's size. |
| `bytesRead` | `number` | What this call actually cost. |
| `headerBytes` | `Uint8Array \| undefined` | The bytes read, for a hexdump. |
| `diagnostics` | `readonly EdfDiagnostic[]` | Everything found, in the order the parse found it, with the fatal one last when parsing failed. |

## buildTimeline

```ts
function buildTimeline(
  source: ByteSource,
  header: EdfHeader,
  options?: OpenOptions,
): Promise<{ timeline: EdfTimeline; index: EdfRecordIndex }>
```

The half of `openEdf` that runs after the header. Call it directly when you already hold a header (from `readHeader`, or from a previous open) and don't want to re-read it.

Probes records 0 and `recordCount - 1`, for two reads. A single-record file costs one read. A file with no annotations signal costs none. Without a timekeeping TAL there are no per-record onsets on disk, and record `r` starts at `r * recordDuration` by definition. Both probes are memoised into the returned index, so `index.onsetTicks(0)` and `index.onsetTicks(recordCount - 1)` are free afterwards.

```ts
import { readHeader, buildTimeline } from 'edfcore';

const header = await readHeader(source);
const { timeline, index } = await buildTimeline(source, header);
const recording = { source, header, timeline, index };
```

## buildRecordIndex

```ts
function buildRecordIndex(
  recording: EdfRecording,
  options?: BuildIndexOptions,
): Promise<EdfRecordIndex>
```

Reads every record's onset and returns a `'complete'` index carrying the segments and gaps they imply. **This is the only function in edfcore that reads the whole file, and it is never called implicitly.**

The traversal is chunked so memory stays bounded whatever the file size: each chunk holds `min(4 MiB, maxMaterializeBytes) / recordByteLength` records, and never fewer than one. `onProgress` fires once per chunk. A file with no annotations signal is not scanned at all, because its record onsets are arithmetic. `onProgress` still fires once with the traversal complete, so a progress bar finishes.

The index's own diagnostics are not returned. An `EdfRecordIndex` is a structural answer, and `validateRecording` is the call that reports on a traversal. A non-monotonic timeline throws `EdfFormatError` with code `TIMELINE_NOT_MONOTONIC`.

`EdfRecording` is a plain struct, so you use the result by rebuilding one:

```ts
const index = await buildRecordIndex(recording, {
  onProgress: (done, total) => console.log(`${done}/${total}`),
});

console.log(index.coverage);          // 'complete'
console.log(index.segments?.length);  // 2
console.log(index.gaps);              // [ { startSeconds: 500, endSeconds: 560, ... } ]

const withIndex = { ...recording, index };
```

### BuildIndexOptions

Extends both `ParseOptions` and `ReadOptions`.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `onProgress` | `(done: number, total: number) => void` | none | Called once per chunk with records finished and records total. |
| `strict` | `boolean` | `false` | From `ParseOptions`. |
| `signal` | `AbortSignalLike` | none | From `ReadOptions`. |
| `maxMaterializeBytes` | `number` | `268435456` | From `ReadOptions`. Also caps the traversal's chunk size. |

### EdfRecordIndex

| Member | Type | Meaning |
| --- | --- | --- |
| `coverage` | `'probed' \| 'complete'` | `probed` = record 0 and the last record only. `complete` = every record verified. |
| `recordCount` | `number` | Records the index covers. |
| `segments` | `readonly EdfSegment[] \| undefined` | Present only when `coverage === 'complete'`. |
| `gaps` | `readonly EdfGap[] \| undefined` | Present only when `coverage === 'complete'`. |
| `onsetTicks(recordIndex, options?)` | `Promise<bigint>` | That record's onset, relative to the header start time. |
| `locate(seconds, options?)` | `Promise<EdfLocation \| undefined>` | Which record contains that instant. |

`segments` and `gaps` are absent rather than empty on a probed index, where nobody has checked for continuity.

`onsetTicks` costs one read of that record on a probed index and memoises the answer; on a complete index it costs nothing. It throws `EdfRangeError` for an index outside `0..recordCount - 1`.

`locate` costs `O(log recordCount)` reads on a probed index (about ten for a thousand records). A nearby second call costs almost none, because the probes are memoised. It returns `undefined` when the time is before the recording, after it, or inside a gap. Onsets are monotonic, and any violation the search observes throws `EdfFormatError`.

```ts
const location = await recording.index.locate(700);
// { recordIndex: 640, recordStartSeconds: 700, offsetInRecordSeconds: 0 }
```

### EdfSegment, EdfGap, EdfLocation

A **segment** is a maximal run of records with no gap inside it.

| `EdfSegment` | Type | Meaning |
| --- | --- | --- |
| `index` | `number` | Position in `segments`. |
| `records` | `RecordRange` | The records it covers. |
| `startSeconds` | `number` | Elapsed recording time at its first record. |
| `startTicks` | `bigint` | The same, exact. |
| `durationSeconds` | `number` | How long the run covers. |
| `durationTicks` | `bigint` | The same, exact. |
| `endSeconds` | `number` | First instant the run no longer covers. |
| `endTicks` | `bigint` | The same, exact. |

| `EdfGap` | Type | Meaning |
| --- | --- | --- |
| `beforeSegmentIndex` | `number` | Segment that ends at the gap. |
| `afterSegmentIndex` | `number` | Segment that starts after it. |
| `startSeconds` | `number` | When recording stopped. |
| `startTicks` | `bigint` | The same, exact. |
| `endSeconds` | `number` | When it resumed. |
| `endTicks` | `bigint` | The same, exact. |
| `durationSeconds` | `number` | How long nothing was recorded. |
| `durationTicks` | `bigint` | The same, exact. Sum these to total the time lost. |

| `EdfLocation` | Type | Meaning |
| --- | --- | --- |
| `recordIndex` | `number` | The record containing the instant. |
| `recordStartSeconds` | `number` | That record's start in elapsed recording time. |
| `recordStartTicks` | `bigint` | The same, exact. |
| `offsetInRecordSeconds` | `number` | How far into the record the instant falls. |
| `offsetInRecordTicks` | `bigint` | The same, exact. |

## readHeader

```ts
function readHeader(source: ByteSource, options?: OpenOptions): Promise<EdfHeader>
```

Parses the header and nothing else. **Exactly two reads**: 256 bytes to learn the signal count, then the remaining `256 * ns` as one range. Never one read per signal block, and never a speculative read of a size the file has not stated. When the signal-count field is unreadable, the second read is skipped and the 256 bytes are handed to `parseHeader` so it can report the real problem. That case costs one read.

Both reads are clamped to the source length. A file too short for the header it declares is reported as a file defect (`SOURCE_TOO_SMALL`), not as an `EdfSourceError` about a range past the end.

The returned `EdfHeader` is documented under [parseHeader](/docs/api-primitives#parseheader).

```ts
const header = await readHeader(source);
console.log(header.signals.map((s) => s.label));
console.log(header.recordCount, header.recordByteLength);
```

## readRecordBytes

```ts
function readRecordBytes(
  source: ByteSource,
  header: EdfHeader,
  records: RecordRange,
  options?: ReadOptions,
): Promise<Uint8Array>
```

One contiguous read covering every signal over the requested records. The returned buffer is exactly `records.count * header.recordByteLength` bytes and begins at record `records.start`. That's what [`decodeDigital`](/docs/api-primitives#decodedigital) and [`decodeAnnotations`](/docs/api-primitives#decodeannotations) require, so pass it to them unsliced.

The unit of I/O is the record range, never the channel range. There's no cheap single-channel read in EDF. Ten seconds of one channel out of thirty is a 27x overread spread over ten requests, against a single 153,600-byte read for all thirty.

A zero-record range issues no read at all and returns an empty buffer. A zero-length HTTP range isn't expressible, and there's nothing to fetch.

Throws `EdfRangeError` for a range outside `header.recordCount`, and `EdfBudgetError` *before* allocating when the range needs more than `maxMaterializeBytes`. The error names both numbers.

```ts
import { readRecordBytes, decodeDigital } from 'edfcore';

const records = { start: 0, count: 4 };
const bytes = await readRecordBytes(source, header, records);
const digital = decodeDigital(header, bytes, records, 0);
```

## Option types

### ReadOptions

Accepted by every function on this page, and by `ByteSource.read` itself.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `signal` | `AbortSignalLike` | none | Checked before and after each read. An aborted signal throws an `Error` whose `name` is `'AbortError'`. `DOMException` cannot be named without the DOM lib, and `error.name` is what consumers branch on. |
| `maxMaterializeBytes` | `number` | `268435456` (256 MiB) | Ceiling for any single allocation. Exceeding it throws `EdfBudgetError` *before* the allocation, never during it. |

`AbortSignalLike` is `{ readonly aborted: boolean }`. A real `AbortSignal` satisfies it; see [the shims](/docs/api-sources#structural-platform-shims).

### ParseOptions

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `strict` | `boolean` | `false` | The first would-be diagnostic throws `EdfFormatError` carrying it, so every `diagnostics` array is consequently empty. |

Strict mode is more unforgiving than it first looks. Every EDF file that writes its startdate in the mandated `dd.mm.yy` form carries a two-digit year. That is a `DATE_CLIPPED_TO_1985_2084` warning, and under `strict` it is a thrown `EdfFormatError`. Strict mode is a conformance gate, not a stricter reading mode. Use it when you want to reject anything less than perfect, and read `header.diagnostics` otherwise. Check order is pinned and tested, which is what makes error identity stable across refactors.

### OpenOptions

```ts
type OpenOptions = ParseOptions & ReadOptions;
```

Taken by `openEdf`, `readHeader` and `buildTimeline`.

### RecordRange

```ts
interface RecordRange {
  readonly start: number;
  readonly count: number;
}
```

Start plus count, never start plus end. Every range in edfcore has this shape.

## Errors

| Class | `edfErrorKind` | Thrown when |
| --- | --- | --- |
| `EdfFormatError` | `'format'` | The file is wrong in a way edfcore cannot proceed past. Under `strict`, the first diagnostic of any severity. Carries `code`, `diagnostic`, `field`, `byteOffset`, `signalIndex`, `recordIndex`. |
| `EdfRangeError` | `'range'` | You asked for records that do not exist. Carries `requested` and `available` as `RecordRange`. |
| `EdfChannelNotFoundError` | `'channel'` | A signal index or label the file does not have. Carries `selector` and `availableLabels`. |
| `EdfAmbiguousChannelError` | `'channel'` | A label matching more than one signal. Carries `label` and `matchingIndices`. |
| `EdfBudgetError` | `'budget'` | An allocation was refused before it happened. Carries `requiredBytes`, `budgetBytes` and `optionName` (always `'maxMaterializeBytes'`). |
| `EdfSourceError` | `'source'` | A `ByteSource` broke its contract, or the transport failed. Carries `offset`, `requestedLength`, `receivedLength`. |
| `EdfScalingError` | `'scaling'` | Physical units are undefined for a signal. See [toPhysical](/docs/api-primitives#tophysical). |

All extend the abstract `EdfError`. Discriminate with `isEdfError(value)` and then on `edfErrorKind`. `instanceof` is false across a realm boundary, which is exactly where a worker or iframe is most likely to be in play. Each class's full field list is in [Errors and diagnostic codes](/docs/api-errors).

> **Note**
> A plain `RangeError` (not an `EdfError`) means a caller mistake rather than a file defect. It covers decoding an annotations channel as samples and passing a reuse array that is too small. It also covers asking `readWindow` to map seconds to records on a discontinuous file with a probed index. `isEdfError` is how you tell the two apart.

```ts
import { isEdfError, openEdf } from 'edfcore';

try {
  await openEdf(source);
} catch (error) {
  if (isEdfError(error) && error.edfErrorKind === 'format') {
    console.log(error.code, error.byteOffset);
  } else {
    throw error;
  }
}
```

Diagnostics, severities and the code vocabulary are covered in [Diagnostics and errors](/docs/diagnostics).
