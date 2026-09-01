---
title: Large files
description: What every call costs in reads and bytes, and how the allocation budget and the optional cache behave on multi-hour recordings.
section: "Guides"
order: 3
lead: A sleep study is hours long and hundreds of megabytes. Reading ten seconds out of it costs ten seconds' worth of bytes, and this page shows how to measure that for yourself.
---

## The cost of opening a file

`openEdf` parses the header and, on EDF+ and BDF+, probes two records for their timekeeping
onsets. That is the entire cost, whatever the file size.

| file | reads at open | bytes at open |
|---|---|---|
| plain EDF or BDF | 2 | `256 * (signalCount + 1)` |
| EDF+ or BDF+ | 4 | header, plus two whole records |
| EDF+ or BDF+ with one record | 3 | header, plus that record |
| a file with zero records | 2 | header only |

The header is two reads and never more: 256 bytes to learn the signal count, then the remaining
`256 * signalCount` as a single range. It is never one read per signal block, a pattern that costs
64 requests over HTTP on a 64-signal file. The size read is always the computed `256 * (ns + 1)`,
not the byte-length field the header declares, which files get wrong.

The two extra reads on EDF+ are records 0 and *n*−1. They detect any net drift of the timeline for
two reads instead of a traversal. They are not a proof of contiguity:
`recording.index.coverage` stays `'probed'`, and `index.segments` and `index.gaps` stay
`undefined` until something checks.

A plain EDF or BDF is probed zero times. Without an annotation signal there are no per-record
onsets stored on disk at all, so record *r* starts at `r * recordDuration` by definition.

Measured on a 29,925,760-byte EDF+C (8 channels at 256 Hz, 7,200 one-second records, 4,156-byte
records):

```
open reads: { offset: 0, length: 256 }
            { offset: 256, length: 2304 }
            { offset: 2560, length: 4156 }        <- record 0
            { offset: 29921604, length: 4156 }    <- record 7199
total: 10,872 bytes = 0.036 % of the file
```

## How do I read part of a large EDF file without loading all of it?

After the header, every read edfcore issues is one contiguous range covering **all** signals over
a range of records. `readWindow` resolves the window to record ranges and issues one read per
contiguous run. `readRecords` issues exactly one. A zero-record range issues none at all, since a
zero-length HTTP range is not expressible.

### Measure it yourself

A [`ByteSource`](/docs/data-sources) is two required members and an optional `close`, so a spy
that records every read is a few lines you can paste into your own project:

```ts
import type { ByteSource } from 'edfcore';

function spy(inner: ByteSource) {
  const reads: Array<{ offset: number; length: number }> = [];
  const source: ByteSource = {
    byteLength: inner.byteLength,
    read(offset, length, options) {
      reads.push({ offset, length });
      return inner.read(offset, length, options);
    },
  };
  return { reads, source };
}
```

Wrap your real source in it and read a window:

```ts
import { openEdf, readWindow } from 'edfcore';
import { fileSource } from 'edfcore/node';

const { reads, source } = spy(await fileSource('./overnight.edf'));
const recording = await openEdf(source);

reads.length = 0;  // discard the header reads

await readWindow(recording, {
  startSeconds: 4 * 3600,
  durationSeconds: 10,
  signalIndices: recording.header.dataSignalIndices,
});

console.log(reads, reads.reduce((total, r) => total + r.length, 0));

// fileSource opens a descriptor and closing it is yours.
await source.close();
```

On an eight-hour, 30-channel, 256 Hz EDF (28,800 one-second records, 15,360 bytes each,
442,375,936 bytes in total) that program prints:

```
[ { offset: 221191936, length: 153600 } ]  153600
```

One read. 153,600 bytes out of 442,375,936, which is 0.035 % of the file. The highest byte the
read touches is 221,345,535, and the file's last byte is 442,375,935. The far end of the recording
is never addressed at all. Opening the file first cost 7,936 bytes, or 0.0018 %.

The window's position does not change the price: ten seconds at the end costs the same one read
as ten seconds at the start.

### One channel costs the same as thirty

Ask for `signalIndices: [0]` over that same window and the read is byte-for-byte identical:

```
[ { offset: 221191936, length: 153600 } ]
```

EDF interleaves every channel inside each record, so one channel's samples are a stripe repeated
every 15,360 bytes. No byte range holds them and nothing else. The alternative is one small read
per record to collect the stripes: for this window that is ten requests of 512 bytes instead of
one of 153,600, and for a one-minute window it is sixty. That's fewer bytes and far more round
trips. edfcore takes the single contiguous read and reports how big it was.

Both numbers are on the chunk:

```ts
const [chunk] = await readWindow(recording, { /* … */ signalIndices: [0] });

chunk.signals[0].sampleCount;  // 2,560 samples
chunk.byteLength;              // 153,600 bytes actually read
// 2,560 samples x 2 bytes = 5,120 bytes of interest. Overread factor: 30.
```

`chunk.byteLength` is the bytes that came off the source. When you want more than one channel,
name them all in one call. The bytes are already being read.

## The allocation budget

`maxMaterializeBytes` caps any single allocation edfcore makes on your behalf. The default is
256 MiB (268,435,456 bytes). Exceeding it throws `EdfBudgetError` **before** anything is
allocated, not part-way through:

```ts
import { isEdfError, readRecords } from 'edfcore';

try {
  await readRecords(recording, {
    records: { start: 0, count: recording.header.recordCount },
    signalIndices: [0],
  });
} catch (error) {
  if (isEdfError(error) && error.edfErrorKind === 'budget') {
    error.requiredBytes;  // 442,368,000
    error.budgetBytes;    // 268,435,456
    error.optionName;     // 'maxMaterializeBytes'
  }
}
```

The message names both numbers and what to do:

```
Reading records { start: 0, count: 28800 } needs a 442368000-byte buffer, above the
268435456-byte maxMaterializeBytes budget, so the read was refused before anything was
allocated. Next: read fewer records per call, or raise options.maxMaterializeBytes.
```

A record range is the one allocation whose size *you* control directly, and decoded output is much
larger than the file. For EDF, two bytes on disk become four in the `Int32Array` of digital samples
and eight in the `Float64Array` of physical values: a **4x expansion** to physical. Converting that
eight-hour file whole needs 1.6 GiB of `Float64Array` for 422 MiB of disk. For BDF the ratio is
8/3, since samples are three bytes on disk.

Three allocation points sit on the read path, and each is checked independently against the same
budget:

| call | allocates | bytes per sample |
|---|---|---|
| `readRecordBytes` | the raw record buffer | 2 (EDF) or 3 (BDF) |
| `decodeDigital` | `Int32Array` of digital values | 4 |
| `toPhysical` | `Float64Array` of physical values | 8 |

Two more refuse against the same budget off that path, and neither is proportional to the samples
you asked for: `readEnvelope`'s bucket accumulator and `validateRecording`'s sample-scan scratch.
The record-index scan reads the budget too, but as a cap on its block size rather than as a
refusal — a full traversal never throws for being large, it just reads in smaller pieces.

Passing an `out` array to `decodeDigital` or `toPhysical` skips the allocation, and with it the
budget check for that stage. That's how to run a viewer that reads continuously. `readRecordBytes`
has no `out`, so its buffer is always checked.

Raise the budget when you want a large read. Lower it in a browser tab to get a typed error
instead of a crash:

```ts
await readRecords(recording, selection, { maxMaterializeBytes: 16 * 1024 * 1024 });
```

`buildRecordIndex` is one of two calls in edfcore that traverse the whole file — `validateRecording` is the other — and it treats the
budget as a chunk size rather than a ceiling. It reads `floor(budget / recordByteLength)` records
at a time, capped at a 4 MiB working set whatever the budget says, so memory stays flat however
large the file is. It reports progress through `onProgress(done, total)`.

## `cachedSource`

`cachedSource` wraps any `ByteSource` in a block-aligned LRU. It's the only cache of file bytes in
edfcore and it's opt-in. Remove it by deleting one wrapper from the expression that built the
source.

```ts
import { cachedSource, httpSource, openEdf } from 'edfcore';

const remote = await httpSource(url);   // httpSource is async: it probes the resource length
const recording = await openEdf(
  cachedSource(remote, { blockBytes: 1024 * 1024, maxBytes: 64 * 1024 * 1024 }),
);
```

Blocks default to 1 MiB and the LRU budget to 64 MiB. Blocks are **byte**-aligned, not
record-aligned: the cache never sees a header, so there is no record size for it to align to.
Round `blockBytes` to a multiple of `header.recordByteLength` yourself if you want block
boundaries to fall on record boundaries.

### Scrolling with the cache in place

Scrolling through 300 seconds of that 8-channel EDF+C in thirty consecutive ten-second windows,
two channels at a time:

| | reads issued | bytes from the source |
|---|---|---|
| bare source | 30 | 1,246,800 |
| `cachedSource`, 1 MiB blocks | 1 | 1,048,576 |

Thirty requests become one, and the samples are identical. Comparing every decoded value from both
runs gives an exact match. **Removing `cachedSource` changes the number of reads and nothing
else.** If a bug appears while the cache is in place, delete the wrapper. If the bug survives, the
cache wasn't involved.

The single read is the second 1 MiB block. The first was already resident because the header read
at open pulled it in, so the reads that come with opening a file are not wasted.

A cached read returns a **copy**, never a view into a retained block. A caller who writes into the
array it was handed can't corrupt what the next reader sees. Concurrent reads that want the same
block issue one underlying read between them.

Reads larger than the whole LRU budget bypass the cache entirely rather than evicting every block
on their way through.

> **Note**
> `cachedSource` caches bytes. The record index separately memoises record onsets it has already
> decoded. `index.locate()` therefore costs O(log recordCount) reads the first time, and close to
> none for a nearby second call. Those are the only two forms of memory in the library.

## Advice for a scrolling viewer

**Read record ranges, not seconds, once you are scrolling.** Resolve the viewport to records once
with `resolveTimeWindow`, which is pure and does no I/O, then step through them with
`readRecords`. You get exactly one read per frame and you can see the cost before paying it.

```ts
import { resolveTimeWindow } from 'edfcore';

const ranges = resolveTimeWindow(recording.timeline, recording.index, startSeconds, 30);
// ranges is the exact record cost of that window, before a byte is read.
```

**Prefer one wide read to several narrow ones.** Thirty ten-second windows cost thirty reads; one
300-second window covering the same records costs one, for the same 1,246,800 bytes. If your
viewport is 10 seconds and the user is scrolling, read a minute and serve the next five frames
from it.

**Name every channel you need in one call.** The bytes for all of them are in the range you are
already reading.

**Reuse output arrays.** `decodeDigital` and `toPhysical` both take an `out` argument and write
into it, so a viewer redrawing at 60 Hz can allocate once at startup. An oversized `out` is
narrowed with `subarray`, which shares memory, so `result.length` is still the true sample count.

**Wrap the source in `cachedSource` when it's remote.** Over HTTP, `httpSource` also takes
`maxConcurrency`. Concurrency belongs to the source. `readWindow` issues its runs one after
another, so the read pattern you observe is the one it asked for.

**Build a complete index only when you need gaps located.** On a continuous file the probed index
`openEdf` gives you already answers every window. On EDF+D it is the price of asking where the
gaps are, and it's the only price in the library proportional to the file.

## Where to go next

- [Reading signals](/docs/reading-signals): record ranges, chunk anatomy, and `trimToWindow`.
- [Physical values](/docs/physical-values): the 4x expansion the budget exists to guard, and when
  conversion throws.
- [Data sources](/docs/data-sources): the adapters, the `ByteSource` contract, and writing your
  own.
- [Discontinuous recordings](/docs/discontinuous): what `buildRecordIndex` buys and when you need
  it.
