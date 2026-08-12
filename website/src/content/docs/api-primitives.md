---
title: API — primitives
description: "Reference for the pure, synchronous, I/O-free layer: parseHeader, decodeDigital, toPhysical, decodeAnnotations, the time helpers, the lookups, and the exported constants."
section: Reference
order: 2
lead: Every function here takes bytes or plain values and returns plain values. No promises, no source, no hidden state. Each one is testable from a Uint8Array literal with no mocks.
---

The primitives are the layer the [reading functions](/docs/api-reading) are built out of. Reach for them directly when you already hold bytes (from a WebSocket, a zip entry, a database blob), or to decode the same buffer twice without re-reading it.

Each function's result shape is summarised with it. [Types](/docs/api-types) lists every public shape in full.

```ts
import {
  parseHeader,
  decodeDigital,
  toPhysical,
  clampToDigitalRange,
  decodeAnnotations,
  resolveTimeWindow,
  trimToWindow,
  findSignals,
  getSignal,
  isAnnotationLabel,
  decodeHeaderLatin1,
  formatStartTimeNaive,
  formatDiagnostics,
} from 'edfcore';
```

## parseHeader

```ts
function parseHeader(
  headerBytes: Uint8Array,
  sourceByteLength: number,
  options?: ParseOptions,
): EdfHeader
```

Parses an EDF, EDF+, BDF or BDF+ header.

`headerBytes` must hold at least `256 * (ns + 1)` bytes. Anything beyond that is ignored, so a caller that over-read is free to pass its whole buffer.

**`sourceByteLength` is a required positional argument, and it is the size of the whole file, not the length of `headerBytes`.** Two parsing steps need it, and neither can be skipped:

- **Recovering `recordCount = -1`.** That value is the EDF+ sanctioned way of saying the writer never closed the file, and it's common in real corpora. The only way to learn the real count is `floor((sourceByteLength - headerByteLength) / recordByteLength)`. Without the file size there is no answer.
- **Detecting truncation.** A header declaring 2880 records over a file that only holds 2879 whole ones is a truncated download. The difference between those two numbers is the only evidence of it. edfcore reports `TRUNCATED_FILE` and sets `recordCount` to what is actually present.

Pass `bytes.byteLength` for an in-memory file, or `source.byteLength` for a `ByteSource`. Passing the length of a header-only buffer isn't an error edfcore can detect. It reports `recordCount: 0` with `recordCountSource: 'sourceByteLength'`, which is the correct answer to the question you asked.

Throws a plain `RangeError` when `sourceByteLength` is not a non-negative safe integer, which is a caller bug rather than a file defect. Throws `EdfFormatError` for a defect that makes further parsing meaningless: fewer than 256 bytes, a header shorter than the signal count implies, or a zero-byte data record. An EDF+ file with no annotations signal throws too.

```ts
import { parseHeader } from 'edfcore';

const bytes = new Uint8Array(await file.arrayBuffer());
const header = parseHeader(bytes, bytes.byteLength);

console.log(header.variant);            // 'EDF+C'
console.log(header.recordCount);        // 10
console.log(header.recordCountSource);  // 'headerField'
```

Validation order is pinned and tested. Under `strict: true` the first would-be diagnostic throws, so the order decides which error a broken file reports. Moving a check is a behavioural change even when every individual check is unaltered.

### EdfHeader

| Field | Type | Meaning |
| --- | --- | --- |
| `variant` | `EdfVariant` | `'EDF' \| 'EDF+C' \| 'EDF+D' \| 'BDF' \| 'BDF+C' \| 'BDF+D'`. |
| `continuity` | `'continuous' \| 'discontinuous'` | From the reserved marker. Plain EDF and BDF are continuous. |
| `bytesPerSample` | `2 \| 3` | 2 for EDF, 3 for BDF. |
| `headerByteLength` | `number` | Always the computed `256 * (ns + 1)`, never the declared value. |
| `declaredHeaderByteLength` | `number` | What the file claims at offset 184, kept so a mismatch stays visible. |
| `recordByteLength` | `number` | `bytesPerSample * sum(samplesPerRecord)`. Every data offset steps by this. |
| `dataByteLength` | `number` | `recordCount * recordByteLength`. |
| `recordDurationSeconds` | `number` | May legitimately be `0`. Never divide by it. |
| `recordDurationTicks` | `bigint` | The same value in exact 100 ns ticks, taken from the digits on disk rather than from the parsed float. |
| `recordCount` | `number` | Resolved and non-negative. What is actually readable. |
| `declaredRecordCount` | `number` | Verbatim. `-1` means the writer never closed the file. |
| `recordCountSource` | `'headerField' \| 'sourceByteLength'` | Which of the two produced `recordCount`. |
| `startTime` | `EdfStartTime` | Date and clock, with both candidate dates kept. |
| `patient` | `EdfPatientId` | Parsed local patient identification. |
| `recording` | `EdfRecordingId` | Parsed local recording identification. |
| `signals` | `readonly EdfSignal[]` | Every signal, data and annotations alike, in file order. |
| `dataSignalIndices` | `readonly number[]` | Indices of the sample-carrying signals. |
| `annotationSignalIndices` | `readonly number[]` | Indices of the annotations signals. Element `0` is the one carrying timekeeping. |
| `reserved` | `string` | The full 44 reserved bytes, verbatim. |
| `raw` | `EdfRawHeaderFields` | Every fixed-header field as written, before trimming or interpretation. |
| `rawBytes` | `Uint8Array` | A copy of the whole header, for hexdumps and bug reports. |
| `diagnostics` | `readonly EdfDiagnostic[]` | Everything the parse found. Under `strict` the first non-`info` diagnostic threw instead, so only `info` notes can be here. |

`raw` holds `version`, `patientId`, `recordingId`, `startDate`, `startTime`, `headerByteLength`, `reserved`, `recordCount`, `recordDuration` and `signalCount`, all as `string`. Anything that can be checked against the file is exposed twice: as parsed value, and as the bytes it came from.

### EdfSignal

| Field | Type | Meaning |
| --- | --- | --- |
| `index` | `number` | Position in `header.signals`. |
| `kind` | `'data' \| 'annotations'` | Decided by the reserved label, not by anything you pass in. |
| `label` | `string` | Trimmed. `raw.label` keeps the padding. |
| `transducerType` | `string` | Trimmed. |
| `prefiltering` | `string` | Trimmed. |
| `physicalDimension` | `string` | Trimmed. `raw.physicalDimension` keeps the padding. |
| `unit` | `string` | Normalised for comparison only. The several encodings of micro all become `u`. |
| `physicalMinimum` | `number` | As declared. |
| `physicalMaximum` | `number` | **May be less than the minimum.** That is a negative amplifier gain, it is legal, and edfcore never "fixes" it. |
| `digitalMinimum` | `number` | As declared. |
| `digitalMaximum` | `number` | As declared. |
| `samplesPerRecord` | `number` | Authoritative. Sample indexing uses this, never a rate. |
| `sampleRateHz` | `number \| undefined` | Derived. `undefined` exactly when `recordDurationSeconds === 0`. Never index by this. |
| `sampleCount` | `number` | `samplesPerRecord * header.recordCount`. |
| `scale` | `EdfScale \| undefined` | `{ bitValue, offset }`, or `undefined` when scaling is impossible or unsafe. |
| `recordByteOffset` | `number` | Byte offset of this signal's block within one data record. |
| `recordByteLength` | `number` | `samplesPerRecord * header.bytesPerSample`. |
| `raw` | `EdfRawSignalFields` | All ten per-signal fields as written. |

`scale` is `undefined` for a degenerate or inverted digital range, a degenerate physical range, or a log-transformed channel. [`toPhysical`](#tophysical) then throws; `decodeDigital` keeps working.

### EdfStartTime

EDF records local time at the patient with no timezone, so edfcore never produces a `Date`. A `Date` applies the reader's zone, and is worst exactly at DST boundaries.

| Field | Type | Meaning |
| --- | --- | --- |
| `headerDate` | `EdfCalendarDate \| undefined` | From the `dd.mm.yy` field, through the 1985–2084 rule. |
| `recordingIdDate` | `EdfCalendarDate \| undefined` | From the EDF+ recording-identification `Startdate` subfield (the only unambiguous four-digit year, and the only way past 2084). |
| `resolvedDate` | `EdfCalendarDate \| undefined` | `recordingIdDate` when present, otherwise `headerDate`. |
| `dateSource` | `'headerField' \| 'recordingIdField' \| 'none'` | Which one won. |
| `clock` | `EdfClockTime` | `{ hour, minute, second }`. Reports midnight when the field was unparseable, and says so in a diagnostic. |
| `clockSource` | `'headerField' \| 'none'` | Which of those two it is. Midnight is a believable start for a sleep study, so a refused clock is otherwise indistinguishable from a real one. |
| `secondsSinceMidnight` | `number` | Derived from `clock`. |

`EdfCalendarDate` is `{ year, month, day }` with `month` in 1–12, not a JavaScript month index. A disagreement between the two dates is always reported as `DATE_FIELDS_DISAGREE`, and both stay on the result.

## decodeDigital

```ts
function decodeDigital(
  header: EdfHeader,
  recordBytes: Uint8Array,
  records: RecordRange,
  signalIndex: number,
  out?: Int32Array,
  options?: MaterializeOptions,
): Int32Array
```

De-interleaves one signal out of a record range and sign-extends its samples. This is the sole owner of the 2- and 3-byte two's complement expressions. EDF is little-endian 16-bit; BDF is little-endian 24-bit sign-extended from bit 23. There's no big-endian variant of either.

`recordBytes` must be **exactly** `records.count * header.recordByteLength` bytes and must begin at record `records.start`. Pass the buffer [`readRecordBytes`](/docs/api-reading#readrecordbytes) returned, unsliced. The range check catches asking for records the file doesn't have. The length check catches a buffer that doesn't start where `records.start` says it does. Nothing in the bytes identifies which record they came from, so that case is unrecoverable rather than merely wrong.

Returns an `Int32Array` of `records.count * signal.samplesPerRecord` samples, still in digital units.

`out` is the reuse path. When supplied and long enough it is written in place and no allocation happens. A longer array is narrowed with `subarray`, which shares its memory, so `result.length` still equals the true sample count. An `out` that is too short throws a plain `RangeError`.

Throws `EdfChannelNotFoundError` for a signal the header does not have, `EdfRangeError` for a bad range or a mis-sized buffer, and `EdfBudgetError` when the allocation would exceed `maxMaterializeBytes`. The budget check runs before the allocation, never during.

```ts
import { readRecordBytes, decodeDigital } from 'edfcore';

const records = { start: 0, count: 2 };
const bytes = await readRecordBytes(source, header, records);

// Fresh allocation.
const digital = decodeDigital(header, bytes, records, 0);

// Or reuse across a loop — zero allocations after the first.
const scratch = new Int32Array(64);
const again = decodeDigital(header, bytes, records, 0, scratch);
console.log(again.buffer === scratch.buffer); // true
```

> **Warning**
> Never pass an annotations signal's index here. Its bytes are TAL text; decoded as samples they produce numbers that look exactly like a signal. `decodeDigital` does not check for it (the check lives in [`readRecords`](/docs/api-reading#readrecords)), so select from `header.dataSignalIndices`.

### MaterializeOptions

The trailing options argument on every primitive that can allocate.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `maxMaterializeBytes` | `number` | `268435456` (256 MiB) | Refused before the allocation, never during it. |

Passing nothing keeps the default. `ReadOptions` also carries this field, so the same value flows through a read and the decode that follows it.

## toPhysical

```ts
function toPhysical(
  signal: EdfSignal,
  digital: ArrayLike<number>,
  out?: Float64Array,
  options?: MaterializeOptions,
): Float64Array
```

Converts digital counts into the signal's own physical units, in float64 throughout. `digital` is any `ArrayLike<number>`: an `Int32Array` from `decodeDigital`, or a plain array.

The expression is `physical = bitValue * (offset + digital)`, and it is **pinned**. It is numerically worse than the obvious `physicalMinimum + (digital - digitalMinimum) * gain`. It is EDFlib's exact form, kept verbatim so that edfcore's float64 output *can* be compared bit for bit against pyEDFlib and EDFlib. That parity is measured, not intended: `tests/corpus/golden-values.test.ts` reads fixtures written and read back by pyEDFlib's own writer and compares every physical sample against the IEEE-754 bits pyEDFlib produced, with `Object.is` — so a one-ULP difference fails. The harness has existed since 0.2.34-0.2.48 and its goldens are committed, so it runs on a fresh clone. The two forms disagree by up to about 9.3e-10 LSB (ten orders of magnitude below the quantisation floor). On asymmetric ranges they differ on nearly half the samples by one ULP. If your pipeline cross-validates against a Python reader, that shared expression is why the numbers are expected to agree.

Float64 is a contract, never Float32. Float32 carries 24 significand bits, so a 24-bit BDF sample scaled into it loses about a quarter of a quantisation step.

Throws `EdfScalingError` when `signal.scale` is `undefined`. The error carries `code`, `signalIndex` and `label`, and its message names the raw header fields it read. `decodeDigital` keeps working on that signal.

| `EdfScalingError.code` | Cause |
| --- | --- |
| `DEGENERATE_DIGITAL_RANGE` | `digitalMinimum === digitalMaximum`, which makes the gain a division by zero. |
| `DEGENERATE_PHYSICAL_RANGE` | `physicalMinimum === physicalMaximum`, so every sample maps to one value. |
| `INVERTED_DIGITAL_RANGE` | `digitalMinimum > digitalMaximum`, and edfcore will not guess which the writer meant. |
| `LOG_TRANSFORMED_CHANNEL` | Physical dimension `Filtered`: the values are log-compressed and the linear formula would be wrong by orders of magnitude. |
| `SCALE_UNAVAILABLE` | No scale, and none of the above explains it. |

`out` behaves exactly as in `decodeDigital`: reused when long enough, narrowed with `subarray` when longer, a plain `RangeError` when shorter.

```ts
import { getSignal, toPhysical } from 'edfcore';

const signal = getSignal(header, 'Fp1');
const microvolts = toPhysical(signal, digital);

// Same length, same order, now in signal.physicalDimension units.
console.log(microvolts.length === digital.length); // true
console.log(signal.physicalDimension);             // 'uV'
```

## clampToDigitalRange

```ts
function clampToDigitalRange(
  signal: EdfSignal,
  digital: Int32Array,
  out?: Int32Array,
  options?: MaterializeOptions,
): Int32Array
```

Clamps samples to the declared digital range. **Post-hoc only. Nothing on the read path calls this.**

It exists for one job: cross-validating against a consumer that clamps. EDFlib clamps samples to the declared digital range when it loads them. If your numbers differ from a Python reader's only at the extremes, this is the difference.

Clamping is to `[min(digMin, digMax), max(digMin, digMax)]` rather than to `[digMin, digMax]`. That matters for an inverted declaration, where the naive bounds are empty and collapse every sample onto a single value.

Throws a plain `RangeError` when either bound is not a finite number. Every comparison against `NaN` is false, so a clamp against one returns the input unchanged.

```ts
const clamped = clampToDigitalRange(signal, digital);
```

## decodeAnnotations

```ts
function decodeAnnotations(
  header: EdfHeader,
  recordBytes: Uint8Array,
  records: RecordRange,
  options?: DecodeAnnotationsOptions,
): EdfAnnotationsResult
```

Decodes the TALs in the annotation regions of a record range. Same buffer contract as `decodeDigital`: exactly `records.count * header.recordByteLength` bytes, beginning at `records.start`, or `EdfRangeError`.

The returned shape is documented under [`readAnnotations`](/docs/api-reading#readannotations), which is this function plus one read.

Three rules the rest of the library depends on:

1. The **first** TAL of the **first** annotations signal of the file is that record's timekeeping TAL. "First" is a position, not "the first one that parsed". "First annotations signal" means `header.annotationSignalIndices[0]`, whatever this call was asked for. An additional annotations signal carries no timekeeping, so its first TAL is a real event and stays.
2. `recordOnsetTicks` has one entry for **every** record in the decoded range, always.
3. Onsets are exposed under both conventions as separately named fields, never as an option.

Passing `signalIndices` that omits the timekeeping signal is legal and means no timekeeping is read. Every `recordOnsetTicks` entry then falls back to the nominal grid. Passing a data-signal index throws a plain `RangeError` — a signal the file has, of the wrong kind. An index the file does not have is a different mistake and throws `EdfChannelNotFoundError`, as every other entry point taking a signal index does.

Diagnostic volume is bounded. `TIMEKEEPING_TAL_MISSING` is reported per record, because it names a record whose onset was derived and that information exists nowhere else. `NEGATIVE_ANNOTATION_ONSET` and `TIMEKEEPING_TAL_NONCONFORMANT` are reported once per call. Grammar defects are deduplicated per region and carry an occurrence count.

```ts
import { readRecordBytes, decodeAnnotations } from 'edfcore';

const records = { start: 0, count: header.recordCount };
const bytes = await readRecordBytes(source, header, records);
const { annotations, recordOnsetTicks } = decodeAnnotations(header, bytes, records);

// Text verbatim, onset exact in 100 ns ticks.
console.log(annotations[0].text, annotations[0].onsetTicks);
// One entry per record, always — record 1 of a 1 s file starts at 10000000n.
console.log(recordOnsetTicks.length === records.count);
```

Record-onset spacing and monotonicity are **not** checked here. This function produces `recordOnsetTicks`, and the timeline layer owns what a valid timeline is.

## resolveTimeWindow

```ts
function resolveTimeWindow(
  timeline: EdfTimeline,
  index: EdfRecordIndex,
  startSeconds: number,
  durationSeconds: number,
): readonly RecordRange[]
```

Answers "which records does this window cost?" **before** a byte is read, so the price of a window is auditable. This is the function [`readWindow`](/docs/api-reading#readwindow) calls first.

Returns one `RecordRange` per contiguous run the window overlaps, in time order. Empty when the window falls entirely inside a gap, entirely outside the recording, or has a non-positive duration. The interval is half-open `[start, start + duration)`, so a zero-length window contains no time and therefore no samples.

Ranges are record-aligned and are therefore usually wider than the window. A record is the smallest unit the file can be read by; [`trimToWindow`](#trimtowindow) is how you narrow the samples afterwards.

With `index.segments` present (`coverage === 'complete'`) the answer is exact. With a probed index it is exact only while the file is contiguous, which is precisely what `spanTicks === coveredTicks` states. Otherwise this function throws a plain `RangeError` rather than guessing at onsets nobody has read.

Every comparison inside is integer or rational arithmetic on ticks, records and `samplesPerRecord`. `round(t * sampleRateHz)` appears nowhere. `sampleRateHz` is derived and often not representable (256/3 Hz is a real record duration of 3 s with 256 samples). Rounding through it walks the answer off by a sample near every large `t`.

```ts
// One second from t = 2.5, on a file with 1 s records: it straddles records 2 and 3.
const ranges = resolveTimeWindow(recording.timeline, recording.index, 2.5, 1);
// [ { start: 2, count: 2 } ]

const bytes = ranges.reduce(
  (total, r) => total + r.count * recording.header.recordByteLength,
  0,
);
console.log(`this window costs ${bytes} bytes in ${ranges.length} read(s)`);
```

## trimToWindow

```ts
function trimToWindow(
  header: EdfHeader,
  chunkSignal: EdfChunkSignal,
  startSeconds: number,
  durationSeconds: number,
): EdfChunkSignal
```

Narrows one record-aligned `EdfChunkSignal` to exactly the samples inside `[startSeconds, startSeconds + durationSeconds)`.

Sample `j` of the chunk is inside the window when the tick edfcore **publishes** for it — `ceil(j * recordDuration / samplesPerRecord)`, the value `gridSampleStartTicks` and `sampleStartTicksOf` report — falls in `[relativeStart, relativeEnd)`. Since `ceil(x) >= R` iff `x > R - 1`, both edges stay integer bigint products of on-disk quantities (no division, no sample rate, no float bound), so the boundary sample is the same one on every platform.

The comparison is against the published tick, not the sample's exact rational start. The two differ whenever a boundary is not a whole tick — 256 samples in a one-second record puts sample 1 at 39,062.5 ticks, published as 39,063 — and selecting on the exact start excluded the very sample a caller had aligned the window to (fixed in 0.3.56).

`digital` in the result is a **subarray view** of the input's, so trimming allocates nothing and the two share memory. `sampleCount` is taken from the view, so the count and the data cannot disagree. `outOfDigitalRangeCount` is re-counted only when it can have changed and only when there is something to find.

The chunk must be one contiguous run of records (what `readWindow` returns), because that's what makes the sample grid uniform across it. A window that only partly overlaps the chunk is clamped to the samples that exist. One that misses it entirely yields a zero-length result rather than an error.

Throws `EdfChannelNotFoundError` when `chunkSignal.signalIndex` is not in `header.signals`, which means you passed a different header than the chunk was read with.

```ts
import { readWindow, trimToWindow } from 'edfcore';

const chunks = await readWindow(recording, {
  startSeconds: 1.4,
  durationSeconds: 0.5,
  signalIndices: [0, 1],
});

for (const chunk of chunks) {
  for (const signal of chunk.signals) {
    const exact = trimToWindow(header, signal, 1.4, 0.5);
    console.log(signal.signalIndex, exact.sampleCount, exact.startSeconds);
  }
}
// On a file with 1 s records, signal 0 at 256 samples/record and signal 1 at 3:
// 0 128 1.40234375           <- 256 Hz: the first sample at or after 1.4 s
// 1 1   1.6666666666666667   <- 3 Hz: a coarser grid, so the boundary lands later
```

That per-signal difference is why `startSeconds` lives on `EdfChunkSignal` rather than only on the chunk. Two signals of different rates have different first samples inside the same window.

## findSignals

```ts
function findSignals(header: EdfHeader, label: string): readonly EdfSignal[]
```

Every signal with this label, in signal order. Empty when none matches. Matching is exact on the **trimmed** label and is **case-sensitive**; the argument is trimmed too, so `'  Fp1  '` matches `'Fp1'`.

Nothing else is normalised. EDF labels are electrode names, `'Fp1'` and `'FP1'` are written by different systems, and edfcore has no montage vocabulary to decide they are the same thing.

```ts
const matches = findSignals(header, 'T8-P8');
console.log(matches.map((s) => s.index)); // [ 0, 1 ]  — CHB-MIT really does this
```

## getSignal

```ts
function getSignal(header: EdfHeader, selector: number | string): EdfSignal
```

One signal, by index or by label. A numeric selector indexes `header.signals` directly.

Throws `EdfChannelNotFoundError` when nothing matches, carrying `selector` and `availableLabels` so the message can list what the file actually has. Throws `EdfAmbiguousChannelError` when a label matches more than one signal, carrying `label` and `matchingIndices`.

That second case is the reason this function exists. `signals.find(s => s.label === label)` returns the first of a duplicate pair and reports nothing about the second.

```ts
import { getSignal, EdfAmbiguousChannelError, type EdfHeader, type EdfSignal } from 'edfcore';

function resolve(header: EdfHeader, label: string): EdfSignal {
  try {
    return getSignal(header, label);
  } catch (error) {
    if (error instanceof EdfAmbiguousChannelError) {
      // Duplicates are real. Decide deliberately which one you meant.
      console.warn(`${label} matches indices ${error.matchingIndices.join(', ')}`);
      const [first] = error.matchingIndices;
      // An ambiguous match always holds at least two indices, but `noUncheckedIndexedAccess`
      // types the element as `number | undefined` and cannot know that.
      if (first === undefined) throw error;
      return getSignal(header, first);
    }
    throw error;
  }
}
```

`instanceof` is fine inside a single realm; if the header could have crossed a worker or iframe boundary, branch on `isEdfError(error) && error.edfErrorKind === 'channel'` instead.

## isAnnotationLabel

```ts
function isAnnotationLabel(label: string): boolean
```

True for the two reserved annotation labels, `'EDF Annotations'` and `'BDF Annotations'`, matched on the trimmed text and case-sensitively.

Both are accepted for either family: the label identifies the channel's **role**, and a BDF+ file written by an EDF+ library carries `'EDF Annotations'`.

You rarely need this, since `signal.kind` already says `'annotations'`. It's the same predicate the parser uses, so it's here for code that classifies a label before it has a header.

```ts
isAnnotationLabel('EDF Annotations ');  // true
isAnnotationLabel('Fp1');               // false
```

## decodeHeaderLatin1

```ts
function decodeHeaderLatin1(bytes: Uint8Array): string
```

Decodes header bytes as ISO-8859-1: byte `b` becomes code point U+00`b`, always. No trimming, no interpretation.

`TextDecoder` is not used on this path. Verified on Node v24.4.0, `TextDecoder('latin1')`, `'iso-8859-1'`, `'ascii'` and `'windows-1252'` all report `encoding === 'windows-1252'` yet decode `0x80` as U+0080. The WHATWG Encoding Standard mandates U+20AC for those labels, so the same header bytes produce different strings in Node and in a spec-compliant browser. `String.fromCharCode` is the identity map ISO-8859-1 actually is, and it's the same everywhere.

```ts
decodeHeaderLatin1(bytes.subarray(0, 8));  // '0       '
```

## formatStartTimeNaive

```ts
function formatStartTimeNaive(startTime: EdfStartTime): string | undefined
```

Renders the recording start as `'1951-08-02T09:00:00.000'`. **There is no zone designator, because EDF has no zone.**

Returns `undefined` when the file states no start instant, which is **two** conditions, not one:

| Condition | What the file did |
| --- | --- |
| `startTime.resolvedDate === undefined` | neither the `dd.mm.yy` field nor the EDF+ `Startdate` subfield gave a date |
| `startTime.clockSource === 'none'` | the `hh.mm.ss` field failed its grammar, so `startTime.clock` is a substituted midnight |

The second was added in 0.3.17 and matters more than it looks: without it a file whose starttime reads `23.59.60` came back as `...T00:00:00.000`, a wall-clock instant the file never gave — and for a sleep study midnight is the most believable start there is. A caller who checks only `resolvedDate` before calling will still see `undefined`.

The milliseconds are always `.000`. The header stores whole seconds. The sub-second start of an EDF+ recording lives in record 0's timekeeping TAL (`timeline.startOffsetSeconds`).

Do not feed the result to `new Date()` without deciding what zone you mean.

```ts
formatStartTimeNaive(header.startTime);  // '1951-08-02T09:00:00.000', or undefined
```

## formatDiagnostics

```ts
function formatDiagnostics(
  diagnostics: readonly EdfDiagnostic[],
  options?: FormatDiagnosticsOptions,
): string
```

Renders a diagnostic array as a multi-line report, one block per diagnostic. Returns `''` for an empty list, so the result concatenates into a larger report without a stray blank line.

Layout only. By the message contract a diagnostic's own message already names the field, the raw bytes as written, the rule and the next step. This adds structure: severity marker, code, location, bytes as hex. Output is deterministic: no locale-sensitive formatting, no unordered iteration, and no ANSI escapes unless you ask for them.

| `FormatDiagnosticsOptions` | Type | Default | Meaning |
| --- | --- | --- | --- |
| `color` | `boolean` | `false` | ANSI colour by severity: red for `error`, yellow for `warning`, cyan for `info`, dim for detail lines. |
| `maxItems` | `number` | all | Show at most this many, then a dim `... and N more`. A non-finite value is ignored; `0` shows only the summary line. |

Raw byte runs are elided after 24 bytes with a `+N more` count: a report is a summary, not a hex dump.

```ts
import { formatDiagnostics } from 'edfcore';

console.log(formatDiagnostics(header.diagnostics, { color: true, maxItems: 10 }));
```

```
info [DATE_CLIPPED_TO_1985_2084] startdate field (8 bytes at offset 168) is "01.01.20": its
  two-digit year was resolved to 2020 by the EDF+ rule that 85..99 mean 1985..1999 and 00..84
  mean 2000..2084, so the field cannot express a year outside that span. ...
  at byte offset 168 (8 bytes), startDate
  raw: "01.01.20"
  expected: 1985..2084
  actual: 2020
  spec: EDF+ additional specification 2 (startdate and starttime)
```

## Constants

| Constant | Value | Meaning |
| --- | --- | --- |
| `EDF_HEADER_BLOCK_BYTES` | `256` | The fixed header is one block, and each signal adds exactly one more. Total header size is always `256 * (signalCount + 1)`. |
| `EDF_ANNOTATIONS_LABEL` | `'EDF Annotations'` | The reserved label, trimmed and case-sensitive. On disk the field is `'EDF Annotations '` (15 characters plus a pad). |
| `BDF_ANNOTATIONS_LABEL` | `'BDF Annotations'` | The BDF spelling. Either is accepted for either family. |
| `EDF_DIGITAL_MIN` | `-32768` | 16-bit two's complement (the EDF sample range). |
| `EDF_DIGITAL_MAX` | `32767` | |
| `BDF_DIGITAL_MIN` | `-8388608` | 24-bit two's complement, sign-extended from bit 23 (the BDF sample range). |
| `BDF_DIGITAL_MAX` | `8388607` | |
| `EDF_RECOMMENDED_MAX_RECORD_BYTES` | `61440` | An EDF specification *recommendation*, not a limit. Exceeding it is a warning, never an error. Reads are record-aligned, so it is also the smallest amount of data any read of that file can return. |
| `TICKS_PER_SECOND` | `10000000n` | A `bigint`. Time is compared in exact 100 ns ticks, never in floats. Float equality on event times is how ERP alignment breaks. |
| `VERSION` | `string` | The published package version, kept in sync with `package.json` by a test. Printing it into a bug report is the point; the docs do not spell it out, because a number written here goes stale the next release. |

```ts
import { TICKS_PER_SECOND, EDF_DIGITAL_MAX, VERSION } from 'edfcore';

const halfSecond = TICKS_PER_SECOND / 2n;   // 5000000n
const saturated = digital.filter((v) => v === EDF_DIGITAL_MAX).length;
console.log(`edfcore ${VERSION}`);
```

edfcore is pre-1.0, and that is meant literally: the API surface can still move. It is checked against real public corpora (see the [installation page](/docs/installation)), and the physical-value expression is compared bit for bit against pyEDFlib by the harness described on the [physical values](/docs/physical-values) page. Claims outside what that harness covers are well-argued rather than settled.
