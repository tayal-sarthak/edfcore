---
title: The EDF format
description: "The EDF format from the bytes up: the 256-byte header, data records, TAL annotations, and where EDF+, BDF and BDF+ differ."
section: Background
order: 1
lead: A byte-level primer on the format itself, independent of any library. If a colleague asks what EDF is, this is the page to send them.
---

## Three formats, one lineage

EDF (the European Data Format) was published in 1992 by Bob Kemp and colleagues as a small container for digitised polygraphic recordings: an all-ASCII header, then fixed-size records of 16-bit integers, and nothing else. EDF+ followed in 2003 and added events, discontinuous recordings and structured patient identification, without changing a single byte of the original layout. BDF is BioSemi's 24-bit variant of the same design, produced by their ActiveTwo hardware. BDF+ is those same EDF+ additions carried over to it.

The compatibility is the point. An EDF+ file opens in a reader that predates EDF+ by a decade and yields correct samples, because everything EDF+ added went into fields the original format left free. That's also why identifying which dialect you're holding takes more care than it looks like it should.

## A file is a header record and a grid of data records

Every file has exactly two parts. The **header record** is `256 * (ns + 1)` bytes, where `ns` is the number of signals: one 256-byte block describing the recording, then one 256-byte block's worth of fields per signal. Immediately after it come the **data records**, all the same size, back to back, with no padding, no index and no trailer.

A data record is not a channel. It's a slice of time containing a fixed number of samples from *every* signal, one signal's block after another in signal order. That single fact is where most of the format's ergonomics come from, and [Concepts](/docs/concepts) works through what it means for reading. This page is about the bytes.

Every field in the header is text. Numbers are written as ASCII digits, left-justified in their field and padded on the right with spaces: `"256     "` rather than a 16-bit integer. The spec restricts header characters to printable ASCII 32 through 126. Real equipment writes Latin-1 names and a raw `0xB5` byte for the micro sign often enough that a reader has to decide what to do about it.

## The fixed header (256 bytes at offset 0)

| Offset | Bytes | Field | What it holds |
|---|---|---|---|
| 0 | 8 | version | EDF: `"0"` and seven spaces. BDF: byte 0 is `0xFF`, bytes 1–7 are `"BIOSEMI"`. |
| 8 | 80 | local patient identification | Free text in EDF; four space-separated subfields in EDF+. |
| 88 | 80 | local recording identification | Free text in EDF; in EDF+, starts with `Startdate dd-MMM-yyyy`. |
| 168 | 8 | startdate | `dd.mm.yy`, with a fixed two-digit year rule. |
| 176 | 8 | starttime | `hh.mm.ss`, local time at the patient, whole seconds only. |
| 184 | 8 | number of bytes in the header record | Should equal `256 * (ns + 1)`. |
| 192 | 44 | reserved | Carries the EDF+ dialect marker in its first five bytes. |
| 236 | 8 | number of data records | May be `-1`. |
| 244 | 8 | duration of a data record, in seconds | May be fractional, and may be `0`. |
| 252 | 4 | number of signals (ns) | 1 to 9999 — the field is four characters wide. |

Two of those fields deserve attention before anything else reads the file.

The **version block is the only reliable way to tell EDF from BDF**, and therefore the only way to know whether a sample is two bytes or three. EDF+ keeps `"0       "` there so that pre-2003 readers still open the file. Nothing in the reserved field can be trusted to identify the family. A file whose reserved field says `BDF+C` but whose version block says EDF is an EDF file with a mislabelled reserved field. Reading it with three-byte samples corrupts every value in it.

The **signal count decides every subsequent offset**, so it has to be validated before it is used for anything. That includes the header-size field at offset 184, which is redundant with it. When the two disagree, `256 * (ns + 1)` is the one that describes where the data records actually start.

## The per-signal header is field-major

This is the layout detail that produces the most wrong parsers. The `ns * 256` bytes starting at offset 256 are **not** one 256-byte struct per signal. They are one contiguous block per *field*: all `ns` labels, then all `ns` transducer types, then all `ns` physical dimensions, and so on to the end.

For signal `i` in a file with `ns` signals:

| Field | Bytes each | Address of signal `i` |
|---|---|---|
| label | 16 | `256 + ns*0 + i*16` |
| transducer type | 80 | `256 + ns*16 + i*80` |
| physical dimension | 8 | `256 + ns*96 + i*8` |
| physical minimum | 8 | `256 + ns*104 + i*8` |
| physical maximum | 8 | `256 + ns*112 + i*8` |
| digital minimum | 8 | `256 + ns*120 + i*8` |
| digital maximum | 8 | `256 + ns*128 + i*8` |
| prefiltering | 80 | `256 + ns*136 + i*80` |
| samples per data record | 8 | `256 + ns*216 + i*8` |
| reserved | 32 | `256 + ns*224 + i*32` |

The widths sum to 256, which is why the per-signal section is `ns * 256` bytes even though no 256-byte unit of it belongs to one signal. The multiplier on `ns` in each row is the sum of the widths of every field before it.

> **Note**
> Reading this section as one struct per signal produces plausible output for a one-signal file, because with `ns = 1` the two layouts are identical. That's how the bug survives a first round of testing. It then fails on a real 30-channel recording, where signal 1's "label" is the tail of signal 0's transducer type.

## Data records and the interleave

Everything about the data section follows from `samplesPerRecord`. There is no sample-rate field in EDF. A signal declares how many samples it contributes to each record, and the header declares how long a record is in seconds. A rate is the quotient of the two. Different signals may declare different counts, so one file can hold EEG at 256 samples per record alongside a temperature probe at 1.

```text
bytesPerSample      = 2 for EDF, 3 for BDF
recordByteLength    = bytesPerSample * SUM(samplesPerRecord[j] for all j)
recordByteOffset[i] = bytesPerSample * SUM(samplesPerRecord[j] for j < i)
fileOffset(r)       = headerByteLength + r * recordByteLength
```

Those four lines give the address of any one sample. Here is sample `n` of a signal, counting from the start of the recording on that signal's own grid:

```ts
import { openEdf } from 'edfcore';
import { fileSource } from 'edfcore/node';
import type { EdfHeader, EdfSignal } from 'edfcore';

function byteOfSample(header: EdfHeader, signal: EdfSignal, sampleIndex: number): number {
  const record = Math.floor(sampleIndex / signal.samplesPerRecord);
  const withinRecord = sampleIndex % signal.samplesPerRecord;
  return (
    header.headerByteLength +
    record * header.recordByteLength +
    signal.recordByteOffset +
    withinRecord * header.bytesPerSample
  );
}

const source = await fileSource('./overnight.edf');
const recording = await openEdf(source);
const signal = recording.header.signals[1]!;      // 'Resp', 16 samples per record

byteOfSample(recording.header, signal, 20);       // 1832 — record 1, sample 4 of that signal

// fileSource opens a descriptor and closing it is yours.
await source.close();
```

edfcore does that arithmetic for you. The function is here because seeing it once is the fastest way to understand the layout. If you do write it yourself, keep every offset in plain floating-point numbers, which are exact to 2^53. A data offset in a multi-gigabyte BDF routinely exceeds 2^31, and every bitwise operator in JavaScript truncates its operand to 32 bits first. Past that point `|0` and `<<` wrap the offset negative without warning. `>>>` is unsigned, so it does not go negative — it keeps returning a plausible offset until 2^32 and a wrong one after that, which is the harder of the two to notice.

Note what the interleave costs. The samples for one channel over ten records are ten small pieces separated by everything the other channels contributed, so there's no cheap single-channel read in this format. Any reader either issues one request per record or reads whole records and de-interleaves them in memory.

## Sample encoding

Samples are **little-endian two's complement integers**. Never big-endian, never floating point, and never anything else. EDF has no mechanism for declaring an alternative.

```ts
// EDF: 16 bits, so -32768 .. 32767
function decodeEdfSample(b0: number, b1: number): number {
  const value = b0 | (b1 << 8);
  return value & 0x8000 ? value - 0x10000 : value;
}

// BDF: 24 bits, sign-extended from bit 23, so -8388608 .. 8388607
function decodeBdfSample(b0: number, b1: number, b2: number): number {
  const value = b0 | (b1 << 8) | (b2 << 16);
  return value & 0x800000 ? value - 0x1000000 : value;
}

decodeEdfSample(0xff, 0xff);         // -1
decodeBdfSample(0xff, 0xff, 0x7f);   // 8388607
```

Bitwise operators are correct here, because a sample is 16 or 24 bits wide and the operations are exact on it. They're only dangerous on offsets.

The three-byte BDF sample is the whole of the difference between the two families at this level. `-1` is `ff ff` in EDF and `ff ff ff` in BDF; `8388607` is `ff ff 7f`. A reader that gets `bytesPerSample` wrong doesn't fail. It produces a signal, just not the one in the file.

One exception to all of the above: the bytes in an **annotation signal's** block are not samples. They are raw character bytes in file order, with no endianness at all. The sample width only sizes the region, which is `samplesPerRecord * bytesPerSample` bytes long.

## Digital to physical

A stored sample is an ADC count. Turning it into microvolts uses four header fields per signal (the digital minimum and maximum, and the physical minimum and maximum). Together they define an affine map. The reference C implementation, EDFlib, writes it this way:

```text
bitValue = (physicalMaximum - physicalMinimum) / (digitalMaximum - digitalMinimum)
offset   = physicalMaximum / bitValue - digitalMaximum
physical = bitValue * (offset + digital)
```

The algebraically equivalent `physicalMinimum + (digital - digitalMinimum) * bitValue` is a numerically better arrangement of the same map. On an asymmetric range the two forms disagree on the last bit of the mantissa for a substantial fraction of samples. Which form a library picks decides whether its output is bit-identical to pyEDFlib's. edfcore pins the EDFlib form for that reason, as [Physical values](/docs/physical-values) explains.

The physical minimum is allowed to be *greater* than the physical maximum. That is not corruption. It's how a negative amplifier gain is written, and it makes `bitValue` come out negative, which is correct. Swapping the two to "fix" the file inverts the polarity of the signal, and an inverted EEG looks entirely normal.

## What EDF+ adds

EDF+ didn't add an events table, a timestamp column or a new record type. It added conventions to fields EDF already had, so the layout is byte-for-byte unchanged.

**The dialect marker.** The first five bytes of the reserved field at offset 192 hold `EDF+C` for a continuous recording or `EDF+D` for a discontinuous one. The BDF family spells those `BDF+C` and `BDF+D`, and `24BIT` marks a plain BioSemi BDF file with no EDF+ additions. The match is on the five-byte prefix, so `"EDF+D v2.1"` is still an EDF+D file.

**An annotations signal.** One of the signals in the header carries the label `EDF Annotations` (`BDF Annotations` in BDF+), written into the 16-byte label field and padded with a space. The match is case-sensitive on the trimmed text. Such a signal has a label, a `samplesPerRecord` and a block of bytes in every data record like any other. Its bytes are UTF-8 text in a small grammar called a TAL, a Time-stamped Annotations List. A file may carry more than one of them.

```text
region   = *TAL *%x00                     ; samplesPerRecord * bytesPerSample bytes
TAL      = Onset [ %x15 Duration ] %x14 *( Text %x14 ) %x00
Onset    = ("+" / "-") 1*DIGIT [ "." 1*DIGIT ]
Duration = 1*DIGIT [ "." 1*DIGIT ]        ; never signed
Text     = UTF-8, excluding %x00, %x14, %x15
```

Three structural bytes carry the whole grammar. `0x15` separates an onset from an optional duration. `0x14` terminates the timestamp and each individual text. `0x00` terminates a TAL and pads out the rest of the region. Splitting on those bytes is safe *before* decoding, because every byte of a multi-byte UTF-8 sequence is at least `0x80` and can never collide with one of them. Doing it the other way round (decode the region to a string, then split) corrupts any annotation containing a non-ASCII character.

Onsets are seconds relative to the header's startdate and starttime, and they are decimal text. Parsed digit by digit they are exact, and `parseFloat` is the only thing that makes them inexact.

**Timekeeping.** The first TAL of the first annotations signal in **every** data record is reserved: it carries that record's own start time relative to the file start, and no text. This is the mechanism that makes EDF+D possible at all. In a discontinuous file, record onsets are not `r * recordDuration`. They are stored, one per record, and the only way to know where record 3 sits on the time axis is to read record 3. Record 0's timekeeping onset is `+0.X` with `0 <= X < 1`. That fractional part is the recording's sub-second start offset, the one piece of sub-second timing the whole format has.

Additional annotation signals carry no timekeeping TAL. Stripping the first TAL from those deletes a real event.

The mandated shape of a timekeeping TAL is `+t 0x14 0x14 0x00`, an empty text after the timestamp. A great many writers emit `+t 0x14 0x00` instead, and a reader that rejects the shorthand rejects a large fraction of real files.

## Oddities that bite implementers

**The two-digit year.** The startdate field is `dd.mm.yy`, and the EDF+ rule is fixed rather than sliding. `85` through `99` mean 1985 through 1999, and `00` through `84` mean 2000 through 2084. `02.08.51` is 2 August **2051**, not 1951. There is no way to express a year outside that span in this field. EDF+ therefore put a four-digit `Startdate dd-MMM-yyyy` subfield at the front of the recording identification at offset 88, the only unambiguous year a file carries.

**The post-2084 escape.** For a recording after 2084 the year position of the startdate field holds the literal characters `yy`, and the real date must be read from that recording-identification subfield. A file using the escape without carrying the subfield has no resolvable date at all.

**A record count of -1.** The number of data records at offset 236 is written when the file is closed. A writer that crashed, or one still streaming, leaves `-1` there. The recovery is arithmetic: `floor((fileSize - headerByteLength) / recordByteLength)`. That's why a reader needs the true file size and not just the header bytes. The same computation catches the file that claims more records than it contains.

**A record duration of 0.** Legal, and it occurs in real recordings rather than only in theory. It means the records don't advance in time, so every sample rate in the file is a division by zero. A reader that computes `samplesPerRecord / recordDuration` unguarded reports `Infinity` Hz and then produces `NaN` for every time it converts.

**A negative amplifier gain.** Covered above, and worth repeating: `physicalMinimum > physicalMaximum` is sanctioned by the EDF FAQ and means the gain is negative.

**BDF's first header byte is not ASCII.** It's `0xFF`, followed by `"BIOSEMI"`. Anything that reads the header as a text string before inspecting it mangles that byte on the way in, and then the file "is not EDF". A `TextDecoder` and a naive `toString('ascii')` both do. The version block has to be examined as bytes.

**The header byte-count field is redundant and sometimes wrong.** `256 * (ns + 1)` is the truth; the field at offset 184 is a claim. When they disagree, believing the field puts every data-record offset in the file at the wrong place.

## Where the spec lives

The primary sources are short and worth reading directly: the [EDF specification](https://www.edfplus.info/specs/edf.html), the [EDF+ specification](https://www.edfplus.info/specs/edfplus.html) with its numbered additional specifications, and the [EDF FAQ](https://www.edfplus.info/specs/edffaq.html). The FAQ answers most of the questions the specs leave open.

BioSemi documents the BDF sample width and header on its own site. BDF+ was never published as a specification, so EDFlib's treatment of it is what implementations follow in practice, edfcore included.

Every diagnostic edfcore emits names the clause it comes from, so a surprising message is traceable back to one of those documents.
