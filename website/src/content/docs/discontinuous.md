---
title: Discontinuous recordings
description: Detect gaps in an EDF+D file, build a complete record index, and read across a discontinuity.
section: Guides
order: 5
lead: An EDF+D recording has holes in it, and the only place the true start of each record is written down is inside the file. This page covers how edfcore finds those holes, which calls throw until it has, and how to read a window that spans one.
---

## What a discontinuity is

A data record in EDF is a fixed slice of time (one second, thirty seconds, whatever the header
declares). In a continuous recording, record *r* begins at `startOffset + r × recordDuration`.
That's arithmetic: you can compute which record holds any instant without touching the file.

In a discontinuous recording it isn't. The records are still fixed-length, and they are still
stored back to back on disk, but the time between two adjacent records can be anything. The true
start of each record is *stored*, in that record's timekeeping TAL. The only way to know where
record 3 sits on the time axis is to read record 3.

```text
record         0     1     2   │← 10 s gap →│    3     4     5
starts at     0s    1s    2s   │  3s .. 13s │   13s   14s   15s
byte offset  768  1400  2032   │            │  2664  3296  3928
```

This happens constantly in practice. A sleep study where the amplifier was disconnected for a
bathroom break. Long-term epilepsy monitoring where the recorder only saves the minutes around a
detected event and drops the hours between them. A telemetry system that reconnected after a
dropout. None of these are corrupt files. EDF+D exists so a writer can mark a hole rather than
concatenating the two halves.

Reading such a file as if it were contiguous puts record 3 at t = 3 s when it truly starts at
t = 13 s. Nothing throws, the waveform looks fine, and every event you align against it is ten
seconds out.

## Detecting a gap

Two header fields, and one comparison on the timeline:

```ts
import { openEdf } from 'edfcore';
import { fileSource } from 'edfcore/node';

const source = await fileSource('./overnight.edf');
const recording = await openEdf(source);

recording.header.variant;              // 'EDF+D'
recording.header.continuity;           // 'discontinuous'

recording.timeline.spanSeconds;        // 16 — last record's end minus record 0's start
recording.timeline.coveredSeconds;     //  6 — the sum of the record durations

// fileSource opens a descriptor and closing it is yours.
await source.close();
```

`variant` is the reserved field's marker, one of `EDF`, `EDF+C`, `EDF+D`, `BDF`, `BDF+C`, `BDF+D`.
`continuity` collapses that to the distinction that changes how you read. It's `'continuous'` for
plain EDF, BDF, EDF+C and BDF+C, and `'discontinuous'` for the two `+D` variants.

`spanSeconds` and `coveredSeconds` are computed independently, one from the two ends of the
recording and the other from `recordCount × recordDuration`. Their being equal is a real statement
rather than an identity.

**Read the difference with its sign.** `spanSeconds - coveredSeconds` positive is time that sits
inside the recording and that no record covers — ten seconds, in the file above. Negative means
records OVERLAP: the sum of their durations exceeds the distance from the first start to the last
end, because at least one record begins before the one before it ended, and two records claim the
same instant. `coveredSeconds` is the sum of the record durations and nothing subtracts a
double-counted second from it, so on an overlapping file it can exceed the span outright.

That is not a hypothetical case the two probes cannot reach: it is the case `resolveTimeWindow`
already names on its own. Asked for a window against a probed index it partitions the same
comparison by sign, and says `records covering 6 s are packed into a 3.5 s span, so at least one
record starts before the previous one ends` rather than reporting a gap. `edfcore gaps` counts
holes and overlaps apart for the same reason, and `RECORD_ONSET_SPACING_VIOLATION` is what an
overlap earns at open time.

> **Warning**
> `EDF+C` is a claim the writer made, not a fact the format enforces, and files marked continuous
> that contain real gaps exist. Compare `spanSeconds` against `coveredSeconds` on *every* file
> rather than trusting `continuity`. When they disagree on a file marked continuous, edfcore
> reports `DISCONTINUITY_IN_CONTINUOUS_FILE` and the calls below behave exactly as they would on
> an EDF+D file.

## The probed index

`openEdf` never scans. On an EDF+ or BDF+ file it reads the header in two ranges, then probes
exactly two records (the first and the last) for their timekeeping onsets. Four reads, whatever the
file size:

```text
{ offset:    0, length: 256 }   the fixed header
{ offset:  256, length: 512 }   the per-signal header
{ offset:  768, length: 632 }   record 0
{ offset: 3928, length: 632 }   record 5
```

Two probes detect any **net** drift of the timeline, which is what `spanSeconds ≠ coveredSeconds`
above is reporting. They aren't a proof of contiguity: a gap that an overlap elsewhere cancels
exactly leaves both ends where a contiguous file would put them. Only reading every onset can rule
that out.

The index `openEdf` hands back marks what it hasn't checked:

```ts
recording.index.coverage;   // 'probed'
recording.index.segments;   // undefined
recording.index.gaps;       // undefined
recording.index.recordCount;
```

`segments` and `gaps` are `undefined`, not `[]`. An empty array would read as "this recording has
no gaps", and nobody has checked. The fields are declared
`readonly segments: readonly EdfSegment[] | undefined`, so `strictNullChecks` makes you deal with
it.

A file with no annotations signal at all (plain EDF or BDF) is probed **zero** times. Without a
timekeeping TAL there are no per-record onsets on disk, so record *r* starts at
`r × recordDuration` by definition.

### Time windows on a probed index

Ask a probed index to map seconds to records on a file that has a gap, and it throws instead of
guessing:

```ts
await readWindow(recording, { startSeconds: 0, durationSeconds: 20, signalIndices: [0] });
// RangeError: this file cannot be mapped from seconds to records: its 6 records
// span 16 s but cover only 6 s, so it contains at least one gap, and a probed index knows
// where neither the discontinuity nor the records after it start. Exactly: 160000000 against
// 60000000 ticks of 100 ns. Next: await buildRecordIndex(recording) and pass the index it
// returns, or locate the window with index.locate(seconds).
```

That's a plain `RangeError` rather than an `EdfError`, and `isEdfError` returns `false` for it.
Nothing is wrong with the file. The question can't be answered from what has been read.

### `locate`

The throw is specific to mapping a *window* to records without knowing the onsets.
`index.locate(seconds)` answers the same kind of question exactly, and pays for it in reads:

```ts
await recording.index.locate(13.5);
// { recordIndex: 3, recordStartSeconds: 13, offsetInRecordSeconds: 0.5 }

await recording.index.locate(5);
// undefined — that instant is inside the gap
```

It's a binary search over the record onsets, which are monotonic, so it costs `O(log recordCount)`
one-record reads on a probed index. Every onset it reads is memoised, so a second `locate` nearby
usually costs nothing:

```text
locate(13.5)  →  3 reads   (records 0 and 5 were already memoised by openEdf)
locate(13.9)  →  0 reads
```

`undefined` means the instant is in a gap or outside the recording, never that the lookup failed.
Monotonicity is verified at every pair the search actually observes. A violation is fatal
(`TIMELINE_NOT_MONOTONIC`) rather than a plausible record.

## Building the complete index

`buildRecordIndex` reads every record's onset and returns an index that knows the structure:

```ts
import { buildRecordIndex } from 'edfcore';

const index = await buildRecordIndex(recording, {
  onProgress: (done, total) => console.log(`${done}/${total} records`),
});

index.coverage;  // 'complete'
```

This is one of only two functions that read the whole file — `validateRecording` is the other — and it is never called implicitly.
It reads in bounded chunks (at most about 4 MiB in flight, or less if you lower
`maxMaterializeBytes`), so memory stays flat whatever the file size. `onProgress` fires once per
chunk with the number of records finished. Its cost is proportional to the file, which is why it
takes a progress callback.

A file with no annotations signal is not scanned at all: its onsets are arithmetic. `onProgress` is
still called once, with the traversal complete, so your progress bar finishes.

It returns no diagnostics. An `EdfRecordIndex` is a structural answer, and `validateRecording` from
`edfcore/validate` is the call that reports on a traversal. It still throws
`TIMELINE_NOT_MONOTONIC` if record onsets go backwards anywhere in the file.

`EdfRecording` is a plain struct, so you use the result by rebuilding one:

```ts
const located = { ...recording, index };
```

## Segments and gaps

Once `coverage` is `'complete'`, the structure is available:

```ts
index.segments;
// [ { index: 0, records: { start: 0, count: 3 },
//     startSeconds: 0,  startTicks: 0n,         durationSeconds: 3, endSeconds: 3  },
//   { index: 1, records: { start: 3, count: 3 },
//     startSeconds: 13, startTicks: 130000000n, durationSeconds: 3, endSeconds: 16 } ]

index.gaps;
// [ { beforeSegmentIndex: 0, afterSegmentIndex: 1,
//     startSeconds: 3, endSeconds: 13, durationSeconds: 10 } ]
```

A segment is a maximal run of records with no gap inside it. Segments cover every record exactly
once and are in time order. There's one gap between each adjacent pair, so
`gaps.length === segments.length - 1` for any file that has records.

The boundary rule is one comparison: a new segment starts wherever
`onset[r] !== onset[r - 1] + recordDurationTicks`, **in exact ticks**. A float tolerance hides a
one-sample overlap.

Every second here is elapsed recording time, measured from the start of record 0, the same axis
`chunk.startSeconds` and `readWindow`'s bounds use. A gap's `durationSeconds` is
`endSeconds - startSeconds`. A negative one means records overlap in time, which is a spacing
violation the [validation sweep](/docs/diagnostics) reports.

### An overlap is a negative gap

EDF+D lets a file spread its records out. It never lets a record start before the previous one
ends — but files do it anyway, and edfcore reports what is there rather than reordering anything.

There is no separate shape for it. `EdfGap.durationSeconds` simply goes **negative**, and the two
segments it sits between overlap in time:

```ts
index.gaps.map((g) => g.durationSeconds);   // [-1, 1]  — the first pair overlaps by a second
```

`validateRecording` turns that into `RECORD_ONSET_SPACING_VIOLATION`, naming the segments. Two
consequences worth knowing:

- Summing `durationSeconds` to get "time lost to gaps" is only right if you expect a negative term.
- Where two segments cover the same instant there is no single right answer, so `segmentAt` and
  `sampleAt` return one of them. More than one sample genuinely exists at that time.

A probed index cannot see any of this when the gap and the overlap cancel: net drift is then zero,
the file opens with no diagnostic, and `contiguityOf` answers `'unknown'` — which is the honest
answer and exactly why `buildRecordIndex` exists.

## Reading across a gap

In the fragments below, `located` is the recording rebuilt around the complete index and `signal`
is the channel you want. `readWindow` returns **one chunk per contiguous run** the window touches:

```ts
const chunks = await readWindow(located, {
  startSeconds: 2,
  durationSeconds: 12,
  signalIndices: [signal.index],
});

chunks.length;                              // 2
chunks[0].startSeconds;                     // 2
chunks[0].precededByGap;                    // undefined
chunks[1].startSeconds;                     // 13
chunks[1].precededByGap.durationSeconds;    // 10
```

It always returns an array, including on a continuous file, where it always has exactly one
element.

There is no gap-fill and no option to enable one. The samples during a gap do not exist. A window
that falls entirely inside a gap returns an empty array:

```ts
await readWindow(located, { startSeconds: 5, durationSeconds: 3, signalIndices: [signal.index] });
// []
```

`[]` means "no samples exist in that interval", never that the read failed.

`precededByGap` is the `EdfGap` sitting immediately before a chunk's first record. It's `undefined`
whenever the index is still `'probed'`, which means nobody has read the onsets in between.

Runs are read one after another rather than concurrently, so the request pattern you observe is the
one `readWindow` issued, in order. Concurrency over a `ByteSource` belongs to the source
(`httpSource` takes `maxConcurrency`).

### `readRecords` across a gap

`readRecords` takes a record range, so it never throws on a gap: you named the records. Note what
`durationSeconds` then means:

```ts
const chunk = await readRecords(located, {
  records: { start: 2, count: 2 },   // record 2 and record 3, either side of the gap
  signalIndices: [signal.index],
});

chunk.startSeconds;              // 2
chunk.durationSeconds;           // 12  — the SPAN, not the time covered
chunk.signals[0].sampleCount;    // 512 — two records' worth of samples
```

Twelve seconds of span, two seconds of data. The samples in that chunk are not a uniform grid, and
`trimToWindow` assumes one contiguous run. Do not apply it to a chunk that straddles a gap. Use
`readWindow` when you want time-aligned samples, and `readRecords` when you want specific records.

## The whole flow

```ts
import {
  openEdf,
  buildRecordIndex,
  readWindow,
  trimToWindow,
  getSignal,
} from 'edfcore';
import { fileSource } from 'edfcore/node';

const source = await fileSource('./overnight.edf');
const recording = await openEdf(source);
const { header, timeline } = recording;

// 1. Is there anything to worry about? Two fields and one comparison, no extra I/O.
const suspect =
  header.continuity === 'discontinuous' || timeline.spanSeconds !== timeline.coveredSeconds;

// 2. Pay for the structure only when there is structure to find.
const index = suspect
  ? await buildRecordIndex(recording, {
      onProgress: (done, total) => console.log(`${done}/${total} records`),
    })
  : recording.index;

const located = { ...recording, index };

for (const segment of index.segments ?? []) {
  console.log(`segment ${segment.index}: ${segment.startSeconds}..${segment.endSeconds} s`);
}
for (const gap of index.gaps ?? []) {
  console.log(`gap of ${gap.durationSeconds} s at ${gap.startSeconds} s`);
}
// segment 0: 0..3 s
// segment 1: 13..16 s
// gap of 10 s at 3 s

// 3. Read a window that spans the gap. One chunk per contiguous run.
const signal = getSignal(header, 'EEG Fpz-Cz');
const chunks = await readWindow(located, {
  startSeconds: 2,
  durationSeconds: 12,
  signalIndices: [signal.index],
});

for (const chunk of chunks) {
  if (chunk.precededByGap !== undefined) {
    console.log(`${chunk.precededByGap.durationSeconds} s gap before this chunk`);
  }
  const [series] = chunk.signals;
  if (series === undefined) continue;
  // Chunks are record-aligned and usually wider than the window; narrow them exactly.
  const exact = trimToWindow(header, series, 2, 12);
  console.log(`${exact.sampleCount} samples from ${exact.startSeconds} s`);
}
// 256 samples from 2 s
// 10 s gap before this chunk
// 256 samples from 13 s

// 4. A single instant, rather than a window.
await index.locate(5);     // undefined — inside the gap
await index.locate(13.5);  // { recordIndex: 3, recordStartSeconds: 13, offsetInRecordSeconds: 0.5 }

// fileSource opens a descriptor and closing it is yours.
await source.close();
```

Step 2 is the shape worth copying. Building a complete index over a continuous file is a full
traversal that tells you what you already knew. Gate it on the two-probe verdict that `openEdf`
gave you for free, and keep the probed index otherwise. `readWindow` works against a probed index
on a file whose span and coverage agree.

## Where to go next

- [Annotations](/docs/annotations): the timekeeping TALs that every onset on this page came from,
  and how to place an event on a signal's sample grid.
- [Large files](/docs/large-files): the read pattern of every call, and how to measure it on your
  own file.
- [Diagnostics](/docs/diagnostics): `DISCONTINUITY_IN_CONTINUOUS_FILE`,
  `RECORD_ONSET_SPACING_VIOLATION`, `TIMELINE_NOT_MONOTONIC`, and the conformance sweep that finds
  them all in one traversal.
