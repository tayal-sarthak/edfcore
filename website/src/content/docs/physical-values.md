---
title: Physical values
description: Convert digital sample counts into the signal's own units with toPhysical, and handle the signals that have no usable scale.
section: "Guides"
order: 2
lead: A chunk hands you the integers the file stores. Turning those into microvolts is a separate call, because the conversion can fail. This page covers the scale, the three unit fields, and the conditions that leave a signal without a gain.
---

## `toPhysical`

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

There's no `{ physical: true }` option and no fused "read as physical" call. Conversion throws
for reasons the read cannot, so the two stay separate.

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

### Verified against pyEDFlib

Since 0.2.34 this is a measured claim rather than an argument. `scripts/golden/generate.py` writes
EDF and BDF fixtures with pyEDFlib's own writer, reads them back with pyEDFlib, and records every
physical sample as its exact IEEE-754 bit pattern; the test compares edfcore's output with
`Object.is`, so a one-ULP difference is a failure. Nothing in the golden files was produced by
edfcore.

Substituting the numerically better textbook expression fails it on 140 of 256 samples of the
symmetric fixture — for example `-492.15686274509807` where pyEDFlib says `-492.156862745098`.
That is the whole reason the EDFlib form is pinned, and it is now the reason a test gives.

Three harnesses, and they do not all claim the same strength:

| Harness | Claim | Strength |
|---|---|---|
| pyEDFlib physical values | edfcore reproduces them exactly | **bit for bit** |
| pyEDFlib annotation onsets | both place every event at the same time | exact, to the tick |
| MNE | edfcore agrees | 1e-12 relative, **not** bit-exact |

The MNE bound is weaker on purpose. MNE returns SI units, so a microvolt channel arrives divided by
1e6 and that division is lossy — the two cannot be bit-identical, and claiming otherwise would be
claiming something false.

The cases cover a symmetric range, an asymmetric one, 24-bit BDF, a negative amplifier gain, and
the coarsest and finest gains an 8-byte field can express. The negative-gain case is additionally
asserted against the file's own declaration — physical values must fall as digital values rise —
because a value comparison alone cannot catch a field swap that pyEDFlib made too.

See [`scripts/golden/README.md`](https://github.com/tayal-sarthak/edfcore/blob/main/scripts/golden/README.md)
to regenerate them.

### The EDFlib expression

The form above is EDFlib's, kept verbatim, so edfcore's float64 output can be compared bit for
bit against pyEDFlib and EDFlib rather than approximately. The textbook expression
`physicalMinimum + (digital - digitalMinimum) * gain` is numerically *better* (fewer operations
away from the endpoints, less cancellation). edfcore does not use it.

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
sample values (57 % of them). The largest disagreement is 8.5e-14 µV, which is 5.6e-12 of one
quantisation step. That's about eleven orders of magnitude below the smallest difference the
amplifier can express, so it's invisible in any measurement. It is visible in a golden-value
comparison, so a drift in the expression fails the comparison rather than rounding itself into
agreement.

> **Note**
> The cross-implementation harness exists as of 0.2.34-0.2.48, which is what makes "bit-identical
> to pyEDFlib" a measured claim rather than a design intent — see the paragraph forty lines above.
> Descriptions of EDFlib's behaviour elsewhere on this page that are NOT covered by that harness
> still come from edfcore's design notes rather than from a comparison run in this repository.

### Float64, always

The output is a `Float64Array`, and there's no `Float32` option. Float32 carries 24 significand
bits and a BDF sample is a 24-bit integer, so a scaled BDF sample doesn't fit. On a
−500..500 µV BDF channel the float32 rounding error reaches **0.26 of a quantisation step**,
a quarter of the smallest difference the amplifier can express.

If you need float32 for a GPU buffer, convert at the boundary where you can see the cost.

## Units

edfcore does not normalise units. It never turns microvolts into volts, millimetres of mercury
into pascals, or anything else. Three fields describe the unit:

| field | value for a `µV` channel | what it is |
|---|---|---|
| `signal.raw.physicalDimension` | `"µV      "` | the eight header bytes verbatim, padding included |
| `signal.physicalDimension` | `"µV"` | the same text with the EDF padding removed, nothing else changed |
| `signal.unit` | `"uV"` | normalised for comparison: every encoding of micro becomes `u` |

Display `physicalDimension`. Compare against `unit`. Micro has several spellings that all mean
the same thing (U+00B5 MICRO SIGN, U+03BC GREEK SMALL LETTER MU, and a raw `0xB5` header byte).
Latin-1 decodes that byte to the first of them. A reader that string-compares against `'uV'`
alone will reject files it should accept. `unit` collapses all of them to `u` and changes nothing
else: case stays meaningful, `mV` is not `MV`, and no unit is ever rewritten into another.

Converting is your call, and it's one line:

```ts
const microvolts = toPhysical(fp1, chunk.signals[0].digital);

if (fp1.unit !== 'uV') {
  throw new Error(`expected uV, got ${JSON.stringify(fp1.physicalDimension)}`);
}
const volts = Float64Array.from(microvolts, (v) => v * 1e-6);
```

Note the check. The factor you write is only correct if the unit is what you assumed, so assert
it on any file you didn't produce.

## Negative gain

A signal may declare `physicalMinimum > physicalMaximum`. That's how a negative amplifier gain is
written, and the EDF FAQ sanctions it. `bitValue` comes out negative and the map works as
written:

```ts
// physicalMinimum 500, physicalMaximum -500, over -32768..32767
inverted.scale;  // { bitValue: -0.015259021896696421, offset: 0.5 }

toPhysical(inverted, new Int32Array([-32768, 0, 32767]));
// Float64Array [ 500, -0.007629510948348211, -500 ]
```

edfcore never swaps the two fields. Swapping them flips the polarity of every sample in the
channel. A polarity-flipped EEG is a clinically wrong result that looks completely normal: the
traces still have the right amplitude, the right frequency content and the right artifacts.

`header.diagnostics` carries an `INVERTED_PHYSICAL_RANGE` entry at `info` severity naming the
signal, the raw bytes, the byte offset, and the spec clause. On a one-signal file it reads:

```
signal 0 "Inv" declares physicalMinimum 500 greater than physicalMaximum -500
(raw "500     " at byte offset 360). This is legal and encodes a negative amplifier gain
(EDF FAQ Q6), so bitValue comes out negative. Next: nothing to do — edfcore never swaps
the two, because a silent polarity flip is a clinically wrong result that looks normal.
```

### The declared range, in order

`physicalMinimum` is not the smaller of the two, and a viewer that reads the two fields in field
order gets an inverted y-axis on exactly the channels whose trace is also inverted — two errors
that cancel on screen while both are wrong.

```ts
import { physicalRangeOf } from 'edfcore';

physicalRangeOf(inverted);   // { low: -500, high: 500 }
```

This is the DECLARED envelope, not the observed one. Samples outside it exist — that is what
`outOfDigitalRangeCount` counts — and this function reads no samples. It is what a fixed axis or a
gain control should be built from. A bound that is not finite throws a `RangeError` rather than
returning a `NaN` axis that draws nothing and reports no error.

## Signals with no scale

`signal.scale` is `EdfScale | undefined`. `undefined` means edfcore found no usable way to
compute a gain, and `toPhysical` on such a signal throws `EdfScalingError`. The `| undefined` in
the type makes reading the gain without a check a compile error. It does not gate the
`toPhysical` call itself, which takes any `EdfSignal` and fails at runtime.

Four conditions produce it, checked in this order:

| `error.code` | condition | reason |
|---|---|---|
| `DEGENERATE_DIGITAL_RANGE` | `digitalMinimum === digitalMaximum` | the gain is a division by zero |
| `DEGENERATE_PHYSICAL_RANGE` | `physicalMinimum === physicalMaximum` | every sample would map to one value |
| `INVERTED_DIGITAL_RANGE` | `digitalMinimum > digitalMaximum` | no sanctioned meaning, unlike the physical case |
| `LOG_TRANSFORMED_CHANNEL` | `physicalDimension` is exactly `"Filtered"` | the samples are log-compressed, so a linear map is wrong by orders of magnitude |

The first is the most common header defect in practice. EDFlib substitutes a gain of 1 here and
returns ADC counts labelled as microvolts. edfcore sets `scale` to `undefined`.

`INVERTED_DIGITAL_RANGE` throws where `INVERTED_PHYSICAL_RANGE` is accepted. An inverted physical
range has a documented meaning; an inverted digital range does not. Nothing in the file says
whether the writer swapped two fields or inverted the samples.

`LOG_TRANSFORMED_CHANNEL` follows the EDF `edffloat` convention, where a physical dimension of
exactly `Filtered` marks a logarithmically transformed channel. edfcore detects it and leaves
`scale` undefined rather than applying an inverse transform it can't verify.

Each condition also appears in `header.diagnostics` at parse time, at `error` severity, with the
byte offset and the raw field text. You can report the problem before anyone calls `toPhysical`.

The **annotations channel** is the exception, and deliberately: `buildScale` is never run over it,
because its physical and digital fields describe nothing a caller may use and checking them would
report a defect about a number nobody may read. So it has no `scale` and no diagnostic. Calling
`toPhysical` on it throws `SCALE_UNAVAILABLE` saying so — that its bytes are EDF+ TAL text rather
than measurements — and points at `readAnnotations`. Until 0.3.22 it re-derived a cause from those
unused fields instead: a channel declaring `0`/`0` was refused with `DEGENERATE_PHYSICAL_RANGE`
asserting a header defect, and the conventional `-1`/`1` one was told "the header recorded the
reason", both sending the reader to a `header.diagnostics` entry that does not exist.

> **Note**
> A fifth, rarer condition exists: four finite fields whose *derived* pair is not usable, such as
> a physical range that underflows or overflows float64 against the digital range. The header
> reports it as `DEGENERATE_PHYSICAL_RANGE`. The error thrown later by `toPhysical` carries
> `SCALE_UNAVAILABLE`, because `toPhysical` re-derives the cause from the signal alone and can't
> re-derive this one.

### Digital data still works

A signal with no scale is still readable. Its samples are ordinary integers, and only their
interpretation in physical units is missing:

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
realm boundary (an iframe, a worker, two copies of the package in one dependency tree). It stops
working the day someone adds a web worker.

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

## Out-of-range samples

A file can contain samples outside the digital range its own header declares. edfcore decodes
them as they are and converts them as they are. It never clamps on read.

The count is taken in the same pass that decodes:

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
what the amplifier wrote. The header field is a claim about them that has turned out to be false,
so the count is the cue to go and look at the header.

For the whole file rather than one window's tally,
`validateRecording(recording, { scanSamples: true })` from `edfcore/validate` fills
`report.signalStats` with the observed digital minimum and maximum per signal. That call reads
every record. No window read does it for you.

The comparison uses `min` and `max` of the two declared bounds rather than the pair as written.
A file with an inverted digital range therefore does not report every sample as out of range.

### Reproducing a clamping reader

EDFlib clamps when it loads samples. `clampToDigitalRange` reproduces that behaviour as an
explicit, post-hoc step, for cross-validating edfcore's output against a reader that does:

```ts
import { clampToDigitalRange } from 'edfcore';

const clamped = clampToDigitalRange(narrow, chunk.signals[0].digital);
clamped;                       // Int32Array [ -100, -50, 50, 100 ]

toPhysical(narrow, clamped);   // now matches the clamping reader
```

Nothing on the read path calls it. It clamps to `[min(digMin, digMax), max(digMin, digMax)]`
rather than to `[digMin, digMax]`. On an inverted declaration the naive bounds are an empty
interval that collapses every sample onto a single value. Like the other allocating primitives,
it takes an `out` array for reuse.

## Where to go next

- [Reading signals](/docs/reading-signals): selecting channels and turning a time window into
  samples.
- [Large files](/docs/large-files): what conversion costs in memory, and the allocation budget.
- [Validation](/docs/validation): the conformance sweep, including the observed digital range of
  every signal across the whole file.
