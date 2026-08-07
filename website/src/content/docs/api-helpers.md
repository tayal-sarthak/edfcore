---
title: API — helpers
description: "Reference for the helpers added after 0.1.6: signal lookup, envelope decimation, chunk joining, streaming iteration, annotation queries, the sample grid, the BioSemi Status channel, and the text formatters."
section: Reference
order: 7
lead: Everything that sits on top of the reading layer rather than inside it. Each is a convenience over primitives you already have, and each exists because the hand-rolled version is easy to get subtly wrong.
---

## Finding signals and describing the recording

`header.signals` includes the annotations channel, and forgetting that is the usual way a "select
every EEG channel" filter ends up decoding a TAL region as if it were samples.

```ts
import { matchSignals, declaredDurationSeconds, contiguityOf } from 'edfcore';

const eeg = matchSignals(recording.header, /^EEG /);
const byPredicate = matchSignals(recording.header, (s) => s.physicalDimension === 'uV');
```

`matchSignals` never returns an annotations channel. A `g` or `y` flag on the pattern is harmless:
`RegExp.prototype.test` is stateful with those flags and would otherwise make each label's answer
depend on the previous one — returning about half a montage, silently. Both this and
`filterAnnotationsByText` test against a clone with `lastIndex` reset, so your own regex object is
never mutated either (fixed in 0.2.21).

`getSignal` remains the right call for one channel by name — it throws `EdfChannelNotFoundError` or `EdfAmbiguousChannelError` rather than
returning `undefined`; `matchSignals` returns a family, possibly empty.

```ts
declaredDurationSeconds(recording.header);   // what the records COVER
recording.timeline.spanSeconds;              // first record start to last record end
```

The two differ on an EDF+D file, and the difference is the gaps: they belong to no record, so they
are inside the span and outside the coverage.

```ts
contiguityOf(recording.index);   // 'contiguous' | 'discontinuous' | 'unknown'
```

Three answers, not a boolean. `openEdf` probes two records and does not scan; a probed index has
seen the first and the last and cannot rule out a gap between them. `'unknown'` is that state, and
`await buildRecordIndex(recording)` is what turns it into one of the other two.

```ts
import { segmentAt } from 'edfcore';

const index = await buildRecordIndex(recording);
segmentAt(index, 3612.5);   // EdfSegment, or undefined if that instant is in a gap
```

`segmentAt` is the pure, synchronous form of `index.locate()`: a binary search over segments the
scan already produced, with no reads. A viewer asking on every mouse move wants this one.

It **throws** on a probed index rather than returning `undefined`, because `undefined` here means
"no records cover this instant" and a probed index cannot say that about anything in the middle of
the file.

On a file whose record duration is **zero** it returns `undefined` for every time, and that is
correct rather than a gap in the implementation: records then occupy no time, so each segment's
half-open interval `[start, start)` is empty and no instant is inside one. A real sleep-staging
file is shaped exactly like that. Index by record with `readRecords` instead. Merging "there is a gap here" with "nobody looked" is the one confusion this whole area
of the API exists to prevent.

```ts
import { gapAt } from 'edfcore';

const gap = gapAt(index, 3612.5);   // EdfGap, or undefined if a record covers that instant
gap?.durationSeconds;
gap?.endSeconds;                    // when the recording resumes
```

`gapAt` is the complement. `segmentAt` returning `undefined` tells a viewer there is no data under
the cursor and nothing else; how long the hole is and when data resumes are on the `EdfGap`.
Exactly one of the two returns a value for any instant strictly inside the recording.

## Envelope decimation

A twelve-hour recording at 256 Hz is about eleven million samples per channel. A plot is a
thousand pixels wide. Something has to reduce one to the other, and taking every 11,000th sample
is the wrong reduction: a spike or a spindle is a handful of samples wide, so subsampling misses
it and the trace looks calm exactly where a reader most needs it not to.

`readEnvelope` keeps the minimum and maximum of each bucket, at two numbers per pixel.

```ts
import { openEdf, readEnvelope, toPhysicalEnvelope, getSignal } from 'edfcore';

const recording = await openEdf(source);
const eeg = getSignal(recording.header, 'EEG Fpz-Cz');

const [chunk] = await readEnvelope(recording, {
  signalIndices: [eeg.index],
  startSeconds: 0,
  durationSeconds: recording.timeline.spanSeconds,
  buckets: 1000,
});

chunk.signals[0].min;
chunk.signals[0].max;
chunk.signals[0].counts;
```

The shape mirrors `readWindow`: an array of chunks, one per contiguous run, empty when the window
selects nothing. Memory is bounded by the record chunk rather than by the window, so an envelope
over a whole recording costs the buckets plus one chunk.

`buckets` is clamped to the sample count of the densest signal in the run — asking for more
buckets than there are samples would leave holes that mean nothing.

### Physical units

Use `toPhysicalEnvelope`, not `toPhysical`.

```ts
const { min, max } = toPhysicalEnvelope(eeg, chunk.signals[0]);
```

The affine transform is decreasing when `bitValue` is negative, which is a spec-sanctioned
arrangement edfcore reports rather than rejects. A decreasing map sends the smallest digital value
to the largest physical one, so mapping `min` to `min` would produce an envelope whose lower bound
sits above its upper bound, and a viewer would draw it inside out. `toPhysicalEnvelope` swaps the
bounds when it has to.

### Samples already in hand

```ts
import { envelopeOfSamples } from 'edfcore';
const envelope = envelopeOfSamples(chunk.signals[0], 1000);
```

### A resolution instead of a bucket count

`readEnvelope` takes `buckets`, which is what a pixel-width knows. A time axis knows seconds per
pixel instead, and converting one to the other by hand is a rounding decision.

```ts
import { readEnvelopeAtResolution } from 'edfcore';

const chunks = await readEnvelopeAtResolution(recording, {
  signalIndices: [eeg.index],
  startSeconds: 0,
  durationSeconds: 40,
  secondsPerBucket: 30,
});
```

The bucket count is rounded UP: 40 seconds at 30 seconds per bucket is two buckets, not one.
Rounding down would drop the last ten seconds off the picture entirely. The **last bucket of a run
is short** by whatever the division left over — 40 s at 30 s per bucket is one full bucket and one
of 10 s — and its `counts` entry says by how much.

Every chunk of one call has the width you asked for, whatever its own length. A chunk covers one
record-aligned contiguous run, and a run is not the window: an EDF+D window spanning a gap gives
two runs of different lengths, and even a contiguous window that does not begin on a record
boundary gives a run wider than it asked for. Two things had to be right for that:

- The bucket **count** comes from each run's own span, not once from the window. Before 0.2.31 one
  count was handed to every chunk, so a window of 11 s asked at 1 s per bucket came back as 0.27 s
  per bucket in one chunk and 0.09 s in the other.
- The bucket a sample lands in is decided by **when it is**, not by dividing the run evenly into
  that count. Before 0.3.9 it was the latter, so the width still followed the run whenever the span
  was not a whole multiple of the request: a 100 s run at 30 s per bucket gave four buckets of
  25 s while a 60 s run in the same call gave two of 30 s.

Widths that disagree cannot be drawn on one axis, which is the entire reason this function exists
separately from `readEnvelope`.

## Streaming iteration

`readWindow` returns every chunk at once, which is right for a window you are about to draw and
wrong for a whole recording: the array holds every sample the window covers.

```ts
import { streamRecords } from 'edfcore';

for await (const chunk of streamRecords(recording, {
  signalIndices: [0, 1],
  startSeconds: 0,
  durationSeconds: recording.timeline.spanSeconds,
  chunkRecords: 256,
})) {
  process(chunk);
}
```

`chunkRecords` is a count of records, not of bytes or seconds, because the record is the only unit
every signal in an EDF file shares — channels sample at different rates, so "a second of data" is
a different number of samples per channel.

`signalIndices` is validated before the window is resolved, so a non-existent index or the
annotations channel is refused even when the window selects no records at all — the same
`EdfChannelNotFoundError` `readWindow` raises. Before 0.2.22 a window past the end, inside an
EDF+D gap, or of zero duration reported a bad channel as "no data here", which is the wrong
diagnosis. A *valid* selection over an empty window still yields nothing, silently; that is an
ordinary answer, not an error.

Chunks arrive in time order, never span a gap, and carry the same `precededByGap` a `readWindow`
chunk would. They come from `readRecords`, so a streamed chunk and a read chunk are the same
object in every respect, diagnostics included.

## Joining chunks

`readWindow` splits at every discontinuity, so a window over an EDF+D file arrives as one chunk
per contiguous run. Code that wants one array — a filter, an FFT, a CSV writer — has to join them,
and joining is where the gap gets lost.

```ts
import { mergeChunks } from 'edfcore';

const chunks = await readWindow(recording, selection);
const one = mergeChunks(chunks);      // throws if they are not joinable
```

Concatenating two runs five minutes apart produces an array in which sample `i` and sample `i + 1`
are five minutes apart, and every time derived from an index past the join is wrong by five
minutes with nothing in the result to say so. `mergeChunks` throws a `RangeError` instead — for a
gap, for chunks out of order or not adjacent, for a different signal selection, and for a chunk
already narrowed by `trimToWindow`. That last one is invisible to a record-adjacency check, which
is why the check is per signal on `firstSampleIndex`. Trim after merging, not before.

The gap check does not depend on the index. `precededByGap` is `undefined` in two different
situations — no gap, and nobody looked — and `openEdf` returns a probed index that has looked for
none. So `readRecords` by record number on an EDF+D file could hand two chunks a minute apart to
`mergeChunks` with that field empty on both. Since 0.2.19 the refusal compares the chunks' own
`startSeconds`, in exact ticks: each chunk decoded its onset from its own bytes, so the evidence
never needed an index at all.

A single chunk is returned unchanged, so the continuous case costs no allocation.

## Annotation queries

`readAnnotations` returns every event in a record range. Narrowing it by hand goes wrong in one
specific way: the obvious filter compares `onsetSecondsFromFirstRecord`, which is float64 seconds
divided out of an exact tick count, so an onset and a bound that should be equal need not compare
equal.

```ts
import {
  filterAnnotationsByTime,
  filterAnnotationsByText,
  countAnnotationsByText,
  annotationsAt,
} from 'edfcore';

const epoch = filterAnnotationsByTime(annotations, {
  startSeconds: 3600,
  durationSeconds: 30,
});

const wake = filterAnnotationsByText(annotations, 'Sleep stage W');
const stages = countAnnotationsByText(annotations);
const underCursor = annotationsAt(annotations, 3612.5);
```

Every comparison is on `onsetTicksFromFirstRecord`. Windows are half-open, so adjacent windows
partition a recording without double-counting an epoch that ends exactly on the boundary. An
annotation with a duration is returned when it overlaps the window — containment would return
nothing for a window inside a 30-second sleep epoch.

`annotationsAt` is the instant form a cursor needs. The window form does not work for it: a
zero-length window is a non-positive duration, which `filterAnnotationsByTime` refuses, so the
obvious call returns nothing at every position.

### Which onset field to compare

An annotation carries its onset four ways, and two of them are exact.

| Field | Axis | Exact |
|---|---|---|
| `onsetTicks` | header start time | yes |
| `onsetTicksFromFirstRecord` | start of record 0 | yes |
| `onsetSecondsFromHeaderStart` | header start time | no — float64 |
| `onsetSecondsFromFirstRecord` | start of record 0 | no — float64 |

`resolveTimeWindow`, `readWindow` and `readEnvelope` all put `t = 0` at the start of record 0, so
`onsetTicksFromFirstRecord` is the field that lines up with a window you have read. It differs
from `onsetTicks` by the sub-second start offset a file may declare in record 0's timekeeping TAL:
identical on a file that declares none, and up to a second apart on one that does.

Before 0.2.10 these queries compared `onsetTicks`, which put events in the neighbouring window on
exactly the files careful enough to state an offset.

`filterAnnotationsByText` matches a string exactly, because annotation vocabularies are controlled
and a substring match on `W` would also catch spellings like `W/REM`. Pass a `RegExp` or a
predicate when you want something looser.

## The sample grid

The obvious spelling of "which sample is at 3600 s" is `Math.round(seconds * signal.sampleRateHz)`
and it breaks three ways.

| Problem | Consequence |
|---|---|
| `sampleRateHz` is `samplesPerRecord / recordDurationSeconds` | 128 samples over 0.3 s is 426.666… with no exact float representation, and the index drifts by one over a long recording |
| `sampleRateHz` is `undefined` for a zero record duration | legal EDF, which a real sleep-staging file relies on — the expression yields `NaN` silently |
| Rounding rather than flooring | a window boundary lands one sample late |

```ts
import { gridSampleIndexAt, gridSampleStartTicks, gridSampleStartSeconds } from 'edfcore';

const { sampleIndex, recordIndex, sampleWithinRecord } = gridSampleIndexAt(
  eeg,
  3600,
  recording.header.recordDurationTicks,
);

const ticks = gridSampleStartTicks(eeg, sampleIndex, recording.header.recordDurationTicks);
```

These do the arithmetic in integers on `(record, sampleWithinRecord)` — the same rule
`trimToWindow` follows — and throw a `RangeError` for a zero record duration rather than returning
`NaN`.

> **These measure the signal's own sample grid, not the recording clock.**
> Sample `n` is the `n`th sample the file stores for that signal, at
> `n * recordDuration / samplesPerRecord`. On a contiguous recording that is also elapsed recording
> time and the two are the same number — which is exactly why the difference is easy to miss.
>
> On a **discontinuous** file they part company. Samples are adjacent in the array across a gap
> while their times are not, so on a file with a seven-second hole after record 2,
> `gridSampleStartSeconds(signal, 12, d)` answers `3` for a sample whose record truly begins at `10`,
> and `gridSampleIndexAt(signal, 10, d)` names record `10` of a six-record file. They are handed a
> signal, a number and a record duration — no index, no timeline — so a gap is not in their
> arguments and nothing inside them could find it.
>
> For a file that may be discontinuous, use the recording-aware pair below instead.

### The recording-aware form

```ts
import { sampleAt, sampleStartTicksOf, sampleStartSecondsOf } from 'edfcore';

sampleAt(recording, eeg.index, 3612.5);          // EdfSampleLocation, or undefined
sampleStartSecondsOf(recording, eeg.index, 940); // when sample 940 actually starts
```

These take the **recording**, so a gap is in their arguments and they answer the question people
usually mean. On a contiguous file they agree with the grid functions exactly — a test asserts that
sample by sample. On a discontinuous one they differ by the gaps, and `sampleAt` can say something
the grid functions structurally cannot: **`undefined`**, meaning no sample exists at that instant
because it falls in a hole, or before the recording, or after it. `gridSampleIndexAt` given only a
signal and a record duration always returns an index — including one past the end of the file.

They refuse a probed index on a file with gaps rather than guessing, for the reason `segmentAt`
does. `index.locate(seconds)` remains the read-based form; `contiguityOf(index)` tells you which
regime you are in.

> **Renamed in 0.3.0.** These were `sampleIndexAt`, `sampleStartTicks` and `sampleStartSeconds`.
> The behaviour did not change — only the name, which never said which of two different quantities
> it returns. See [Migrating to 0.3](/docs/migrating-to-0-3) for the find-and-replace.

`gridSampleStartTicks` rounds up to a whole tick. A sample boundary need not fall on one: 128 samples
over 0.3 s puts sample 1 at 23,437.5 ticks, and 100 ns is the finest unit edfcore has. Truncating
would return a tick lying inside the previous sample, and `gridSampleIndexAt` would send it straight
back there. Rounding up keeps the two functions inverse for every index.

## The BioSemi Status channel

A BioSemi ActiveTwo writes BDF files whose last channel is labelled `Status`. Its 24-bit samples
are not a measurement — they are a bit field the amplifier latched at each sample, and the low 16
bits are the parallel trigger input.

```ts
import { getStatusSignal, readTriggers, decodeStatusWord } from 'edfcore';

if (getStatusSignal(recording.header) !== undefined) {
  const events = await readTriggers(recording, {
    startSeconds: 0,
    durationSeconds: recording.timeline.spanSeconds,
  });
}
```

`readTriggers` reports one event per change of the trigger word, not one per sample: a parallel
trigger is held for as long as the stimulus computer asserts it, so the transition is what carries
the information. A return to `0` is reported too, because the release time is what gives a trigger
its duration.

### Times and the window

`seconds` and `ticks` are elapsed recording time on the same axis as everything else: `t = 0` is
the start of record 0, matching `chunk.startSeconds` and the bounds you pass here. Each event is
timed from its own record's **true** onset, so on an EDF+D file the gaps are in the numbers.
`sampleIndex` is a different quantity — a count of Status samples from the start of the file — and
deriving a time from it would place every post-gap event early by the whole gap. Before 0.2.18 that
is exactly what happened: a stimulus the hardware latched at 10 s was reported at 2 s.

Events outside the window are never returned, even though the scan itself is record-aligned. The
first in-window sample always produces an event carrying the code **in force** at that instant,
whether or not it is a transition — the same rule a whole-file read follows at `t = 0`, so an
aligned and an unaligned window behave alike. If you want assertions only, filter on `trigger`:

```ts
const onsets = (await readTriggers(recording, window)).filter((e) => e.trigger !== 0);
```

`decodeStatusWord` masks the sample back to 24 unsigned bits first. `decodeDigital` sign-extends
BDF samples, as it must for a measurement, so a Status word with bit 23 set arrives negative.

Only the bits BioSemi documents are named — trigger, `newEpoch`, `cmsInRange`, `batteryLow`.
`raw` carries all 24, because sources disagree about the bits above 18 and a wrong trigger code is
worse than none.

This is file access, not analysis: the codes were written by the hardware at acquisition time,
exactly like an EDF+ annotation. Nothing here inspects a biosignal.

## Text formatters

```ts
import { formatHeader } from 'edfcore';
import { formatValidationReport } from 'edfcore/validate';

console.log(formatHeader(recording.header));
console.log(formatValidationReport(report, { header: recording.header }));
```

`formatHeader` omits patient identification unless you pass `{ includePatientId: true }`. A header
carries a name and a birth date, and the obvious thing to do with this string is paste it into an
issue or a log, so the default is the safe one. The data is still on `header.patient`.

Neither formatter invents a value. An unresolved date prints as `unknown`, and a rate that is
genuinely undefined prints as an em dash rather than `0 Hz` or `Infinity`.

`formatAnnotations` is the third formatter, for a hypnogram or an event list:

```ts
import { formatAnnotations } from 'edfcore';

console.log(formatAnnotations(annotations, { maxItems: 20 }));
// 00:00:00.000                Sleep stage W
// 08:30:30.000  00:02:00.000  Sleep stage 1
```

The clock is built from `onsetTicksFromFirstRecord` by integer division, never from the float
seconds — an event list is exactly where someone reads a number off the screen and types it into
something else, and a millisecond field derived from a float can be off by one. Hours are not
wrapped at 24, because a 30-hour recording is real and `30:12` beats `06:12` on day two. A negative
onset prints as one: EDF+ measures onsets from the header start time, a recording may begin after
its first annotation, and clamping to zero would silently move the event.

`formatValidationReport` leads with the severity counts and the distinct codes sorted by how much
of the file each affects, then a capped sample of individual entries. A sweep over a damaged file
can produce six figures of diagnostics — `TIMEKEEPING_TAL_MISSING` is per record — and a wall of
them buries the answer.

## The CLI

```bash
npx edfcore header <file>      # the header, the signals, and any diagnostics
npx edfcore validate <file>    # a full conformance sweep, scanning every sample
npx edfcore events <file>      # the annotations, counted by text
npx edfcore signals <file>     # one tab-separated line per signal, for grep and awk
npx edfcore gaps <file>        # the discontinuities, from a full scan
npx edfcore json <file>        # the header as JSON, for piping into jq
npx edfcore --version          # the installed version
```

Flags: `--patient` includes patient identification, `--list` makes `events` print one event per
line instead of counting them by text, `--limit <n>` caps the individual diagnostics or events
printed.

```bash
npx edfcore events recording.edf --list --limit 100
# 0<TAB>30<TAB>Sleep stage W<TAB>
```

The onset column is `onsetSecondsFromFirstRecord` — the axis `gaps` and every read use, where
`t = 0` is the start of record 0. A truncated listing says how many events it withheld, because a
silently cut one reads as a complete one.

`header` is for reading and `signals` is for piping. The second emits six tab-separated columns,
in this order, annotations channel included:

| # | Column | Note |
|---|---|---|
| 1 | `index` | |
| 2 | `label` | trimmed |
| 3 | `kind` | `data` or `annotations` |
| 4 | `sampleRateHz` | **empty** for a legal zero record duration — it is derived |
| 5 | `physicalDimension` | trimmed |
| 6 | `samplesPerRecord` | the authoritative count; index by this, never by the rate |

Column 6 was added in 0.2.42 and appended rather than inserted, so nothing that parsed the first
five by position moved. Before that this page claimed the command emitted samples per record when
it emitted `kind` instead, and the authoritative field was in no column at all. `gaps` runs a full scan rather
than the two probes `openEdf` makes, because a probed index cannot see a gap in the middle and
reporting "none" from it would be a claim nobody verified.

Exit codes are the contract, so a script can act on them without parsing the output:

| Code | Meaning |
|---|---|
| `0` | success |
| `1` | the file could not be read, or validation failed |
| `2` | bad usage — unknown command or option, missing file, extra files, bad flag value |

Bad usage really does exit 2 since 0.2.27; before that `parseArgs` threw a plain `RangeError` that
the shell reported as 1, so `--limit all` was indistinguishable from a corrupt recording to the job
gating on it. Three related things changed with it:

- An **unknown option** is refused rather than ignored. A misspelled `--patinet` used to be dropped
  silently, so the command printed the identification the caller was trying to withhold, and
  exited 0.
- **Extra files** are refused. `edfcore validate *.edf` used to validate the first file the shell
  expanded, exit 0, and say nothing about the rest — inside the CI gate the exit code exists for.
  Loop instead: `for f in *.edf; do edfcore validate "$f" || exit 1; done`
- **`--help` and `-h`** exit 0. They are flags, and `parseArgs` never puts a dash-prefixed argument
  in the command slot, so the old `command === '--help'` branch was unreachable and
  `npx edfcore --help` fell through to "no command" and exited 2.

`edfcore validate` exiting non-zero is the intended way to gate a CI job on file conformance.

Patient identification is omitted from `header` and `json` unless `--patient` is passed, for the
same reason `formatHeader` withholds it: the obvious thing to do with CLI output is pipe it
somewhere.

That covers the diagnostics too, which is the part that is easy to miss. A diagnostic names the
raw bytes as written — that is the message contract, and it is what makes a report actionable —
so a NON-CONFORMANT identification field had its whole content printed in the diagnostics block
underneath the summary that had just withheld it. That is not a rare file: a writer that packs the
name into a single token fails the EDF+ grammar, and a file that behaves oddly is exactly the one
someone runs `edfcore header` on and pastes into an issue. Since 0.2.26 both are gated by the same
flag, and the diagnostic still reports its code, severity, byte offset and rule with the value
replaced by `[redacted]`.

`formatDiagnostics` and `formatValidationReport` take `redactFields` for the same purpose:

```ts
formatDiagnostics(header.diagnostics, { redactFields: ['patientId', 'recordingId'] });
```
