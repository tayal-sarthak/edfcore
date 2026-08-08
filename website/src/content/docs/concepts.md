---
title: Concepts
description: The record grid that EDF is built on, and the six consequences that shape every part of the edfcore API.
section: "Start here"
order: 3
lead: EDF is a header followed by a rectangular grid of data records. This page defines that grid and states the six consequences the rest of the API follows from.
---

## A file is a header and a grid of records

An EDF file has two parts. First a **header record**, which is `256 * (numberOfSignals + 1)` bytes: one 256-byte block describing the recording, then one 256-byte block's worth of fields per signal. Then the **data records**, which are all exactly the same size, laid out back to back with nothing between them.

A data record holds a slice of **every** signal in the file, stored one after another in signal order. Every record holds the same amount of each signal. A signal that declares 256 samples per record contributes 256 samples to record 0, 256 to record 1, and 256 to every record after that.

Here is a real two-signal file: an EEG channel at 256 samples per record and a respiration channel at 16. The record duration is one second and there are 30 records. EDF samples are 16-bit, so the EEG block is 512 bytes and the respiration block is 32.

```text
byte 0                                                              767
├──────────── header record: 256 x (2 signals + 1) = 768 bytes ───────┤

data record 0                                      bytes 768 .. 1311
┌──────────────────────────────────────┬───────────┐
│ EEG Fpz-Cz   256 samples x 2 = 512 B │ Resp 32 B │  recordByteLength
└──────────────────────────────────────┴───────────┘        = 544
  recordByteOffset 0                     offset 512

data record 1                                     bytes 1312 .. 1855
┌──────────────────────────────────────┬───────────┐
│ EEG Fpz-Cz   the second second       │ Resp      │
└──────────────────────────────────────┴───────────┘

                       ... records 2..28 ...

data record 29                                   bytes 16544 .. 17087
┌──────────────────────────────────────┬───────────┐
│ EEG Fpz-Cz   the thirtieth second    │ Resp      │
└──────────────────────────────────────┴───────────┘
```

Total file: `768 + 30 * 544 = 17088` bytes. edfcore reports all four of those numbers on the header (`headerByteLength`, `recordByteLength`, `recordCount`, `dataByteLength`). Every signal reports its own `recordByteOffset` and `recordByteLength`, the horizontal position and width of its block inside a record.

The address of any signal's bytes in any record is one expression, and it's the whole of the arithmetic the data section needs:

```text
header.headerByteLength + recordIndex * header.recordByteLength + signal.recordByteOffset
```

> **Note**
> The per-signal header is *field-major*: all the labels, then all the transducer types, then all the physical dimensions, and so on. Reading it as one 256-byte struct per signal produces plausible output for a one-signal file. edfcore parses it correctly, and you never see the layout unless you're writing a parser yourself.

## The unit of I/O is the record range

Because a record interleaves every channel, there's no such thing as a cheap single-channel read. To get the respiration samples for seconds 0 through 9, the bytes you need are spread across ten records in 32-byte pieces separated by 512-byte gaps. Any reader must either issue ten tiny reads or read the ten whole records. edfcore reads the ten whole records: one contiguous range, de-interleaved in memory afterwards.

The arithmetic for this file:

```text
records 0..9, respiration channel only
  bytes read      = 10 * 544  = 5440
  bytes wanted    = 10 *  32  =  320
  overread ratio  = recordByteLength / signal.recordByteLength = 544 / 32 = 17
```

That's seventeen times more bytes than the samples occupy, and no arrangement of requests avoids it. The ratio for a channel is always `header.recordByteLength / signal.recordByteLength`, so the wider a channel is relative to the record, the closer to 1 it gets. Asking for the EEG channel out of the same file reads `544 / 512`, about 1.06.

Every chunk carries `byteOffset` and `byteLength`, and `byteLength` is what actually left the source:

```ts
const chunk = await readRecords(recording, {
  records: { start: 0, count: 10 },
  signalIndices: [resp.index],
});

chunk.byteOffset;                    // 768
chunk.byteLength;                    // 5440
chunk.signals[0]!.sampleCount;       // 160
```

Two consequences follow. **Name every channel you want in one call**, because the second channel from the same records is free. **Prefer wider windows to more requests**, because the cost is dominated by records touched rather than samples returned.

`readRecords` and `readAnnotations` require an explicit `RecordRange`, and `signalIndices` has no "all signals" default. A 256-channel file is never read whole because an argument was left out.

## `samplesPerRecord` and `sampleRateHz`

The EDF header does not store a sample rate. It stores, per signal, the number of samples in each data record, and separately the duration of a data record in seconds. A rate is the quotient of those two. edfcore computes it for you as `signal.sampleRateHz`, a derived convenience that nothing inside the library indexes by.

```ts
signal.samplesPerRecord;  // 256 — from the file, an integer, exact
signal.sampleRateHz;      // 256 — samplesPerRecord / recordDurationSeconds
signal.sampleCount;       // samplesPerRecord * header.recordCount
```

Two things follow.

**Different signals have different rates.** One file can hold EEG at 256 Hz, ECG at 512 Hz and a temperature probe at 1 Hz. There is no universal sample rate for an EDF file. Each `EdfChunkSignal` therefore carries its own `firstSampleIndex`, on that signal's own grid: `records.start * signal.samplesPerRecord`.

**`sampleRateHz` is `undefined` when `recordDurationSeconds` is zero**, which is legal. A zero record duration means the records do not advance in time, so the quotient is a division by zero. edfcore records a `ZERO_RECORD_DURATION` warning, leaves `sampleRateHz` undefined for every signal, and keeps reading. The type is `number | undefined`, so `strictNullChecks` makes you handle it.

edfcore does not index by rate, because the quotient is frequently not representable. A record duration of 3 seconds with 256 samples per record is a real configuration; 256/3 is 85.333… Hz, and `Math.round(t * 85.333)` walks off by a sample somewhere in the second hour of a recording. Every time-to-sample conversion in edfcore (`resolveTimeWindow`, `trimToWindow`, the record index) is integer arithmetic on exact tick counts, record indices and `samplesPerRecord`, with no float rate in the path.

## `toPhysical`

What is stored in a data record is an integer: 16-bit two's complement little-endian for EDF, 24-bit sign-extended from bit 23 for BDF. What you usually want is microvolts. The conversion is linear, and the header supplies it as two pairs of numbers (a digital range and a physical range).

edfcore gives you both as separate calls, and the type changes accordingly:

```ts
const digital = chunk.signals[0]!.digital;        // Int32Array — what is on disk
const physical = toPhysical(signal, digital);     // Float64Array — µV, V, °C, ...
```

There is no `{ physical: true }` flag; the two calls have different return types. **Scaling is not always available.** `signal.scale` is `EdfScale | undefined`, and it's `undefined` when the header does not define a usable conversion. That covers a degenerate digital range (`digitalMinimum === digitalMaximum`, which is a division by zero), a degenerate physical range, and an inverted digital range. It also covers a channel whose physical dimension is `Filtered`: those values are log-compressed, and the linear formula is wrong for them by orders of magnitude.

The reference C implementation substitutes a gain of 1 here and returns ADC counts labelled as microvolts. In edfcore:

```ts
signal.scale;                       // undefined
toPhysical(signal, digital);        // throws EdfScalingError, code 'DEGENERATE_DIGITAL_RANGE'
decodeDigital(header, bytes, records, signal.index);   // still works
```

The digital samples are real data and they keep working. It's the *interpretation* that is unavailable. `scale` is optional in the type system, so the compiler can point at a `toPhysical` call you haven't guarded.

The conversion itself is `physical = bitValue * (offset + digital)`, in float64 throughout. That expression is numerically worse than the obvious rearrangement, and it's EDFlib's exact form. Keeping it means edfcore's float64 output *can* be compared bit for bit against pyEDFlib and EDFlib. That's a design target rather than a measured result: the cross-implementation harness does not exist yet in 0.1. See [physical values](/docs/physical-values) for what is and is not established.

Physical values are `Float64Array`. Float32 carries 24 significand bits, so a 24-bit BDF sample scaled into it loses about a quarter of a quantisation step. That's a quarter of the smallest difference the hardware can express, and it stays in the data permanently.

## The annotations signal

EDF+ stores events in a *channel*. An annotations signal is an ordinary signal as far as the header layout is concerned (a label, a `samplesPerRecord`, a block of bytes in every record). The bytes in its block are UTF-8 text in a small grammar called a TAL, a Time-stamped Annotations List:

```text
Onset [ 0x15 Duration ] 0x14 *( Text 0x14 ) 0x00
```

The label is `EDF Annotations`, or `BDF Annotations` in a BDF+ file, and edfcore accepts either in either family because the label identifies the channel's *role*. Such a signal reports `kind: 'annotations'`, appears in `header.annotationSignalIndices` rather than `header.dataSignalIndices`, and gets no `scale`.

Two things follow.

**Decoding an annotations channel as samples produces numbers that look exactly like a signal.** Text bytes are perfectly valid little-endian integers. There is no wobble in the waveform to tell you something went wrong, and you get a plausible-looking trace made of ASCII. edfcore throws:

```ts
await readRecords(recording, { records, signalIndices: [annotationsIndex] });
// RangeError: signal 1 ("EDF Annotations") is this file's annotations channel: its bytes
// are TAL text, not samples, so decoding them as samples would produce numbers that look
// like a signal. Next: call readAnnotations(recording, records) for it, and pass only
// header.dataSignalIndices here.
```

That one is a plain `RangeError`, because it can only ever be a caller's mistake and never a file's.

**The first TAL of each record is timekeeping.** EDF+ specification 2.2.1 reserves the first TAL of the first annotations signal in every data record for it: that TAL carries the record's own start time relative to the header start, and no text. It's the mechanism the next section runs on. edfcore strips it from `annotations` and surfaces it as `recordOnsetTicks`. A file with several annotations signals gets timekeeping only in the first one, so edfcore strips the first TAL of that signal alone and leaves the others intact.

## EDF+C and EDF+D

Bytes 192 through 235 of the header are a reserved field, and its first five bytes carry the dialect marker. `EDF+C` means the recording is uninterrupted. `EDF+D` means the recording stopped and restarted, and there are gaps in it.

In a continuous file, record `r` starts at `startOffset + r * recordDuration`, so you can compute the record containing any instant without reading anything. In a discontinuous file that formula does not hold. Record onsets are *stored*, in the timekeeping TALs, and the only way to know where record 3 sits on the time axis is to read record 3.

Concretely, take a 6-record EDF+D file with one-second records and a ten-second gap after record 2:

```text
record         0     1     2   │← 10 s gap →│    3     4     5
starts at     0s    1s    2s   │  3s .. 13s │   13s   14s   15s

timeline.spanSeconds    = 16   last record end minus first record start
timeline.coveredSeconds =  6   sum of the record durations
```

Read that file as if it were contiguous and record 3 is reported at t = 3 s when it truly starts at t = 13 s. Nothing throws, nothing looks wrong, and every event you align against it is ten seconds out.

`openEdf` never scans the file. It probes at most two records, the first and the last. A file with no annotations signal gets no probes at all, because its onsets are arithmetic and there's nothing stored to read. Two probes are enough to detect any net drift of the timeline, and `openEdf` leaves the index in a state that admits what it doesn't know:

```ts
const recording = await openEdf(source);

recording.index.coverage;   // 'probed'
recording.index.segments;   // undefined — nobody has read the onsets in between
recording.index.gaps;       // undefined
recording.timeline.spanSeconds;      // 16
recording.timeline.coveredSeconds;   //  6   — they differ, so there is a gap
```

`segments` and `gaps` are `undefined` on a probed index. No property there reads as "this recording is continuous" when nothing has checked. Asking for a time window against that index throws:

```ts
await readWindow(recording, { startSeconds: 0, durationSeconds: 20, signalIndices: [0] });
// RangeError: resolveTimeWindow() cannot map seconds to records on this file: its 6 records
// span 16 s but cover only 6 s, so it contains at least one gap, and a probed index knows
// where neither the gap nor the records after it start. Next: await buildRecordIndex(recording)
// and pass the index it returns, or locate the window with index.locate(seconds).
```

`buildRecordIndex` reads every record's onset and returns an index that knows the structure. It's a full traversal of the file, so it's never called implicitly. It takes `onProgress`, because it's the one operation in edfcore whose cost is proportional to the file size. `EdfRecording` is a plain struct, so you use the result by rebuilding one:

```ts
const index = await buildRecordIndex(recording);

index.coverage;   // 'complete'
index.segments;   // [ { records: { start: 0, count: 3 }, startSeconds: 0,  ... },
                  //   { records: { start: 3, count: 3 }, startSeconds: 13, ... } ]
index.gaps;       // [ { startSeconds: 3, endSeconds: 13, durationSeconds: 10, ... } ]

const chunks = await readWindow(
  { ...recording, index },
  { startSeconds: 0, durationSeconds: 20, signalIndices: [0] },
);
// chunks.length === 2
// chunks[0].startSeconds === 0,  chunks[0].precededByGap === undefined
// chunks[1].startSeconds === 13, chunks[1].precededByGap.durationSeconds === 10
```

`readWindow` always returns an array, including for a continuous file, where the array always has exactly one element. One shape covers both cases, so the same consumer code handles a continuous file and a gapped one. There is no gap filling and no option to enable it. A window that falls entirely inside a gap returns `[]`.

For a single instant rather than a window, `index.locate(seconds)` answers with the record containing it, or `undefined` when that time is in a gap. On a probed index it costs `O(log recordCount)` targeted reads and memoises what it learns.

> **Warning**
> An `EDF+C` marker is a claim the writer made, not a fact the format enforces. Files marked continuous that contain real gaps exist. edfcore reports one as `DISCONTINUITY_IN_CONTINUOUS_FILE` when it sees it. Two probes see any *net* drift, but not a gap that an overlap elsewhere cancels exactly. Only `buildRecordIndex` or `validateRecording`, which read every onset, can rule that out.

## Diagnostics

One rule decides what happens when a file is wrong:

**If edfcore cannot proceed without inventing something, it throws. Otherwise it records a diagnostic on the result.** There is no third category, and there is no `console` call anywhere in the package.

A diagnostic is a plain object sitting on whatever produced it. There are no callbacks to register and no logger to configure. You read the array, or you don't:

```ts
recording.header.diagnostics;    // header parsing
recording.timeline.diagnostics;  // the onset probes
chunk.diagnostics;               // the annotation regions inside the records you read
inspection.diagnostics;          // inspectEdf()
report.diagnostics;              // validateRecording(), from edfcore/validate
```

Each one names the field, the byte offset and length, and the raw bytes as written. It also names what was expected, what was found, the spec clause it violates, and what to do about it:

```ts
for (const diagnostic of recording.header.diagnostics) {
  console.log(diagnostic.severity, diagnostic.code, diagnostic.byteOffset);
  console.log(diagnostic.message);
}
// info DATE_CLIPPED_TO_1985_2084 168
// startdate field (8 bytes at offset 168) is "01.01.20": its two-digit year was resolved to
// 2020 by the EDF+ rule that 85..99 mean 1985..1999 and 00..84 mean 2000..2084, so the field
// cannot express a year outside that span. EDF+ additional specification 2 (1985 is the
// clipping date). Next: for an unambiguous year read startTime.recordingIdDate, which the
// EDF+ recording identification spells out in four digits.
```

`severity` is `'error'`, `'warning'` or `'info'`. An error means something is genuinely unavailable: a signal with no usable `scale`, for instance, which leaves the header perfectly readable but physical units undefined for that channel. A warning means the file departs from the spec and what you got back still holds. Info means the file is correct and the note exists because the situation surprises people. A physical minimum above the physical maximum is a negative amplifier gain, it's sanctioned by the EDF FAQ, and edfcore leaves it alone. Swapping the two flips polarity.

The diagnostic code is an open union. Known codes autocomplete; a `default` branch in your `switch` stays mandatory, so a code added in a later minor release cannot break your exhaustive handling.

To stop at the first problem, pass `strict`:

```ts
// A file whose local patient identification is free text rather than the four EDF+ subfields.
await openEdf(source, { strict: true });
// EdfFormatError: [PATIENT_ID_NONCONFORMANT] local patient identification (80 bytes at offset 8)
// is "Haagse Harry", which is not the EDF+ ...
```

`info` codes are exempt from `strict`, so the diagnostic above is deliberately not the one printed
earlier: `DATE_CLIPPED_TO_1985_2084` is `info`, nearly every EDF file carries it, and making
`strict` throw on it would mean rejecting conforming files. Every `info` note is still collected
and readable.

The error carries `code`, `field`, `byteOffset`, and the whole `diagnostic` object it would otherwise have collected. Discriminate on `error.edfErrorKind` (`'format'`, `'scaling'`, `'range'`, `'source'`, `'budget'` or `'channel'`) rather than `instanceof`, which returns false across a realm boundary such as a worker or an iframe. `isEdfError(value)` is the one-call version of that check.

`strict` does not change the always-fatal codes. A file with no recognisable version block, a signal count outside 1..9999, a comma used as a decimal separator, or record onsets that go backwards throws either way.

## Where to go next

Reading a window, walking records, building an index, and running the conformance sweep are all applications of this model. The guides cover each one. The reference has the exact shape of every type mentioned on this page.
