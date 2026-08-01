---
title: Annotations
description: Read EDF+ events (onsets, durations, text and channel labels) and convert an event time into an exact sample index.
section: Guides
order: 4
lead: EDF+ stores events as text inside a signal, not in a table beside the samples. This page covers how to read them and the two onset conventions every reader chooses between. It also covers the integer arithmetic that turns an event time into a sample index without drifting.
---

## Where the events live

EDF+ did not add an events table to the format. It added a channel. One signal in the header is
labelled `EDF Annotations`, or `BDF Annotations` in a BDF+ file. edfcore accepts either label in
either family, because the label names the channel's *role*. In every data record, that signal's
block of bytes holds text instead of samples.

The text is a Time-stamped Annotations List, a TAL:

```text
Onset [ 0x15 Duration ] 0x14 *( Text 0x14 ) 0x00
```

The onset carries a mandatory sign. The duration never does. `0x14` terminates the timestamp and
each text run, `0x15` separates onset from duration, and `0x00` ends the TAL. A record's region
holds as many TALs as fit, and the rest of the region is `0x00` padding.

The region is exactly `samplesPerRecord * bytesPerSample` bytes. The annotations signal declares a
`samplesPerRecord` like any other, and that number is what buys the writer room for text. A signal
declaring 60 samples in a 2-byte EDF file gives every record 120 bytes of annotation space:

```ts
const { header } = recording;
const region = header.signals[header.annotationSignalIndices[0]];

region.kind;              // 'annotations'
region.label;             // 'EDF Annotations'
region.samplesPerRecord;  // 60
region.recordByteLength;  // 120 — the region size, per record
region.recordByteOffset;  // 768 — where it begins inside each record
region.scale;             // undefined — there is nothing to scale
```

Parsing is hard-bounded to that region. A TAL with no terminating `0x00` before the region ends is
discarded rather than continued into the next signal's block. The bytes past the bound are samples,
and decoding them as text produces annotations that aren't in the file.

## How do I read EDF+ annotations and event times?

`readAnnotations` takes a recording and a record range, and returns everything in it:

```ts
import { openEdf, readAnnotations } from 'edfcore';
import { fileSource } from 'edfcore/node';

const recording = await openEdf(await fileSource('./study.edf'));

const { annotations, recordOnsetTicks, diagnostics } = await readAnnotations(recording, {
  start: 0,
  count: recording.header.recordCount,
});

for (const event of annotations) {
  console.log(event.onsetSecondsFromFirstRecord, event.durationSeconds, event.text);
}
// -0.75 undefined pre-stimulus baseline
// 1     30        Sleep stage W
// 1.25  undefined spike
// 2     30        Sleep stage 1
```

The record range is required and has no default. Annotation regions are interleaved with the
samples inside each record, so there's no way to read only the events. A full-file scan reads every
byte of every record:

```text
a 200-record file with 632-byte records

{ start: 0, count: 200 }   one read of 126,400 bytes   the whole file
{ start: 0, count:  10 }   one read of   6,320 bytes
```

A full scan of a twelve-hour study is a full download of it. Spelling
`{ start: 0, count: recording.header.recordCount }` at the call site keeps that cost visible in
your own source. See [large files](/docs/large-files) for the read patterns of every other call.

One annotation object is produced per non-empty **text run**, not per TAL. A TAL carrying two texts
at the same timestamp yields two annotations that share an onset and a duration. Empty runs are
dropped, since an empty text is how the grammar terminates a timestamp.

The list is sorted by `onsetTicks`, then `signalIndex`, then `byteOffsetInRecord`, then the order
the TALs appear on disk. That order is total and is pinned by a test, so two runs over the same
file produce the same array.

## The timekeeping TAL

EDF+ specification 2.2.1 reserves the **first TAL of the first annotations signal** in every data
record for timekeeping. It carries that record's own start time relative to the header
startdate/starttime, no duration, and one empty text:

```text
+13.25 0x14 0x14 0x00
```

"First" here is a position, not "the first one that parsed". A record whose slot-0 TAL is malformed
does not get its second TAL promoted into the timekeeping role.

edfcore strips it from `annotations`, since it's structure rather than an event, and surfaces it
separately:

```ts
result.recordOnsetTicks;  // BigInt64Array, one entry per record in the decoded range
```

There's always exactly one entry per record, with no holes and no sentinel. A record whose
timekeeping TAL is missing or unparseable gets the derived onset
`start + recordIndex * recordDuration`. edfcore also reports a `TIMEKEEPING_TAL_MISSING` diagnostic
naming that record. This array is the primitive every timeline in edfcore is built from. See
[discontinuous recordings](/docs/discontinuous).

A plain EDF or BDF has no annotations signal at all, and `readAnnotations` still works on such a
file. It returns an empty list with no diagnostics. `recordOnsetTicks` is the arithmetic grid
`recordIndex * recordDuration`, which is what a record onset means in a file that doesn't store one.

## Two onset conventions

Every EDF+ reader has to answer one question: an onset written `+13.25` is 13.25 seconds after
*what*?

The spec's answer (EDF+ 2.2.4) is the header's startdate and starttime. The header start time is
only accurate to the second, since it's an `hh.mm.ss` field. The true start of record 0 is the
onset in record 0's own timekeeping TAL, which is allowed to be a sub-second value in `[0, 1)`. The
two answers differ by that offset. EDFlib, pyEDFlib and MNE all report the second one.

edfcore reports both, as two separately named fields:

| field | measured from | value in the example below |
|---|---|---|
| `onsetSecondsFromHeaderStart` | the header startdate/starttime, verbatim on disk | `1.25` |
| `onsetSecondsFromFirstRecord` | the true start of record 0 | `1` |

They differ by `recording.timeline.startOffsetSeconds`, which is record 0's timekeeping onset
(`0.25` in the example file):

```ts
recording.timeline.startOffsetSeconds;  // 0.25
recording.timeline.startOffsetTicks;    // 2500000n

event.onsetSecondsFromHeaderStart;      // 1.25
event.onsetSecondsFromFirstRecord;      // 1
```

`onsetSecondsFromFirstRecord` is the one that lines up with everything else edfcore reports. `t = 0`
in this library is the start of record 0. `chunk.startSeconds`, `segment.startSeconds`,
`gap.durationSeconds` and the bounds you pass to `readWindow` and `trimToWindow` all live on that
axis. Reach for `onsetSecondsFromHeaderStart` when you're reconciling against a wall clock, a paper
report, or another tool that quotes the on-disk value.

edfcore exposes two named fields rather than one field plus an option. Picking the wrong convention
shifts every event in the recording by that sub-second offset: too small to look wrong, large
enough to move an ERP epoch onto the other side of a stimulus.

> **Note**
> When the decoded range does not start at record 0, record 0's start is not in the bytes you asked
> for. edfcore derives it as `onset(first decoded record) − recordIndex × recordDuration`. That's
> exact for a contiguous file and wrong by the elapsed gaps for an EDF+D one, so the derived value
> is used only when it lands inside `[0, 1)`. Otherwise rebasing is switched off and the two fields
> come back equal. Decode from record 0 whenever you intend to use `onsetSecondsFromFirstRecord`.

## How do I convert an event onset to a sample index?

Both seconds fields are float64 and both are lossy. The exact value is `onsetTicks`, a `bigint`
count of 100 ns ticks:

```ts
event.onsetTicks;  // 12500000n
event.onsetRaw;    // '+1.25' — the digits exactly as the file wrote them
```

Onsets are parsed digit by digit into `bigint`. `parseFloat` and `Number()` appear nowhere on that
path. An onset written `+0.1` and one written `+0.3` are integers by the time you see them.
Equality, ordering and subtraction follow the digits on disk rather than binary floating-point
rounding. Sorting, grouping into epochs, and testing whether two markers coincide should all use
`onsetTicks`:

```ts
const stimulus = annotations.find((a) => a.text === 'stim');
const response = annotations.find((a) => a.text === 'button');

if (stimulus !== undefined && response !== undefined) {
  const latencyTicks = response.onsetTicks - stimulus.onsetTicks;  // exact
  console.log(Number(latencyTicks) / 10_000, 'ms');                // 10^4 ticks per millisecond
}
```

Fractional digits beyond the seventh are below tick resolution and are **truncated, never
rounded**, since a rounded onset names a time that is in no file. For a stimulus marker that's the
difference between a pre- and a post-stimulus sample. The extra digits still have to be digits:
`+1.00000000x` fails the grammar and is reported rather than accepted.

`onsetRaw` keeps the original text, so a round-trip through edfcore never loses precision you had.

## Durations

A TAL carries a duration only when it contains a `0x15` separator. When it does not, all three
duration fields are `undefined`:

```ts
event.durationSeconds;  // 30 | undefined
event.durationTicks;    // 300000000n | undefined
event.durationRaw;      // '30' | undefined
```

`undefined` is not `0`. An instantaneous marker and an event whose writer omitted the duration are
the same thing on disk, and edfcore doesn't distinguish them. A duration is never signed. A `0x15`
followed by something that isn't `1*DIGIT [ "." 1*DIGIT ]` makes the whole TAL malformed, and it's
skipped with a `TAL_MALFORMED` diagnostic rather than half-read.

## Negative onsets

An onset before the file start is legal EDF+ and is how a pre-stimulus event is written:

```ts
event.onsetSecondsFromHeaderStart;  // -0.5
event.onsetTicks;                   // -5000000n
```

edfcore reports `NEGATIVE_ANNOTATION_ONSET` for it, at severity `info`. At that severity the file
is correct and nothing needs fixing. It's emitted once per `readAnnotations` call, not once per
event.

Any arithmetic on onsets has to handle negatives. `bigint` division truncates toward zero, which
isn't the same as flooring. Getting that wrong puts a pre-stimulus event one sample later than it
belongs. The worked example below floors explicitly.

## `description@@channel`

EDF+ scopes an event to a channel by suffixing the description with `@@` and the channel's label.
edfcore splits it for you, at the **last** `@@`, because the channel label is the suffix and a
description is free to contain anything:

```ts
event.text;          // 'spike'
event.channelLabel;  // 'EEG Fpz-Cz'
```

A trailing `@@` with nothing after it isn't a channel label, and the text keeps it verbatim.
`@@Fp1` with nothing before it gives an empty description and the channel, since the run itself is
not empty.

`channelLabel` is the text the file wrote. It isn't resolved to a signal. The writer may have
scoped an event to a channel that isn't in this file. Resolve it yourself when you need the signal,
and be ready for it to fail:

```ts
import { findSignals } from 'edfcore';

const [target] = event.channelLabel === undefined
  ? []
  : findSignals(recording.header, event.channelLabel);
```

`findSignals` returns every match. Real files ship duplicate labels (CHB-MIT has `T8-P8` twice),
and `getSignal` throws `EdfAmbiguousChannelError` for them rather than picking one.

## More than one annotations signal

EDF+ permits several. All of them are read by default, and **only the first one carries
timekeeping**:

```ts
recording.header.annotationSignalIndices;  // [1, 2]
```

The first TAL of signal 2 is an ordinary annotation, and it stays in the list.

Restrict the read with `signalIndices` when you only want one of them:

```ts
const result = await readAnnotations(
  recording,
  { start: 0, count: recording.header.recordCount },
  { signalIndices: [2] },
);
```

Leaving out the file's first annotations signal means no timekeeping TAL is read at all. Every
entry of `result.recordOnsetTicks` then falls back to the nominal grid, and no diagnostic is
emitted for it. Read them all when you need both the events of a secondary signal and true record
onsets.

Passing a data signal index throws a plain `RangeError` rather than an `EdfError`, since parsing
samples as text is a caller's mistake rather than a file's:

```ts
await readAnnotations(recording, records, { signalIndices: [0] });
// RangeError: decodeAnnotations(): signal 0 is not an annotation signal. This file's
// annotation signals are [1]. Next: pass one of those, or omit signalIndices to read them all.
```

## Provenance

Every annotation says where it came from, down to the byte:

| field | meaning |
|---|---|
| `signalIndex` | which annotations signal held it |
| `recordIndex` | which data record it was stored in |
| `byteOffsetInRecord` | offset of the text run within that record |
| `onsetRaw`, `durationRaw` | the digits exactly as written |
| `textEncoding` | `'utf-8'` or `'latin-1-fallback'` |

`recordIndex` is where the event was *stored*, which is not necessarily the record its onset falls
in. Writers usually put an event in the record covering it, but nothing in the format requires
that, so use the onset for time and `recordIndex` only for provenance.

Between `recordIndex` and `byteOffsetInRecord` you can point a hexdump at the exact bytes:
`header.headerByteLength + recordIndex * header.recordByteLength + byteOffsetInRecord`.

## Text encoding

Annotation text is UTF-8 in EDF+. edfcore decodes it with a strict decoder, so invalid UTF-8 is
detected rather than replaced with `U+FFFD`. When a run fails, it falls back to ISO-8859-1 and says
so:

```ts
event.text;          // 'café'
event.textEncoding;  // 'latin-1-fallback'
```

The fallback also raises `ANNOTATION_TEXT_NOT_UTF8`, carrying the offending bytes:

```text
warning [ANNOTATION_TEXT_NOT_UTF8] annotation region of signal 1 ("EDF Annotations") in record 0:
the text run is not valid UTF-8 and was decoded as ISO-8859-1 instead. ...
  at byte offset 810 (4 bytes), annotation region, signal 1, record 0
  raw: "caf\xe9"
  bytes: 63 61 66 e9  |caf.|
  spec: EDF+ specification 2.2 (the 'EDF Annotations' signal)
```

Latin-1 is a guess, and it round-trips every byte to exactly one character. If your writer used a
different code page, `byteOffsetInRecord` and the diagnostic's `rawBytes` give you the bytes to
re-decode yourself.

Text is exposed verbatim: never trimmed, never case-folded, and a leading byte-order mark is kept
as a character rather than stripped.

## From an event onset to a sample index

`Math.round(onset * sampleRateHz)` drifts. `sampleRateHz` is derived, and a file declaring 256
samples in a 3-second record has a rate of 85.333… Hz that no float holds exactly. The error grows
with time, and the rate is `undefined` outright when the record duration is zero, which is legal
EDF.

Do it in integers instead. Every quantity below comes from the header as written:

```ts
import { openEdf, readAnnotations, readRecords, getSignal, toPhysical } from 'edfcore';
import { fileSource } from 'edfcore/node';

const recording = await openEdf(await fileSource('./study.edf'));
const { header, timeline } = recording;
const signal = getSignal(header, 'EEG Fpz-Cz');

const { annotations } = await readAnnotations(recording, {
  start: 0,
  count: header.recordCount,
});

/** `recordDurationTicks` is positive; bigint `/` truncates, so negatives need the correction. */
function floorDiv(a: bigint, b: bigint): bigint {
  const quotient = a / b;
  return a % b === 0n || a > 0n ? quotient : quotient - 1n;
}

function sampleIndexOf(onsetTicks: bigint): bigint {
  // 1. Put the event on edfcore's axis, where t = 0 is the start of record 0.
  const elapsedTicks = onsetTicks - timeline.startOffsetTicks;
  // 2. Sample n sits at n * recordDuration / samplesPerRecord. Invert that, in ticks.
  return floorDiv(elapsedTicks * BigInt(signal.samplesPerRecord), header.recordDurationTicks);
}

for (const event of annotations) {
  if (!event.text.startsWith('Sleep stage')) continue;

  const sampleIndex = sampleIndexOf(event.onsetTicks);
  // 3. A pre-stimulus event lands before the first sample; there is nothing to read.
  if (sampleIndex < 0n || sampleIndex >= BigInt(signal.sampleCount)) continue;

  // 4. Records are the unit of I/O, so split the index into a record and an offset in it.
  const samplesPerRecord = BigInt(signal.samplesPerRecord);
  const recordIndex = Number(sampleIndex / samplesPerRecord);
  const offsetInRecord = Number(sampleIndex % samplesPerRecord);

  const chunk = await readRecords(recording, {
    records: { start: recordIndex, count: 1 },
    signalIndices: [signal.index],
  });
  const microvolts = toPhysical(signal, chunk.signals[0].digital);

  console.log(event.text, sampleIndex, microvolts[offsetInRecord]);
}
// Sleep stage W 256n 0.007629510948348211
// Sleep stage 1 512n 0.007629510948348211
```

Step by step:

**Step 1 rebases the onset.** `onsetTicks` is measured from the header start time; every other
second in edfcore is measured from the start of record 0. Subtracting `timeline.startOffsetTicks`
moves the event onto the same axis as `chunk.startSeconds` and `trimToWindow`'s bounds. Both values
are exact ticks, so nothing is lost. (`onsetSecondsFromFirstRecord` is this same quantity as a
float: use it for display, and the ticks for arithmetic.)

**Step 2 is the whole conversion.** Sample *n* of a signal starts at
`n × recordDuration / samplesPerRecord`, so the sample containing time *t* is
`floor(t × samplesPerRecord / recordDuration)`. Written in ticks, that's one `bigint` multiply and
one floored divide, with no sample rate, no division before the comparison and no float bound. The
floor matters for negative onsets: `bigint` division truncates toward zero, which rounds a
pre-stimulus event *up*, toward the file start, by one sample.

**Step 3 handles events outside the samples.** A negative index means the event precedes the
recording, which is normal for pre-stimulus markers. `signal.sampleCount` is
`samplesPerRecord × recordCount`, so the upper bound catches an event stamped past the end.

**Step 4 turns a sample index into a read.** `sampleIndex` is non-negative by now, so plain `/` and
`%` on the `bigint` are already a floor. `chunk.signals[0].firstSampleIndex` comes back as
`recordIndex × samplesPerRecord`, which is the check that the two agree.

Each signal has its own grid. Run the same function with a 128 Hz channel's `samplesPerRecord` and
you get that channel's index for the same instant. Do not reuse an index computed for another
signal.

> **Warning**
> This formula assumes record *r* starts at `r × recordDuration`, which holds for EDF, BDF and
> EDF+C but not for EDF+D. On a discontinuous file it gives you a position on the *time* axis,
> which is not a position on the sample grid: the samples do not exist during a gap. Use
> `index.locate(seconds)` to find the record first. See
> [discontinuous recordings](/docs/discontinuous).

## Where to go next

- [Discontinuous recordings](/docs/discontinuous): what the timekeeping TALs mean when the
  recording has gaps in it, and how to read across one.
- [Diagnostics](/docs/diagnostics): the TAL and timekeeping codes in full, and what `strict` does
  to them.
- [Reading signals](/docs/reading-signals): chunks, `trimToWindow`, and the sample grid these
  onsets are being mapped onto.
