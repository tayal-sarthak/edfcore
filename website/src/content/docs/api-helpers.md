---
title: API — helpers
description: "Reference for the helpers added after 0.1.6: envelope decimation, streaming iteration, annotation queries, the sample grid, the BioSemi Status channel, and the text formatters."
section: Reference
order: 7
lead: Everything that sits on top of the reading layer rather than inside it. Each is a convenience over primitives you already have, and each exists because the hand-rolled version is easy to get subtly wrong.
---

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

Chunks arrive in time order, never span a gap, and carry the same `precededByGap` a `readWindow`
chunk would. They come from `readRecords`, so a streamed chunk and a read chunk are the same
object in every respect, diagnostics included.

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
} from 'edfcore';

const epoch = filterAnnotationsByTime(annotations, {
  startSeconds: 3600,
  durationSeconds: 30,
});

const wake = filterAnnotationsByText(annotations, 'Sleep stage W');
const stages = countAnnotationsByText(annotations);
```

Every comparison is on `onsetTicks`. Windows are half-open, so adjacent windows partition a
recording without double-counting an epoch that ends exactly on the boundary. An annotation with a
duration is returned when it overlaps the window — containment would return nothing for a window
inside a 30-second sleep epoch.

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
import { sampleIndexAt, sampleStartTicks, sampleStartSeconds } from 'edfcore';

const { sampleIndex, recordIndex, sampleWithinRecord } = sampleIndexAt(
  eeg,
  3600,
  recording.header.recordDurationTicks,
);

const ticks = sampleStartTicks(eeg, sampleIndex, recording.header.recordDurationTicks);
```

These do the arithmetic in integers on `(record, sampleWithinRecord)` — the same rule
`trimToWindow` follows — and throw a `RangeError` for a zero record duration rather than returning
`NaN`.

`sampleStartTicks` rounds up to a whole tick. A sample boundary need not fall on one: 128 samples
over 0.3 s puts sample 1 at 23,437.5 ticks, and 100 ns is the finest unit edfcore has. Truncating
would return a tick lying inside the previous sample, and `sampleIndexAt` would send it straight
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

`formatValidationReport` leads with the severity counts and the distinct codes sorted by how much
of the file each affects, then a capped sample of individual entries. A sweep over a damaged file
can produce six figures of diagnostics — `TIMEKEEPING_TAL_MISSING` is per record — and a wall of
them buries the answer.
