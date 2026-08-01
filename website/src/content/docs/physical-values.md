---
title: Physical values
description: Convert digital sample counts into the signal's own units with toPhysical, and understand the cases where edfcore refuses to convert at all.
section: "Guides"
order: 2
lead: A chunk hands you the integers the file stores. Turning those into microvolts is a separate call, because it can fail — and when it fails, guessing a gain would produce numbers that look perfectly ordinary and are wrong.
---

## Two functions, not a flag

`chunk.signals[i].digital` is an `Int32Array` of the values as stored. `toPhysical` returns a
`Float64Array` in the signal's declared units:

```ts
import { getSignal, readWindow, toPhysical } from 'edfcore';

const fp1 = getSignal(recording.header, 'Fp1');
const [chunk] = await readWindow(recording, {
  startSeconds: 30,
  durationSeconds: 10,
  signalIndices: [fp1.index],
});

const microvolts = toPhysical(fp1, chunk.signals[0].digital);
```

There is no `{ physical: true }` option, because an option that changes the return type is a bug
waiting to be written. There is also no fused "read as physical" call: conversion can throw for
reasons the read cannot, and keeping them separate is what makes that visible.

`toPhysical` takes any `ArrayLike<number>`, so it works on a trimmed chunk signal, on a raw
`decodeDigital` result, or on a plain array.

## How do I convert EDF digital sample values to microvolts?

Every EDF signal declares four numbers: a physical minimum and maximum in its own units, and a
digital minimum and maximum in ADC counts. Those define an affine map, and edfcore builds it as:

```
bitValue = (physicalMaximum - physicalMinimum) / (digitalMaximum - digitalMinimum)
offset   = physicalMaximum / bitValue - digitalMaximum
physical = bitValue * (offset + digital)
```

`bitValue` and `offset` are precomputed once per signal and published as `signal.scale`:

```ts
fp1.scale;  // { bitValue: 0.015259021896696421, offset: 0.5 }
            // from -500..500 uV over -32768..32767
```

### Why this form and not the better one

The textbook expression `physicalMinimum + (digital - digitalMinimum) * gain` is numerically
*better* — fewer operations away from the endpoints, less cancellation — and edfcore
deliberately does not use it. The form above is EDFlib's, kept verbatim, so that edfcore's
float64 output can be compared bit for bit against pyEDFlib and EDFlib rather than
approximately.

The two forms agree at the endpoints and disagree in the last place elsewhere:

| digital | edfcore (EDFlib form) | textbook form |
|---|---|---|
| `-32768` | `-500` | `-500` |
| `-1` | `-0.007629510948348211` | `-0.007629510948390816` |
| `0` | `0.007629510948348211` | `0.007629510948333973` |
| `32767` | `500` | `500` |

(Digital zero does not map to physical zero here, and that is correct: the digital range
−32768..32767 is not symmetric about zero, so neither is the map.)

For this range the two forms produce a different float64 for 37,144 of the 65,536 possible
sample values — 57 % of them. The largest disagreement is 8.5e-14 µV, which is 5.6e-12 of one
quantisation step: about eleven orders of magnitude below the smallest difference the amplifier
can express, and therefore invisible in any measurement. It is perfectly visible in a
golden-value comparison, which is exactly the point — if the expression ever drifts, the
comparison should fail rather than round itself into agreement.

> **Note**
> edfcore is 0.1 and the cross-implementation harness that would *prove* bit-parity against
> pyEDFlib and MNE has not been built yet. What is true today is that the expression is EDFlib's
> verbatim and is pinned by tests against fixed golden values. Treat "bit-identical to pyEDFlib"
> as the design intent, not as a measured claim. The same caution applies to every description of
> EDFlib's behaviour on this page: they come from edfcore's design notes, not from a comparison
> run in this repository.

### Float64, always

The output is a `Float64Array` and there is no `Float32` option. Float32 carries 24 significand
bits and a BDF sample is a 24-bit integer, so a scaled BDF sample does not fit. On a
−500..500 µV BDF channel the float32 rounding error reaches **0.26 of a quantisation step** —
a quarter of the smallest difference the amplifier can express, injected by the library that was
supposed to be reporting it. Halving the memory is not worth that.

If you need float32 for a GPU buffer, convert at the boundary where you can see the cost, not in
the library that owns the numbers.

## Units are reported, never converted

edfcore does not normalise units. It never turns microvolts into volts, millimetres of mercury
into pascals, or anything else. Unit inference is where readers guess, and a guess about scale is
a wrong number with a plausible magnitude.

Three fields describe the unit, and they differ deliberately:

| field | value for a `µV` channel | what it is |
|---|---|---|
| `signal.raw.physicalDimension` | `"µV      "` | the eight header bytes verbatim, padding included |
| `signal.physicalDimension` | `"µV"` | the same text with the EDF padding removed, nothing else changed |
| `signal.unit` | `"uV"` | normalised for comparison: every encoding of micro becomes `u` |

Display `physicalDimension`. Compare against `unit`. The normalisation exists because micro has
several spellings that all mean the same thing — U+00B5 MICRO SIGN, U+03BC GREEK SMALL LETTER
MU, and a raw `0xB5` header byte, which Latin-1 decodes to the first — so a reader that
string-compares against `'uV'` will reject files it should accept. `unit` collapses all of them
to `u` and changes nothing else: case stays meaningful, `mV` is not `MV`, and no unit is ever
rewritten into another.

Converting is your call, and it is one line:

```ts
const microvolts = toPhysical(fp1, chunk.signals[0].digital);

if (fp1.unit !== 'uV') {
  throw new Error(`expected uV, got ${JSON.stringify(fp1.physicalDimension)}`);
}
const volts = Float64Array.from(microvolts, (v) => v * 1e-6);
```

Note the check. The library will not do this conversion for you, so the factor you write is only
correct if the unit is what you assumed — and on a file you did not produce, that is worth
asserting rather than hoping.

## Negative gain is legal and is never "fixed"

A signal may declare `physicalMinimum > physicalMaximum`. That is not corruption: it is how a
negative amplifier gain is written, and the EDF FAQ sanctions it. `bitValue` comes out negative
and the map works exactly as it should:

```ts
// physicalMinimum 500, physicalMaximum -500, over -32768..32767
inverted.scale;  // { bitValue: -0.015259021896696421, offset: 0.5 }

toPhysical(inverted, new Int32Array([-32768, 0, 32767]));
// Float64Array [ 500, -0.007629510948348211, -500 ]
```

edfcore never swaps the two fields to make them look tidy. Swapping them flips the polarity of
every sample in the channel, and a polarity-flipped EEG is a clinically wrong result that looks
completely normal — the traces still have the right amplitude, the right frequency content and
the right artifacts. Nothing downstream would catch it.

You still get told. `header.diagnostics` carries an `INVERTED_PHYSICAL_RANGE` entry at `info`
severity naming the signal, the raw bytes, the byte offset, and the spec clause. On a
one-signal file it reads:

```
signal 0 "Inv" declares physicalMinimum 500 greater than physicalMaximum -500
(raw "500     " at byte offset 360). This is legal and encodes a negative amplifier gain
(EDF FAQ Q6), so bitValue comes out negative. Next: nothing to do — edfcore never swaps
the two, because a silent polarity flip is a clinically wrong result that looks normal.
```

## When there is no scale

`signal.scale` is `EdfScale | undefined`, and `undefined` means edfcore found no defensible way
to compute a gain. `toPhysical` on such a signal throws `EdfScalingError`. Because the type is
`| undefined`, `strictNullChecks` makes the case hard to ignore at the point where you would have
written the bug.

Four conditions produce it, checked in this order:

| `error.code` | condition | why it is refused |
|---|---|---|
| `DEGENERATE_DIGITAL_RANGE` | `digitalMinimum === digitalMaximum` | the gain is a division by zero |
| `DEGENERATE_PHYSICAL_RANGE` | `physicalMinimum === physicalMaximum` | every sample would map to one value |
| `INVERTED_DIGITAL_RANGE` | `digitalMinimum > digitalMaximum` | no sanctioned meaning, unlike the physical case |
| `LOG_TRANSFORMED_CHANNEL` | `physicalDimension` is exactly `"Filtered"` | the samples are log-compressed, so a linear map is wrong by orders of magnitude |

The first is the one that matters most in practice. It is a common header defect, and EDFlib's
answer to it is to substitute a gain of 1 — which hands back ADC counts labelled as microvolts,
a number that is wrong by whatever the real gain was and carries no sign that anything happened.
edfcore sets `scale` to `undefined` instead, so the mistake becomes a type error before it
becomes a plot.

`INVERTED_DIGITAL_RANGE` is refused where `INVERTED_PHYSICAL_RANGE` is accepted, and the
asymmetry is intentional. An inverted physical range has a documented meaning; an inverted
digital range does not, so edfcore cannot tell whether the writer swapped two fields or inverted
the samples, and either interpretation would be a guess.

`LOG_TRANSFORMED_CHANNEL` follows the EDF `edffloat` convention, where a physical dimension of
exactly `Filtered` marks a logarithmically transformed channel. edfcore detects it and refuses
rather than applying an inverse transform it cannot verify.

Each condition also appears in `header.diagnostics` at parse time, at `error` severity, with the
byte offset and the raw field text — so you can report the problem before anyone calls
`toPhysical`.

> **Note**
> A fifth, rarer condition exists: four finite fields whose *derived* pair is not usable, such as
> a physical range that underflows or overflows float64 against the digital range. The header
> reports it as `DEGENERATE_PHYSICAL_RANGE`; the error thrown later by `toPhysical` carries
> `SCALE_UNAVAILABLE`, because `toPhysical` re-derives the cause from the signal alone and this
> one is not one of the four it can re-derive. Naming no cause was judged better than naming the
> wrong one.

### Digital data still works

This is the point of separating the two functions. A signal with no scale is not unreadable — its
samples are perfectly good integers, and only their interpretation in physical units is missing:

```ts
import { decodeDigital, getSignal, isEdfError, readRecordBytes } from 'edfcore';

const signal = getSignal(recording.header, 'EMG Chin');
const records = { start: 0, count: 10 };
const bytes = await readRecordBytes(recording.source, recording.header, records);
const digital = decodeDigital(recording.header, bytes, records, signal.index);
// Always works.

try {
  const physical = toPhysical(signal, digital);
} catch (error) {
  if (isEdfError(error) && error.edfErrorKind === 'scaling') {
    // error.code, error.signalIndex, error.label — plot the digital counts and say so.
  } else {
    throw error;
  }
}
```

Use `isEdfError` plus `edfErrorKind` rather than `instanceof`. `instanceof` is false across a
realm boundary — an iframe, a worker, two copies of the package in one dependency tree — and this
is exactly the kind of check that silently stops working when someone adds a web worker.

The thrown message names the signal, the reason, every raw field as written, the spec clause, and
what to do next:

```
[DEGENERATE_DIGITAL_RANGE] signal 0 "D" declares digitalMinimum == digitalMaximum == 0,
which makes the gain a division by zero, so physical units are undefined for it. Raw fields:
digital minimum "0       ", digital maximum "0       ", physical minimum "-500    ",
physical maximum "500     ", physical dimension "uV      ". EDF+ additional specification 5:
"Digital maximum must be larger than Digital minimum". Next: decodeDigital() still works on
this signal; edfcore will not invent a gain.
```

## Out-of-range samples are reported, not clamped

A file can contain samples outside the digital range its own header declares. edfcore decodes
them as they are and converts them as they are. It never clamps on read.

The count comes free, because it is taken in the same pass that decodes:

```ts
// A signal declaring -100..100 digital, holding samples at -500 and +500.
const narrow = getSignal(recording.header, 'Narrow');

const [chunk] = await readWindow(recording, {
  startSeconds: 0,
  durationSeconds: 1,
  signalIndices: [narrow.index],
});

chunk.signals[0].digital;                 // Int32Array [ -500, -50, 50, 500 ]
chunk.signals[0].outOfDigitalRangeCount;  // 2
```

A non-zero count means **the declared range is wrong, not that the samples are**. The samples are
what the amplifier wrote; the header field is a claim about them that has turned out to be false.
Clamping would destroy the evidence and hand back a flattened signal that looks like saturation.
The count is the cue to go and look at the header. When you want the whole file rather than one
window's tally, `validateRecording(recording, { scanSamples: true })` from `edfcore/validate`
fills `report.signalStats` with the observed digital minimum and maximum per signal. That reads
every record, so it is a deliberate call and not something a window read does behind your back.

The comparison uses `min` and `max` of the two declared bounds rather than the pair as written,
so a file with an inverted digital range does not report every sample as out of range, which
would say nothing about the samples.

### Reproducing a clamping reader

EDFlib clamps silently when it loads samples. When you are cross-validating edfcore's output
against a library that does, `clampToDigitalRange` reproduces that behaviour as an explicit,
post-hoc step:

```ts
import { clampToDigitalRange } from 'edfcore';

const clamped = clampToDigitalRange(narrow, chunk.signals[0].digital);
clamped;                       // Int32Array [ -100, -50, 50, 100 ]

toPhysical(narrow, clamped);   // now matches the clamping reader
```

Nothing on the read path calls it. It clamps to `[min(digMin, digMax), max(digMin, digMax)]`
rather than to `[digMin, digMax]`, because on an inverted declaration the naive bounds are an
empty interval that would collapse every sample onto a single value. Like the other allocating
primitives it takes an `out` array for reuse.

## Where to go next

- [Reading signals](/docs/reading-signals) — selecting channels and turning a time window into
  samples.
- [Large files](/docs/large-files) — what conversion costs in memory, and why the budget refuses
  before it allocates.
- [Validation](/docs/validation) — the conformance sweep, including the observed digital range of
  every signal across the whole file.
