---
title: Design decisions
description: Why edfcore is shaped the way it is, stated as the fourteen choices you'll notice while using it, each with its reason and what it costs you.
section: Background
order: 2
lead: Several things about this API look like omissions until you know what they are protecting against. This page states each decision, the failure it exists to prevent, and the price you pay for it.
---

## One rule underneath all of them

If edfcore cannot proceed without inventing something, it throws. If it can proceed, it records a
diagnostic on the result. There is no third category, nothing is written to the console, and no
option relaxes the first sentence.

Almost every decision below is that rule applied to a specific situation. Several of them impose
work on you. That work is the part that used to be wrong without anyone noticing.

## `decodeDigital` and `toPhysical`

`decodeDigital` returns an `Int32Array` of stored ADC counts. `toPhysical` returns a `Float64Array`
in the signal's own units. There is no `{ physical: true }` option.

```ts
import { toPhysical } from 'edfcore';

const digital = chunk.signals[0]!.digital;              // Int32Array
const microvolts = toPhysical(signal, digital);         // Float64Array
```

An option that changes a function's return type forces every caller into a union they then have to
narrow. It also makes the type of a variable depend on a value rather than on a call. Two names
cost nothing and read better at the call site. The second call can also *fail* where the first
cannot: `toPhysical` throws for some signals, and `decodeDigital` never does. They are not two
modes of one operation.

The cost: converting a whole recording means two arrays and two passes rather than one, and
`toPhysical` is where the allocation happens. Reuse an `out` array when that matters.
[Physical values](/docs/physical-values) covers the details.

## `readWindow` always returns an array

Even for a continuous file with no gaps, where the array always has exactly one element.

```ts
const chunks = await readWindow(recording, {
  startSeconds: 10,
  durationSeconds: 5,
  signalIndices: [0],
});
chunks.length;   // 1 on a continuous file; one per contiguous run on EDF+D
```

A varying return type (a bare chunk for the simple case, an array for the discontinuous one)
invites callers to write against the bare chunk. Most files are continuous, so that code passes
every test written against them. The first EDF+D recording to reach it produces a plot with a
ten-second gap closed up and no warning. A structural shape rather than a behavioural one handles
the discontinuous case by construction.

The cost: `const [chunk] = await readWindow(...)` in the common case. Under
`noUncheckedIndexedAccess` that `chunk` is possibly `undefined`, so you write a guard for a
situation that cannot happen on your file.

## The scaling expression is pinned

```text
bitValue = (physicalMaximum - physicalMinimum) / (digitalMaximum - digitalMinimum)
offset   = physicalMaximum / bitValue - digitalMaximum
physical = bitValue * (offset + digital)
```

The algebraically equivalent `physicalMinimum + (digital - digitalMinimum) * bitValue` is the
numerically better arrangement, and edfcore does not use it. The form above is EDFlib's exact
expression, kept verbatim so that edfcore's float64 output can be compared bit for bit against
EDFlib and pyEDFlib. The two forms disagree by around 9.3e-10 of a least significant bit, ten
orders of magnitude below the quantisation floor of any real amplifier. On an asymmetric range they
differ on a large fraction of samples by one unit in the last place. That's the difference between
"edfcore's numbers match the Python pipeline exactly" and "edfcore's numbers match to within
rounding".

Cross-validation is worth more than the last mantissa bit. A test asserts the literal expression so
that nobody rewrites it later.

The cost: you can't ask for the better-conditioned form. edfcore's values differ from MNE's in the
last bit, because MNE anchors on the physical minimum and converts to volts. Bit-equality with MNE
is a stated non-goal rather than an oversight.

> **Note**
> The harness that runs pyEDFlib and MNE over the same fixtures and *proves* parity was built in
> 0.2.34-0.2.48. [Physical values](/docs/physical-values) states exactly what it establishes and
> how strong each claim is.

## Dates and clock times

There is no `Date` anywhere in the API. EDF stores local time at the patient, with no timezone and
no offset field. A `Date` constructed from those digits applies the reader's zone without saying
so. The same file then decodes to a different instant on a laptop in Berlin and a server in UTC.
The error is largest at a DST boundary, which is a time of night sleep studies are full of.

```ts
import { formatStartTimeNaive } from 'edfcore';

recording.header.startTime.clock;          // { hour: 10, minute: 0, second: 0 }
recording.header.startTime.resolvedDate;   // { year: 2020, month: 1, day: 1 }
formatStartTimeNaive(recording.header.startTime);   // '2020-01-01T10:00:00.000'
```

`EdfCalendarDate` uses a 1-based month, not a JavaScript month index. The formatter emits no zone
designator, because there is none to emit.

The cost: if you need a `Date` you construct it yourself and take responsibility for the zone
you're asserting. `formatStartTimeNaive` exists so that formatting a start time doesn't mean
reintroducing the bug by hand.

## Event times are `bigint` ticks

Annotation onsets and durations are parsed digit by digit into exact 100-nanosecond ticks, never
through `parseFloat`. `TICKS_PER_SECOND` is `10000000n`.

```ts
annotation.onsetTicks;                     // 132500000n — exact
annotation.onsetSecondsFromHeaderStart;    // 13.25 — convenient, and lossy in general
```

Float equality on event times is how ERP alignment breaks without anyone noticing. Two onsets that
are the same instant on disk compare unequal after a round trip through a binary fraction. An
averaging window then lands one sample off for a subset of trials. Ticks make the comparison exact,
and the original digit string is kept on `onsetRaw` so nothing is lost even to the tick conversion.

The cost: `bigint` does not mix with `number` in arithmetic, does not survive `JSON.stringify`
without a replacer, and is slower per operation. The seconds fields are there for display and for
arithmetic where a float is fine. Don't use them for equality.

## `scale` is `undefined` rather than fabricated

Four header conditions make a linear conversion impossible or wrong. They are a degenerate digital
range (`digitalMinimum === digitalMaximum`, a division by zero), a degenerate physical range, an
inverted digital range, and a channel whose physical dimension is exactly `Filtered`. That last one
marks log-compressed values. A fifth condition catches a derived gain that is not a usable float64
number.

```ts
signal.scale;                        // undefined
toPhysical(signal, digital);         // throws EdfScalingError, code DEGENERATE_DIGITAL_RANGE
decodeDigital(header, bytes, records, signal.index);   // still works
```

The reference C implementation substitutes `bitvalue = 1; offset = 0` unconditionally in the
degenerate cases, and then returns raw ADC counts labelled with the signal's physical dimension.
Those numbers look like microvolts, plot like microvolts and are off by whatever the amplifier's
real gain was. Making `scale` optional in the type system means the compiler refuses to let you
read a gain that may not be there. The `toPhysical` call is not itself type-gated — it accepts
any `EdfSignal` and throws `EdfScalingError` when the scale is missing.

The cost: a file that another reader opens without complaint throws here, and you have to decide
what to do about a channel with no defined physical interpretation. The digital samples remain
available, which is usually the right answer.

## Out-of-range samples

A sample outside the declared digital range is returned as it was stored. edfcore counts them for
free during decode (`chunkSignal.outOfDigitalRangeCount`) and does not modify them.

The affine map extrapolates correctly past the declared range, so an out-of-range sample converts
to a physical value that is exactly what the amplifier reported. Clamping instead flat-tops real
peaks, and the resulting waveform looks like saturation that the hardware did not produce. A
non-zero count means the declared range is wrong, not that the samples are.

EDFlib clamps on read. Reproducing its output during cross-validation needs the same operation,
which ships as a separate pure function rather than as a read option:

```ts
import { clampToDigitalRange } from 'edfcore';

// signal declares digitalMinimum -2048, digitalMaximum 2047
clampToDigitalRange(signal, Int32Array.from([-5000, 0, 5000]));   // Int32Array [-2048, 0, 2047]
```

The cost: your downstream code sees values outside the range the header advertises, and a
fixed-scale renderer that trusts the header will draw outside its axes. Clamp explicitly if that's
what you want.

## Gaps

A window that spans a discontinuity comes back as two chunks. A window that falls entirely inside a
gap comes back as `[]`. Nothing is ever synthesised to bridge one, and there's no option to enable
it.

```ts
chunks[0]!.startSeconds;                       // 0
chunks[1]!.startSeconds;                       // 13
chunks[1]!.precededByGap!.durationSeconds;     // 10
```

Zero-filling a gap produces a flat line that is indistinguishable from a real isoelectric period,
and interpolating produces a plausible signal that no electrode recorded. Either one turns a
structural fact about the recording into data. The gap is reported on the chunk that follows it, so
a renderer can draw the discontinuity as a discontinuity.

The cost: you can't hand `readWindow` output straight to a fixed-length plotting buffer. You
iterate chunks and place each at its own `startSeconds`.
[Discontinuous recordings](/docs/discontinuous) works through it.

## The unit of I/O

Every read takes a `RecordRange` (start plus count, never start plus end), and `signalIndices` has
no "all signals" default.

Because a data record interleaves every channel, the bytes for one channel over a window are small
pieces separated by everything the other channels contributed. There's no cheap single-channel
read in this format. The only choice is between many tiny requests and one contiguous one. edfcore
issues one contiguous read per range, de-interleaves in memory, and reports what the read actually
cost:

```ts
chunk.byteOffset;                  // where the read started
chunk.byteLength;                  // bytes that actually left the source
chunk.signals[0]!.sampleCount;     // what you asked for
```

Two things follow. Name every channel you want in one call, because the second channel from the
same records is free. Prefer wider windows to more requests. `signalIndices` is required so that a
256-channel file is never read whole because an argument was left out.

The cost: chunks are record-aligned and usually wider than the window you asked for, so a
sample-exact result takes a second step. `trimToWindow` does that arithmetic in exact integers
rather than leaving you to write `Math.round(t * rate)`.
[Reading signals](/docs/reading-signals) and [Large files](/docs/large-files) cover both.

## `strict` is the only mode

One boolean. With `strict: true`, the first would-be diagnostic throws `EdfFormatError` carrying
it, so a file that has one comes back as a rejection rather than as a header with a list. `info`
codes are exempt and are still collected — they explain something the file got right, and
`DATE_CLIPPED_TO_1985_2084` is carried by nearly every conforming EDF file. Without `strict`,
diagnostics accumulate on the result that produced them. Check order is pinned in the parser and asserted by a test, so which
error a broken file reports stays stable across refactors.

Two states are exhaustively testable. A third mode, or a per-code severity map, is a configuration
space you can only sample. A per-code override would also re-enable exactly the tolerant behaviour
the one rule above rules out.

The cost: you can't say "treat `DATE_CLIPPED_TO_1985_2084` as fatal but tolerate everything else".
You either collect diagnostics and decide yourself, which is the intended path, or you reject at
the first one. Note that the always-fatal codes throw either way: no version block, a signal count
outside 1..9999, a comma used as a decimal separator, record onsets that go backwards.
[Diagnostics and errors](/docs/diagnostics) lists them.

## Zero runtime dependencies, permanently

`edfcore` imports nothing. `edfcore/node` imports `node:fs/promises` and nothing else.

The two most-used JavaScript EDF paths both depend transitively on a package that has not been
published since March 2018. An unmaintained transitive dependency attached to a file parser is a
supply-chain surface, not only a maintenance question. Having no dependencies also forces
`types: []` and `lib: ["ES2022"]` in the build. That keeps DOM and Node types out of the published
`.d.ts`, and lets the same declarations serve a browser bundle and a server.

The cost: whatever a dependency would have brought is not here. No CLI, no CSV export, no plotting.
edfcore is a file-format library, and [Installation](/docs/installation) lists exactly what each of
the three entry points contains.

## ESM and three subpaths

`edfcore`, `edfcore/node` and `edfcore/validate`, each resolving to one universal build. The
exports map contains no `browser`/`node`/`worker` conditions.

Conditional exports are the single largest source of "works in Vitest, breaks in the bundler"
reports in the modern ecosystem. A dual CJS/ESM build is worse: two copies of `EdfFormatError` end
up loaded, and every `instanceof` check across the boundary returns false. Subpath resolution is
the one mechanism every runtime and bundler agrees on. There is no top-level `await` anywhere in
the module graph, which is what makes `require()` of this package safe on Node 22.12 and later.

The cost: Node below 22.12 cannot `require()` it, and a build pipeline that only emits CJS needs a
bundler step. `isEdfError(value)` and `error.edfErrorKind` exist so that error discrimination
doesn't depend on `instanceof`, even when two copies do end up in one tree. Across a worker or
iframe boundary, `instanceof` fails regardless of packaging.

## Pure TypeScript

Decoding a sample is one sign-extension and one multiply-add. The loop is memory-bandwidth-bound,
and a viewer-sized read is sub-millisecond. A WASM core would add a toolchain to every
contribution. It would also add a 4 GiB linear-memory ceiling, which a 13 GiB BDF file exceeds, and
a copy across the module boundary. That copy defeats the point of handing out views into buffers
you already have. JavaScript numbers are IEEE-754 float64 already, so bit-parity with pyEDFlib is
achievable natively.

The cost: a large full-file sweep is bounded by what a JIT-compiled scalar loop can do, with no
SIMD. This library targets random access into a big file rather than batch conversion of a corpus.
On that workload the limiting factor has been the I/O.

## Read-only through 1.0

edfcore does not write EDF, and will not before 1.0. A writer exists in the test suite and is not
exported.

Reading tolerantly and writing correctly are asymmetric commitments. A reader has to decide what a
wrong file means. A writer has to decide what a *right* file is, and every one of those decisions
becomes normative for everything downstream of it. A subtly non-conformant writer produces files
that this library reads back perfectly and other tools reject.

The cost: round-tripping (anonymising a header, trimming a recording, merging two files) needs
another tool. pyEDFlib and EDFlib both write EDF.

## What this adds up to

Most of these decisions move work from the library to you. Two calls instead of one, an array
instead of a chunk, a guard instead of a fabricated gain, a `bigint` instead of a float. In each
case the work is small and the thing it replaces was a wrong answer that looked right.

The [validation](/docs/validation) page covers the one place edfcore does more than parse: a
full-file conformance sweep, and why that lives behind its own entry point rather than on the open
path.
