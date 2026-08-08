# Changelog

Notable changes per release. Fixes say what was wrong and what it cost, because a version number
alone does not tell you whether you were affected.

edfcore is pre-1.0. Patch releases have carried behaviour changes where the old behaviour was a
defect; those are called out below.

## 0.3.25

- **Fixed** a TAL duration that is out of range being reported as a grammar violation. `9223372036855`
  seconds is about 292,000 years — past the ±2^63 tick range — and its thirteen digits are perfectly
  conformant. edfcore told the writer the field *"is not 1\*DIGIT [ \".\" 1\*DIGIT ]"* and
  volunteered *"a duration is never signed"*. Hexdump the region and you find thirteen unsigned
  digits and no sign, and conclude the parser is broken.
- The two conditions were folded into one branch. **The onset path has always kept them apart** —
  grammar failure and int64 overflow have separate messages there — so the identical defect on the
  two fields of one TAL produced two explanations that contradicted each other. The duration branch
  now mirrors the onset one.
- The TAL is still dropped and the annotation is still lost; only the explanation becomes true. A
  duration that really is malformed — a signed one, say — still gets the grammar message, and the
  "never signed" hint is the right one there.

## 0.3.24

- **Fixed** `MISSING_EDFPLUS_MARKER` telling a BDF writer to put `"EDF+C"` or `"EDF+D"` in the
  reserved field. Both the message and `expected` named EDF's markers for both families. Following
  that advice produces a NEW warning: `detectVariant` treats the version block as the only reliable
  discriminator, so a BDF file whose reserved field says `EDF+C` is reported as
  `NONSTANDARD_RESERVED_FIELD` — *"declares EDF+C but the version block says this file is BDF"*.
  edfcore was advising something it then complained about. It now names the file's own family:
  `BDF+C`/`BDF+D` for BDF, `EDF+C`/`EDF+D` for EDF.
- **Fixed** the same diagnostic's byte range pointing somewhere other than the field it names.
  `field` was `reserved`, but `byteOffset` was the annotation signal's LABEL offset, `byteLength`
  was the label's 16-byte width, and `raw` was the label text — while the prose in the very same
  diagnostic said "in the reserved field at offset 192". One diagnostic, two different locations,
  and a hexdump following the structured one lands on the wrong bytes. All three now describe the
  reserved field, and `raw` carries its own 44 bytes as evidence.
- The message also called the channel "an EDF+ annotations channel" on a BDF file.

**Correction to 0.3.23.** The comment shipped there said a probe under `tests/scratch/` could still
be "run by naming it directly". That is false — vitest applies `exclude` even to an explicit
filename filter, so the exclusion made probes unrunnable rather than merely un-collected. Added
`vitest.scratch.config.ts` and `npm run test:scratch`, and corrected the comment. Repository only.

## 0.3.23

- **Repository only; the published package is byte-identical to 0.3.22.** `tests/scratch/` is
  excluded from the vitest `include` and the tsconfig `include`.
- That directory holds throwaway reproductions written while chasing a defect, and `.gitignore`
  already excluded it with the reason: they "assert whatever behaviour was current when they were
  written, so committing them pins defects". Not committing them was not enough. An uncommitted
  probe still sat inside the `tests/**` glob and the tsconfig `include`, so it joined the suite and
  the typecheck — and `npm run check` is what `scripts/release.mjs` runs before it tags. A leftover
  probe could fail a release, or pass one, on the strength of a file nobody meant to keep.
- Found while running two adversarial sweeps whose agents write probes there: a stale probe from
  one broke the typecheck of an unrelated release. A probe is now only ever run by naming it.

## 0.3.22

- **Fixed** `toPhysical` inventing a header defect when called on an annotations channel.
  `parseSignalHeaders` deliberately never runs `buildScale` over one — its physical and digital
  fields describe nothing a caller may use, and checking them "would report a defect about a number
  nobody may use" — so such a signal has no scale AND no diagnostic. `describeScalingFailure` was
  applied to it anyway, re-running the four data-signal tests over those unused fields and
  confidently naming a cause the header never evaluated.
- A channel declaring `0`/`0` was refused with **`DEGENERATE_PHYSICAL_RANGE`**, a message asserting
  a header defect. The conventional `-1`/`1` one was refused with `SCALE_UNAVAILABLE` and the words
  *"the header recorded the reason rather than the signal"*. Both sent the caller to a
  `header.diagnostics` entry that does not exist, and neither ever said the actual reason.
- It now says what the channel is: its bytes are EDF+ TAL text rather than measurements, so no
  scale was ever built for it. `describeScalingFailure` only ever names a cause `buildScale`
  actually evaluated, which is what its own comment promises.
- The next step changed too. Every other scaling failure ends "decodeDigital() still works on this
  signal", which is true for a data signal whose ranges are unusable and **false here** — decoding
  TAL text as samples produces numbers that look exactly like a signal, the one failure this
  package exists to prevent. For the annotations channel it points at `readAnnotations` instead.
- `physical-values.md` said "Each condition also appears in `header.diagnostics` at parse time".
  That was false for every annotations channel; the exception is now written down beside the rule.

## 0.3.21

- **Fixed** a non-finite `maxMaterializeBytes` producing two different wrong diagnoses, neither
  naming the argument that was wrong. `Number(process.env.EDF_BUDGET)` on an unset variable is
  `NaN`, `ReadOptions` types the field as `number`, and every comparison against `NaN` is false —
  so the guards did not fire and the failure surfaced elsewhere:
  - `readWindow` and `readAnnotations` refused **every** read with an `EdfBudgetError` reporting a
    *"NaN-byte maxMaterializeBytes budget"* and advising the caller to "read fewer records per
    call" — advice no record count can satisfy.
  - `validateRecording` and `buildRecordIndex` sized their scan chunks from it, so `chunkRecords`
    became `NaN` and the failure arrived as an `EdfRangeError` about
    `records { start: 0, count: NaN }`, telling the caller to "clamp the range against
    `header.recordCount`" — a range neither function accepts as a parameter.
- The option is now resolved once, in `src/options.ts`, and all four call sites go through it. A
  bad value is a plain `RangeError` naming `options.maxMaterializeBytes` and pointing at the
  expression that produced it. A negative budget is refused by name too, rather than refusing every
  read that follows.
- **`requireFiniteOption` was written for exactly this class in 0.1.3** — for `cachedSource`'s
  `blockBytes`/`maxBytes` and `httpSource`'s `maxConcurrency` — and its own comment describes the
  failure verbatim: *"guards written as `if (value < 1)` simply do not fire"*. It was never applied
  to `maxMaterializeBytes`, the one option that reaches four modules across four layers. It has
  moved to `src/options.ts` so every layer can reach it; a guard only one caller applies is not a
  guard.
- A real budget still behaves exactly as before, in both directions, and omitting it still means
  the 256 MiB default. That is asserted, because a fix that disabled the budget would look
  identical in the messages above.

## 0.3.20

- **Fixed** `byteSource` refusing an `ArrayBuffer` that crossed a realm boundary — an iframe, an
  Electron contextBridge, jsdom, a Node `vm` context. The guard tested `bytes instanceof
  ArrayBuffer`, which is false for a buffer created in another realm, so a real, fully usable
  552-byte file was rejected.
- The message made it worse twice over. `describe()` had no buffer branch, so it called the
  ArrayBuffer **"a plain object"** — pointing the reader at the wrong problem entirely — and then
  advised them to "pass ... the ArrayBuffer itself", which is exactly what they had done. Nothing
  in it suggested the workaround that does work, `new Uint8Array(thatBuffer)`.
- **This was the last realm-unsafe `instanceof` on a cross-realm value in the package**, and it sat
  twelve lines above the comment explaining why `instanceof` is wrong here, beside `isByteArray`,
  which was rewritten off `instanceof` in 0.2.23 for this exact reason. The `SharedArrayBuffer`
  half of the same expression already used the built-in tag. So a cross-realm `Uint8Array` was
  accepted while the buffer behind it was not.
- Both halves now test `Object.prototype.toString`, which reads `Symbol.toStringTag` off the buffer
  prototype and is a value every realm agrees on. It admits nothing new: a plain object, an Array,
  a string and a number all report a different tag, and `Int8Array` is still refused for the
  documented reason. `describe()` names buffers, so any future refusal says what it actually got.

## 0.3.19

**Two places where content was dropped under a diagnostic saying it was not.** Both are annotation
data going missing quietly, which is the failure this package exists to refuse.

- **Fixed** a timekeeping TAL carrying a duration AND text being classified as harmless. A writer
  that merges a scored epoch into the timekeeping TAL writes
  `+onset 0x15 30 0x14 Sleep stage W 0x14 0x14 0x00`, and every one of those epochs is dropped.
  edfcore reported **one** diagnostic, naming record 0, blaming the duration field, and ending
  "nothing was lost". Remove the duration from the same file and it correctly emitted six, each
  naming the event it lost — so adding a duration turned six loud reports into one misleading one.
  `timekeepingDefect` returns at the first matching branch and asked about the benign duration
  before the destructive text; the text check now comes first, and a stray duration is mentioned
  inside that same message.
- 0.2.33 fixed the same swallowing by splitting the once-per-call flag between the two kinds and
  left the check ORDER alone. Its test builds a merged TAL with text and no duration, so the
  combination was never exercised. Both fixtures now live in that file.
- **Fixed** `TAL_MALFORMED` collapsing nine structurally different defects onto one report.
  Their dispositions are opposites: a 0x15 inside a text run and a missing onset sign KEEP the TAL,
  while a bad onset, an over-long field, an out-of-range onset, a bad duration and an unterminated
  timestamp DISCARD it. Whichever came first in a region won the `detail`, the offset and the raw
  bytes, so a region holding one of each reported *"the text was kept verbatim"* with occurrences 2
  while an annotation had in fact been thrown away — and reversing the two TALs produced the
  mirror-image lie. `TalIssue.detail` promises to state "what was wrong AND what was done about it".
- The issue log is keyed on the defect KIND rather than the code, from a closed set of twelve. Not
  on the `detail` string: several details interpolate the bytes they found, so keying on those
  would be unbounded — and bounding the per-region issue count is the whole reason the collapsing
  exists. Many occurrences of the same defect still collapse to one entry with a count.

## 0.3.18

- **Fixed** `inspectEdf` discarding every diagnostic the parse had already found when a fatal check
  stopped it. A three-signal EDF+ file with a degenerate physical range, a degenerate digital range
  and a duplicated label, and no annotations channel, returned exactly ONE entry:
  `EDFPLUS_WITHOUT_ANNOTATION_SIGNAL`. The three real defects were found, recorded, and thrown away
  with the sink.
- It matters most in this call, because triaging unknown files is the whole job of it — and the
  fatal is often the least informative of the set. None of those three has anything to do with
  annotations, so the reader adds an annotations channel, re-runs, and only then learns the file
  has three more problems. The documented contract said "everything found, including the fatal one
  when parsing failed"; it was one thing.
- **Added** `EdfFormatError.collected` — the diagnostics already in hand when the fatal was raised,
  in the order they were found, empty when it was raised before any collection existed. A caller
  who catches rather than inspects sees them too.
- The mechanism is a `fatal()` on `DiagnosticSink`, so a fatal thrown where a sink EXISTS carries
  what the sink has. `fatalError` stays the sinkless version for the paths that genuinely have
  nothing to attach. `sink.report` does the same when a code is always fatal or `strict` is set,
  so both routes are covered rather than the five call sites that happened to be found.
- The fatal is reported LAST, after what led up to it: it is the reason parsing stopped, and a
  reader going down the list arrives at it in the order the parse did.

## 0.3.17

**`formatHeader` printed `00:00:00` for a starttime the file never stated.** The module's own
promise, two paragraphs into the file and repeated in the published docs, is that a field edfcore
could not resolve prints as `unknown` rather than as a plausible default. The date half honoured it
and was pinned by a test. The clock half did not.

- A blank starttime field, a `23.59.60`, and a file that genuinely started at midnight all rendered
  the identical line `start        2019-03-11 00:00:00 (local, no timezone)`. Midnight is the most
  believable start there is for a sleep study, so nothing in the string was a cue — in the one
  output this package exists to have pasted into a bug report.
- **Added** `EdfStartTime.clockSource: 'headerField' | 'none'`, the counterpart of the existing
  `dateSource`. `EdfClockTime` admits no absent clock, so `clock` is still a substituted midnight;
  this is how to tell that from a real one, and library consumers get the same signal `formatHeader`
  now uses.
- **Changed** `formatStartTimeNaive` to return `undefined` when the clock was refused, as it
  already did for a refused date. It was returning `2019-03-11T00:00:00.000` for a file whose
  starttime field says `23.59.60` — a wall-clock instant nothing in the file supports, from the one
  function whose entire job is to report that instant. `api-errors.md` already told readers this
  was the behaviour; now it is.
- **Corrected three published claims about `DATE_UNPARSEABLE`.** It is emitted for a refused
  startdate AND for a refused starttime, and `diagnostic.field` says which. The docs described only
  the first: `validation.md` said it "means the file has no calendar date at all", `api-validate.md`
  mapped it to `dateSource === 'none'`, and `api-errors.md` said `startTime.clock` "is still exact"
  under it — which is exactly false in the case that motivated this release.

## 0.3.16

- **Fixed** `formatHeader` printing the patient and recording identification fields raw under
  `includePatientId`, so a file could forge lines in the summary describing it. Both are 80
  arbitrary bytes. A newline in the patient field opened a row matching the signal table's shape
  exactly — `  0  99 signals · 0 records` — and one in the recording field forged
  `record       9 s` at the left margin, contradicting the real geometry three lines above it.
- **0.3.2 swept this class through five outputs and missed these two.** Both lines are off by
  default, so nothing exercised them: the test written for that release built a hostile file and
  never asked for the fields that are hidden unless requested. The case now lives in
  `tests/unit/hostile-text.test.ts` beside the rest of the class, which is where the next one
  should be found rather than discovered.
- Control characters are replaced with `.`, exactly as for every other field. `header.patient.raw`
  and `header.recording.raw` still hold the bytes as written.

## 0.3.15

- **Fixed** `validateRecording` reporting a different set of diagnostics depending on how large its
  scan chunks were. On an EDF+C file with a real gap — the single most likely thing a conformance
  sweep is pointed at — one 60-record file produced **1, 2, 4, 7, 16 or 31** occurrences of
  `START_OFFSET_OUT_OF_RANGE`, varying nothing but `maxMaterializeBytes`. None of them described
  the file. Each named a chunk boundary the caller never chose, and the report's "by code" block —
  which exists to show which code affects most of the file — ranked them first.
- `traverse` states the broken invariant two lines above the call that broke it: *"The origin is
  the recording's, so the sweep's verdict does not depend on its chunk size."*
- Same root cause as 0.3.14, in the other direction. Record 0's offset was resolved from
  `startOffsetTicks` only, so the three callers that pass `originTicks` instead — the validation
  sweep, the index scan and the envelope fold — re-derived it from whichever record their chunk
  began on, and a chunk starting after a gap derives a value outside [0, 1). The two names are one
  quantity and each now falls back to the other, so all three are fixed at the derivation rather
  than at the call sites that happened to be found.
- **A record 0 offset that really is out of range is still reported, and still exactly once** — it
  comes from the open-time timeline probe, which the sweep folds in. That is asserted, because a
  fix that silenced the genuine check would look identical in the counts above.

## 0.3.14

- **Fixed** `readAnnotations` deriving the onset of a record with no timekeeping TAL from an origin
  of zero instead of the recording's start. On a file that declares a sub-second start offset, the
  same record reported one start time read alone and another read alongside a neighbour that did
  carry a TAL: record 5 of a 0.25 s-offset file came back at **5.00 s** on its own and **5.25 s**
  in a whole-file read. Every other decode path agreed on 5.25 s.
- That is the 0.1.4 failure verbatim — "the same record reported two different start times
  depending on how many neighbours were read with it" — surviving on one path. It is the seventh
  place this project has found it and the eighth fix for the shape.
- The cause was two option names for one quantity. `DecodeAnnotationsOptions.originTicks` feeds the
  record-onset grid and `startOffsetTicks` feeds the annotation rebasing; both are documented as
  "pass `timeline.startOffsetTicks`", and neither fell back to the other. `readAnnotations` passed
  only the second — so the one public function whose docs say it "passes `timeline.startOffsetTicks`
  for you" was the one that did not supply this origin. `originTicks` now falls back to
  `startOffsetTicks`, which fixes any direct `decodeAnnotations` caller that passes one and not the
  other, rather than only the call site that happened to be found.
- A file with no start offset is unaffected, because the two origins coincide at zero. That is why
  this survived: it is invisible on every file that does not bother to state its offset, and wrong
  only on the ones careful enough to.

## 0.3.13

- **Fixed** `readTriggers` carrying its running trigger state across a gap, so a code held before
  and after a discontinuity was reported once and read as one continuous epoch. A BDF+D file with
  code 5 asserted, a five-minute hole, and code 5 asserted again returned a SINGLE event at 0 s. A
  consumer differencing consecutive events measured a 308-second trigger epoch out of eight seconds
  of recording, and nothing in the returned array said a gap had happened.
- The old reasoning was that a code held over a gap should not be reported twice. It is not the
  same observation twice: the records between two segments do not exist, so what the trigger did in
  between is unknown, and staying silent asserted that it did nothing. A gap is a left edge, and
  the first in-window sample of every contiguous run now produces an event carrying the code in
  force there — the same rule the window's own left edge has followed since 0.2.19.
- **Added** `EdfTriggerEvent.precededByGap`, the same `EdfGap` an `EdfChunk` carries and meaning
  the same thing. Set on the first event of each run, so a resume is distinguishable from a latch
  the hardware actually made; `undefined` elsewhere, and always `undefined` on a probed index.
- **A contiguous file resolves to one run, so nothing about it changes** — same events, same times,
  one left edge. This is the last function in the package that returned a flat array spanning a
  discontinuity; `readWindow` splits at one, `mergeChunks` refuses to join across one, and
  `EdfChunk.precededByGap` has always reported one.

## 0.3.12

- **Fixed** `error.name` becoming a mangled identifier in any minified consumer bundle. Every
  edfcore error took its name from `new.target.name`, which reads `Function.prototype.name` — and
  a minifier rewrites `class EdfFormatError` to `class t`, so the name follows it. Bundled with
  `esbuild --minify`, `new EdfFormatError(...).name` came out as `"t"`.
- That is exactly the build where it matters. `error.name` is what a consumer branches on in a
  browser, `api-errors.md` states the value, and the package's own test asserts it — but the suite
  runs against unminified source, so it could not see this. Each class now assigns its name as a
  string literal.
- The guard renames the class binding with `Object.defineProperty(cls, 'name', …)` before
  constructing, which is an exact simulation of the rewrite: `Function.prototype.name` is the one
  property `new.target.name` reads. Verified separately against a real `esbuild --minify` bundle
  of `dist/`; the test needs no bundler, and edfcore keeps its five dev dependencies.
- `new.target.name` remains in the abstract base as the fallback for a consumer who subclasses
  `EdfError` themselves. Nothing else changed: `edfErrorKind` is still the supported discriminator,
  because `instanceof` is false across a realm boundary and a name is not a type.

## 0.3.11

- **Changed** `formatHeader` to stop calling the declared coverage the "duration" on a file that
  says it has gaps. `recordCount * recordDuration` is what the records COVER; on an EDF+D or BDF+D
  file the recording reaches further by whatever the gaps add up to. A four-record file with an
  hour-long hole in it printed `duration 00:00:04` for a recording spanning 3604 s — and this
  string exists to be pasted into a bug report, where it reads as "a 4-second file".
- The line is now labelled `covered` on those files, with two lines under it saying that the gaps
  are not in the number and that `buildRecordIndex(recording)` is what reports the span and where
  the gaps are. Continuous files are untouched and still say `duration`.
- The number itself has not changed and was never wrong; only its name was. A header ALONE cannot
  report the span — that is the last record's onset minus the first's, and those live in the
  timekeeping TALs, which `formatHeader` has never read. Saying which of the two quantities is on
  screen is the whole fix, and it is the same fix 0.3.0 made to the sample-grid function names.

## 0.3.10

- **Changed** `toPhysicalEnvelope` to return `NaN` for a bucket no sample landed in, instead of a
  number that looks like a measurement.
- `EdfEnvelopeSignal.min` and `.max` are `Int32Array`s, so there is no sentinel available outside
  the sample range and an empty bucket carries a digital `0` with `counts[i] === 0` beside it to
  say so. In digital units a stray `0` at least reads as nothing. Through the affine transform it
  stops reading as nothing: `bitValue * (offset + 0)` is `bitValue * offset`, which is mid-scale
  for any channel whose declared range is not centred on zero. A channel declared 0..1000 over a
  full signed 16-bit range converts an empty bucket to **500.008** — dead centre, and
  indistinguishable from a real reading.
- A viewer that plots `min`/`max` without consulting `counts` therefore drew a flat, plausible
  trace across a hole in the recording. That is believable garbage, which this package's own fuzz
  invariant says it never returns.
- `counts` is unchanged and is still the authoritative answer to how many samples a bucket holds.
  A caller already checking it sees no difference; one that was not now gets a value no plotting
  library will draw and no reader will mistake for data.
- The digital envelope is unchanged for the reason above — an `Int32Array` cannot hold `NaN` — so
  `readEnvelope`, `readEnvelopeAtResolution` and `envelopeOfSamples` return exactly what they did.

## 0.3.9

- **Fixed** `readEnvelopeAtResolution` delivering a different bucket width in each chunk of one
  call. Asked for 30 s per bucket over a window covering a 100 s run and a 60 s run, it returned
  four buckets of **25 s** for the first and two of **30 s** for the second. Widths that disagree
  cannot go on one axis, which is the entire reason this function exists apart from `readEnvelope`.
- 0.2.31 fixed half of this. It made the bucket COUNT come from each run's own span instead of once
  from the window, which was necessary and not sufficient: the fold still divided each run evenly
  into that count, so the width went on following the run whenever its span was not a whole
  multiple of the request. The 25 s above is 100 s divided by four.
- The bucket a sample lands in is now decided by WHEN it is — `floor(elapsed / secondsPerBucket)`,
  in exact integer arithmetic on ticks and sample positions. The last bucket of a run is therefore
  short by whatever the division left over, which is the "sliver" this function's own documentation
  described from the start and did not produce. Its `counts` entry says how short.
- `chunk.secondsPerBucket` is the width the buckets actually have, so for this function it is now
  the width that was requested, for every chunk. It was `durationSeconds / bucketCount`, which is
  only the width when the run divides evenly — the same wrong number, reported.
- `readEnvelope` is unchanged. Its contract is `buckets`, a plot's pixel width, and dividing the
  run evenly into that count is exactly right; the two rules are now distinct in the code.
- Boundaries are precomputed once per signal per run, so the per-sample loop advances a cursor
  rather than dividing. It does not reset at a chunk boundary: chunking bounds memory and must
  never move a sample between buckets, and the test for that reads a file large enough to force
  more than one chunk with the boundary falling inside a bucket rather than on its edge.

## 0.3.8

**0.3.7 claimed the exactness work "closes the set". It did not.** An audit of every public type
found four more, and this ships them.

`EdfLocation` gains `recordStartTicks` and `offsetInRecordTicks`. `EdfTimeline` gains
`recordDurationTicks`. `EdfEnvelopeChunk` gains `startTicks` and `durationTicks`, and
`EdfEnvelopeSignal` gains `startTicks`. Additive throughout.

Every one of those values was already exact where it was produced — `index.locate` computes both of
its numbers in ticks and converts them at the return, and so does `reduceRange` — and the missing
`recordDurationTicks` had a real consequence: `resolveTimeWindow` takes no header, so it carried a
helper that rounded `recordDurationSeconds` back with `secondsToTicks` and a comment arguing the
trip was exact for anything a header can declare. The argument was fine. Not needing it is better,
and the helper is gone.

**Why the claim was wrong.** It was made from memory rather than from a check, at the end of three
releases that each fixed the type in front of it. `tests/integration/exact-time-fields.test.ts` is
the check that should have come first: it reads `src/types.ts` and fails when a reported type
declares a `*Seconds` field with no `*Ticks` counterpart. It found `EdfTimeline.recordDurationTicks`
and `EdfEnvelopeSignal.startTicks`, neither of which was on the list this release started from.

Two kinds of exemption are written down rather than assumed, and a third assertion checks that each
listed name still exists — an exemption for a type nobody has is an exemption nobody reads.

- SELECTION types (`WindowSelection`, `TriggerSelection`, `EdfAnnotationWindow` and the rest) take
  seconds from a caller. `secondsToTicks` rounds a caller's bound to the nearest tick by design, so
  nothing exact is being discarded on the way in.
- `EdfStartTime.secondsSinceMidnight` is a wall clock, whole seconds by construction, and
  `EdfEnvelopeChunk.secondsPerBucket` is a resolution rather than an instant — a bucket boundary is
  a rational that generally falls between ticks, so a tick counterpart would round and be less true
  than the float.
- `EdfAnnotation.onsetSecondsFromHeaderStart` has its counterpart under the older name `onsetTicks`.
  The value has always been there; only the two names disagree. Renaming a shipped public field to
  satisfy a test would be the test dictating the API, so the alias is recorded instead.

## 0.3.7

**`EdfChunk` gains `startTicks` and `durationTicks`, `EdfChunkSignal` gains `startTicks`, and the
two functions that were rounding those values back out of the seconds stop.** Additive.

The third and last type where an exact value was computed and thrown away, and the one where the
cost was written down in the source. `trimToWindow` carried this comment:

> The chunk's own start is a float only because `EdfChunkSignal` publishes seconds; it was produced
> from exact ticks by `ticksToSeconds`, and rounding back to the nearest tick recovers them for any
> recording shorter than ~28.5 years.

`mergeChunks` did the same round trip on two values and added them, so a tick lost in either
produced a refusal naming a discontinuity of 1e-7 s between chunks that are genuinely adjacent.

**The bound is not the interesting part.** A trimmed signal does not start on a tick: sample `j`
sits at `chunkStart + j * recordDuration / samplesPerRecord`, and 3 s records of 256 samples — a
real geometry, and the one this package's own comments cite for why `sampleRateHz` is never used in
a boundary — put a sample every 117187.5 ticks. Rounding those seconds back moves the grid origin
to the wrong side of the sample, on an ordinary file, at ordinary times. `startTicks` is the tick
the sample is already running in, floored, and `startSeconds` keeps the remainder; the two together
are the exact rational, and `trimToWindow` now reads the tick instead of guessing it back.

`mergeChunks` also derives the merged span from the ends in ticks and converts once, rather than
performing three float operations on three already-converted numbers. It still refuses two chunks
that are record-adjacent but a tick apart in time — that check is the reason the round trip existed,
and it is now made on the values themselves.

That closes the set: `EdfTimeline` (0.3.4), `EdfSegment` and `EdfGap` (0.3.6), `EdfChunk` and
`EdfChunkSignal` (0.3.7). Every time edfcore reports is now available exactly, and no internal
comparison recovers a tick by rounding a float.

## 0.3.6

**`EdfSegment` and `EdfGap` carry their exact ticks, and `segmentAt` and `gapAt` decide boundaries
on them.** Additive: `EdfSegment` gains `durationTicks` and `endTicks`, `EdfGap` gains `startTicks`,
`endTicks` and `durationTicks`. Nothing is removed or renamed.

The same shape as 0.3.4, in the other two time-bearing types. `buildSegmentation` computed every
one of these exactly — it kept a private `SegmentBounds` array of tick values purely so gaps would
not have to re-derive them — and then converted them away at the return. `EdfSegment` shipped
`startTicks` and no matching end.

**Why it is not only tidiness.** `segmentAt` and `gapAt` are binary searches, and their comparison
was `seconds < segment.startSeconds` against float64 bounds. `sampleAt` picks a segment through
`segmentAt` and then measures the offset from `segment.startTicks` — a boundary resolved in one
unit feeding arithmetic done in another. Both searches now compare tick to tick, so the instant
that lands on a boundary lands on the same side of it for every function that asks.

A gap is now read straight off the two segments it joins, rather than from a parallel array, so
there is one derivation of a boundary in the module instead of two that must agree.

For a consumer: `durationTicks` is the field to sum to total the time a recording lost. Summing
`durationSeconds` accumulates error and was the only way to ask before this. The sign still carries
the meaning 0.2.69 pinned — negative is an overlap, not a gap — and `endTicks < startTicks` now says
so exactly.

## 0.3.5

- **Fixed** `readEnvelopeAtResolution` returning a bucket width that is not the one asked for. It
  computed a run's length as `records.count * recordDurationSeconds`, a float64 product that lands
  just ABOVE the true value as readily as below: 3 x 0.1 s is 0.30000000000000004, so a 0.3 s run
  at 0.1 s per bucket ceiled to FOUR buckets. The extra bucket is not empty — the samples are
  spread across whatever count is asked for — so every bucket came out 0.075 s wide.
- That is the failure this function exists to prevent, reached by a second route. 0.2.31 fixed it
  for a run being narrower than the window; this is the same wrong width with no gap, no chunking
  and no window offset involved, on a contiguous file whose record duration is not a binary
  fraction. A caller asking for a fixed 0.1 s so two runs share an axis got neither the resolution
  it requested nor the same one in both.
- The record count is an integer and the record duration is exact in ticks, so the run length and
  the bucket width are computed there and divided with `ceilDiv`. The 0.2.5 ceiling rule is
  unchanged: 40 s at 30 s per bucket is still two buckets, never one.
- A `secondsPerBucket` below one 100 ns tick has no whole-tick answer. The limit of that request is
  one bucket per tick, so that is what it gets, and `reduceRange`'s existing clamp to one bucket
  per sample still applies — no new refusal.
- `floorDiv` and `ceilDiv` now live in `src/tal/ticks.ts` instead of in private copies in three
  modules. Same four lines, one home; every caller is dividing a tick count by a tick count.

## 0.3.4

**`EdfTimeline` gains `spanTicks` and `coveredTicks`, and edfcore's contiguity check moves off
float64.** Additive: no field is removed or renamed.

Both values were already computed exactly. `buildTimelineFromProbes` derives them in bigint — last
record end minus first record start, against the sum of the record durations — and then discarded
them at the return, keeping only the `ticksToSeconds` conversions. `startOffsetTicks` sits right
beside `startOffsetSeconds`; these two were the pair that did not get the same treatment, and they
are the pair edfcore asks its most consequential question of.

**What it cost.** Two different tick counts round to one float once an ulp of the span exceeds a
tick — from roughly 4 × 10⁸ seconds, which `recordDuration` reaches in three ASCII bytes, since
that field is free-form and accepts exponent notation. `resolveTimeWindow` and `sampleAt` both
decided "is this file contiguous" on the converted seconds, so on such a file:

- `resolveTimeWindow` returned one range covering every record, where it is documented to REFUSE —
  a probed index cannot say where the records after a gap begin.
- `sampleAt` answered `record 9, sample 36` for an instant that lies inside the gap, while
  `buildRecordIndex` on the same recording reports **two segments and one gap** and `sampleAt`
  against that index correctly returns `undefined`.

Two functions disagreeing about one file, which is how every instance of this project's recurring
timebase defect has surfaced. The reproduction is in `tests/integration/extreme-geometry.test.ts`,
and it asserts the premise — that the two seconds compare equal — so the test cannot quietly stop
testing anything.

The `RangeError` from `resolveTimeWindow` now states both tick counts. Its existing sentence quotes
the seconds, and on exactly the files this fixes, those two print identically.

Equality still means only what TWO PROBES can see. A gap that an overlap elsewhere cancels exactly
leaves both ends where a contiguous file would put them; `buildRecordIndex()` reads every onset and
is the only thing that rules it out. That was true before this change and is unaffected by it.

## 0.3.3

- **Fixed** `edfcore gaps` counting an overlap as a gap. An overlap travels in `index.gaps` with a
  NEGATIVE duration — 0.2.69 documented that and pinned it — and this command called every entry a
  gap, so a file with one gap and one overlap printed `2 gap(s) in 6 records`. Someone sweeping a
  directory for discontinuities got a count that silently included the opposite condition. A gap is
  time no record covers; an overlap is one instant two records both claim.
- **Fixed** the duration printing as `+-1s`. The `+` was hardcoded on the assumption that a gap
  duration is never negative. The value now carries its own sign.
- The kind — `gap` or `overlap` — is a fourth column, APPENDED, so `cut -f3` still reads a
  duration and no existing column moves. The same rule 0.2.42 followed when `signals` gained
  `samplesPerRecord`.
- The interval still prints as the gap reports it, which for an overlap runs backwards
  (`3s..2s`): from where the earlier segment ends to where the later one had already started. With
  the kind named beside it, that reads as what it is instead of as a corrupt line.
- Exit code unchanged at 0. This command reports and does not gate; `edfcore validate` is the gate
  and already exits 1 on an overlap through `RECORD_ONSET_SPACING_VIOLATION`.

## 0.3.2

**No output edfcore produces can be given a row, a column or a diagnostic by the file it is
describing.** `formatHeader` was fixed for this in 0.2.67; the other five outputs were not, and
this is the class.

Every string edfcore prints that it did not write itself came out of a file. A label is 16
arbitrary bytes and the specification says nothing about what may be in them; EDF+ annotation text
is exposed verbatim, because the TAL grammar reserves 0x00, 0x14 and 0x15 and nothing else, so 0x0a
and 0x09 reach `annotation.text` unchanged.

- **`formatValidationReport`** printed the label raw in its sample-range block. A newline opened a
  row reporting an observed range for a signal the file does not contain — in a conformance report,
  which is read precisely because the file is already suspect.
- **`formatAnnotations`** printed the text raw. A newline split one event into two rows, and the
  second carried no time of its own, so it read as an event at the time above it.
- **`formatDiagnostics`** printed `expected:` and `actual:` raw, and `actual` is usually the
  field's bytes as written. Unlike `message`, whose continuation lines are indented, a detail line
  is emitted whole — so a newline reached the left margin, where a line is indistinguishable from a
  diagnostic edfcore itself reported. A label could forge
  `error [NOTHING_IS_WRONG] this file is fine` into the report about it. Found by the test written
  for the two above.
- **`edfcore signals` and `edfcore events --list`** are tab-separated on purpose — the format
  exists for `cut` and `awk`. A tab in a label added a field for one row, so column 6 returned a
  physical dimension where a script expected a sample count, with no error and only on the file
  that had the problem.

Control characters are REPLACED with `.`, one character for one, never stripped and never escaped:
stripping changes a padded column's width, and a two-character `\n` is wrong in a fixed-width cell.
Only C0 and DEL are touched — a latin-1 letter above 0x7f is an ordinary character in an electrode
label written on a European system. `header.signals[i].raw.label` and `annotation.text` still hold
the bytes as written; only the rendering changed.

`tests/unit/hostile-text.test.ts` is the guard, and it covers every output in one file so the next
one is added there rather than discovered.

## 0.3.1

- **Fixed** `declaredDurationSeconds` returning a length up to a whole second short. It computed
  `recordCount * recordDurationSeconds` in float64, and a record duration with no exact binary
  representation makes that product land just under the true value: 100 records of 0.29 s is
  exactly 29 s and multiplies out to 28.999999999999996, which floors to 28. Both inputs are exact
  — an integer count and a tick-valued duration — so the product is now computed in ticks and
  converted once.
- This is the same defect `formatHeader`'s duration line was fixed for in **0.2.67**, and it was
  found the way this project keeps finding things: two functions disagreeing about one file. The
  header line printed `00:00:29` while `declaredDurationSeconds` returned a number that floors to
  28. The fix there left a comment naming `recordCount * recordDurationSeconds` as the wrong way to
  do it, and the one function still doing it was three modules away.

## 0.3.0

**One rename. No behaviour change, anywhere.**

| 0.2 | 0.3 |
|---|---|
| `sampleIndexAt` | `gridSampleIndexAt` |
| `sampleStartTicks` | `gridSampleStartTicks` |
| `sampleStartSeconds` | `gridSampleStartSeconds` |

Same arguments, same return values, same rounding. Marked `@deprecated` in 0.2.62, a release ahead
of the change, so an editor pointed at the replacement before it landed.
[Migrating to 0.3](https://edfcore.vercel.app/docs/migrating-to-0-3) has the find-and-replace.

### Why a rename earns a minor bump

These functions measure the signal's own SAMPLE GRID: sample `n` is the `n`th sample the file
stores, at `n * recordDuration / samplesPerRecord`. On a contiguous recording that is also elapsed
recording time and the two ideas are the same number — which is exactly why the difference kept
escaping. On a discontinuous file they part company by the gaps.

This project has now shipped **seven** fixes for one defect: a function deriving a time from the
nominal grid while every other function used the record's true onset. `readTriggers` reported a
stimulus latched at 10 s as 2 s (0.2.18). `filterAnnotationsByTime` put events in the neighbouring
window (0.2.10). `mergeChunks` could not see a gap (0.2.19). `readAnnotations` answered on the
header axis for a partial range (0.2.28). And `sampleAt` — added in 0.2.61 to FIX this class —
shipped with the seventh instance and was fixed in 0.2.68.

Every one was found because two functions disagreed, never because one looked wrong on its own.
The functions renamed here were not wrong at all; their names simply did not say which of two
quantities they returned. `gridSampleStartSeconds` cannot be called in the belief that it returns
elapsed recording time, and that is the whole fix.

They are not deprecated in favour of nothing. They remain the right tool when you have a signal and
no recording, which is why they take no index. For a file that may have gaps, use `sampleAt`,
`sampleStartTicksOf` and `sampleStartSecondsOf`, added in 0.2.61.

### Not changing

No other export is removed or renamed. The three entry points, the error hierarchy, the
`ByteSource` contract and every diagnostic code are untouched.

## 0.2.69

- **Documented and pinned** how an overlap is reported, after investigating whether it was reported
  at all. It is: `EdfGap.durationSeconds` goes NEGATIVE, and `validateRecording` turns that into
  `RECORD_ONSET_SPACING_VIOLATION` naming the segments. No new shape, no missing diagnostic — I
  checked before changing anything, and there was nothing to fix.
- What was missing is that none of it was written down. Two consequences now are: summing gap
  durations to get "time lost" is right only if you expect a negative term, and where two segments
  cover the same instant `segmentAt` and `sampleAt` return one of them because more than one sample
  genuinely exists there.
- Also pinned that a PROBED index sees none of this when a gap and an overlap cancel exactly — net
  drift is zero, the file opens with no diagnostic, and `contiguityOf` answers `'unknown'`. That is
  the honest answer and precisely why `buildRecordIndex` exists; the docs say so three times and
  now a test does too.

## 0.2.68

Two defects in `sample-locate.ts`, both introduced by me in 0.2.61 and found by an adversarial
sweep of it seven releases later.

- **Fixed** `sampleAt` consulting the net-drift check before the scanned index. `spanSeconds !==
  coveredSeconds` is what TWO PROBES can see, and this project's own documentation says three
  times that it is not a proof of contiguity: a gap that an overlap elsewhere cancels exactly
  leaves span equal to coverage. On such a file — which opens with no diagnostic at all —
  `sampleAt` took the nominal branch while a complete index sat on the same object reporting two
  gaps, and returned a sample one whole record away from the one `readWindow` reads. It also
  reported a sample inside a hole that `gapAt`, `segmentAt`, `index.locate` and `readWindow` all
  report as empty. `resolveTimeWindow` has always had this precedence right; this module inverted
  it. **The seventh instance of the defect this project has spent six releases on, and the first
  one I introduced myself.**
- **Fixed** the discontinuous branch being unbounded. `segmentAt` compares float seconds and the
  arithmetic after it compares exact ticks, so a time within half a tick of a segment end is inside
  the segment for one and past it for the other: it named record 6 and sample 24 of a six-record,
  24-sample file. `sampleStartTicksOf` had the matching hole — a sample index past the end fell
  through to the nominal grid and came back 6.75 s EARLIER than the last real sample. Both are now
  bounded, and the second refuses rather than answering.
- **Corrected** an over-claim in the 0.2.61 entry. It said the round-trip "the sample at a sample's
  start is that sample" was pinned "for every sample in the file". That is false when two records
  cover the same instant — repeated onsets, which EDF+ does not forbid — because two samples exist
  at that time and no function can return both. The claim holds for files whose records do not
  overlap. Now stated in the source and pinned by a test that uses a genuinely overlapping fixture.

## 0.2.67

Three defects in `formatHeader`, found by an adversarial sweep of the modules no earlier pass had
covered.

- **Fixed** the duration line losing a whole second. It computed `recordCount *
  recordDurationSeconds` in float64 and truncated, and a record duration with no exact binary form
  makes that product land just under the true value: 100 records of 0.29 s is exactly 29 s,
  computes as 28.999999999999996, and printed `00:00:28`. It is now computed from
  `recordDurationTicks`, which is exact. A genuine fraction still truncates rather than rounding —
  7 × 0.7 s is 4.9 and prints `00:00:04`, because rounding would name a time the file never reaches.
- **Fixed** control characters in a signal label being printed verbatim. EDF pads labels with
  spaces and says nothing about what else may be in them, so a writer can put a newline there and
  the label renders as TWO rows — forging a signal the file does not contain — while a tab shifts
  every column after it. They are replaced with a dot in the rendering only; `signal.raw.label`
  still holds the bytes.
- **Fixed** the diagnostic severity summary being ordered by arrival, so two files with the same
  diagnostics could summarise them differently. Now error-warning-info, matching
  `formatValidationReport` since 0.2.15 and sharing its counting.

## 0.2.66

- **Fixed** the changelog numbering, which had drifted a second time, and **fixed the cause** so it
  cannot drift a third.
- The mechanism, both times: the entry is written by hand before the release runs, against the
  version the author expects. When a release fails AFTER bumping — a lint error, a flaky test, an
  agent's scratch file in the tree — that number is consumed, the next run produces a different
  one, and every heading from there on inherits the drift. `0.2.29` and `0.2.36` went that way in
  the last round; `0.2.59` went that way in this one, consumed by its own coverage guard when a
  corpus file was added without regenerating its parity golden.
- `scripts/release.mjs` now refuses to release unless the top `## <version>` heading in
  CHANGELOG.md equals the version being tagged, and its message says what to do — including
  recording a skipped number as never released. One file read, and a silent documentation defect
  becomes a message before anything is committed.
- Headings `0.2.59` through `0.2.64` are shifted to the releases that actually carried them,
  verified against `git show <tag>:CHANGELOG.md` rather than reasoned about, and `0.2.59` is
  recorded as never released. Prose references in the README, the docs and one test are shifted to
  match.

## 0.2.65

- **Added** a migration guide for 0.3.0, published before the release rather than after it:
  [Migrating to 0.3](https://edfcore.vercel.app/docs/migrating-to-0-3). Three functions are
  renamed, nothing else changes, and no arithmetic changes.
- It says what a rename is worth a minor bump for. The grid functions were never wrong; their names
  simply did not say which of two quantities they returned, and six releases of this project were
  spent on that exact confusion elsewhere — a stimulus latched at 10 s reported as 2 s, events in
  the neighbouring window, a gap `mergeChunks` could not see. Each was found because two functions
  disagreed, not because one looked wrong. `gridSampleStartSeconds` cannot be called in the belief
  that it returns elapsed recording time.
- Includes the find-and-replace, with word boundaries, and a note on why: `sampleStartTicks` and
  `sampleStartTicksOf` are distinct names and a substring replace would damage the second.

## 0.2.64

- **Added** a test that drives essentially the whole public barrel over every corpus file — six
  files written by five pieces of software across twenty-one years — and asserts the results are
  mutually consistent. Deliberately broad and shallow, because it catches a class the deep
  single-function tests cannot: a function that is individually correct and disagrees with its
  neighbour, or one that is correct on the fixtures written for it and throws on the first real
  file with a zero record duration, a duplicate label, or no signals at all.
- **Documented**, because it found one: `segmentAt` returns `undefined` for EVERY time on a file
  whose record duration is zero. That is correct rather than a defect — records then occupy no
  time, so each segment's half-open interval is empty and no instant is inside one — but it was
  nowhere written down, and the sleep-edfx hypnogram is a real file of exactly that shape. Now
  stated in the source, in the docs, and pinned by the test that found it.

## 0.2.63

- **Added** `formatAnnotations`, the third formatter beside `formatHeader` and
  `formatDiagnostics`, and the one a hypnogram or an event list actually needs.
- The clock is built from `onsetTicksFromFirstRecord` by integer division, never from the float
  seconds. An event list is exactly where someone reads a number off the screen and types it into
  something else, and a millisecond field derived from a float64 that came out of a division by
  10,000,000 can be off by one. A test makes the two fields disagree deliberately, so only a
  formatter reading the exact one passes.
- Hours are not wrapped at 24 — a 30-hour recording is real, and `30:12` is more useful than
  `06:12` on day two. Times truncate to the millisecond rather than rounding, so the printed
  instant is never later than the event. A NEGATIVE onset prints as one: EDF+ measures onsets from
  the header start time, a recording may begin after its first annotation, and clamping to zero
  would silently move it.

## 0.2.62

- **Deprecated** `sampleIndexAt`, `sampleStartTicks` and `sampleStartSeconds`, which are renamed
  to `gridSampleIndexAt`, `gridSampleStartTicks` and `gridSampleStartSeconds` in **0.3.0**. The
  behaviour does not change and neither do the arguments — only the name, which never said which of
  two different quantities it returns. Six releases of this project were spent on exactly that
  confusion elsewhere, and the `grid` prefix is what stops the seventh.
- The tag is folded into each function's existing documentation rather than added as a second
  comment above it, so an editor shows the original prose AND the replacement instead of replacing
  one with the other.
- Nothing is removed here. An editor will point at the replacement a release before the rename
  lands, and for a contiguous file the rename is the only thing that affects a caller.

## 0.2.61

- **Added** `sampleAt`, `sampleStartTicksOf` and `sampleStartSecondsOf` — the recording-aware
  counterpart to the sample-grid family, and the groundwork for 0.3.0.
- 0.2.32 documented why the existing three cannot be fixed in place: they take
  `(signal, value, recordDurationTicks)`, so a gap is not in their arguments and no arithmetic
  inside them could find one. These take the RECORDING. On a contiguous file they agree with the
  grid functions exactly — asserted sample by sample — and on a discontinuous one they differ by
  the gaps.
- `sampleAt` can return **`undefined`**, which is the answer the grid form structurally cannot
  give: no sample exists at that instant, because it falls in a gap, before the recording, or after
  it. `sampleIndexAt(signal, 5, d)` on a six-record file with a hole at 5 s names record 5; there
  is no record 5 at that time.
- Both refuse a probed index on a file with gaps rather than guessing, the same rule `segmentAt`
  follows. A round-trip test pins the pair together across the gap: the sample at a sample's start
  is that sample, for every sample in the file.

## 0.2.60

- **Added** `calib.rec` from edfplus.info — the last corpus the README named. It was written by
  **Bob Kemp, who wrote the EDF specification**, expressly to check that a reader gets amplitude
  and POLARITY right, which makes it the closest thing this format has to a conformance test.
- It is the only fixture in the suite whose expected values come from neither edfcore nor another
  library, but from the file's own design. Its declared range is ±100 µV over ±4096 digital units,
  so the gain is 25/1024 — a small integer over a power of two, exactly representable in float64 —
  and the offset is exactly zero. Digital `-2048` is therefore exactly `-50 µV`, checkable from the
  header by hand, and every level in the file is asserted with no tolerance.
- The polarity assertions are the point. A reader that swapped the physical bounds returns the
  right magnitudes with the wrong sign — plausible microvolts that invert the clinical reading of
  the trace — so the extremes are asserted as signed values tied to the digital codes that produced
  them, not as an amplitude.
- I first wrote the gain up as "a power of two". It is not; log2 of it is -5.356. The corrected
  claim and a test pinning the distinction are both in the file, so nobody simplifies it back.
- The coverage guard added in 0.2.50 earned its place on the way: it failed this release because
  the new corpus file had no parity golden yet. That is exactly the drift it exists to catch, and
  it caught it before the release rather than after.

## 0.2.59

Never released. The 0.2.59 release run failed its own coverage guard — a corpus file had been added
without regenerating its parity golden — which consumed the number before a tag was cut. The
calibration-file work that carried this heading while it was being written shipped in `0.2.60`.

## 0.2.58

- **Added** CHB-MIT to the corpus, closing a gap the README has named since 0.1. It is chosen to be
  UNLIKE sleep-edfx rather than to add volume: 23 channels at a uniform 256 Hz in one-second
  records, recorded in 2010 at another institution on other equipment, against 7 channels at mixed
  rates in 30-second records from 1989. Every real file in this suite came from one dataset until
  now. Same bit-for-bit parity with pyEDFlib across all 23 channels.
- It also supplies something no fixture in this project had: **a montage that names one derivation
  twice.** `T8-P8` appears at index 14 and index 22, and the two carry identical samples — verified
  against pyEDFlib over the whole hour rather than assumed; I had written the test expecting them
  to differ. `EdfAmbiguousChannelError` had until now only ever been raised against a fixture
  written to raise it.
- That identity makes the refusal matter more, not less. If `getSignal` picked one arbitrarily, no
  comparison of the returned numbers could reveal which it picked, so a caller would never learn
  the question had two answers. The error is the only signal there is.
- Downloaded on demand under the Open Data Commons Attribution License v1.0, hash-verified, never
  redistributed — the same terms as every other corpus entry.

## 0.2.57

- **Documented** what the corpus work of 0.2.49-0.2.55 actually established. The README's
  interop section stopped at sample parity, which was the state at 0.2.48 and has not been the
  state since — annotation onsets, the zero-record-duration scoring file, the 1985-2084 year rule,
  faithful decimation over 7,950,000 samples, chunk-independence, the memory bound, streaming
  equivalence, HTTP random access costing under 64 KB for a window twelve hours into a 48 MB file,
  and `validate` exiting 0 on a real clinical recording were all verified and none of them were
  claimed. A reader deciding whether to trust this package should not have to reconstruct that
  from a changelog.
- Each row names how it is checked rather than only what it asserts, because "we test that" is the
  kind of claim this project has spent forty releases learning not to make without saying how.

## 0.2.56

- **Fixed** `tests/README.md`, which said "There are no binary fixtures in this repository" and
  listed Tier 2 of its own fixture policy as "Not used". Both stopped being true in 0.2.34, when
  the parity harness committed six small EDF/BDF files and their goldens — about 1.4 MB. I added
  those without revisiting the policy that forbade them.
- The policy is now stated as it actually is, with the reason: a parity fixture has to be bytes a
  DIFFERENT implementation wrote, so regenerating it in memory with this project's own writer
  would make the comparison circular and prove nothing. The licence rule is unchanged and was
  never at risk — the committed files are generated locally by pyEDFlib, the downloaded corpus is
  still gitignored, and only the JSON goldens reference it, by name and hash. None of it ships:
  the package contains `dist`, `src` and the changelog.

## 0.2.55

- **Added** CLI coverage against the real corpus. Every existing CLI fixture is a few hundred bytes
  written by this project, which checks the decisions — exit codes, flags, output shape — and
  cannot check what a command does when pointed at 48 MB of clinical recording, or at a scoring
  file with 154 events and a record duration of zero.
- The load-bearing one: **`edfcore validate` exits 0 on a real recording from a real sleep lab.**
  That is what makes the command usable as a CI gate at all; a validator that fails real files is
  worse than no validator, because it teaches people to ignore it.
- Also pins that the sleep-edfx PSG is plain **EDF, not EDF+** — it carries an `Event marker` data
  channel rather than an annotations channel, which is how that dataset splits signals from
  scoring. I had assumed EDF+ writing the test and the file said otherwise.

## 0.2.54

- **Added** the random-access claim, measured over HTTP on the real 48 MB recording. A `fetch`
  double serves byte ranges out of the file and counts what it hands over; reading a 30-second
  window twelve hours in costs **under 64 KB**, and opening the file costs under a five-hundredth
  of it. This is the property the whole package is built around, checked over the transport that
  makes it matter — a reader that has to download the file first cannot do it at all, and until now
  it was only demonstrated on fixtures small enough that the distinction did not exist.

## 0.2.53

- **Added** a check that `validateRecording`'s sample scan sees what pyEDFlib sees. The observed
  digital minimum and maximum are the only numbers in a validation report derived from every sample
  rather than from the header, so they are the ones worth checking against another reader — and a
  sampled window cannot check them, because the extremes of a 22-hour recording are very unlikely
  to fall inside the 256 samples the goldens record. The whole-signal extremes now come from
  pyEDFlib, across all five corpus files.
- Also pins `outOfDigitalRangeCount` against those extremes. It is a claim about the DECLARATION
  rather than about the samples — a non-zero count means the header's digital range is wrong, and
  edfcore never clamps — so recomputing whether any sample could be outside the declared bounds
  from pyEDFlib's own observations is the independent form of that check.

## 0.2.52

- **Added** streaming equivalence on the 22-hour recording. The documented claim is that a streamed
  chunk and a read chunk are the same object in every respect; on a 40-record fixture a chunking
  mistake often cancels out, and over 2,650 records it cannot. 7,950,000 samples are concatenated
  from 42 streamed chunks and compared element by element with a single `readWindow`, and no chunk
  is allowed to hold more than its own records.
- Also pins that streaming yields its first chunk after reading under one percent of a 48 MB file.
  Bounded memory is half the claim; not having to read the whole file before yielding anything is
  the other half, and a byte counter is the evidence.
- The comparison is a loop rather than `toEqual`. Deep equality over two 7.95-million-element typed
  arrays took 45 seconds and, on failure, printed a diff nobody could read; the loop takes under a
  second and names the first differing sample, which is the only part anyone would look at.

## 0.2.51

- **Added** the tests only a real, large recording can support, against the 22-hour sleep-edfx
  polysomnogram. Three claims edfcore advertises are invisible on a hundred-byte fixture:
  - **Envelope decimation is faithful.** 7,950,000 samples reduced to 1,000 buckets, compared with
    an EXHAUSTIVE reduction of every one of them — not a spot check. This is the case the feature
    exists for, and until now it was only demonstrated on 40 records.
  - **The bucket grid does not move with the read chunk size.** 265 chunks versus a handful. A fold
    that computed its bucket on the chunk's grid rather than the run's would diverge here and agree
    on a two-record fixture.
  - **Memory is bounded by the chunk, not the window.** The 22-hour envelope is produced under a
    512 KiB budget; materialising the window would need ~32 MB, so the budget makes the claim
    falsifiable rather than asserted.
- Also pins that a 100 Hz and a 1 Hz channel keep their own sample grids across the whole file,
  checked at the LAST 30 seconds — where a shared-grid error is largest, and nowhere else.
- **Fixed** an unnecessary biome suppression added in 0.2.50 that was itself the only warning in
  the tree.

## 0.2.50

- **Added** a corpus-coverage report that always runs. Every other test in `tests/corpus/` skips
  when the files are absent, which is right — a fresh clone must stay green and offline, and none
  of the corpus is redistributed. But a skipped test is indistinguishable from a passing one in a
  summary line, and the corpus is where this project's strongest claims live: `1487 passed` reads
  the same whether the bit-for-bit check against a 22-hour clinical recording ran or not. It now
  says which state the run is in, once, in a line a reader sees.
- It also checks the parts that need no corpus: every manifest entry names a source, a licence and
  a SHA-256, no committed golden refers to a file the manifest no longer lists, and every fetched
  file has a parity golden. A golden that has drifted from the corpus definition still looks like
  coverage, which is the failure this catches.

## 0.2.49

- **Added** annotation, start-date and geometry parity on the real corpus, alongside the sample
  parity added in 0.2.48. The richest case is the sleep-edfx hypnogram: **154 sleep stages on a
  file whose record duration is legally zero** — the case where `sampleRateHz` is `undefined` and
  every rate-derived expression yields `NaN`, so a reader that indexes by rate rather than by
  record cannot read it at all. edfcore finds the same 154 events at the same onsets with the same
  durations as pyEDFlib, and the epochs tile the night with no gap, checked against pyEDFlib's
  onsets rather than against edfcore's.
- Start dates too. The sleep-edfx files were recorded in 1989 and carry a two-digit year, so
  resolving them exercises the 1985-2084 pivot rule against a reader that implements it
  independently.
- No discrepancy was found. That is the result, and it is worth stating plainly rather than
  implying the sweep found something.

## 0.2.48

- **Added** bit-for-bit parity against pyEDFlib on the REAL corpus — the last thing the README
  withheld. A 22-hour clinical polysomnogram from sleep-edfx and the three teuniz generator files
  in EDF, EDF+ and 24-bit BDF+, compared with `Object.is` per sample.
- These files matter because nobody here chose them: they were written by other people's software
  and hardware, years ago. `corpus.test.ts` already read them, but it checked that the output was
  BELIEVABLE — a rectal temperature near 37 degrees, an 8.5 Hz channel oscillating at 8.5 Hz — and
  a check like that would pass for a reader that was slightly wrong everywhere, which is exactly
  the failure the pinned scaling expression exists to prevent. A test in the new file demonstrates
  that directly: on the PSG's temperature channel the textbook expression produces a believable
  body temperature for every sample AND disagrees with pyEDFlib, so the old check could not have
  told the two apart and the new one can.
- Sampled at the start, the middle and the END of each signal rather than whole files — the PSG
  alone is 48 MB. The end window is the one that earns its place: a reader whose record arithmetic
  drifts does so with distance from the start.
- Skips without the corpus, like every other test in that directory, so a fresh clone stays green
  and offline.

## 0.2.47

- **Fixed** this changelog. Every heading from `0.2.36` down to `0.2.45` named a version one lower
  than the release that actually shipped it: `0.2.36` was consumed by a release run that failed its
  typecheck after bumping the version, and I kept writing the next entry against the number I
  expected rather than the tag that got cut. So the `cachedSource` fix was labelled `0.2.36` and
  shipped in `0.2.37`, and everything after it was off by one — including the MNE claim in the
  README, which named `0.2.43` for work that is in `0.2.44`. Verified against the tags rather than
  reasoned about: `git show <tag>:CHANGELOG.md` for each. `0.2.36` is now listed as never released,
  the way `0.2.29` already was.

## 0.2.46

- **Added** `scripts/golden/README.md`: how to regenerate every parity fixture, and — more usefully
  — what each of the three harnesses actually claims and how strong that claim is. Bit-for-bit for
  pyEDFlib physical values, exact-to-the-tick for pyEDFlib annotation onsets, 1e-12 relative for
  MNE, with the reason the last one is weaker stated where someone would otherwise assume it was an
  oversight. Also records the rule for adding a case: pick where the two candidate expressions
  diverge or where a mistake would be least visible, and remember that a value comparison alone
  cannot catch a mistake both libraries make.
- **Documented** the same table on the physical-values page, so a reader who never opens the
  repository sees which claims are load-bearing and which are approximate.

## 0.2.45

- **Added** annotation parity against pyEDFlib — the other axis, and the one edfcore has got wrong
  most. The scaling harness checks arithmetic; this checks WHICH AXIS an onset is on. Six releases
  were variants of "one function used the nominal grid while the rest used the record's true
  onset", and every one was found by comparing edfcore against edfcore. The property test added in
  0.2.25 makes that internal agreement a hard invariant; this makes it an external one, which is a
  different kind of evidence — a shared misreading of the format satisfies the first and fails
  here. Onsets match to the tick, and edfcore reports no diagnostic at all on a file a reference
  writer produced.
- The generator refuses to record fewer annotations than it wrote. `writeAnnotation` silently drops
  an event that does not fit the region pyEDFlib sized, and the first run lost one — a golden file
  recorded from that would have made the parity test compare an incomplete set and pass while doing
  it.

## 0.2.44

- **Added** parity against MNE — a second, independent reader. pyEDFlib and edfcore both descend
  from EDFlib's arithmetic, so agreement between them shows edfcore copied it correctly rather than
  that the answer is right; MNE is a different implementation.
- The claim is deliberately WEAKER than the pyEDFlib one and says so. MNE returns SI units, so a
  microvolt channel arrives divided by 1e6 and that division is lossy — the two cannot be
  bit-identical, and asserting otherwise would be asserting something false. The bound is 1e-12
  relative, about a hundred times the worst observed and ten orders of magnitude below the
  quantisation step of any real recording. Bit-parity remains claimed for pyEDFlib alone.
- The bound is RELATIVE rather than an ULP count, which was the first instinct and is the wrong
  measure: near 1e-6 the same relative rounding spans far more representable floats than it does
  near 100, so an ULP bound tight enough to be meaningful at one magnitude is meaningless at the
  other. Channels MNE does not rescale — it leaves `degC` alone — are excluded rather than pushed
  through a factor that would make the comparison an artefact of the test.

## 0.2.43

- **Added** three cases to the pyEDFlib parity harness, chosen for where the two scaling
  expressions diverge most or where a mistake would be least visible:
  - **negative gain** (`physicalMinimum > physicalMaximum`, a legal EDF FAQ Q6 declaration). Parity
    alone would not catch a field swap that pyEDFlib also made, so the POLARITY is asserted against
    the file's own declaration too: physical values must fall as digital values rise, in both
    libraries. A silent polarity flip is a clinically wrong result that looks completely normal.
  - **a 16-step digital range** mapped to a 2000-unit physical one — the coarsest `bitValue` of the
    set.
  - **a full 16-bit range** mapped to one millivolt — the finest.

## 0.2.42

- **Added** a `samplesPerRecord` column to `edfcore signals`, and **fixed** the documentation,
  which claimed the command emitted it when it emitted `kind` instead. That left the authoritative
  field in no column at all: `sampleRateHz` is derived from `samplesPerRecord` and the record
  duration, and is empty for the legal zero-duration file a real sleep-staging recording relies on
  — so a listing meant for a script omitted the one number it could always index by, and sent the
  reader back to `json` for it. Appended rather than inserted, so nothing that parsed the first
  five columns by position moved. The full six-column list is now pinned by a test, not only
  described.

## 0.2.41

- **Added** the types `edfcore/validate`'s own signatures mention to that subpath's exports:
  `EdfHeader`, `EdfDiagnostic`, `EdfDiagnosticCode`, `EdfSeverity`, `EdfSignal`, `EdfRecordIndex`
  and `RecordRange`. The entry already re-exported the shapes it PRODUCES so a consumer could name
  a `ValidationReport` without reaching into the universal entry — but `validateHeader` takes an
  `EdfHeader` and returns `EdfDiagnostic[]`, and `FormatReportOptions.header` is an `EdfHeader`, so
  someone importing only this subpath could call every function in it and still not name the type
  of anything they passed or got back. A type-only test now pins the set, so it fails at
  `npm run typecheck` rather than in a consumer's project.

## 0.2.40

- **Added** tests pinning which date defect produces which diagnostic. `DATE_IMPLAUSIBLE` is
  documented as covering two conditions with only the second reachable, and that was prose about an
  INTERACTION between two modules: `resolveStartTime` refuses a date that names no real day and
  leaves `resolvedDate` undefined, so `validateRecording`'s start-date branch never sees one. Both
  sides are now asserted, so if the parser ever starts resolving a best-effort date instead of
  refusing, a test says so rather than the branch quietly coming to life while the docs claim it is
  dead. The branch itself is kept, with the reason written next to it — a missing guard is harder
  to notice than an idle one.

## 0.2.39

- **Fixed** `onsetSecondsFromFirstRecord` and `onsetTicksFromFirstRecord` disagreeing about the
  same event at the edge of the int64 tick range. The exact field saturated and the float field was
  computed from the unsaturated difference, so one annotation reported 1,844,674,407,370.955 s in
  one field and 922,337,203,685.4775 s in the other — a factor of two. My own inconsistency, added
  with the exact field in 0.2.10. Both are now derived from one rebased value, which is what the
  float field was always documented to be: the lossy view of the exact one.

## 0.2.38

- **Fixed** `fileHandleSource` and `fileSource` ignoring an abort signal that flipped while a read
  was in flight. The abort check ran at the top of each loop iteration, and the common case is one
  syscall that returns everything — so the check ran once, before it, and a caller who gave up
  during the read got the data anyway. `blobSource` has always re-checked after its await, with a
  test saying why; one adapter honouring a signal that another quietly ignores is worse than either
  rule alone.

## 0.2.37

- **Fixed** `cachedSource` repopulating itself after `close()`. A read already in flight when close
  was called still resolves, and its continuation still runs — after `blocks.clear()` — so the
  cache refilled itself after being closed and then served that data on later reads, from a source
  whose own `close` had already run. Admission is now refused once closed, so the cache stays empty
  and every later read is delegated to the wrapped source, which behaves exactly as it would
  without the wrapper.
- **Documented** why the oversized-read path returns the wrapped source's own array rather than a
  copy. It looks like a violation of the "a cache hands back a copy" rule and is not: that rule
  exists because a cache RETAINS its blocks, and a read wider than the whole budget bypasses the
  cache entirely and retains nothing. The path is exactly as safe as calling the wrapped source
  directly, which is what it does.

## 0.2.36

Never released. A release run failed its typecheck after bumping the version, which consumed the
number before a tag was cut — the same way `0.2.29` was lost earlier. The `cachedSource` fix that
carried this heading while it was being written shipped in `0.2.37`, and is listed there.

## 0.2.35

- **Fixed** `byteSource` building a source over an argument that is not bytes, so the caller's
  mistake was reported as a defect in the file. `new Uint8Array(x)` accepts almost anything: a
  string, a plain object and `null` all yield an empty array, and a `number[]` yields one of the
  wrong length. The source was constructed happily and the failure surfaced later as
  `[SOURCE_TOO_SMALL] the header is 0 bytes` — the file blamed for the argument, which is the one
  confusion this package works hardest to avoid. It now refuses at construction and says what it
  wanted. `Int8Array` is refused by name: one byte per element, so it passes every length check
  and then decodes to fabricated sample values.

## 0.2.34

- **Added** the golden-value harness this README has withheld a numerical-interop claim for since
  0.1.0. edfcore now **reproduces pyEDFlib's float64 physical values bit for bit** on EDF and
  24-bit BDF, across symmetric and asymmetric declared ranges. `scripts/golden/generate.py` writes
  the fixtures with pyEDFlib's own writer, reads them back with pyEDFlib, and records every sample
  as its exact IEEE-754 bit pattern; the test compares with `Object.is`, so one ULP is a failure.
  Nothing under `tests/corpus/golden/` was produced by edfcore, and the goldens are committed so
  CI never needs Python.

  Every previous test of the pinned scaling expression re-derived that same expression inside the
  test, which proved edfcore agrees with itself and nothing more. This is the first evidence that
  the choice to keep EDFlib's numerically worse form was worth making: substituting the textbook
  `physicalMinimum + (digital - digitalMinimum) * gain` fails on 140 of 256 samples of the
  symmetric fixture — `-492.15686274509807` where pyEDFlib says `-492.156862745098` — and a test
  asserts that the goldens can tell the two apart, so the parity is a real constraint rather than
  a coincidence of the fixtures.

  Still not claimed, because no test produces it yet: parity with MNE, and validation across the
  public corpora.

## 0.2.33

- **Fixed** annotations being dropped with no diagnostic naming them. `TIMEKEEPING_TAL_NONCONFORMANT`
  covers several unrelated defects behind one once-per-call flag. Most lose nothing — the onset is
  unambiguous either way — but a timekeeping TAL that carries TEXT has swallowed an annotation: the
  writer merged an event into it, and the text appears in no field of the result. Because the flag
  was shared, a file whose FIRST record used the widespread `+t 0x14 0x00` shorthand — which is most
  of the real corpus — reported that shorthand and then suppressed every dropped event after it. On
  a six-record fixture: two annotations gone, `annotations` empty, and one warning naming record 0
  and a different, harmless cause. `strict: true` did not help either; it threw on record 0's
  benign shorthand and never reached the real problem. The text-carrying kind is now reported for
  every affected record, with the text and the byte offset where it still is; the harmless kinds
  are still capped at one per call, and each message now says which of the two it is.

## 0.2.32

- **Documented, not fixed**, and the distinction is the point: `sampleIndexAt`, `sampleStartTicks`
  and `sampleStartSeconds` measure the signal's own SAMPLE GRID, which equals elapsed recording
  time only when the recording is contiguous. On a file with a seven-second hole,
  `sampleStartSeconds(signal, 12, d)` answers 3 s for a sample whose record truly begins at 10 s,
  and `sampleIndexAt(signal, 10, d)` names record 10 of a six-record file. This is the fifth
  instance the 0.2.25 property test found, and the one that cannot be fixed by arithmetic: the
  three take a signal, a number and a record duration — no index, no timeline — so a gap is not in
  their arguments and nothing inside them could find it. Changing that would mean changing their
  signatures, which is a 0.3 decision, not a patch. Until then the contract is stated in the source,
  in the docs and in the property test, which now pins both regimes: exact agreement with
  `readRecords` on a contiguous file, and the grid behaviour on a discontinuous one. `index.locate`,
  `segmentAt`/`gapAt` and `chunk.firstSampleIndex` are the recording-axis answers.

## 0.2.31

- **Fixed** `readEnvelopeAtResolution` not delivering the resolution it was asked for. A chunk
  covers one record-aligned contiguous run, and a run is not the window, but one bucket count was
  computed from the window and handed to every chunk. A window of 11 s over an EDF+D file asked at
  1 s per bucket came back as 0.27 s per bucket in one chunk and 0.09 s in the other — widths that
  are not commensurable, so a viewer could not place the two on one axis, which is the entire
  promise of the function. A contiguous window that did not start on a record boundary got 1.33 s
  per bucket for the same reason. The count is now derived from each run's own span; the ceil rule
  is unchanged, so the tail of a window is still never dropped.

### A note on version numbers

`0.2.29` was never released: a failed release run consumed the number before the tag was cut.
`0.2.26` has a git tag and a GitHub release but is **not on npm** — GitHub Actions was dropping
events and failing to acquire runners while these went out, and by the time 0.2.26 was retried npm
refused to tag it `latest` because 0.2.28 was already above it. Everything 0.2.26 fixed, including
the patient-identification leak, is present in 0.2.27 and every release after it; that was verified
against the published 0.2.27 tarball rather than assumed.

## 0.2.30

- **Fixed** `validateRecording({ scanSamples: true })` refusing a small file for a scratch buffer
  it could never fill. The buffer was sized from `chunkRecords` — a chunk size chosen from the
  record geometry, not from the file's length — so a four-record file was budgeted for a full
  chunk, and a 552-byte one demanded 8 MB and was refused under any budget below 8 MiB. That is
  the opposite of the failure the guard exists for. It is now clamped to the records that exist.
- **Changed**, as a consequence, what 0.1.3's fixture does. That file declares zero records and a
  `samplesPerRecord` of 99,999,999, and 0.1.3 fixed the resulting 400 MB allocation by REFUSING
  it. With the clamp the allocation is never demanded, so there is nothing to refuse and the scan
  simply reports zero records scanned. The invariant is unchanged and stronger — a 512-byte file
  still never causes a large allocation — but it is now enforced by not allocating rather than by
  throwing, so the two tests that pinned the budget error now pin success. A new case pins the
  refusal for a file whose records really do exist and really are too big, so the guard is still
  covered.

## 0.2.28

- **Fixed** `readAnnotations` answering on the header's axis for any record range that does not
  start at record 0, on a file that declares a sub-second start offset. The rebasing origin was
  derived from the first observed onset, which only works while the records in between are
  contiguous — on an EDF+D file the derivation lands outside `[0, 1)` and the rebasing switches off
  entirely. So the same annotation read 10 s from a whole-file decode and 10.25 s from a partial
  one, while `readWindow` reported the record starting at 10 s either way. The pairing the docs
  recommend, `readAnnotations(recording, chunk.records)` beside a `readWindow`, is exactly the call
  that hit it. Sixth instance of the nominal-grid defect, and the first one the 0.2.25 property
  test caught rather than a user.
- **Added** `DecodeAnnotationsOptions.startOffsetTicks`. The offset is a property of the file, not
  of the range; `readAnnotations` passes `timeline.startOffsetTicks` for you, and a direct
  `decodeAnnotations` call on a partial range should pass it too.

## 0.2.27

Three defects in one place: the CLI's argument handling did not match its own documented exit-code
contract, which is the part a CI job depends on without parsing output.

- **Fixed** bad usage exiting 1 instead of the documented 2. `parseArgs` threw a plain `RangeError`
  that `cli.ts` caught alongside every other failure, so `--limit all` was indistinguishable from a
  corrupt recording to the job gating on it. Usage mistakes now throw `CliUsageError`, which
  extends `RangeError` so anyone already catching that keeps working.
- **Fixed** an unknown option being ignored. A misspelled `--patinet` was dropped silently, so the
  command printed the patient identification the caller was trying to withhold, and exited 0.
- **Fixed** extra positional arguments being dropped. `edfcore validate *.edf` validated whichever
  file the shell expanded first, exited 0, and said nothing about the rest — a green CI gate for
  files that were never opened. It now refuses and names them, and suggests the shell loop.
- **Fixed** `npx edfcore --help` exiting 2. `parseArgs` never puts a dash-prefixed argument in the
  command slot, so `runCli`'s `command === '--help'` branch was unreachable and help fell through
  to "no command". `--help` and `-h` are now flags, handled beside `--version`, and exit 0.

## 0.2.26

- **Fixed** `edfcore header` and `edfcore validate` printing the full local patient identification
  without `--patient`. Withholding it from the summary was never enough on its own: a diagnostic
  names the raw bytes as written — that is the message contract and what makes a report
  actionable — so a NON-CONFORMANT identification field had its whole content printed in the
  diagnostics block directly underneath the line that had just withheld it. `header` printed the
  name three times and `validate` six. The trigger is not exotic: a writer that packs the name into
  one token fails the EDF+ four-subfield grammar, and a file that behaves oddly is exactly the one
  someone runs this on and pastes into an issue tracker — which is the whole reason the flag
  exists. Recording identification, which carries technician and investigation codes, leaked the
  same way.
- **Added** `redactFields` to `FormatDiagnosticsOptions` and `FormatReportOptions`. The diagnostic
  still reports its code, severity, byte offset, rule and next step; only the value is replaced,
  and `rawBytes` is dropped outright because a hex dump with an ASCII column redacts nothing.
  Diagnostics about every other field are untouched — a signal-label or numeric-field diagnostic
  keeps its raw bytes, since that is what makes it actionable and none of it identifies anyone.

## 0.2.25

- **Added** a property test pinning the ONE timebase invariant across every public function that
  reports a time, against a single EDF+D fixture whose true onsets are known independently of
  edfcore. Four releases — 0.1.4, 0.2.10, 0.2.18, 0.2.19 — were the same defect wearing different
  clothes: a function deriving a time from the nominal `recordIndex * recordDuration` grid while
  the rest of the package used the record's true onset. Fixing them one at a time did not stop the
  next one, because a contiguous fixture agrees with both rules and every test used one.
  `index.onsetTicks`, `index.segments`, `index.locate`, `readRecords`, `readWindow`,
  `streamRecords`, `readEnvelope`, `readEnvelopeAtResolution`, `segmentAt`, `gapAt`,
  `readAnnotations` and `filterAnnotationsByTime` are now all asserted against the same fixture,
  plus a second file with a sub-second start offset.
- **Found**, by running it: a fifth instance. `sampleIndexAt`, `sampleStartTicks` and
  `sampleStartSeconds` are all on the nominal grid — `sampleStartSeconds(signal, 12, d)` answers
  3 s for a sample that starts at 10 s, and `sampleIndexAt(signal, 10, d)` returns record 10 of a
  six-record file. They take no index and so cannot see a gap from their arguments, which makes it
  a signature problem rather than an arithmetic one; the fix is the next release, and the property
  test says out loud that they are not yet covered.

## 0.2.24

- **Changed** `envelopeOfSamples` to bound its reduction by `sampleCount` rather than by
  `digital.length`. This is a consistency change, NOT a bug fix, and the difference is worth
  stating: it was reported as a leak of edfcore's reusable decode buffer, and that leak does not
  exist — `decodeDigital` narrows an oversized reused buffer with `subarray` before it escapes, and
  every internal producer sets `sampleCount` from `digital.length`, so no read path could ever hand
  this a padded array. What was real is that `mergeChunks` and `trimToWindow` both treat
  `sampleCount` as authoritative on a caller-built `EdfChunkSignal` and this one did not. Two
  helpers defending and one not is the worst of the three states.

## 0.2.23

One hardening pass over `io/`. Both are cases where a guard that looked total was not.

- **Fixed** `httpSource` accepting a `206 Partial Content` without checking WHICH bytes it carried.
  The only guard was `assertExactRead`, which compares lengths, so a server answering `bytes=8-11`
  with the bytes of `bytes 0-3` passed — four bytes were asked for and four arrived. The
  `Content-Range` header, which RFC 7233 makes mandatory on a 206 precisely as the check against
  this, was never parsed. The result is the worst shape a data bug can take: the samples decode
  cleanly, land at the timestamps the caller asked for, and are the wrong seconds of the recording.
  The usual cause is a cache, Service Worker or CDN edge keyed on the URL without the `Range`
  header. A 206 that reports no `Content-Range` at all is still accepted, so a hand-written
  `FetchLike` double that answers `null` for every header keeps working.
- **Fixed** the `ByteSource` contract guard reading `.length` off whatever it was handed, while its
  own error message promised to detect "a value that is not a byte array". The quiet case is a
  one-byte view of the wrong signedness: `Int8Array` passes any length check, and `decodeInt16`
  then sign-extends already-signed elements a second time, so a file holding
  `[-32768, -1, 200, 32767]` decoded as `[-98304, -65537, -65592, -65537]` with no error anywhere.
  A plain-JavaScript caller reaches it by typing `Int8Array` for `Uint8Array`. The guard now tests
  the built-in tag rather than `instanceof` — a `Uint8Array` from a worker or an iframe still
  counts — and `BYTES_PER_ELEMENT === 1` was NOT the right test, because `Int8Array` satisfies it.

## 0.2.22

- **Fixed** `streamRecords` skipping the signal validation `readWindow` and `readEnvelope` both do
  before resolving the window. It validated `chunkRecords` and not `signalIndices`, and
  `readRecords` — where the check lived — only ran once the window resolved to at least one
  record. So a window past the end, one inside an EDF+D gap, or one of zero duration reported a
  non-existent channel, or the annotations channel, as "no data here". Both siblings carry a
  comment explaining that a caller mistake is a caller mistake wherever the window lands; this was
  the third one, and the odd one out. A valid selection over an empty window still yields nothing.

## 0.2.21

- **Fixed** `matchSignals` and `filterAnnotationsByText` returning roughly half their matches when
  the caller's `RegExp` carried a `g` or `y` flag. `RegExp.prototype.test` starts from `lastIndex`
  and advances it with those flags, so across an array each element's answer depended on what the
  previous one matched: four EEG channels and `/^EEG/g` gave back the first and the third. Even a
  match-everything pattern stopped returning every signal once it carried the flag, and a second
  call with the same regex object gave a different answer than the first. A `g` flag on a
  membership test means nothing, so both now test against a clone with `lastIndex` reset — cloned
  rather than reset in place, so a shared module-level regex is never mutated.

## 0.2.20

- **Fixed** `filterAnnotationsByTime` dropping an annotation whose duration was written as an
  explicit `0`. A TAL spells an instant either by omitting the duration field or by writing `0`;
  the two are the same instant, and the docs say edfcore does not distinguish them. The left-edge
  clause keyed on `durationTicks === undefined` — a fact about the writer, not the event — so an
  explicitly-zero marker fell out of the window starting at its own onset AND out of the window
  before it, belonging to no window at all in an adjacent-window partition. It also disagreed with
  `annotationsAt`, which had always treated the two spellings alike. The clause now tests the
  event's actual duration; positive-duration events and the half-open rule are untouched.

## 0.2.19

- **Fixed** `mergeChunks` merging across a real gap whenever the index had not been scanned — the
  one thing the helper exists to refuse. Its gap check read `precededByGap`, which is `undefined`
  in two different situations: no gap, and nobody looked. `openEdf` returns a probed index that has
  looked for none, and `readRecords` reads by record number without consulting the timeline, so two
  chunks five seconds apart arrived record-adjacent with that field empty on both and were joined
  silently. The refusal now compares the chunks' own `startSeconds` in exact ticks — each chunk
  decoded its onset from its own bytes, so the evidence was in hand the whole time and never needed
  an index. The `precededByGap` branch stays, because its message names the indexed gap's duration.

## 0.2.18

- **Fixed** `readTriggers` timing every event on the nominal grid — `sampleIndex * recordDuration /
  samplesPerRecord` — instead of from its record's true onset. On an EDF+D file every event after a
  gap was early by the whole gap: a stimulus the amplifier latched at 10 s was reported at 2 s, and
  the same call was self-inconsistent, answering a request for `[10, 12)` with events labelled 2 s
  and 3 s. `readWindow` on the identical records returned the correct onsets, so one file had two
  timebases depending on which function you asked. This is the 0.1.4 defect in the one function
  that never got the fix.
- **Fixed** `readTriggers` returning events from outside the requested window, and — the worse
  half — manufacturing an onset that is not in the file. The scan is record-aligned, and its
  running trigger state reset at the record boundary rather than carrying across it, so a window
  starting at 1.5 s reported a *transition* to a code that had been held since 1.0 s. In a file
  whose only real transition was at 0.75 s, a window containing no transition at all returned a
  stimulus onset. The error is up to one record duration, which is 30 s in many clinical files.
- **Changed**, as a consequence: a windowed `readTriggers` now reports the code **in force** at the
  window's left edge plus every transition inside it, and nothing outside it. That generalises the
  rule a whole-file read already followed at `t = 0`, so an aligned and an unaligned window behave
  alike. All eight existing BioSemi tests pass unmodified.

## 0.2.17

- **Changed** the README's compatibility section to say what the browser claim now rests on. The
  version floors were always a syntax-and-API judgement rather than a test matrix, and until
  0.2.11 nothing executed the library off Node at all; that distinction now appears where the
  claim does rather than only in this file.
- **Added** the `events --list`, `gaps` and `signals` commands to the README's CLI block, and the
  helpers shipped since 0.1.6 to its roadmap. The changelog link is absolute, because a relative
  one 404s on npmjs.com — the same mistake 0.1.1 fixed for three other links.

## 0.2.16

- **Added** `gapAt(index, seconds)`, the complement of `segmentAt`. `segmentAt` returning
  `undefined` tells a viewer there is no data under the cursor and nothing else; how long the hole
  is and when the recording resumes are on the `EdfGap`. Exactly one of the two returns a value
  for any instant strictly inside the recording, and a test checks that at every tenth of a second
  across a file with a real gap.

## 0.2.15

- **Added** `summarizeDiagnostics(diagnostics)` — counts by severity and by code, plus `worst`.
  `formatDiagnostics` produces text for a person; there was nothing that produced numbers for a
  program, and `validateRecording`'s `report.ok` needs a full scan. `worst` is `undefined` for an
  empty list rather than `'info'`, so `worst !== undefined` means "anything to report at all".
  Documented with the warning that `errors > 0` does NOT mean the file failed to read: a deferred
  code carries `error` severity while every signal but one decodes perfectly.
- **Changed** `formatValidationReport` to print severity counts in a fixed error-warning-info
  order rather than in whichever order they first appeared, and to share one counting
  implementation with `summarizeDiagnostics` instead of keeping a second copy.

## 0.2.14

- **Added** `segmentAt(index, seconds)` — the pure, synchronous form of `index.locate()`. A viewer
  asks which segment covers the cursor on every mouse move and should not issue a read to find
  out; a completed index already holds the segments. Throws on a probed index rather than
  returning `undefined`, because `undefined` means "no records cover this instant" and a probed
  index cannot say that about anything in the middle of the file.

## 0.2.13

- **Added** `edfcore events <file> --list`: one tab-separated event per line instead of counts by
  text. The onset column is `onsetSecondsFromFirstRecord`, the axis `gaps` and every read already
  use — printing the on-disk value here would put two lines of the same CLI on different clocks. A
  truncated listing says how many it withheld.

## 0.2.12

- **Added** documentation for everything shipped since 0.1.19: `matchSignals`,
  `declaredDurationSeconds`, `contiguityOf`, `readEnvelopeAtResolution`, `annotationsAt`,
  `mergeChunks`, `physicalRangeOf`, `onsetTicksFromFirstRecord`, and the `signals`, `gaps` and
  `--version` CLI commands.
- **Added** a test that fails when an export is mentioned nowhere in the docs. 0.1.16 made adding
  an export a deliberate act by requiring a line in a test file; adding a line to a test file is
  not writing a doc, and eight more helpers shipped undocumented after it. The match is on word
  boundaries, so `readEnvelopeAtResolution` does not vouch for `readEnvelope`.

## 0.2.11

- **Added** the first test that runs edfcore anywhere other than Node. All 1,293 of the others ran
  under `environment: 'node'`, where `process.env` and `Buffer.from` work perfectly — so nothing
  could catch the one mistake that breaks Chrome, Firefox and Safari at once: a bare Node global,
  which needs no import and so passes the existing module-graph walk untouched. The built
  universal bundle is now driven end to end in a child process whose Node-only globals have been
  replaced by getters that throw the way a browser does. Verified by planting one and watching it
  fail. `npm run check` builds before it tests, because the test loads `dist/`.

## 0.2.10

- **Fixed** `filterAnnotationsByTime` and `annotationsAt` answering on the header's timebase while
  every read answers on the recording's. EDF+ lets a file put its sub-second start offset in
  record 0's timekeeping TAL; `onsetTicks` is the number the file wrote, and `readWindow` puts
  `t = 0` at the start of record 0. The two are identical on a file with no offset and up to a
  second apart on one that declares an offset, so `readWindow` and `filterAnnotationsByTime` — the
  pair that answers "the events in the window I just read" — disagreed on exactly the files
  careful enough to state their offset. Events landed in the neighbouring window, and one near the
  end landed in no window at all.
- **Added** `EdfAnnotation.onsetTicksFromFirstRecord`: `onsetSecondsFromFirstRecord` without the
  float. Only the header-axis form was exact, so a caller comparing on the axis the rest of the
  package uses had nothing exact to compare with. This is what the two queries above now use.

## 0.2.9

- **Added** `physicalRangeOf(signal)`, the declared physical bounds in ascending order.
  `physicalMinimum` is not the smaller of the two: a negative amplifier gain is declared by
  putting the larger value in the minimum field, and reading the fields in field order gives a
  viewer an inverted y-axis on exactly the channels whose trace is also inverted — two errors
  that cancel on screen while both are wrong.

## 0.2.8

- **Added** `mergeChunks(chunks)`. `readWindow` splits at every discontinuity, and joining the
  pieces by hand is where the gap gets lost: concatenating two runs five minutes apart dates every
  sample after the join five minutes early, with nothing in the result to say so. This refuses,
  and refuses a chunk already narrowed by `trimToWindow` too — that one is invisible to a record
  adjacency check.
- **Fixed** the 200,000-record call-stack test timing out under load. It ran within a few hundred
  milliseconds of vitest's 5 s default on its own, so it failed intermittently in a full run and
  the failure read as a regression in code it does not touch.

## 0.2.7

- **Added** `edfcore gaps <file>`. Runs a full scan rather than reading the two probes `openEdf`
  makes: a probed index cannot see a gap in the middle, so reporting "none" from it would be a
  claim nobody verified.

## 0.2.6

- **Added** `annotationsAt(annotations, seconds)` — the instant form a cursor needs.
  `filterAnnotationsByTime` refuses a non-positive duration, so a zero-length window returns
  nothing at every position.

## 0.2.5

- **Added** `readEnvelopeAtResolution`: an envelope at a chosen seconds-per-bucket rather than a
  chosen bucket count. Ceils, so a 40 s window at 30 s per bucket gets two buckets — rounding
  down would drop the last 10 s off the picture.

## 0.2.4

- **Added** `contiguityOf(index)`: `contiguous`, `discontinuous`, or `unknown`. Three answers,
  because a probed index has seen two records and cannot rule out a gap between them.

## 0.2.3

- **Added** `declaredDurationSeconds(header)`. This is what the records COVER, which on an EDF+D
  file is less than `timeline.spanSeconds` — the gaps belong to no record.

## 0.2.2

- **Added** `edfcore signals <file>`: one tab-separated line per signal. `header` is for reading;
  this is for grep and awk.

## 0.2.1

- **Added** `--version` / `-v` to the CLI. Handled before the command check, so a bare
  `--version` does not fall through to usage and exit 2.

## 0.2.0

Marks the feature set that accumulated across 0.1.7–0.1.19 — envelope decimation, the CLI,
BioSemi Status helpers, streaming iteration, annotation queries, the sample grid and the
formatters. Those went out as patch releases, which understated them: a backward-compatible
feature is a minor under semver, and nineteen patch bumps read as nineteen bug fixes.

- **Added** `matchSignals(header, pattern)` — a signal family by RegExp or predicate. Never
  returns an annotations channel, which is the step people forget when filtering
  `header.signals` by hand.

## 0.1.19

- **Added** an optional `out` parameter to `toPhysicalEnvelope`, matching `toPhysical`. An
  envelope is the render-loop path, so two `Float64Array` allocations per frame is the one
  allocation worth letting a caller avoid.

## 0.1.18

- **Added** this changelog, and documentation for the CLI.

## 0.1.17

- **Added** a CLI: `npx edfcore header|validate|events|json <file>`. Exit codes are the contract —
  0 success, 1 unreadable or failed validation, 2 bad usage — so `edfcore validate` gates a CI job
  without parsing output. Patient identification is opt-in.

## 0.1.16

- **Added** an exhaustiveness check to the public API test. It was an allowlist, which only proved
  that listed exports exist; fifteen helpers reached npm undocumented because nothing failed.

## 0.1.15

- **Fixed** `readEnvelope` reporting `precededByGap: undefined` on every chunk, so an EDF+D
  envelope claimed no gaps. Introduced in 0.1.7. At one bucket per pixel a gap is invisible in the
  data itself, so a viewer had nothing to go on.

## 0.1.14

- **Added** [API — helpers](https://edfcore.vercel.app/docs/api-helpers), documenting everything
  shipped in 0.1.7 through 0.1.13.

## 0.1.13

- **Added** `formatValidationReport` to `edfcore/validate`.

## 0.1.12

- **Added** `formatHeader`. Omits patient identification unless asked.

## 0.1.11

- **Added** `sampleIndexAt`, `sampleStartTicks`, `sampleStartSeconds`. `Math.round(seconds *
  sampleRateHz)` drifts by one over a long recording when the rate has no exact float
  representation, and yields `NaN` for a zero record duration.

## 0.1.10

- **Added** `filterAnnotationsByTime`, `filterAnnotationsByText`, `countAnnotationsByText`. All
  comparisons are on `onsetTicks`, not on float seconds.

## 0.1.9

- **Added** `streamRecords`, an async iterator over a window with bounded memory.

## 0.1.8

- **Added** BioSemi Status-channel helpers: `getStatusSignal`, `decodeStatusWord`, `readTriggers`.
  One event per change of the trigger word, not one per sample.

## 0.1.7

- **Added** min/max envelope decimation: `readEnvelope`, `toPhysicalEnvelope`,
  `envelopeOfSamples`. `toPhysicalEnvelope` swaps the bounds when the gain is negative, which
  `toPhysical` applied twice would not.

## 0.1.6

- **Fixed** `validateRecording` throwing `RangeError: Maximum call stack size exceeded` once a
  sweep collected about 125,000 diagnostics. `push(...array)` passes each element as a call
  argument. A 32 MiB file with 130,000 records and a damaged annotation section reached it
  honestly, and the thrown value was neither an `EdfError` nor a caller mistake.
- **Fixed** record onsets wrapping silently in their `BigInt64Array` for an overflowing record
  duration, producing an index that reported `coverage: 'complete'` with one segment per record,
  negative gaps, and no diagnostic. A declared span past the tick range is now refused with a new
  fatal `RECORDING_SPAN_UNREPRESENTABLE`.

## 0.1.5

- **Changed** `readWindow` to validate `signalIndices` before resolving the window. An
  out-of-range index previously threw for a window over data and returned `[]` for a window past
  the end — and `[]` is documented to mean "no records here", never "the read failed".

## 0.1.4

- **Fixed** a record whose timekeeping TAL is missing deriving its onset from zero rather than
  from the recording's start. Three failures came from this one gap: a missing TAL in the last
  record faked a discontinuity and made `readWindow` refuse an entire conforming file; the scan
  chunk size changed the onsets, the segments and even a fatal `TIMELINE_NOT_MONOTONIC`; and the
  same record reported two different start times depending on how many neighbours were read with
  it.

## 0.1.3

- **Fixed** `cachedSource` returning fabricated zero bytes when `blockBytes` or `maxBytes` was
  `NaN`. The `< 1` guard cannot fire for `NaN`.
- **Fixed** `httpSource` hanging forever on a `NaN` `maxConcurrency` — no error, no timeout.
- **Fixed** `httpSource` re-downloading a Range-ignoring resource once per concurrent read. 32
  concurrent reads cost 32 full transfers; now one.
- **Fixed** a source-level `AbortSignalLike` shim being ignored, so the same object behaved
  differently depending on where it was passed.
- **Fixed** `validateRecording` allocating its scan scratch buffer without checking
  `maxMaterializeBytes`, reachable as 400 MB from one corrupted field in a 512-byte file.

## 0.1.2

- Release tooling only.

## 0.1.1

- **Fixed** a false claim in the README: `strictNullChecks` does not catch an unguarded
  `toPhysical` call. The type stops you reading the gain; it does not gate the call.
- **Fixed** three README links that 404ed on npmjs.com.

## 0.1.0

First release. Reads EDF, EDF+, BDF and BDF+ with real random access.
