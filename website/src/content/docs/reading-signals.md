---
title: Reading signals
description: Open a recording, select channels by index or label, and read a time window or a record range as decoded samples.
section: "Guides"
order: 1
lead: An EDF file stores its channels interleaved inside fixed-size data records, so the unit you read is a record range, not a channel. This page covers turning a time window into samples and what a read returns.
---

## The shortest useful program

```ts
import { openEdf, getSignal, readWindow, toPhysical } from 'edfcore';
import { fileSource } from 'edfcore/node';

const recording = await openEdf(await fileSource('./overnight.edf'));
const fp1 = getSignal(recording.header, 'Fp1');

const [chunk] = await readWindow(recording, {
  startSeconds: 30,
  durationSeconds: 10,
  signalIndices: [fp1.index],
});
// One chunk per contiguous run; a window that selects nothing returns none.
if (chunk?.signals[0] === undefined) throw new Error('no data in that window');

const microvolts = toPhysical(fp1, chunk.signals[0].digital);
```

That guard is not ceremony. `readWindow` returns an array and `chunk.signals` is indexed, so under
`noUncheckedIndexedAccess` both reads are `T | undefined` and the last line does not compile
without it — which is the same shape as the array itself being the answer: a window inside an
EDF+D gap really does select nothing.

`openEdf` reads the header and nothing else. It never scans the file, so opening a twelve-hour
recording costs the same as opening a twelve-second one. It returns an `EdfRecording`: a plain
object holding the `source` you passed, the parsed `header`, a `timeline`, and a record `index`.

Nothing on it is a handle you have to release. If your source owns an OS resource, as
`fileSource` does, you close the source yourself with `await recording.source.close?.()`.
`close` is optional on `ByteSource` (the in-memory and blob adapters have nothing to release),
so the call is spelled with `?.`.

In a browser, swap the source and the rest is identical:

```ts
import { blobSource, openEdf } from 'edfcore';

const recording = await openEdf(blobSource(fileFromInput));
```

Every adapter is covered in [data sources](/docs/data-sources); nothing else on this page depends
on which one you chose.

## Data records

An EDF file is a header followed by a run of equal-sized **data records**. Each record covers the
same fixed slice of time (one second is typical, but the header can declare any duration). Inside
a record, every channel's samples for that slice appear one after another. A 30-channel recording
at 256 Hz with one-second records stores 256 samples of channel 0, then 256 of channel 1, and so
on, 15,360 bytes per record.

Two consequences run through the whole API. First, a channel's samples are a stripe repeated
every `recordByteLength` bytes. No byte range holds one channel and nothing else, so asking for
one channel still reads the records that contain it. Second, the smallest amount of a file you
can read is one record. Any window you ask for is served by a **record-aligned** range that's
usually wider than the window itself.

`chunk.byteLength` reports the number of bytes actually read. `trimToWindow` is the separate,
pure step that narrows a record-aligned chunk to the samples you asked for.

## `readWindow` and `readRecords`

`readWindow` takes seconds and works out which records they need. `readRecords` takes the
records directly. Use `readWindow` when your question is about time (a viewport, an epoch around
an event, the first minute). Use `readRecords` when you're walking the file structurally, or when
you've already resolved a record range yourself and want exactly one read for it.

```ts
import { readRecords, readWindow } from 'edfcore';

// By time: one chunk per contiguous run of records the window touches.
const chunks = await readWindow(recording, {
  startSeconds: 3600,
  durationSeconds: 30,
  signalIndices: [0, 1, 2],
});

// By record: exactly one chunk, exactly one read.
const chunk = await readRecords(recording, {
  records: { start: 3600, count: 30 },
  signalIndices: [0, 1, 2],
});
```

Record ranges are always `{ start, count }`, never `{ start, end }`, so there's no
inclusive-versus-exclusive question to get wrong.

`signalIndices` is required and has no "all signals" default, so a 256-channel file is never read
wholesale because an argument was left off.

### `readWindow` always returns an array

Even on a plainly continuous file, `readWindow` returns `readonly EdfChunk[]` with one element.
It never returns a bare chunk.

The shape comes from EDF+D, the discontinuous variant, where the recording pauses and resumes.
The records after a gap carry onsets that jump forward. A window straddling such a gap covers two
separate runs of records with a hole between them, and one chunk can't represent that.

A window inside a gap, a window before the recording starts, a window past its end, and a window
with zero or negative duration all return `[]`. An empty array means "no samples exist there",
never "the read failed". Nothing is ever filled in. There's no gap-fill, and no option to enable
one.

```ts
const chunks = await readWindow(recording, {
  startSeconds: 20,
  durationSeconds: 10,
  signalIndices: [0],
});

if (chunks.length === 0) {
  // The window is inside a gap, or outside the recording entirely.
}
for (const chunk of chunks) {
  // One contiguous run of records each, in time order.
  // chunk.precededByGap is defined when a gap sits immediately before it.
}
```

> **Note**
> On a discontinuous file, `readWindow` maps seconds to records only after the gaps have been
> located. Opening a file never scans it, so `recording.index.coverage` starts as `'probed'`
> (records 0 and *n*−1 only). `readWindow` then throws a `RangeError` explaining that a probed
> index knows where neither the gap nor the records after it start. `EdfRecording` is a plain
> struct, so you build a complete index and rebuild the recording around it:
>
> ```ts
> const index = await buildRecordIndex(recording, { onProgress: (done, total) => {} });
> const chunks = await readWindow({ ...recording, index }, selection);
> ```
>
> [Discontinuous recordings](/docs/discontinuous) covers segments, gaps and the index in full.

## Selecting signals

By index, when you know it:

```ts
const chunk = await readRecords(recording, {
  records: { start: 0, count: 10 },
  signalIndices: recording.header.dataSignalIndices,
});
```

`header.dataSignalIndices` is every signal that carries samples; `header.annotationSignalIndices`
is the rest. Passing an annotation channel to `readWindow` or `readRecords` throws a plain
`RangeError`, because its bytes are TAL text rather than samples. Read those with
`readAnnotations` instead (see [annotations](/docs/annotations)).

By label, when you know the electrode:

```ts
import { findSignals, getSignal } from 'edfcore';

const fp1 = getSignal(recording.header, 'Fp1');
```

Matching is exact on the trimmed label and is **case-sensitive**. `'Fp1'` and `'FP1'` are written
by different acquisition systems, and edfcore has no montage vocabulary for deciding they name
the same electrode. A label that matches nothing throws `EdfChannelNotFoundError`. The error
carries `availableLabels`, so you can show the user what the file actually contains.

### Duplicate labels

A label that matches more than one signal throws `EdfAmbiguousChannelError`:

```
label "T8-P8" matches 2 signals (indices 1, 3), so getSignal cannot choose one — returning
the first is how the wrong channel ends up in a paper. Next: call findSignals() to get them
all, or select by index.
```

The CHB-MIT scalp EEG corpus ships files with `'T8-P8'` declared twice. The obvious one-liner,
`signals.find(s => s.label === label)`, returns the first match with no sign that a second
exists. When nothing in the file says which one the writer meant, returning either is a guess.

`findSignals` returns every match in signal order, and an empty array when there are none.

```ts
const matches = findSignals(recording.header, 'T8-P8');
if (matches.length > 1) {
  // Ask the user, or take them all: matches.map(s => s.index) is [1, 3].
}
```

The error carries the same information as `matchingIndices`, so you can recover without a second
lookup.

## Read several signals at once

Reading three channels in one call is cheaper than three calls for one channel each. On a
three-signal file with 1,538-byte records, a ten-second window measures:

| | reads issued | bytes read |
|---|---|---|
| one call, `signalIndices: [0, 1, 2]` | 1 | 15,380 |
| three calls, one signal each | 3 | 46,140 |

Every call re-reads the same interleaved bytes, because those bytes are where all three channels
live. Over HTTP that's three round trips for data you already had. De-interleaving happens in
memory after the read, so adding a channel to `signalIndices` costs decode time and an output
array, never another request.

Asking for one channel out of thirty does not read 1/30th of the bytes. It reads all of them and
decodes one. `chunk.byteLength` reports the real figure, so the overread is a number in your
result rather than a surprise in a network panel.

## What a chunk contains

```ts
const [chunk] = await readWindow(recording, {
  startSeconds: 30,
  durationSeconds: 10,
  signalIndices: [0],
});
```

On a file with 1,538-byte records and a 1,024-byte header, that chunk is:

| field | value | meaning |
|---|---|---|
| `records` | `{ start: 30, count: 10 }` | the record range actually read |
| `startSeconds` | `30` | true start of the first record, in elapsed recording time |
| `durationSeconds` | `10` | span from the first record's start to the last record's end |
| `byteOffset` | `47164` | where the read began in the file |
| `byteLength` | `15380` | bytes read, for every signal in the range |
| `precededByGap` | `undefined` | an `EdfGap` when one sits immediately before this chunk |
| `diagnostics` | `[]` | defects found in the annotation regions of these records |

`startSeconds` is the record's *true* start. On EDF+D that is not `start * recordDuration`. The
onsets are decoded from the annotation regions already inside the bytes of this read. They cost
no extra I/O, and a gap cannot make the number wrong.

`precededByGap` is `undefined` whenever the index is still `'probed'`. That reports that nobody
has read the onsets in between, not that there is no gap. Build a complete index to get the
question answered.

Each entry of `chunk.signals` is an `EdfChunkSignal`:

| field | meaning |
|---|---|
| `signalIndex` | which signal, indexing `header.signals` |
| `digital` | `Int32Array` of raw stored values, exactly as written |
| `sampleCount` | the real count, never padded to a round number |
| `firstSampleIndex` | index of the first sample on *this signal's own* sample grid |
| `startSeconds` | when this signal's first sample starts |
| `outOfDigitalRangeCount` | samples outside the declared digital range, counted during decode |

`firstSampleIndex` is per-signal because `samplesPerRecord` differs between signals. On the same
ten-record range, a 256 Hz channel starts at sample 7,680 and a 1 Hz channel starts at sample 30.
It's the number you want when writing samples into a longer buffer you're assembling yourself.

`digital` holds the stored counts. Turning counts into microvolts is a separate function with its
own failure mode (see [physical values](/docs/physical-values)).

## Record alignment and `trimToWindow`

Ask for `[30.5, 32.5)` on a file with one-second records and you'll get records 30 through 32.
That is three records, 768 samples at 256 Hz, starting at 30 s. The chunk is wider than the window
because a record is the smallest thing the file can be read by.

`trimToWindow` narrows one signal of a chunk to exactly the samples inside the window:

```ts
import { trimToWindow } from 'edfcore';

const [chunk] = await readWindow(recording, {
  startSeconds: 30.5,
  durationSeconds: 2,
  signalIndices: [0],
});

const exact = trimToWindow(recording.header, chunk.signals[0], 30.5, 2);
exact.sampleCount;      // 512
exact.firstSampleIndex; // 7808
exact.startSeconds;     // 30.5
```

The returned `digital` is a `subarray` view over the chunk's own memory, so trimming allocates
nothing and the two share storage. Do not write into one expecting the other to be unaffected.

### Integer sample indexing

`trimToWindow` compares integers. Sample *j* of the chunk is inside the window when the tick edfcore
publishes for it — `ceil(j * recordDuration / samplesPerRecord)`, the value `gridSampleStartTicks`
and `sampleStartTicksOf` report — falls in `[relativeStart, relativeEnd)`. Since `ceil(x) >= R` iff
`x > R - 1`, both edges are integer `bigint` products of quantities taken from the header as
written. It never computes `round(t * sampleRateHz)`: no division, no sample rate, no
floating-point bound.

Comparing against the sample's exact rational start instead excluded the sample a caller had aligned
the window to, whenever a boundary was not a whole tick — half of all indices at 256 samples per
second (fixed in 0.3.56).

`signal.samplesPerRecord` is the authoritative quantity and is what indexing uses.
`signal.sampleRateHz` is *derived* and is provided for display. It is `undefined` when the record
duration is zero, which is legal EDF.

A derived rate is frequently not representable. A file that declares a 3-second record with 256
samples has a sample rate of 85.333… Hz. No float holds that exactly, and the error grows with
*t*:

```ts
// A file declaring 256 samples per 3 s record.
const signal = getSignal(recording.header, 'Fp1');
signal.sampleRateHz;  // 85.33333333333333 — not the exact rate, because there isn't one

const [chunk] = await readWindow(recording, {
  startSeconds: 100,
  durationSeconds: 1,
  signalIndices: [signal.index],
});

const exact = trimToWindow(recording.header, chunk.signals[0], 100, 1);
exact.firstSampleIndex;                 // 8534 — the first sample at or after 100 s
Math.round(100 * signal.sampleRateHz);  // 8533 — a sample that starts at 99.996 s
```

> **Note**
> On this file the two answers disagree at a third of all integer second boundaries (1,000 of the
> first 3,001), always by exactly one sample. The float answer lands one sample early, so it
> pulls data from before the window. A one-sample shift is invisible on a trace and fatal to an
> average across epochs.

## Files with several sample rates

One EDF file can hold EEG at 256 Hz, ECG at 512 Hz and body temperature at 1 Hz. There is no
single universal rate. Each signal keeps its own `samplesPerRecord`, and every per-signal field
in a chunk is computed from it.

Reading all three over `[10, 14)` on a one-second-record file gives one chunk with three entries:

| signal | `samplesPerRecord` | `sampleCount` | `firstSampleIndex` |
|---|---|---|---|
| `Fp1` | 256 | 1,024 | 2,560 |
| `ECG` | 512 | 2,048 | 5,120 |
| `Temp` | 1 | 4 | 10 |

Trimming each to `[10.5, 12.5)` gives 512, 1,024 and 2 samples respectively. The temperature
channel's trimmed window starts at 11 s rather than 10.5 s. At 1 Hz there's no sample at 10.5,
and the first one inside the window is the one at 11.

## Reusing output arrays

A scrolling viewer re-reads a window many times a second and doesn't want a new `Int32Array`
each time. The decode primitives take an `out` argument and write into it:

```ts
import { decodeDigital, getSignal, readRecordBytes } from 'edfcore';

const signal = getSignal(recording.header, 'Fp1');
const records = { start: 0, count: 10 };
const reuse = new Int32Array(records.count * signal.samplesPerRecord);

const bytes = await readRecordBytes(recording.source, recording.header, records);
const digital = decodeDigital(recording.header, bytes, records, signal.index, reuse);
// digital shares memory with `reuse`; nothing was allocated.
```

An `out` array longer than needed is narrowed with `subarray`. The zero-allocation path survives,
and `digital.length` still equals the true sample count, so spare capacity can't be mistaken for
data. An `out` array that is too short throws a `RangeError` naming both lengths.

`toPhysical` takes an `out` the same way. The convenience layer (`readWindow`, `readRecords`)
allocates per call. Drop to `readRecordBytes` plus `decodeDigital` when you need the allocation
under your control.

## Where to go next

- [Physical values](/docs/physical-values): scaling digital counts into the signal's own units,
  and the cases with no usable scale.
- [Large files](/docs/large-files): what each call costs in reads and bytes, the allocation
  budget, and caching.
- [Discontinuous recordings](/docs/discontinuous): segments, gaps, and building a complete index.
- [Annotations](/docs/annotations): reading the events stored in the annotation channels.
