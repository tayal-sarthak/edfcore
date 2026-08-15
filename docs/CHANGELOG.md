# Changelog

Notable changes per release. Fixes say what was wrong and what it cost, because a version number
alone does not tell you whether you were affected.

edfcore is pre-1.0. Patch releases have carried behaviour changes where the old behaviour was a
defect; those are called out below.

## 0.4.112

- **Added** shields.io badges to the README — npm version, exports, types and licence — and
  `/api.json` on the documentation site to back the exports one.
- The count is generated, not written. The site imports the three published entry points at deploy
  time and counts them, so the badge follows the package without anyone editing a number. Three of
  the four badges are served from npm's own metadata and update themselves the same way.

## 0.4.111

- **Added** an "API surface" table to the README: three entry points, 78 functions, classes and
  constants, 64 public types, 46 diagnostic codes and 6 CLI commands.
- Every number is asserted by `tests/integration/api-surface.test.ts` rather than written down and
  trusted. It imports the three entry points and counts them, reads the disposition registry every
  known code must appear in, and renders the CLI's own `--help` to count the commands. A count in
  prose is exactly the claim that went stale unnoticed in the site footer for three minor series,
  so this one ships with the check that catches it.

## 0.4.110

- **Added** a docblock to `TalRegionParse` saying why it always carries both halves. A malformed
  TAL does not stop the region, so the events after it are still returned, and the issues beside
  them are the only signal that the list is not everything the bytes held.

## 0.4.109

- **Added** a docblock to `IdentificationOptions` naming what `edfPlus` does and does not change:
  the same bytes are parsed either way, since plain EDF files often follow the convention anyway,
  and the flag only decides whether a deviation earns a diagnostic.

## 0.4.108

- **Added** a docblock to `HeaderStartDateParse` saying why it carries partial results beside a
  status. A field can yield a day and month but no year — the `yy` escape — and the EDF+
  `Startdate` supplies the rest, so discarding the halves would lose a date the file does state.

## 0.4.107

- **Added** a docblock to `ParsedSignalHeaders` naming why it returns more than the signals: the
  record byte length and the annotation indices are sums over every signal, so computing them in
  the one pass that already visits each is what keeps callers from re-walking the array.

## 0.4.106

- **Added** a docblock to `EdfVariantInfo` saying why it keeps the parts apart instead of
  collapsing them into `variant`. They disagree on real files — a 24-bit file whose reserved
  field says nothing is BDF with no marker — and each consumer needs a different part.

## 0.4.105

- **Added** a docblock to `EdfFamily` naming what the two values decide — 16-bit against 24-bit
  samples — and that it comes from the version block rather than the reserved marker, since a
  file can be BDF without ever claiming `BDF+`.

## 0.4.104

- **Added** a docblock to `TimelineInput` naming the split it enforces: taking probes rather than
  a source is what keeps `time/timeline.ts` free of I/O, so how many records to read stays
  `record-index.ts`'s decision and what they mean stays this module's.

## 0.4.103

- **Added** a docblock to `ScaleInput` answering the question its existence raises: why the scale
  derivation takes six loose fields instead of an `EdfSignal`. The signal is still being built at
  that point, so the narrow input is what keeps the dependency one-way.

## 0.4.102

- **Added** a docblock to `TalTextEncoding` saying what `latin-1-fallback` records and why the
  verdict is kept at all: `src/tal/` is the one place a real `TextDecoder` is permitted, so which
  way a run decoded is worth reporting rather than assuming.

## 0.4.101

- **Added** a docblock to `DecodedDigital` saying why the out-of-range tally travels with the
  samples: the decode loop already visits every one, so counting there is free where asking
  afterwards would be a second pass over the whole array.

## 0.4.100

- **Added** a docblock to `Segmentation` saying why segments and gaps are derived and returned
  together. Computed apart they can disagree about a boundary, which is the shape of several
  defects this project has already fixed.

## 0.4.99

- **Added** a docblock to `DiagnosticSink`, the single place `strict` becomes a decision. Its
  `strict` field warns against re-implementing that choice; the class never said it is the reason
  the rule and the `info` exemption exist once rather than per caller.

## 0.4.98

- **Added** a docblock to `EdfFormatErrorInit`, the last public type in the package without one.
  It says why the type is exported at all: its fields become properties on the thrown error, and
  `collected` is the one worth reading — the diagnostics found before the fatal one.

## 0.4.97

- **Added** a docblock to `FormatDiagnosticsOptions` surfacing `redactFields` on the type. Its
  field comment explains the hazard in full, but a caller has to already be reading the field to
  find it — the one place a warning about pasting a patient's name should not be.

## 0.4.96

- **Added** a docblock to `EdfChannelNotFoundError`, the one error class in the file without one.
  It names why the class carries `availableLabels`: recovering what the file declares from the
  error beats re-reading the header to find out.

## 0.4.95

- **Added** a docblock to `EdfError`, the abstract base every thrown error extends. It states the
  split the class hierarchy encodes: an `EdfError` means the FILE was the problem, and a plain
  `RangeError` from this package means the call was.

## 0.4.94

- **Added** a docblock to `decodeAnnotations`, the last function in the public barrel without
  one. It points at `readAnnotations` as the call most people actually want — this is the pure
  half, over bytes you already hold.

## 0.4.93

- **Added** a docblock to `httpSource`, including why it is the one adapter that returns a
  promise: it probes the server for range support and a length before handing back a source, so
  an origin that cannot serve ranges fails at construction rather than mid-read.

## 0.4.92

- **Added** a docblock to `cachedSource` saying when wrapping is worth it — over HTTP, where a
  scan re-reads neighbouring bytes — and when it is not. 0.4.73 documented its options type; the
  function itself still hovered blank.

## 0.4.91

- **Added** a docblock to `byteSource` naming the check that happens at construction. A typed
  array of the wrong signedness passes a length test and then decodes into plausible, wrong
  samples, which is why the refusal is up front rather than at first read.

## 0.4.90

- **Added** a docblock to `blobSource`. It is the browser entry point and the first call most
  visitors write, and hovering it showed nothing — the module comment above explains the shim, not
  what the function is for.

## 0.4.89

- **Added** a docblock to `FormatAnnotationsOptions` stating the property that makes `maxItems`
  safe: truncation always reports how much it withheld, so a listing that stopped early can never
  be mistaken for a recording that had no more events.

## 0.4.88

- **Added** a docblock to `EdfCodeCount` saying why it carries `severity` beside the count.
  `byCode` is sorted most-frequent-first, and the most frequent code is usually not the most
  serious one, so the severity has to travel with it.

## 0.4.87

- **Added** a docblock to `EdfDiagnosticSummary` saying what it is FOR. A file can carry hundreds
  of notes when one bad field repeats per record, so the summary is meant to be rendered instead
  of the list rather than beside it.

## 0.4.86

- **Added** a docblock to `EdfSeverity` naming the `info` exemption on the type. That level
  describes files the reader got RIGHT and is exempt from `strict`, so treating the diagnostics
  array as uniformly bad is the mistake this hover now heads off.

## 0.4.85

- **Added** a docblock to `EdfErrorKind` saying to branch on it rather than on `instanceof`. The
  barrel explains that a class identity is false across a realm boundary; the type a consumer
  hovers while writing the `switch` did not.

## 0.4.84

- **Added** a docblock to `DecodeAnnotationsOptions`, the last public type in `types.ts` without
  one. It says up front that two of its fields are the same quantity — record 0's true start —
  which is the thing a reader otherwise discovers only by reading both field comments.

## 0.4.83

- **Added** a docblock to `FormatReportOptions` naming the asymmetry with 0.4.82's type: a report
  cannot withhold identification by default, because a diagnostic about a non-conformant field
  must quote it to be useful — so `redactFields` is the deliberate step before sharing one.

## 0.4.82

- **Added** a docblock to `FormatHeaderOptions` naming the default as opt-IN rather than
  redact-on-request. A formatted header is something people paste into issues, and which way that
  default points is the part worth knowing before pasting one.

## 0.4.81

- **Added** a docblock to `BuildIndexOptions` saying why `onProgress` appears here and nowhere
  else in the reading API: `buildRecordIndex` is the only call whose cost scales with the file
  rather than with the window.

## 0.4.80

- **Added** a docblock to `ValidateOptions` naming which field costs what. `scanSamples` is the
  expensive half and the one that produces the observed digital ranges, which is the distinction
  a caller weighing a full sweep against a header check needs.

## 0.4.79

- **Added** a docblock to `OpenOptions`. It is the entry point most callers meet first and hovered
  as a bare intersection of two other types; it now says why that is the whole definition —
  opening introduces no policy of its own.

## 0.4.78

- **Added** a docblock to `ParseOptions`. Its `strict` field is documented at length; the type
  never said what makes it unlike every other option in edfcore — it changes what a parse DOES,
  where the rest only change what one costs.

## 0.4.77

- **Added** a docblock to `TriggerSelection` answering the question its shape raises: it is the
  one selection type with no `signalIndices`, because `readTriggers` locates the Status channel
  itself rather than letting an ordinary signal be decoded as trigger words.

## 0.4.76

- **Added** a docblock to `StreamSelection` naming what it buys: peak memory of `chunkRecords`
  worth of records rather than the whole window, which is the difference between processing a
  22-hour recording and having it refused on the materialize budget.

## 0.4.75

- **Added** a docblock to `EnvelopeSelection`. Its `buckets` field already explained itself; the
  type never said what the shape is for — memory bounded by the plot rather than by the window,
  which is what makes rendering a twelve-hour recording possible at all.

## 0.4.74

- **Added** a docblock to `HttpSourceOptions` saying why `maxConcurrency` lives on the source
  rather than on a read. `readWindow` issues its runs in order precisely so the pattern a caller
  observes is the one they asked for; concurrency is the source's business.

## 0.4.73

- **Added** a docblock to `CacheOptions` naming what makes `cachedSource` the only cache in the
  package, and why that matters: it is one wrapper, so it can be removed, and caching can never
  be the hidden explanation for two reads disagreeing.

## 0.4.72

- **Added** a docblock to `ObservedSignalStats` saying what the numbers are for. The type exists
  to be compared against the declared range, and the comparison worth making — a non-zero
  `outOfDigitalRangeCount` means the declaration is wrong, not the samples — was stated only in
  the validation guide.

## 0.4.71

- **Added** a docblock to `EdfRecordingId`, the sibling of the type 0.4.70 documented. It names
  why its `startDate` subfield matters: the EDF+ one carries a four-digit year, which the
  8-character date field at the top of the header cannot express.

## 0.4.70

- **Added** a docblock to `EdfPatientId` naming `conformant` as the field to check first. A plain
  EDF file may put anything in that header field, so the parsed subfields beside it are only
  meaningful when the convention was followed.

## 0.4.69

- **Added** a docblock to `EdfClockTime`, the companion to the `EdfCalendarDate` one in 0.4.65.
  The `EdfStartTime` below already explains why edfcore produces no `Date`; the clock type an
  editor shows on hover said nothing about the zone it does not carry.

## 0.4.68

- **Added** a docblock to `HttpResponseLike`, the last of the three shims. It names the practical
  consequence of its narrowness: a test double for `httpSource` needs a status, a header lookup
  and the bytes, not a conforming `Response`.

## 0.4.67

- **Added** a docblock to `BlobLike` naming the thing a browser caller actually holds: a `File`
  from an `<input type="file">` satisfies it directly, which is why `blobSource(file)` needs no
  cast despite the published types naming no DOM lib.

## 0.4.66

- **Added** a docblock to `AbortSignalLike`. The section comment above the shims explains why they
  exist, but a consumer hovering the type in their editor sees the type alone — and the thing they
  need to know is that a real `AbortSignal` is assignable, so nothing about the call changes.

## 0.4.65

- **Added** a docblock to `EdfCalendarDate` naming both hazards in the obvious conversion. Its
  `month` field already warned it is 1-based; the type never said that `new Date(y, m, d)` also
  applies the reader's timezone to a date the recording expressed none in.

## 0.4.64

- **Added** a docblock to `ValidationReport` saying why it reports `recordsScanned` and
  `bytesRead`. `validateRecording` is one of only two calls that read the whole file, so what the
  sweep cost belongs in the answer rather than being left for a caller to infer.

## 0.4.63

- **Added** the docblock `EdfRawHeaderFields` was missing. `EdfRawSignalFields` sits directly
  above it, holds the same kind of value and already carried the sentence — so the pair an editor
  shows side by side explained itself only half the time.

## 0.4.62

- **Added** a docblock to `EdfVariant` saying what the two axes in those six strings mean, and
  that neither is a promise: `+D` is what the writer declared, and only a complete index can
  confirm whether records are actually discontinuous.

## 0.4.61

- **Added** a docblock to `ReadOptions` stating the property that makes it safe to pass anywhere:
  both fields bound a cost, neither changes an answer. `maxMaterializeBytes` altering a result is
  the exact defect class 0.3.23-0.3.34 swept, so the type says it is not allowed to.

## 0.4.60

- **Added** a docblock to `RecordSelection` saying what distinguishes it from `WindowSelection`:
  naming records directly is what makes a gap unable to surprise the caller, and therefore what
  lets `readRecords` return one chunk where `readWindow` must return an array.

## 0.4.59

- **Added** a docblock to `WindowSelection` naming the axis its seconds are on, and why it is a
  SELECTION type: reported times all carry an exact `*Ticks` twin, and these deliberately do not,
  because rounding a caller's requested bound to the tick grid is the intended behaviour.

## 0.4.58

- **Added** a docblock to `EdfRecordIndex` naming `coverage` as the field to branch on, and why
  `segments` and `gaps` are absent rather than empty under a probed index: an empty array would
  read as "no gaps" when nothing had looked.

## 0.4.57

- **Added** a docblock to `EdfAnnotationsResult` saying why it carries `recordOnsetTicks` beside
  the events. Reading annotations is how edfcore learns where records truly start, so the onsets
  are the point rather than a by-product of the same decode.

## 0.4.56

- **Added** a docblock to `EdfDiagnostic` stating the rule the whole library is built on where a
  consumer meets it: a diagnostic is a value on the result, never an exception and never console
  output, because anything edfcore could not proceed past would have thrown instead.

## 0.4.55

- **Added** a docblock to `EdfChunkSignal` saying on the type that `digital` holds stored ADC
  counts rather than the signal's units. `AGENTS.md` lists mistaking those for microvolts as the
  single most common error against this API, and the field an editor shows on hover never said so.

## 0.4.54

- **Added** a docblock to `EdfLocation`, the shape `sampleAt` and `index.locate` return. It says
  why the record and the offset within it are separate fields: only on a contiguous recording does
  adding them back together give elapsed time.

## 0.4.53

- **Added** a docblock to `EdfTimeline` saying on the type what its `coveredTicks` field says in
  its own comment: the contiguity verdict is what TWO probes can see, and a gap an overlap cancels
  defeats it. That limit is the one worth reading before trusting the verdict, and hovering the
  type never showed it.

## 0.4.52

- **Added** a docblock to `EdfAnnotation` naming which onset field goes with which axis. That
  choice was corrected in the README and `AGENTS.md` in 0.4.14 and 0.4.15; the type an editor
  actually shows on hover still said it only in the per-field comments below.

## 0.4.51

- **Added** a docblock to `EdfChunk`, stating the two things a caller gets wrong about it: chunks
  are record-aligned and therefore usually wider than the window asked for, and `precededByGap`
  being `undefined` means nobody looked, not that there is no gap.

## 0.4.50

- **Added** a docblock to `EdfSignal`, naming the two fields that decide what a caller can do with
  a channel: `kind`, because an annotations channel holds TAL text rather than samples, and
  `scale`, which is `undefined` when no gain can be derived.

## 0.4.49

- **Added** a docblock to `EdfHeader`, the type every read takes. Its per-field comments already
  said which values are resolved rather than verbatim; the type itself never said that resolved
  values are the rule, with the declared counterpart kept beside each one.

## 0.4.48

- **Added** a docblock to `EdfRecording`. `removeComments: false` ships these as the hover text in
  `dist/types.d.ts`, and the type `openEdf` returns had none — so the struct-not-class shape, which
  is what makes `{ ...recording, index }` the way to attach a scanned index, was documented
  everywhere except on the type itself.

## 0.4.47

- **Fixed** the last `mergeChunks` refusal without a `Next:` clause, completing the sweep
  0.4.30 started. It also named only one of the two ways `readWindow` returns `[]` — a window
  past the end — where the other, a window landing entirely inside a gap, is the one a caller
  merging a discontinuous recording actually hits.

## 0.4.46

- **Fixed** the `mergeChunks` sample-continuity refusal. It already said to trim after merging
  rather than before, as trailing prose; it now says it as the `Next:` clause and names
  `trimToWindow()` as the call that takes the merged chunk.

## 0.4.45

- **Fixed** the `mergeChunks` signal-order refusal, the sibling of 0.4.44's. It now says that
  `readWindow` preserves the order it was given, which is what makes a fixed `signalIndices`
  array the fix.

## 0.4.44

- **Fixed** the `mergeChunks` signal-count refusal naming the rule without the fix. Chunks with
  different signal counts come from reads given different `signalIndices`, so the message now
  says to reuse one array across the reads you mean to merge.

## 0.4.43

- **Fixed** the `mergeChunks` adjacency refusal stating the rule but not the action. A caller
  reaching it has usually reordered or filtered the array, which is now what the message says to
  undo.

## 0.4.42

- **Fixed** the gap and overlap refusals in `mergeChunks` stating their remedy as trailing prose
  rather than the `Next:` clause 0.4.41 wrote down. Both said "Merge each contiguous run
  separately"; both now say it where a reader scanning for the instruction looks.

## 0.4.41

- **Added** the `Next:` rule to the conventions in `AGENTS.md`. Over 150 messages in `src/` end
  with one and seventeen did not, which 0.4.30-0.4.40 closed — an unwritten convention is one new
  code drifts off, so it is now written down beside the formatting rules.

## 0.4.40

- **Fixed** the last refusal in `assertInBounds` without a `Next:` clause, and the one of the
  three with a cause a caller can act on: its own docblock says this fires when a header is mixed
  with bytes from another file, which the message never passed on.

## 0.4.39

- **Fixed** the byte-length bounds refusal, the sibling of the one 0.4.38 fixed and the second of
  three in `assertInBounds` without a `Next:` clause.

## 0.4.38

- **Fixed** the byte-offset bounds refusal in `bytes/view.ts` carrying no `Next:` clause. Nothing
  a caller passes reaches it directly — every offset is computed by edfcore — so the useful
  instruction is to report it, which the message now gives.

## 0.4.37

- **Fixed** the only refusal in `decode/digital.ts` without a `Next:` clause, where the other four
  in that file all have one. It fires on a header whose offsets contradict its record size, which
  is an edfcore bug unless the header was hand-built — so the message now says to report it.

## 0.4.36

- **Fixed** `mergeChunks: no chunk at N.` carrying no `Next:` clause. It fires when the array has
  a hole, which happens when a caller has spliced or filtered what `readWindow` returned — and
  that is what the message now says to check.

## 0.4.35

- **Fixed** `readEnvelopeAtResolution()` refusing a bad `secondsPerBucket` without pointing at
  `readEnvelope()`. The two differ by exactly which quantity you hold — seconds per pixel against
  a pixel count — so a caller who passed the wrong one is the caller most likely to see this.

## 0.4.34

- **Fixed** `gridSampleStartTicks()` refusing a fractional `sampleIndex` with no `Next:` clause,
  where the other three refusals in the same file all carry one. It now says which grid the index
  is meant to be on, which is the distinction the `grid` prefix exists to hold.

## 0.4.33

- **Fixed** the `sampleIndex must be a whole number` refusal carrying no `Next:` clause. A
  fractional index almost always arrives from `round(t * sampleRateHz)`, which the docs warn
  against and the message did not — it names no function on purpose, since 0.3.134, but that is
  no reason to name no remedy either.

## 0.4.32

- **Fixed** `sampleAt()` refusing a non-finite `seconds` without naming the axis the caller was
  supposed to measure on. Which axis is the thing this package is most often got wrong, so the
  refusal is the right place to say it.

## 0.4.31

- **Fixed** the same missing `Next:` clause in `gapAt()`, two functions below the one 0.4.30
  fixed. The refusal above it in the same function already carried one, so a caller got guidance
  for a probed index and none for a `NaN`.

## 0.4.30

- **Fixed** `segmentAt()` refusing a non-finite time without saying what to do about it. 147
  messages in `src/` end with a `Next:` clause and this was one of seventeen that did not, so the
  one case that reaches it — a rate derived by dividing by a legal zero record duration — went
  unnamed.

## 0.4.29

- **Added** the guard for 0.4.26: no `.astro` file may hard-code a version. That footer read
  "Version 0.1.0." for the whole 0.2, 0.3 and 0.4 history because nothing swept it — `PAGES` in
  `readme-status.test.ts` reads only the markdown under `content/docs/`, and `astro check` checks
  types, not prose. Verified by reintroducing the string and watching it fail.

## 0.4.28

- **Added** `npm run corpus:fetch` to the commands in `AGENTS.md`. Without it every corpus test
  skips, and `coverage.test.ts` exists precisely because a skipped test and a passing one look
  identical in a summary line — so an agent could read a green run as covering the real files.

## 0.4.27

- **Fixed** `AGENTS.md` stating "there are no binary files in git". Six EDF/BDF files have been
  committed under `tests/corpus/golden/` since 0.2.34, and `tests/README.md` explains why they
  must be: regenerating them with `support/writer.ts` would make the pyEDFlib comparison circular.
  An agent trusting that sentence would treat them as strays.

## 0.4.26

- **Fixed** the documentation site footer reading "MIT licensed. Version 0.1.0." on every page. It
  was hard-coded, and `npm run check` never looks at the website — `astro check` validates types
  and content collections, not prose — so it survived the whole 0.2, 0.3 and 0.4 history. It now
  reads `VERSION` from the package, which is the one value `scripts/release.mjs` already bumps.

## 0.4.25

- **Added** `scripts/` to the layout table in `AGENTS.md`. It holds the release script and the
  golden generators, neither of which runs in `npm run check` — the two things an agent is most
  likely to reach for and least likely to find from a table that did not mention the directory.

## 0.4.24

- **Added** `scratch/` to the suite layout table in `tests/README.md`, the one directory of the
  eight under `tests/` the table omitted. It has its own vitest config and npm script, and both
  vitest configs explain at length why it is excluded — the layout was the only place silent about
  it. Same omission 0.3.131 fixed for `tests/types`.

## 0.4.23

- **Fixed** the `--limit` line of `edfcore --help` running to 103 characters, so the one line
  explaining the truncation was itself the only line that wrapped on an 80-column terminal. The
  widest line is now 89, which is what every other option already fitted in.

## 0.4.22

- **Added** `--limit <n>` to the README's CLI section. `edfcore --help` and the website both
  document it; the README mentioned only `--patient` and `--list`, so the one place that says
  output is truncated at twenty was the one a reader is least likely to have open.

## 0.4.21

- **Fixed** `api-sources.md` calling `edfcore/node` "the only module the universal entry can reach
  that imports a Node built-in". The universal entry reaches none — the same inversion 0.4.17
  removed from `installation.md`, and the sentence two lines later already said so.

## 0.4.20

- **Fixed** the last copy of the "greps the built universal bundle" claim, in `installation.md`.
  The check walks the module graph, which is what `api-sources.md` already said — the three pages
  describing one guarantee now describe the same mechanism.

## 0.4.19

- **Fixed** the `edfcore/node` docblock crediting "a packaging test" that "greps the built
  universal bundle". It is `public-api.test.ts`, walking the module graph from `src/index.ts` —
  the same correction 0.4.2 made in the barrel, and this copy ships as the subpath's hover text.

## 0.4.18

- **Fixed** `api-primitives.md` documenting only the `RangeError` branch of `decodeAnnotations`.
  0.3.106 split that refusal in two — a signal of the wrong kind stays a plain `RangeError`, an
  index the file does not have became `EdfChannelNotFoundError` — and the page still described the
  single branch that conflating them had produced.

## 0.4.17

- **Fixed** `installation.md` calling `edfcore/node` "the only module the universal entry can reach
  that imports from `node:`". The universal entry reaches no such module — `public-api.test.ts`
  asserts exactly that, and it is the guarantee the browser support rests on. The sentence claimed
  the opposite of the package's central promise.

## 0.4.16

- **Fixed** `api-validate.md` opening its surface section with "Two functions and three types".
  `edfcore/validate` exports three functions; `formatValidationReport` was missing from the count
  and from the import above it, so the page describing that subpath was the one place it did not
  appear.

## 0.4.15

- **Fixed** the README's "Event times are exact" note ending on "Compare `onsetTicks`, not the
  float". The precision half was right and the field was the header-axis one; against a window the
  axis that matches is `onsetTicksFromFirstRecord`. Same correction as 0.4.14, other file.

## 0.4.14

- **Fixed** `AGENTS.md` telling generated code to compare event times with `annotation.onsetTicks`.
  `src/types.ts` says that field is the wrong one for comparing an annotation against a window —
  `readWindow` and `readEnvelope` put `t = 0` at record 0, which is `onsetTicksFromFirstRecord` —
  and the two are up to a second apart on a file with a sub-second start offset.

## 0.4.13

- **Fixed** the last stale `tsconfig.build.json` reference, in `diagnostic-docs.test.ts`. Same
  reason as 0.4.12: the sweep exists because that config keeps comments, so the path has to be
  openable. This closes the set the 0.4.1 move left behind.

## 0.4.12

- **Fixed** `readme-status.test.ts` naming `tsconfig.build.json` at the root. The `.d.ts` sweep it
  introduces only makes sense because that config sets `removeComments: false`, so the reader has
  to be able to open it — it moved to `config/` in 0.4.1.

## 0.4.11

- **Fixed** `browser-safety.test.ts` saying "the 1,290-odd tests in this repository". There are
  1906. The number carries the argument for why that test exists — all of them run under
  `environment: 'node'` — so it should be the real one.

## 0.4.10

- **Fixed** the fixture policy in `tests/README.md` opening with "the first and third are in use"
  and then describing Tier 2 as in use since 0.2.34, three lines below. All three are.

## 0.4.9

- **Fixed** the layer chain in `AGENTS.md` omitting `src/text/`. It is a Layer 1 module, alongside
  `bytes`, and the chain is the rule an agent checks an import against — a layer missing from it
  has no stated position to be checked.

## 0.4.8

- **Fixed** `AGENTS.md` advertising `npm test` as "~2s". The suite is 1906 tests and takes about
  ten seconds; a contributor timing it against that number would think something had hung.

## 0.4.7

- **Fixed** `publish.yml`'s `permissions` comment claiming `id-token: write` is for trusted
  publishing and that "no long-lived secret is stored anywhere". The publish step in the same file
  says the opposite: trusted publishing 400s here, and NPM_TOKEN is the credential. The permission
  is for the provenance attestation, which is the one claim that survived.

## 0.4.6

- **Fixed** the drift-recovery note in `scripts/release.mjs` telling you to run
  `git show <tag>:CHANGELOG.md`. That returns nothing for v0.4.1 and later, which is the range a
  future drift would be in; the note now gives both paths and says where they split.

## 0.4.5

- **Fixed** `scripts/release.mjs` saying the workflow publishes "through trusted publishing".
  `publish.yml` records that registering trusted publishing returns 400 against this package and
  that it authenticates with the NPM_TOKEN secret. The two files described different mechanisms.

## 0.4.4

- **Fixed** the 122-column line in `buildRecordIndex`'s docblock, left unwrapped by an earlier
  edit. It was the longest line in `src/` by twenty columns, against a stated 100-column
  convention, and `removeComments: false` ships it as the hover text for the function.

## 0.4.3

- **Fixed** the `edfcore/node` docblock naming `tsconfig.build.json` at the repository root. It
  moved to `config/` in 0.4.1, and this sentence ships as the hover text on the subpath, so the
  path a consumer is told to look at had to be the real one.

## 0.4.2

- **Fixed** `src/index.ts` crediting "a packaging test" that "greps the built universal bundle" for
  the `node:` prefix. The check is `public-api.test.ts`, and it walks the `src/` module graph — the
  built bundle is what `browser-safety.test.ts` runs, for globals rather than imports.

## 0.4.1

- **Moved** `CHANGELOG.md` to `docs/CHANGELOG.md`. It still ships in the tarball, so the release
  record is still readable out of `node_modules/edfcore/` — at the new path. That is the only
  change in this release a consumer can observe.
- The three build configs moved to `config/`, and every `npm` script now names its config instead
  of relying on a tool's default lookup. Repository only: nothing under `src/` changed, so the API,
  the shipped types and the arithmetic are identical to 0.4.0.

## 0.4.0

The public API is unchanged: nothing was added, removed or renamed, and no arithmetic moved. This
is a series marker, and it exists because the 0.3.104-0.3.136 patches carried observable changes
that a consumer pinning `~0.3.x` would rather have been told about in a version number:

- **Error classes.** `decodeAnnotations` and `readAnnotations` now throw `EdfChannelNotFoundError`,
  not a plain `RangeError`, for a signal index the file does not have (0.3.106). Code branching on
  `isEdfError` sees a different answer for that input.
- **Error codes.** `toPhysicalEnvelope` reports the cause the header recorded rather than always
  `SCALE_UNAVAILABLE` (0.3.111).
- **Diagnostics.** A discarded TAL no longer also reports that it was kept (0.3.105), and
  `validateHeader` now reports `DATE_UNPARSEABLE` for an unreadable startdate field that the EDF+
  `Startdate` rescued — a case it previously called clean (0.3.107).
- **Message text.** Annotation text quoted in a diagnostic is escaped (0.3.104), the TAL
  diagnostics carry the bytes their offsets name (0.3.115), and four refusals no longer prefix
  themselves with a function the caller did not call (0.3.132-0.3.136).

Nothing here changes which samples you read. If you assert on message strings, read those four
entries; otherwise this is a drop-in replacement for 0.3.136.

## 0.3.136

- **Removed** the last hard-coded `readRecordBytes():` prefix, and pinned the rule. Eight modules
  call that helper, so `readAnnotations(recording, { start: 0, count: 99 })` reported a function the
  caller had never written — the fourth instance of what 0.3.132-0.3.134 fixed, and the one those
  three missed.
- The guard asserts it at the delegating entry point, which is the side that was wrong: no message
  thrown by `readAnnotations` or `sampleStartSecondsOf` contains a `someFunction():` prefix. It is
  what found this instance.

## 0.3.135

- **Fixed** the README's claims table saying the pyEDFlib sample-scan parity covers "all five
  files". `corpus-parity.test.ts` runs that sweep over `CASES`, which lists seven — the two Sleep-EDF
  files, three teuniz.net generators, `chb01_01.edf` and `calib.rec`.

## 0.3.134

- **Completed** 0.3.133, which fixed only the three messages outside `resolveSignal`. That helper
  is shared by `sampleAt` and `sampleStartTicksOf` and took a `caller` string, so its four messages
  still said `sampleStartTicksOf():` when reached through `sampleStartSecondsOf`. The parameter is
  gone and the messages name no function, which is what `envelope.ts` already does for its own
  shared helpers.

## 0.3.133

- **Removed** the hard-coded `sampleStartTicksOf():` prefix from that function's three messages, the
  other half of 0.3.132. `sampleStartSecondsOf` is a one-line delegation to it, so every caller of
  the seconds variant was told about a function they never called.

## 0.3.132

- **Removed** the hard-coded `decodeAnnotations():` prefix from the three caller-error messages in
  `tal/annotations.ts`. `readAnnotations` reaches all three, so a caller who never wrote
  `decodeAnnotations` was told about it — the `annotations.md` example demonstrated exactly that,
  calling `readAnnotations` and printing the other name. This is the rule `envelope.ts:113` states
  and 0.3.35 applied to the envelope helpers, which are shared the same way.

## 0.3.131

- **Added** `tests/types/` to the Layout table in `tests/README.md`. It holds the four `.test-d.ts`
  type-level checks — including the one pinning what each subpath can name on its own — and was the
  only tracked test directory the table left out.

## 0.3.130

- **Fixed** `options.ts` saying `maxMaterializeBytes` is read "in four modules spread across four
  layers". Six read it, and they are now named — the same undercount 0.3.119 corrected on
  `large-files.md`, in the docblock whose whole argument is that a guard applied in only some of
  them is not a guard. It ships in `dist/options.d.ts`.

## 0.3.129

- **Corrected** 0.3.119's own sentence, which called all three off-path budget sites refusals. Two
  are: the envelope accumulator and `validateRecording`'s scratch both throw `EdfBudgetError`.
  `scanChunkRecords` reads the budget as a cap on its block size and never throws — a full
  traversal reads in smaller pieces instead of refusing.

## 0.3.128

- **Fixed** the same `readWindow` claim 0.3.121 corrected on the docs page, in `recording.ts`'s own
  module docblock — "a continuous file where the array always has one element", three lines above
  the sentence saying an empty array is returned. It ships in `dist/recording.d.ts`.

## 0.3.127

- **Changed** the `signals` line in `edfcore --help` to say the output is tab-separated, which is
  what `awk` needs to be told. The docs page has always said it; the usage text recommended the
  tools without naming the separator.

## 0.3.126

- **Removed** the stray blank line inside the `Options` block of `edfcore --help`, which split
  `--version` off from the other four and read as the start of a second section.

## 0.3.125

- **Fixed** the CLI flag list on `api-helpers.md`, which named no scopes at all — so a reader
  learned from `--help` that `--patient` applies to three commands and from the docs that it
  applies to all six. 0.3.91 scoped it in the usage text and left the page behind.

## 0.3.124

- **Changed** the `--limit` line in `edfcore --help` to name the commands it applies to, the way
  `--patient` and `--list` already do. It is honoured by `header`, `validate` and `events`; on
  `gaps`, `signals` and `json` it is accepted and ignored.

## 0.3.123

- **Updated** the README's test count from "1,200+" to "1,900+". The suite runs 1,904. The old
  number was still true and 58% low, which is the same way a claim goes stale that the version
  guards exist for.

## 0.3.122

- **Fixed** the "emitted by" column for `SCALE_UNAVAILABLE`, which named only `toPhysical`.
  `toPhysicalEnvelope` throws it too — and after 0.3.111 it is the same builder, so the two can no
  longer be listed apart.

## 0.3.121

- **Fixed** `api-reading.md` saying `readWindow` on a continuous file "always has exactly one
  element". The paragraph immediately below it says an empty array means the window fell outside
  the recording or had a non-positive duration — both of which happen on a continuous file. One
  page answered the same question two ways, two lines apart.

## 0.3.120

- **Fixed** `DIGITAL_RANGE_EXCEEDS_FORMAT` promising extrapolated physical values on a data signal
  whose scale is then refused. The check runs before `buildScale` and picked its consequence on
  `kind === 'annotations'` alone, so a range that is also degenerate or inverted — a writer
  stamping BDF bounds into an EDF header — was told to expect a conversion `toPhysical` throws for.
  0.3.72 split out the annotations case and left this one unconditional.

## 0.3.119

- **Fixed** `large-files.md` stating "there are three allocation points" as a closed enumeration.
  Six call sites refuse against `maxMaterializeBytes`. The table lists the three on the read path,
  which is what its bytes-per-sample column is for; the other three — the index scan block, the
  envelope accumulator and `validateRecording`'s scratch — are not sample-proportional and are now
  named instead of implied not to exist.

## 0.3.118

- **Corrected** the comment on `sampleAt`'s segment bound, which justified the check with a
  float-seconds-versus-ticks disagreement `segmentAt` stopped producing in 0.3.6. It resolves its
  bounds in ticks through the same `secondsToTicks`, so the bound is an invariant rather than a
  guard. The check itself is unchanged; this ships in `dist/` as hover text.

## 0.3.117

- **Fixed** `api-errors.md` claiming `EdfScalingError.code` always names the cause the header
  recorded. It does for the four re-derivable tests. `buildScale` has a fifth refusal — a derived
  gain that is not a usable float64 — which the header records as `DEGENERATE_PHYSICAL_RANGE` and
  which `describeScalingFailure` cannot re-derive from an `EdfSignal`, so `toPhysical` reports
  `SCALE_UNAVAILABLE` and a lookup by code finds no matching header entry.

## 0.3.116

- **Fixed** two reference tables calling `EdfSignal.physicalDimension` "exactly as written". It is
  `trimEdfField(raw.physicalDimension)`, the same treatment `label`, `transducerType` and
  `prefiltering` get — and those neighbouring rows already say "trimmed", so the table singled this
  field out as the one that is not.

## 0.3.115

- **Fixed** the two TAL-level diagnostics whose `raw` was not the bytes their `byteOffset` and
  `byteLength` name.
  - `TIMEKEEPING_TAL_NONCONFORMANT` and `NEGATIVE_ANNOTATION_ONSET` set the span to the whole TAL
    but `raw` to the onset alone, and set no `rawBytes`. So `raw` was two characters for a
    twelve-byte span — against the documented meaning of the field, "those bytes as text, exactly
    as written including padding" — and `formatDiagnostics` printed no `bytes:` line, on the one
    diagnostic whose Next: step tells the reader to read the bytes at that offset.
  - Both now carry the named span, bounded by the same evidence cap `reportIssue` uses. That
    function in the same file has done this correctly since 0.3.68; these two were never brought
    in line. The onset is still in each message's own `onset "..."` clause, so nothing is lost.

## 0.3.114

- **Fixed** `api-errors.md`'s `EdfFormatError` example printing a code strict can never throw.
  - The example wraps `openEdf(source, { strict: true })` in a try/catch and annotates the catch
    body with `formatError.code // 'DATE_CLIPPED_TO_1985_2084'`. That code is `info`, so the parse
    resolves and the catch body never runs — while the same page states the exemption correctly a
    hundred lines below. It now uses `DEGENERATE_DIGITAL_RANGE`, with the field, byte offset,
    signal index and spec reference an actual run produces.
  - This is the claim 0.3.76, 0.3.90 and 0.3.108 retired from eight places, made as an annotated
    VALUE rather than a sentence — which is why all three sweeps, including the one that widened
    the guard yesterday, walked past it. The guard now also checks every fenced block containing
    `strict: true` and a `catch` against the `info` codes in the dispositions table.

## 0.3.113

- **Added** the case that pins `trimToWindow`'s out-of-range re-count. No behaviour change; the
  behaviour was already right and no test could tell it from the wrong one.
  - `it('re-counts out-of-range samples only when narrowing can have dropped one')` is written for
    `keptEverything = firstIndex === 0 && digital.length === chunk.digital.length`, but its fixture
    put the out-of-range sample at index 0. A head-anchored trim then keeps the offender, so
    re-counting and reusing both give 1; the other case it checks has both halves false. Rewriting
    the `&&` as `||` left all 1902 tests green, including this one — while a head trim that dropped
    the offender reported one out-of-range sample in a view that has none.
  - The offender now sits at the tail, and the test covers the head-anchored partial trim, which is
    the only shape in which the two halves disagree.

## 0.3.112

- **Added** the assertion that pins `sampleAt`'s file bound on the contiguous branch. No behaviour
  change; the behaviour was already right and nothing held it there.
  - `it('bounds its answer by the file, before and after')` is the only test that names the rule,
    and it builds its recording with `buildRecordIndex`, so `sampleAt` returns from the SEGMENT
    branch and never reaches the contiguous bound. Every other `sampleAt` assertion in the suite is
    either segmented or asks for a time so far past the end (100 s on a 6 s file) that any bound
    rejects it — so the one value that branch decides, the first instant past the last record, was
    asked for nowhere.
  - Both mutants were silent: relaxing the upper bound to `recordIndex > recordCount` and deleting
    the `recordIndex < 0` half each left all 1901 tests green, with `sampleAt` naming a record the
    file does not have — the exact `gridSampleIndexAt` behaviour its docblock says it exists not to
    have. Both now fail.

## 0.3.111

- **Changed** `toPhysicalEnvelope` to report the cause of a missing scale rather than always
  `SCALE_UNAVAILABLE`.
  - It hard-coded that code. `SCALE_UNAVAILABLE` is defined — in the deferred-fatal code table and
    in `describeScalingFailure` itself — as the case where none of the specific conditions applies,
    so for a signal declaring `digitalMinimum == digitalMaximum` it was positively false: the
    header had already recorded `DEGENERATE_DIGITAL_RANGE` for that signal, and `toPhysical` named
    it. Two public entry points answered the same question about the same signal with two codes.
  - `scalingError` is now shared. The re-derivation order stays owned by `header/scale.ts` and its
    follower in `decode/physical.ts`, so the envelope path cannot drift from it again, and the
    envelope error gains the raw fields and the spec reference it had been dropping. The
    consequence clause and the next step — plot the digital envelope, rather than call
    `decodeDigital` — are what genuinely differ, and stay per-caller.

## 0.3.110

- **Fixed** `formatHeader` printing a calendar year without the padding every other renderer in the
  package applies, so one `edfcore header` run spelled the same date two ways.
  - `format-header.ts` carried its own `formatDate`, which padded the month and the day but not the
    year. `formatCalendarDate` in `header/dates.ts` — used by `formatStartTimeNaive` and by every
    diagnostic — pads all three. A year below 1000 is reachable from a conforming-length field:
    `parseSubfieldDate` requires the EDF+ `dd-MMM-yyyy` Startdate year to be four CHARACTERS, not
    to be at least 1000, so `Startdate 24-APR-0985` resolves to year 985. The header line then read
    `985-04-24` while a `DATE_FIELDS_DISAGREE` diagnostic eight lines below it read `0985-04-24`.
  - `formatHeader` now calls `formatCalendarDate`, keeping its own `undefined` → `unknown` branch.
    One renderer for the type.

## 0.3.109

- **Fixed** three more places saying one file in the package holds every `node:` import.
  - The true statement is about reachability, which is what the packaging test checks and what
    0.3.84 corrected four places to say. It missed `api-sources.md` ("the only module in the
    package that imports a Node built-in (`node:fs/promises`, and nothing else)"),
    `data-sources.md` (the same in the other phrasing) and `src/index.ts`, which ships in
    `dist/index.d.ts`. `src/cli.ts` imports `node:fs/promises` **and** `node:process` and is the
    package's `bin`, inside the published `files` list, so all three were false — and the
    parenthetical was false twice over.
  - The guard is anchored to the code rather than to three sentences: it asserts the premise
    (exactly `cli.ts` and `node.ts` import `node:`, and nothing reachable from the universal entry
    imports `node.js`) and only then sweeps every page and every `src/` docblock for the
    package-wide phrasing. If a refactor ever really does leave one importer, the premise fails
    first and the sentences become sayable again.

## 0.3.108

- **Fixed** the strict-mode claim in three more places, and rewrote the guard so a rewording cannot
  walk past it again.
  - `collector.ts` gates on `this.strict && diagnostic.severity !== 'info'`, so a strict parse of a
    file whose only note is `info` resolves with that note present — and
    `DATE_CLIPPED_TO_1985_2084` is carried by nearly every conforming EDF file. Still saying
    otherwise: `api-reading.md` twice ("the first defect of any severity", "the first diagnostic of
    any severity", four lines from a row on the same page stating the exemption),
    `api-primitives.md` ("Empty under `strict`, because the first one threw"), and the
    `collector.ts` module docblock itself — sixty lines above the gate that disproves it, and
    shipped verbatim in `dist/diagnostics/collector.d.ts` as hover text.
  - The guard now normalises whitespace and comment leaders before matching, tests the CLAIM rather
    than a sentence, and sweeps `src/**/*.ts` as well as the doc pages — `tsconfig.build.json`
    keeps comments, so a `src/` docblock is published documentation. 0.3.76 pinned two exact
    strings and missed three pages; 0.3.90 widened the strings and missed three more. A guard that
    would still pass if the claim came back is not a guard, and this one had failed that test twice.

## 0.3.107

- **Fixed** `DATE_UNPARSEABLE` meaning one thing in `edfcore` and another in `edfcore/validate`.
  - The parser reports it whenever the 8-byte `dd.mm.yy` field fails its grammar. `validateHeader`
    reported it on `startTime.dateSource === 'none'` instead — the resolved date rather than the
    field — so a header with `32.13.05` beside a conformant `Startdate 02-AUG-1951` was called
    defective by one published entry point and clean by the other. A caller on the recommended
    two-read, no-I/O path was told the date fields were fine. Same for a blank field and for
    `00.00.00`, which are the commoner real-world shapes.
  - `validateHeader` now uses the field-level condition. `32.13.05` is eight corrupt bytes whether
    or not something else rescues the date; narrowing the parser instead would have left them with
    no diagnostic anywhere. The message branches, so the rescued case says the date survives rather
    than claiming the recording has none.
  - The three doc statements that equated the code with "no calendar date at all"
    (`api-errors.md`, `api-validate.md`, `validation.md`) now say what it means, and record that
    `startTime.dateSource` is what distinguishes the two outcomes.
  - This is the asymmetry 0.3.81 fixed for `DATE_FIELDS_DISAGREE` under the `yy` escape, and the
    last of the shared codes still holding it. The new guard asserts both halves on one header,
    against `validateHeader` rather than `validateRecording` — the latter merges
    `header.diagnostics` into its report, so asserting there would have passed on the parser's copy
    alone and pinned nothing.

## 0.3.106

- **Changed** `decodeAnnotations` and `readAnnotations` to throw `EdfChannelNotFoundError` for a
  signal index the file does not have, matching the ten other entry points that take one.
  - `resolveSignals` collapsed two different mistakes into one branch. An index outside
    `header.signals` therefore produced a bare `RangeError` with no `selector` and no
    `availableLabels`, `isEdfError` returned `false` for it, and the message read "signal 99 is not
    an annotation signal" — which describes a signal that exists with the wrong kind. This is the
    asymmetry 0.3.35 fixed for the envelope path, where `isEdfError` answered differently depending
    on which read the caller had reached for.
  - The plain `RangeError` stays for the case the docs actually describe and the carve-out's own
    reason covers: a real data signal, whose samples this module exists to keep out of a text
    parser. There are no samples at index 99.
  - The test named for that rule only exercised index 0, which is how the two halves drifted apart.
    It now covers both.

## 0.3.105

- **Fixed** a discarded TAL still reporting that it was kept.
  - The `onset-unsigned` defect — "so the TAL was kept and the onset read as positive" — was logged
    at the point the missing sign was recovered, which is upstream of the four branches that can
    still throw the same TAL away: an out-of-range onset, an over-long duration field, a bad
    duration grammar and an out-of-range duration. An unsigned onset combined with any of them
    produced two `TAL_MALFORMED` entries about one TAL asserting opposite outcomes, and the one
    that ran first was the false one. With an out-of-range onset the pair is indistinguishable by
    anything but prose: same code, same offset, same length, same raw bytes, `occurrences` 1 each.
  - It is now logged once the TAL is known to survive, ahead of the text scan so a kept TAL's
    issues keep the order they had. Consequently its `occurrences` counts surviving unsigned
    onsets, and its offset and raw bytes are the first surviving one's.
  - 0.3.19 fixed the cross-TAL version of this by keying the log on the defect kind. That stops two
    different TALs from describing each other and does nothing for one TAL describing itself twice;
    both guards written for it build two TALs, so they passed throughout. The new guard builds one.

## 0.3.104

- **Fixed** annotation text reaching a diagnostic message unescaped, which let a file forge a
  detail line inside a genuine `TIMEKEEPING_TAL_NONCONFORMANT` block.
  - `formatDiagnostics` re-emits a message's continuation lines at the same two-space indent
    `detail()` uses. Annotation text carrying 0x0a therefore rendered as a line indistinguishable
    from a `spec:` or `raw:` detail edfcore emitted — visible on stdout through `edfcore validate`.
    An ESC byte passed through with `color: false`. The TAL grammar reserves only 0x00, 0x14 and
    0x15, so both bytes reach `annotation.text` unchanged.
  - This is the class 0.3.2, 0.3.16, 0.3.47 and 0.3.48 were all applied for. The reasoning that
    retired it argued the message was safe *because* continuation lines are indented — true of the
    left margin, false of the detail indent, which is the same two spaces. `hostile-text.test.ts`,
    the guard named for the class, had no case for a message built from file text; it does now, and
    it asserts the rule (no message carries a control character) rather than one rendering.
  - `escapeControls` is now exported from `src/tal/grammar.ts`. `previewBytes` escapes for exactly
    this reason but takes a byte slice; annotation text arrives already decoded.

## 0.3.103

- **Fixed** a regression 0.3.84 introduced in the `edfcore/node` docblock, which ships in
  `dist/node.d.ts` as the subpath's hover text.
  - 0.3.84 correctly removed "the ONLY module in edfcore that imports anything from `node:`" —
    `src/cli.ts` imports two and ships as `bin` — and replaced it with "the only module **reachable
    from the universal entry** that imports anything from `node:`". That asserts the opposite of the
    invariant: the point of this module is that `edfcore` **cannot** reach it, which is what lets
    the universal entry bundle for a browser. The paragraph four lines below said so, so the
    docblock contradicted itself.
  - It now leads with the invariant, and the history note keeps both retired sentences so the
    mistake is not made a third time.
- The guard checks the HEADLINE only. The history note quotes both retired sentences deliberately,
  so a whole-file match finds the quotation rather than the claim — which is exactly what the first
  draft of this guard did, the same trap as 0.3.78. It also asserts the invariant itself: no module
  in `src/` other than the `bin` entry imports `./node.js`.

## 0.3.102

- **Fixed** `tests/corpus/coverage.test.ts` asserting nothing on the run it exists to protect.
  - The file's docblock says it "checks the parts that need no corpus at all — that the manifest and
    the goldens agree. A golden for a file the manifest no longer lists ... is a real drift that no
    amount of skipping should hide." Its one test early-returned when the corpus was absent, with
    `expect(corpusGoldens().length).toBeGreaterThanOrEqual(0)`. A length is never negative, so on
    `git clone && npm test` — no corpus, which is the case the whole file is about — it checked
    nothing.
  - The manifest-versus-goldens half is now its own test and always runs: both sides are committed,
    so it needs no corpus. The half that genuinely needs the files still skips without them, and
    says so.
- Canaried in the state that matters: with `tests/corpus/files/` moved away and a manifest entry
  removed, the new test fails and names the orphaned golden. Before this it passed.
- Fifth release in this batch about defect shape (e) — a guard that would still pass if what it
  names regressed. Found by sweeping the whole suite for self-comparisons and structurally weak
  assertions after 0.3.101, rather than one at a time.

## 0.3.101

- **Fixed** an assertion in `tests/corpus/whole-api.test.ts` that compared a value with itself:
  `expect(inspection.header.signals.length).toBe(inspection.header.signals.length)`. Both operands
  are the same expression, so it held for every input.
  - It was the only consistency check in the test the file's docblock calls "the strongest promise
    in the package", under a comment reading "Whatever it reports must be internally consistent
    rather than merely present". Across five corpus files it checked nothing.
  - Replaced with invariants that can fail: the two index arrays partition the signals exactly once,
    `headerByteLength` is the `256 * (ns + 1)` the signal count implies, `bytesRead` exceeds neither
    the file nor the 128 KiB ceiling, and `ok` equals "no error-severity diagnostic" — the rule the
    `inspectEdf` docblock states.
- Each new assertion was canaried by breaking the behaviour it names and confirming it fails.
  Two earlier attempts were rejected: one could not distinguish anything on a clean corpus, and one
  broke module loading instead of changing behaviour, which is not a canary.
- Defect shape (e), the one this project keeps re-learning: a guard that would still pass if what it
  names regressed. It has now been the subject of 0.3.52, 0.3.78, 0.3.80, 0.3.90 and this release.

## 0.3.100

- **Fixed** `diagnostics.md` recommending, as the alternative to a gate it warns against, a gate
  that gives the same verdict.
  - The callout says `summarizeDiagnostics(...).errors > 0` must not gate a read, because the
    deferred group carries `error` severity while the file parses and decodes perfectly — one signal
    has no `scale` and every other signal is fine. It then offered "the thrown `EdfError`, or
    `validateRecording`'s `report.ok`".
  - `report.ok` is `diagnostics.every((d) => d.severity !== 'error')` over a **superset** of
    `header.diagnostics`, so it is false on exactly the files the callout is about. On a two-signal
    file with one degenerate physical range: `errors > 0` is `true`, `report.ok` is `false`, and the
    good signal reads all sixteen of its samples. A reader who followed the advice moved from one
    gate to an identical one and still threw away the file.
  - The callout now names the thrown `EdfError` alone as the read gate, and says what `report.ok`
    actually answers — "did this pass a conformance sweep", a different and stricter question.
- The test builds that file and asserts the two gates AGREE, which is the fact that made the
  recommendation wrong, then checks the retired sentence is gone.

## 0.3.99

- **Fixed** the CLI usage banner scoping `--patient` to "(header, json)". `redaction(args)` is
  applied by `validate` too, so the flag un-redacts patient identification there as well: without it
  a `PATIENT_ID_NONCONFORMANT` diagnostic renders the field as `[redacted]`, with it the full name.
  - The flag exists so that the default output of a command someone pipes somewhere carries no
    patient name. A banner that under-states which commands it governs is the wrong direction to be
    wrong in: a reader gating on "validate doesn't print names anyway" is gating on nothing.
  - `api-helpers.md` carried the same pair and now names all three.
- The test DERIVES the scope: it runs every subcommand with and without the flag over one
  non-conformant file, collects the ones whose output changes, and requires the banner line to list
  exactly those. It first asserts more than one command is affected, so it cannot pass on a file
  where the flag does nothing.

## 0.3.98

- **Fixed** `fileSource` carrying, as advice, a check it never performed. Its size refusal ended
  "Next: check that the path names a regular file rather than a directory, a pipe or a device", and
  none of the three can reach that branch.
  - The branch fires only on `!Number.isSafeInteger(size) || size < 0`. A directory's `st_size` is
    its allocation — 64 on macOS — and a FIFO's and a character device's is 0. All ordinary safe
    integers, so the guard never fired for any of the causes it told you to check.
  - `fileSource(dir)` therefore returned a working-looking `ByteSource` with `byteLength: 64`, and
    the failure arrived on the first read as a raw `EISDIR` from Node — an error edfcore never
    shaped, past the point where the caller could still act on it.
  - It is now an actual check, before the size guard, using the `isFile()` the same `stat()` already
    returns. The size guard's own "Next:" no longer points at causes it cannot be about.
- No new syscall: `fs.open` already returns the handle whose `stat()` was being called two lines
  later; only the declared shape of the shim widened.

## 0.3.97

- **Fixed** `httpSource()` issuing its size probe after the caller cancelled, and resolving a live
  source for a call that had already been aborted.
  - `resolveSource` polls the signal once, at entry, then issues the HEAD inside a bare `catch {}`
    that swallows every rejection — including the `AbortError` the platform `fetch` raises on
    cancellation — with no poll between that catch and the one-byte `Range` probe.
  - For a caller holding a bare `{ aborted }` shim the harm is complete: `attachSignal` cannot hand
    such a signal to `fetch`, so nothing else observes the flip, and `httpSource()` completed both
    requests and returned a usable source. With `allowFullDownload` that is a whole file
    transferred after cancellation.
  - `api-sources.md` promises "a caller who passed a bare `{ aborted }` shim is still served by the
    polls around the request, so cancellation works either way", and the comment above the entry
    poll says resolution must catch this "otherwise `httpSource()` itself does network work after
    cancellation". Both were true of reads and not of resolution.
- One poll, after the catch. The test asserts the request METHODS issued are exactly `['HEAD']`, so
  it pins that nothing goes out after the flip rather than only that the call rejects. It sits
  beside the existing shim test for `read`, which was the path that already had one.

## 0.3.96

- **Fixed** the `edfcore header` signal table's column header row, which was one to two characters
  off the columns beneath it on every file.
  - The header row was a hand-spaced literal while the data rows are built from `padEnd(21)`,
    `padEnd(12)` and `padEnd(9)`. It carried one space too many after `label` and one after `kind`,
    so `kind` sat at column 27 over data at 26, and `rate` and `range` were two out.
  - It is now built from the same widths, so the two cannot drift apart again by construction.
- Small, and in the one output whose entire purpose is being read in a terminal — a misaligned
  header is exactly the kind of thing that makes a reader distrust the numbers under it.
- The test asserts each header word starts at the column its own data starts at, rather than
  comparing the row against a second hand-written literal.

## 0.3.95

- **Fixed** the published `trimToWindow` selection rule, which was still the one 0.3.56 replaced —
  in the function's own docblock and on two pages, one of them the reference a caller consults to
  predict which sample a window will start at.
  - All three said the samples inside the window are those with
    `j * recordDuration >= relativeStart * samplesPerRecord`. That compares the sample's **exact
    rational** start. The implementation compares the tick edfcore **publishes** for it —
    `ceil(j * recordDuration / samplesPerRecord)`, the value `gridSampleStartTicks` and
    `sampleStartTicksOf` report — which is what 0.3.56 changed it to, and why.
  - The two differ whenever a boundary is not a whole tick: 256 samples in a one-second record puts
    sample 1 at 39,062.5 ticks, published as 39,063. So the documented rule names a different
    boundary sample from the real one on **half** of all sample-aligned windows at the commonest EEG
    geometry there is.
  - All three now state the published-tick rule, and say why the distinction exists.
- The guard reads all three back and requires the retired formula to be absent and the current one
  present, so a fourth statement cannot appear in the old form.

## 0.3.94

- **Fixed** `edfcore header` discarding `recording.timeline.diagnostics` — the findings of a read it
  had already paid for.
  - `openEdf` probes record 0 and the last record and records what it learned there. The command
    printed only `header.diagnostics`, so an **EDF+C** file — one that declares itself continuous —
    with a real 20-second hole came back as `1 diagnostic(s): 1 info`, never naming
    `DISCONTINUITY_IN_CONTINUOUS_FILE`. `edfcore gaps` on the same bytes reported the gap.
  - The probes' findings now print in their own labelled block. `formatHeader`'s summary line is
    scoped honestly — it names `header.diagnostics` and points at that array — so the omission was
    the command's, not the formatter's, and the fix belongs in the command.
- The test checks both commands against each other on one file, and asserts a clean file gains no
  extra block, so the fix cannot pass by printing a header nobody needs.

## 0.3.93

- **Fixed** `fileHandleSource` handing a short read the advice written for a source the CALLER
  wrote.
  - When the bytes run out — `fileSource` stat'd the file and it was then truncated or rotated, a
    caller passed a `byteLength` larger than the file, or a picked `File`'s backing file shrank —
    the read fell through to `assertExactRead`, whose message ends "Next: make read() loop until
    `length` bytes have arrived, and reject if they never do." The loop it asks for is twelve lines
    above it, edfcore wrote it, and it already reads until EOF. No amount of looping produces bytes
    the file does not contain.
  - It now says what happened: the file ended after N of the bytes asked for, the source was built
    for M, and the two ways that happens. `assertExactRead` still backstops the return.
- Same shape as 0.3.75, which fixed it on the HTTP buffered-body path. The guard is for a
  `ByteSource` edfcore did not write; when the source IS edfcore's, its advice names a `read()` the
  caller does not have.

## 0.3.92

- **Fixed** three statements of `readTriggers`' `precededByGap` rule that describe the behaviour
  0.3.67 replaced. Two of them ship in `dist/*.d.ts` as the hover text an editor shows.
  - They say the flag goes on "the first in-window sample of every contiguous run"
    (`src/biosemi.ts`, `api-helpers.md`) or "the FIRST event of each contiguous run"
    (`src/types.ts`). 0.3.67 narrowed it to the event whose tick **is** the run's resume instant,
    because `resolveTimeWindow` is record-aligned and a window is not — so the flag was landing on
    whichever sample the window happened to admit first, up to a record later than the resume.
  - The consequence of the stale wording is the opposite of harmless. On a window that opens after
    the resume instant, **no** event carries the gap: `[10.4, 11.4)` over a file resuming at 10 s
    returns four events and zero flags. A consumer following any of the three expected one per run
    and got none, with nothing to indicate the difference.
- The test asserts both halves of the real rule — flagged at the resume instant, not flagged when
  the window opens after it, with events returned in both cases — and then greps all three published
  statements for either phrasing of the retired one.

## 0.3.91

- **Fixed** `edfcore gaps` claiming that `edfcore validate` "is the gate, and it already exits 1 on
  an overlap through `RECORD_ONSET_SPACING_VIOLATION`". It does not: that code's disposition is
  `warning`, so `report.ok` stays true and `validate` prints **PASS** and exits **0** on the same
  file `gaps` has just printed an overlap for.
  - A reader who took the comment at its word gated a CI job on a command that passes the defect —
    the exact use the exit-code contract exists for.
  - The disposition is the considered half and is unchanged: `diagnostics.md` lists the code in the
    warning table, an overlapping file is still readable, and that is why `mergeChunks` refuses the
    join rather than the reader refusing the file. Backwards onsets — `TIMELINE_NOT_MONOTONIC` — are
    the fatal case. The comment was the wrong half.
- The test pins what both commands actually do on one overlapping file, and asserts the retired
  sentence is gone from the source, so the claim cannot drift back silently.

## 0.3.90

- **Fixed** three more pages carrying claims two earlier releases retired, and **widened both
  guards** so they match the claim rather than one phrasing of it.
  - `api-errors.md` said the first would-be diagnostic "of *any* disposition throws" and that this
    is "why every `diagnostics` array is empty by construction in strict mode". `diagnostics.md`
    said the same in different words. Both are the claim 0.3.76 removed from three other places:
    `info` is exempt, and a strict parse of a file whose only note is `info` resolves carrying it.
  - `large-files.md` called `buildRecordIndex` "the one call in edfcore that does traverse the whole
    file" — the claim 0.3.83 corrected on two other pages. `validateRecording` is the other.
- The guards are the real defect here. 0.3.76 pinned the exact strings it happened to find
  (`consequently empty`, `exempts nothing`) and 0.3.83 pinned `only function in edfcore that reads
  the whole file`. Every page that said the same thing in slightly different words walked straight
  past them — which is how a sixth sweep found them as fresh findings rather than the suite catching
  them. Both now match the claim: any spelling of "every diagnostics array is empty", and any
  spelling of "only one function/call reads or traverses the whole file".
- A guard written around the instance you just fixed is a guard that catches nothing else. Widening
  these two turned up all three of these pages immediately.

## 0.3.89

- **Fixed** the envelope budget guard measuring 12 bytes per bucket while the fixed-width path
  allocates 20, so a call granted exactly the byte count its own refusal named allocated **1.67x**
  it.
  - `reduceRange` counts `min`, `max` and `counts` — one `Int32Array` each — refuses above the
    budget, and then `bucketStartsFor` allocates a `Float64Array(bucketCount)` per signal, after the
    guard and uncounted by it. A `readEnvelopeAtResolution` call whose refusal asked for 9,600,000
    bytes allocated 16,000,128 when given exactly that.
  - It happens on the one path the budget exists for: the comment above the guard cites "a fixed
    width fine enough — one microsecond over an hour — asks for billions of buckets".
    `large-files.md` says `maxMaterializeBytes` "caps any single allocation edfcore makes on your
    behalf" and throws "**before** anything is allocated, not part-way through".
  - The guard now adds 8 bytes per bucket per signal on the fixed-width path and nothing on the
    even-division path, where the array is never built.
- The test reads the byte count out of the refusal, grants exactly that, and counts every
  `Int32Array` and `Float64Array` constructed during the call. It asserts the fixed-width branch was
  the one taken first, so it cannot pass on the path where the extra array does not exist.

## 0.3.88

- **Fixed** `data-sources.md` saying the ignored-`Range` check "happens during the length probe,
  before a second request is made". The probe runs on only one of the three ways `httpSource` learns
  a length, and on the other two the check cannot fire until the caller's first `read()`.
  - `httpSource` returns before the probe when `options.byteLength` was supplied, and again when
    `HEAD` gave a usable `Content-Length`. A CDN that answers `HEAD` and then ignores `Range` — the
    ordinary shape of this failure — therefore hands back a source that constructs cleanly and
    refuses the first read. A reader who trusted the page treated a successful `httpSource()` as
    proof the origin honours `Range`.
  - The page now gives the rule as a table of the three paths and says which of them can see a 200
    at construction.
- The test drives both branches through a fake `fetch` and asserts the request METHODS issued —
  `['HEAD']` when HEAD answers, `['HEAD', 'GET']` when it does not — so it pins the reason the two
  behave differently, not just that they do.

## 0.3.87

- **Fixed** `api-validate.md` saying "The other five are also emitted by the parser" under a
  ten-row table from which four codes had just been excluded. Ten minus four is six, and all six
  really are parser codes: `RECORD_SIZE_ABOVE_RECOMMENDED`, `PATIENT_ID_NONCONFORMANT`,
  `RECORDING_ID_NONCONFORMANT`, `DATE_UNPARSEABLE`, `DATE_FIELDS_DISAGREE` and
  `STARTTIME_UNPARSEABLE`.
- The sentence is load-bearing — it is how a reader knows the report stands on its own rather than
  only making sense beside `header.diagnostics` — so a reader who counted the table and got a
  different answer had reason to doubt the claim rather than the arithmetic.
- Both numbers are now derived from the table itself: the count of rows, minus the count the prose
  says exist nowhere else. Adding a row fails the suite until the prose is updated, which is the
  rule 0.3.63 applied to `diagnostics.md` after the same kind of drift.

## 0.3.86

- **Fixed** `formatStartTimeNaive`'s reference entry naming one of its two `undefined` cases, and
  naming it as an equivalence: "Returns `undefined` when `startTime.resolvedDate` is `undefined`,
  i.e. the file carries no resolvable date."
  - It also returns `undefined` when `startTime.clockSource === 'none'` — the `hh.mm.ss` field
    failed its grammar, so `startTime.clock` is a substituted midnight and there is no instant to
    render. That case was added deliberately in 0.3.17, because a file whose starttime reads
    `23.59.60` otherwise came back as `...T00:00:00.000`: a wall-clock instant the file never gave,
    and for a sleep study the most believable start there is.
  - `validation.md` and the source docblock both state it. The function's own reference page did
    not, so a caller who checked `resolvedDate` first — exactly what the "i.e." invites — still got
    `undefined` and had nothing to look up.
- The entry now lists both conditions in a table and says which release added the second. The guard
  checks the page names both **and** exercises the behaviour on a `23.59.60` file, so the page is
  pinned to the code rather than to itself.

## 0.3.85

- **Fixed** four pages denying a comparison the test suite performs on every run.
  - `api-primitives.md` — the page a caller reads to decide whether to trust the pinned scaling
    expression — said the float64 parity with pyEDFlib "isn't yet demonstrated by a golden-value
    harness, so treat it as intent rather than a measured guarantee". `api-validate.md` and
    `validation.md` said edfcore's output "has not been compared element by element" against
    pyEDFlib or MNE. `comparison.md` said validation against the public corpora "has not happened
    yet".
  - `tests/corpus/golden-values.test.ts` writes its fixtures with pyEDFlib's own writer, reads them
    back with pyEDFlib, and compares every physical sample against the IEEE-754 bits it produced
    using `Object.is` — a one-ULP difference fails. `mne-parity.test.ts` does the same for MNE. The
    goldens are committed, so both run on a fresh clone. The harness has existed since 0.2.34-0.2.48.
  - The pages now say what is measured and what is not, and `comparison.md` says plainly that the
    corpus tests SKIP without `npm run corpus:fetch` — so a fresh clone proves the golden comparison
    and not the corpus one. Understating a guarantee is still a false statement about the package.
- Same class as 0.3.64, which removed this wording from three other pages and missed these four. The
  guard now sweeps every page for both retired phrasings.

## 0.3.84

- **Fixed** four statements that the `node:` import lives in exactly one file. `src/cli.ts` imports
  `node:fs/promises` and `node:process` and ships as the package's `bin`.
  - `src/node.ts` called itself "the ONLY module in edfcore that imports anything from `node:`" and
    said "keeping the import in exactly one file" is what makes the browser build work.
    `installation.md` repeated both. The invariant the packaging test actually checks is narrower and
    is the one that matters: nothing **reachable from the universal entry** imports `node:`, which
    is why `edfcore` bundles for a browser without a polyfill.
  - The `bin` program is a Node program by definition and no import path reaches it, so the code is
    right and only the claims were wrong. All four now state the reachability rule, and
    `installation.md` names the CLI's imports outright rather than leaving a reader to discover a
    fourth published entry that contradicts the page.
- **Also fixed** `src/node.ts` saying "edfcore has no other lifetime mechanism in v0.1". Because
  `tsconfig.build.json` keeps comments, that sentence ships in `dist/node.d.ts` as the hover text
  for `fileHandleSource` — the same "v0.1" scoping 0.3.64 removed from three website pages, still
  reaching every consumer of the subpath.
- The version guard from 0.3.53 swept the website only. It now sweeps `src/` too, since those
  docblocks are published, and it catches the exact sentence this release removed.

## 0.3.83

- **Fixed** two pages calling `buildRecordIndex` "the only function in edfcore that reads the whole
  file" — `api-reading.md` in bold, `discontinuous.md` in its opening line.
  - The docblock on the function itself says "one of only two functions that read the whole file,
    the other being `validateRecording`", and the source is right: on an EDF+/BDF+ file with no
    supplied index, `validateRecording` reads every record to derive the annotation onsets. It does
    so even with `scanSamples: false`, which is exactly what 0.3.77 was about.
  - Someone planning I/O against a remote file reads that sentence to decide which calls are safe to
    make. Both pages now carry the source's own count.
- The guard sweeps every docs page for the retired sentence and then asserts the behaviour behind
  the correction — `validateRecording(recording, { scanSamples: false })` reporting
  `recordsScanned` equal to the file's record count — so it is anchored to the second full-file
  reader actually existing.

## 0.3.82

- **Corrected** the `time/segments.ts` docblock, which promised that running
  `assertMonotonicOnsetArray` on the onsets first means "a gap can then only have a non-negative
  duration". Ninety lines below it, the comment on `durationTicks` says "Negative for an overlap."
  - Monotonicity is `onset[r] >= onset[r - 1]`, and an **overlap satisfies it**: `onset[r]` can be
    at or after its predecessor and still before `onset[r - 1] + recordDurationTicks`.
    `buildSegmentation` then closes the earlier segment past where the next one begins, and the gap
    between them is negative — which is what `index.gaps` reports for a real overlapping file, and
    what an existing test has asserted since 0.3.41 (`durationTicks` of `-2_000_000n`).
  - The docblock now says what monotonicity actually buys: every segment starts at or after the one
    before it, and nothing more.
- The test that pins the negative gap now also asserts that the same array passes
  `assertMonotonicOnsetArray`, so the two halves of the retired claim are checked against each other
  rather than separately.

## 0.3.81

- **Fixed** `validateHeader` being structurally unable to report `DATE_FIELDS_DISAGREE` under the
  EDF+ `yy` year escape, which the parser reports for the same header.
  - `checkDates` guards on `startTime.headerDate !== undefined`. The escape leaves that field
    `undefined` by construction — the header still states a day and a month, just no year — so the
    guard could never hold, and a file whose startdate says `01.01.yy` while its Startdate subfield
    says 02 May came back clean from `validateHeader` and defective from `openEdf`.
  - `resolveStartTime` has compared the day and month in that case all along, so the two halves of
    the package disagreed about whether the same header has a defect. `validateHeader` is
    documented as a pure check that stands on its own; it did not.
  - It now re-parses the raw field, which is the only place the day and month survive when
    `headerDate` is `undefined`, and reports the same disagreement with the same code.
- The test asserts the premise — that the escape really does leave no header date to compare — and
  checks the agreeing case stays silent in both, so it cannot pass by reporting everything.

## 0.3.80

- **Fixed** `EdfRangeError.available` meaning two different things depending on which check refused.
  - `api-errors.md` documents one meaning — "what the file has, always starting at `0`" — and shows
    `clampToFile(error.available)` as the recipe. The out-of-range check passes exactly that. The
    buffer-length check beside it passed `{ start: records.start, count: <whole records in the
    buffer> }`: not the file's range, and not based at 0. `decodeAnnotations` had the same.
  - On a three-record file, `decodeDigital(header, wholeFileBuffer, { start: 1, count: 2 })` reported
    `available` as `{ start: 1, count: 3 }` — a range the file never had — so the documented clamp
    produced records 1..3 of a file that ends at 2.
  - Both now pass the file's range. This is a **behaviour change** to a public field, and one
    existing test asserted the old value.
- The buffer's whole-record count is not lost: it moves into the message, which already stated the
  rest of the byte arithmetic exactly, so "19 bytes — 2 whole record(s) — but 3 records of 8 bytes
  each are exactly 24" now says everything the field used to carry.
- The new test drives a mis-sized buffer for a range that starts at 1 and stays **inside** the file.
  At `{ start: 2, count: 2 }` on three records the out-of-range check fires first and the case
  proves nothing — which is how the first draft of this test passed with the bug reinstated.

## 0.3.79

- **Fixed** `cachedSource` leaving an aborting caller pending for the whole underlying block read.
  - 0.3.43 stopped one reader's signal cancelling a block other readers were waiting on — right, and
    unchanged — and justified it by saying `read` "already polls each caller's own signal before and
    after `Promise.all`, so an aborting caller still rejects promptly". The only poll that can fire
    is the one **after** the gather. So the caller's promise settled when the bytes it no longer
    wanted arrived, and with the signal no longer reaching the source, nothing was watching it at
    all. A viewer aborting a scrolled-past window held that promise for the full fetch.
  - `read` now races the caller's own signal against the gather. The shared block read is untouched:
    other readers still get it, and losing the race leaves nothing dangling, because the block
    promises are already attached inside `blockFor`.
- `AbortSignalLike` is `{ aborted: boolean }` and nothing more, so a signal that carries no
  `addEventListener` cannot be watched and the post-gather poll remains the answer for it. A real
  `AbortSignal` — what callers actually pass — is watched and rejects the moment it fires, with the
  same `AbortError` `throwIfAborted` produces, so nothing branching on `error.name` can tell which
  route rejected it.

## 0.3.78

- **Fixed** `sample-grid.ts` sending a reader to `onsetTicks` where `sample-locate.ts` sends them to
  `onsetTicksFromFirstRecord`, for the identical refusal.
  - Both modules refuse an annotations channel with the same sentence — it holds TAL text, so it has
    no sample grid — and then name different fields to use instead. The grid puts sample 0 at
    `t = 0`, which is the start of record 0: the **rebased** axis. `onsetTicks` is on the header's
    timebase, and the two differ by the sub-second offset record 0's timekeeping TAL may declare.
  - On a file with a 0.25 s offset, `gridSampleStartTicks(signal, 4, d)` is 10000000 and the event
    written at that instant reports `onsetTicks` 12500000. The reader was sent to the field that
    does not line up with the numbers the module they had just called returns. `sample-locate.ts`
    had it right.
- The guard reads both refusals out of the source and requires them to name the same field. Its
  first version passed with the bug reinstated, because the explanatory comment above the message
  names both fields and the slice picked it up — it now strips comment lines before matching, and
  says so, since that is the only reason it works.

## 0.3.77

- **Fixed** `validateRecording`'s scan-budget refusal offering advice that does not work on the
  files most likely to hit it.
  - It ended "Next: raise options.maxMaterializeBytes, or drop scanSamples and validate the header
    alone." On EDF+/BDF+ dropping `scanSamples` does not stop the sweep reading: the record onsets
    live in each record's annotation region, so the traversal runs either way and refuses again at
    the same budget — this time from the record-read guard, whose own advice is "read fewer records
    per call", which is not a lever this caller holds. The reader was sent round a loop.
  - On a two-record file of 50,000 samples at a 4 KiB budget: `scanSamples: true` refuses,
    `scanSamples: false` refuses again on EDF+, and resolves on plain EDF. So the offer was right
    for exactly the files that have no annotations channel.
  - The offer is now made only when dropping the scan really does stop the reading. On a file with
    an annotations signal it says so and names `validateHeader(header)`, which is the form that
    reads nothing at all.
- The test asserts the premise too — that following the old advice on an EDF+ file throws a second
  budget error — so it is checking the behaviour rather than the sentence.

## 0.3.76

- **Fixed** two false claims about `strict`, in the reference page, the design record and the
  published `ParseOptions` type.
  - `api-reading.md` said a `DATE_CLIPPED_TO_1985_2084` note is "a thrown `EdfFormatError` all the
    same, because `strict` exempts nothing that names a real deviation", and built a paragraph on
    it ("more unforgiving than it first looks"). `collector.ts` gates on
    `this.strict && diagnostic.severity !== 'info'`, and that code is `info`, so a strict parse of
    such a file **resolves**. 0.3.62 fixed the same claim on `concepts.md`; this is the stronger
    version of it, on the reference page.
  - All three said that under `strict` "every `diagnostics` array is consequently empty". It is not:
    the `info` notes are still collected. A strict parse of a file whose only note is `info` comes
    back with that note on `header.diagnostics`.
  - The exemption is the point, and each place now says so: nearly every conforming EDF file carries
    that code, because the mandated `dd.mm.yy` startdate has a two-digit year, so throwing on it
    would make `strict` reject the files it exists to accept.
- The guard sweeps every docs page for both retired sentences **and** asserts the behaviour they
  described — a strict `openEdf` resolving with exactly that one `info` diagnostic — so it is
  anchored to the code rather than to two strings that could be reworded into the same falsehood.

## 0.3.75

- **Fixed** `httpSource` blaming its own `ByteSource` contract when the caller's source length is
  wrong and the whole body was buffered.
  - One fault — this source was built for N bytes and the resource is really M — got two different
    diagnoses, decided only by whether the server honoured `Range`. Over a 206 it got the message
    0.3.37 wrote for it: the resource's real size, the length the source was built for, and
    `options.byteLength` to look at. Over the buffered path it fell through to `assertExactRead`
    and came back as "A ByteSource must resolve with exactly the requested number of bytes...
    Next: make read() loop until `length` bytes have arrived, and reject if they never do."
  - That guard exists for a source the CALLER wrote. Here the source is edfcore's own `httpSource`:
    there is no `read()` to fix, and no number of retries produces bytes the resource does not
    contain. Meanwhile the real size was sitting in `body.byteLength` as the message was built —
    the same "the real size sat unread in the response just rejected" shape 0.3.37 removed.
  - `options.byteLength` together with `allowFullDownload` is exactly the pair `data-sources.md`
    recommends when an origin is broken, so it is the combination a reader reaches for and the one
    that produced the unactionable advice.
- `sliceFullBody` now diagnoses the overrun itself, with the same three facts the 206 branch
  reports, and `assertExactRead` still backstops the slice.

## 0.3.74

- **Fixed** `DUPLICATE_SIGNAL_LABEL` quoting the trimmed label as its `raw` while reporting the
  full 16-byte label field.
  - `raw` is contractually "those bytes as text, exactly as written **including padding**", and the
    diagnostic sets `byteLength` to the field's 16. It quoted the map key — the trimmed label — so
    the rendered block read `at byte offset 272 (16 bytes), label` immediately above
    `raw: "Fp1"`: three characters under a claim of sixteen bytes. A reader following the offset
    into a hexdump found padding the quote denied.
  - Every other signal diagnostic quotes `raw.label`, including
    `ANNOTATION_SIGNAL_HEADER_NONCONFORMANT` forty lines above it in the same file.
- Found by auditing the remaining `sink.report` sites for the mismatch 0.3.73 fixed. It was the only
  other one: every other diagnostic in the package names the same field in `field`, `byteOffset` and
  `raw`. The test now also asserts `raw.length === byteLength`, which is the invariant rather than
  the instance.

## 0.3.73

- **Fixed** `PARTIAL_FINAL_RECORD` and `TRAILING_BYTES` quoting the record-count field's bytes while
  pointing at the data section.
  - Both are built inside `resolveRecordCount` and inherited its `raw` — the eight bytes of the
    record-count field at offset 236 — while their `field` is `dataRecords` and their `byteOffset`
    lands in the DATA section. `formatDiagnostics` renders the location and `raw` as one block, so
    the output asserted that the bytes at the printed data offset read `"2       "` or `"-1      "`.
    They cannot be: for a partial record they are the tail of a truncated record, and for trailing
    bytes they are sample data.
  - `raw` is contractually "those bytes as text" — the bytes AT the offset reported — and every
    other diagnostic honours that. It is now absent on both. The declared count is already in each
    message, so no evidence is lost.
- This is the class 0.3.26 fixed for `NON_ASCII_HEADER_FIELD`: a diagnostic quoting bytes that
  contradict its own claim. A reader following the offset into a hexdump found something other than
  what the diagnostic said was there, which is worse than no quote at all.

## 0.3.72

- **Fixed** `DIGITAL_RANGE_EXCEEDS_FORMAT` promising scaling behaviour on a channel that has none.
  - The check runs for every signal, which is right: a BDF range in an EDF+ file, or an unsigned
    24-bit range in a BDF+ one, is exactly the sample-width confusion it exists to catch, wherever
    it appears. Its consequence clause was not right for every signal. On an **annotations**
    channel it still said "the declared range is used for scaling exactly as written — edfcore
    never clamps — so expect physical values that extrapolate beyond the declared physical range".
  - Nothing is scaled from those fields. The branch fifteen lines below deliberately skips
    `buildScale` for an annotations channel, `signal.scale` is `undefined`, the bytes are TAL text,
    and `toPhysical` throws `EdfScalingError` for it. The reader was told to expect a conversion
    that cannot happen, and given no reason to fix the field that is actually wrong.
  - It now says nothing is scaled from them, names why (`toPhysical` refuses the channel), and says
    the range is still worth correcting because it records that the writer confused the two sample
    widths. Data signals keep the wording they had, byte for byte.
- The warning itself is unchanged in code, severity and location — only the "Next:" clause branches.

## 0.3.71

- **Corrected** `EdfRecordIndex.onsetTicks`, documented in three places as "one targeted read of
  that record's annotation region". It reads the whole data record.
  - `record-index.ts`'s own module docblock has always said so and calls it decision 7 of the
    design: the unit of I/O is the record range, never the channel range, and `decodeAnnotations`
    owns the timekeeping rule and needs the record's full bytes to apply it. So the implementation
    and its published type disagreed about the same call.
  - The gap is not small. On a 64-channel file the annotation region is **32 bytes of a 16,416-byte
    record** — a 513x understatement — and `locate()` issues `O(log recordCount)` of these. Cost is
    exactly what a reader consults that line for when planning HTTP range requests over a remote
    file, which is the case this package exists to serve.
  - Fixed on the type (which ships in `dist/types.d.ts`), in `api-types.md`'s table, and in
    `concepts.md`, which described `locate` as costing "targeted reads".
- `tests/io/read-pattern.test.ts` now pins it: one read, of `header.recordByteLength` bytes, at the
  record's own offset, and none at all on the second call. It asserts the 32-versus-16,416 premise
  first, so it cannot pass on a file where the distinction would not show.

## 0.3.70

- **Corrected** `EdfEnvelopeChunk.bucketCount`, documented as "Buckets actually filled. Never more
  than requested, and fewer for a short run." All three clauses describe the clamped rule only, and
  the second and third have no meaning for `readEnvelopeAtResolution`, which takes no bucket count.
  - 0.3.30 removed the densest-samples clamp for that function on purpose — reducing the count
    there SHORTENS THE GRID rather than coarsening it — and its own entry says "empty buckets are
    the honest answer for a resolution finer than the data supports". So the field has counted
    unfilled buckets since then, and its docblock kept saying otherwise.
  - A 4 s run of a 2 Hz signal at 0.25 s per bucket reports **16** with **8** filled. A caller
    reading the docblock and sizing an array or a loop by `bucketCount` expecting occupancy gets
    twice what they planned for.
  - The docblock now describes the grid, points at `counts[b]` for occupancy, and states which of
    the two rules clamps.
- This one ships in `dist/types.d.ts` and appears in no docs page, so the editor tooltip was the
  only place it was stated — and the only place it could be wrong.

## 0.3.69

- **Fixed** the envelope's budget refusal telling a `readEnvelope` caller to pass a coarser
  `secondsPerBucket` — a parameter `readEnvelope` does not have.
  - `reduceRange` is shared by `readEnvelope`, whose only resolution knob is `buckets` (a plot's
    pixel width), and `readEnvelopeAtResolution`, whose knob is `secondsPerBucket`. The refusal
    hard-coded the second, and explained it in terms of a request the first caller never made:
    "one finer than the sample interval cannot show more than the samples do".
  - It is reachable from `readEnvelope`: the densest-samples clamp does not save a request for
    30,000 buckets over 32,768 samples, which is an ordinary plot width over eight seconds of a
    4 kHz channel. That caller now reads "ask for fewer buckets — a plot cannot show more of them
    than it has pixels".
- `fixedWidth` already distinguishes the two rules three lines above, so the hint follows it. This
  is the same defect 0.3.35 fixed in `assertPositiveInteger` and `resolveEnvelopeSignals`, whose
  docblocks record it: a helper shared by three entry points must not name one of them.

## 0.3.68

- **Fixed** `EdfDiagnostic.raw` on a TAL diagnostic being a pre-escaped preview rather than the
  bytes, so `formatDiagnostics` escaped it a second time.
  - `raw` is documented — in `api-types.md`, in `diagnostics.md` and on the type — as "those bytes
    as text, exactly as written including padding", and every header diagnostic sets it to exactly
    that. A TAL diagnostic set it to `previewBytes(...)`, the escaped, `...`-truncated string built
    for the MESSAGE. For a two-byte run `01 1b` the public field held the eight-character string
    `\x01\x1b`, and `quote()` then escaped the backslashes again, so the rendered detail line read
    `raw: "\\x01\\x1b"`.
  - A consumer doing anything with `raw` other than printing it — comparing it against a byte run,
    measuring it, feeding it to a hexdump — was working with a rendering of the evidence rather than
    the evidence.
  - `TalIssue` now carries both: `raw`, escaped, for interpolation into its own message, and
    `rawText`, the plain bounded Latin-1 decode, for the diagnostic field. `quote()` stays the one
    escaper, as it already was for every header diagnostic.
- Still bounded and still Latin-1: a diagnostic must not carry an unbounded copy of a record, and
  every byte must map to exactly one character even when the run is the invalid UTF-8 being
  complained about.

## 0.3.67

- **Fixed** `readTriggers` hanging `precededByGap` on the first event the window admits rather than
  on the event where the recording actually resumed.
  - `resolveTimeWindow` is record-aligned and a window is not, so a window that begins part-way
    through the first record after a gap still yields that record — and the flag went on whichever
    sample was the first to fall inside the window, which can be a whole record later.
  - On a 7 s gap ending at 10 s, the window `[10.9, 11.4)` reported its first event, at **11 s**, as
    preceded by a gap ending at 10 s. Four samples of real data sit between the two, so the flag
    asserted a hole where the recording had already resumed — the opposite of what it exists to say.
  - Whether the flag appeared at all depended on where the window started relative to a record
    boundary, not on where the data came back: `[10, 11)` marked it, `[10.4, 11.4)` marked it,
    `[11, 11.5)` did not.
  - It now goes on the event whose tick IS the segment's start, and on no other. A probed index has
    no segments and no gaps, so nothing changes there.

## 0.3.66

- **Fixed** the TAL diagnostic preview hiding the very byte it was complaining about.
  - `escapeControls` escaped C0 and DEL, so the Latin-1 preview passed bytes **0x80-0x9F** through
    as literal U+0080-U+009F — the Unicode C1 controls, which render as nothing. The
    `Bytes at that offset: "..."` clause that every TAL diagnostic carries as its evidence therefore
    showed `Wach<0x96>Beginn` as `WachBeginn`.
  - That block is not an edge case. In cp1252, the encoding that produces those bytes, 0x80-0x9F is
    the smart quotes, the en and em dashes and the ellipsis — the single commonest source of an
    invalid-UTF-8 annotation, which is to say the main case `ANNOTATION_TEXT_NOT_UTF8` exists for.
    A reader shown `WachBeginn` sees a perfectly ordinary word and no reason for the diagnostic.
  - It now prints `Wach\x96Beginn`. The rule below 0xA0 matches `quote()` in
    `diagnostics/format.ts`, which escapes anything non-printable.
- 0xA0-0xFF stay literal. Those are printable in Latin-1 and `é` and `µV` must remain readable —
  that is the whole reason the preview decodes as Latin-1 rather than UTF-8.

## 0.3.65

- **Fixed** `api-errors.md` publishing the wrong signature for `isEdfError` and calling a cast
  mandatory that the compiler does not require.
  - The page said `function isEdfError(value: unknown): value is EdfError`. It returns
    `value is AnyEdfError` — the discriminated union over the seven concrete classes.
  - Around that it built a **Note** explaining that "the cast in each branch is load-bearing" and
    that "reaching for `error.budgetBytes` without the cast is a compile error", with three `as`
    casts in the snippet to match. None of it is true: the snippet compiles without them under
    edfcore's own `tsconfig.json`. `src/errors.ts` says why in the docblock on `AnyEdfError` — the
    union exists precisely so that switching on `edfErrorKind` reaches the extra fields "without
    one". The page documented the problem the union was added to solve as though it were still
    there.
- The snippet is now in `tests/types/documented-examples.test-d.ts` alongside the other two, so
  `npm run typecheck` compiles it: if a cast ever became necessary, the build would say so rather
  than a paragraph.
  - Adding it immediately caught a second error in the same snippet. `EdfRangeError.available` is a
    `RecordRange`, not a count, so the helper the page calls `clampToFile(error.available)` cannot
    take a `number`.
- The comparison against the page is now indentation-insensitive, because a page-level fragment sits
  at column 0 and a compiled copy has to live inside a function. The snippet's `switch` arms were
  reflowed to the form this project's formatter produces, so the page shows code that would survive
  `biome check`.

## 0.3.64

- **Fixed** the pre-0.2 status text still on the website, which contradicted the package and, in one
  case, the page it linked to in the same sentence.
  - `concepts.md` said the pyEDFlib comparison harness "does not exist yet in 0.1" and linked, in
    that sentence, to `physical-values.md`, which says it has existed since 0.2.34-0.2.48. So the
    one claim a reader would check was denied by the page they were sent to check it on.
  - `installation.md` said "edfcore is at 0.1.0" and that an element-by-element comparison against
    pyEDFlib is "still missing"; `api-primitives.md` tabled `VERSION` as `'0.1.0'` and repeated it
    in prose as "at the time of writing".
  - Three pages scoped a still-true statement to a dead series — "edfcore has no other lifetime
    mechanism in 0.1". The claim holds (`Symbol.asyncDispose` is not Baseline); the version scope
    did not.
- The `VERSION` row no longer spells a number at all. A version written into a table is stale the
  next release, which is how this started.
- `tests/integration/readme-status.test.ts` now sweeps every docs page for two present-tense shapes:
  "edfcore is at X.Y.Z" that is not the published version, and "in X.Y" scoping a claim to a series
  that is no longer this one. Past-tense history — "renamed in 0.3.0", "fixed in 0.2.63", "since
  0.2.34-0.2.48" — is correct forever and is deliberately not matched.

## 0.3.63

- **Fixed** `diagnostics.md`'s always-fatal table, which said "Nine codes are always fatal", listed
  **eight**, and then said "All eight throw `EdfFormatError`".
  - The missing row was `RECORDING_SPAN_UNREPRESENTABLE` — `recordCount × recordDuration` beyond the
    signed 64-bit tick range, so the later records have no representable start. It is in
    `api-errors.md`'s own always-fatal table, so the package's two diagnostic pages disagreed about
    how many always-fatal codes there are.
- The 0.3.39 guard checked the prose count on this page and the tables on `api-errors.md`, but not
  this page's table — which is why the count and the rows under it could drift apart. It now
  requires every `fatal` code in `codes.ts` to have a row here, requires every row to actually be
  fatal, and requires the "All N throw" sentence to spell the number the source has.

## 0.3.62

- **Fixed** the Start-here page teaching `strict` with the one code family `strict` cannot fire on,
  and printing that code's severity wrong.
  - `concepts.md` showed `await openEdf(source, { strict: true })` producing
    `EdfFormatError: [DATE_CLIPPED_TO_1985_2084]`. That never happens. `info` codes are exempt from
    `strict` — `collector.ts` gates on `this.strict && diagnostic.severity !== 'info'` and says why
    in the same docblock — and `DATE_CLIPPED_TO_1985_2084` is `info`. Run against a file whose only
    defect is that code, `strict: true` resolves.
  - Ten lines above, the same page printed `// warning DATE_CLIPPED_TO_1985_2084 168` as the output
    of `console.log(diagnostic.severity, ...)`. The real first field is `info`.
  - The `strict` example now uses `PATIENT_ID_NONCONFORMANT`, which is a warning and does throw, and
    the page says out loud that `info` is exempt and why: nearly every EDF file carries this code,
    so making `strict` throw on it would mean rejecting conforming files.
- The 0.3.39 guard could not see this. It matched `severity [CODE]` — the shape `formatDiagnostics`
  emits — and this page prints the `console.log(severity, code, byteOffset)` shape instead. It now
  checks both, so a page cannot state a severity the package would not print in either form.

## 0.3.61

- **Fixed** `inspectEdf` reporting a complete, perfectly readable file as `SOURCE_TOO_SMALL`, at
  error severity, immediately after it had already recorded the real reason.
  - When the declared header exceeds the 128 KiB triage ceiling, `inspectEdf` records
    `HEADER_EXCEEDS_INSPECTION_BUDGET` — and then handed the deliberately truncated buffer to
    `parseHeader` anyway. The parse can only fail its "are all the header bytes here" check, and
    that check reports `SOURCE_TOO_SMALL` saying "only 131072 bytes are available" — which is
    `inspectEdf`'s own budget, not the file's size.
  - A 512-signal file 133,376 bytes long, whose header needs 131,328 and which `readHeader` parses
    without complaint, was therefore reported as too small.
  - Both `api-reading.md` and `diagnostics.md` already say such a header "is reported as
    `HEADER_EXCEEDS_INSPECTION_BUDGET` **rather than half-parsed**". It was half-parsed and then
    misdiagnosed. `inspectEdf` now returns before the parse it knows cannot succeed, with that one
    diagnostic and the variant hint.
- `ok` is still false, and the docblock now names this as the one case where that happens without an
  error-severity diagnostic: nothing was parsed, so there is nothing to be right or wrong about, and
  the diagnostic names the call that will read the file.

## 0.3.60

- **Fixed** `validateRecording` and `readEnvelope` reporting a different number of diagnostics for
  the same file depending on `maxMaterializeBytes`, which is a memory budget and must never change
  an answer.
  - `tal/annotations.ts` caps `NEGATIVE_ANNOTATION_ONSET` at one report per `decodeAnnotations`
    **call** — every onset is in the result, so a second report carries nothing — and both of these
    fold a recording one **scan chunk** at a time, calling `decodeAnnotations` per chunk. The cap
    reset at every chunk boundary, so the count became "how many chunks happened to contain one",
    and the chunk size is `scanChunkRecords(header, maxMaterializeBytes)`.
  - On an eight-record file where every record carries a negative onset, `validateRecording`
    reported it **3, 4, 5 or 10 times** for the same bytes, and `readEnvelope` 1, 2, 3 or 8.
  - Both now share `appendChunkDiagnostics`, which holds the cap across the whole sweep rather than
    across one chunk. Two call sites, one rule, in the module that owns diagnostic collection.
- **Not covered, deliberately:** `TIMEKEEPING_TAL_NONCONFORMANT` has the same per-call cap for its
  non-destructive kind, but its **destructive** kind shares the code and is reported per record on
  purpose — each one names a different annotation that was lost. Collapsing by code alone would drop
  those, which is a worse defect than this one. Separating them needs `decodeAnnotations` to publish
  which kind it emitted, and that is more than this release should carry.
- `tests/integration/budget-invariance.test.ts` asserts the general property — whatever these two
  calls report, they report the same census at every budget — rather than the one code, since this
  is the fourth time the shape has been swept out of the package. It first checks the fixture really
  does span several chunks at the small budgets, so it cannot pass vacuously.

## 0.3.59

- **Fixed** `mergeChunks`' exact-tick refusal calling an overlap "a discontinuity of **-0.2** s"
  that "is a gap in TIME" — the fourth site of the defect 0.3.33 and 0.3.41 swept, forty lines below
  the third, in the same function.
  - `assertJoinable` has two refusal paths. The one on `next.precededByGap` was taught to branch on
    the sign in 0.3.41. The tick comparison beside it was not — and it is the path an overlap
    actually reaches after a bare `openEdf`, because a **probed** index reports no gaps at all, so
    `precededByGap` is `undefined` and the branch that knows the difference never runs.
  - It now says "an overlap of 0.2 s ... the records on either side of the join both claim that
    time", the wording 0.3.41 settled on, and reports a positive magnitude. A gap of negative
    duration is not a thing.
- The gap wording is unchanged, byte for byte, so nothing that reads the existing message moves.
  The new test asserts on the tick path specifically, with `precededByGap` checked to be `undefined`
  first — otherwise it would be testing the branch that was already right.

## 0.3.58

- **Fixed** the `EdfAnnotation` table in `api-types.md`, which put `onsetTicks` on the wrong axis
  and then told readers to compare event times with it and nothing else.
  - The table said `onsetTicks` is "exact, in 100 ns units, on the same axis as the rebased value".
    It is not: it is the number the file wrote, on the **header's** timebase. `src/types.ts` says so
    in the docblock that generates the published `.d.ts`, and calls it "the wrong one for comparing
    an annotation against a window".
  - The rebased field, `onsetTicksFromFirstRecord`, was missing from the table altogether —
    thirteen rows for a fourteen-field interface. So the page named the wrong field as the exact
    one and omitted the right one, in the same three lines.
  - A reader who followed it compared `onsetTicks` against `chunk.startTicks`, `segment.startTicks`
    or a `readWindow` bound — all of which the same page puts on the `t = 0 = start of record 0`
    axis — and every event landed up to a second late, with nothing to indicate it. On a file whose
    record 0 starts 0.25 s in, an event written `+1.25` has `onsetTicks` 12500000 and
    `onsetTicksFromFirstRecord` 10000000, which is exactly `chunk.startTicks` for record 1.
  - `annotations.md` had it right in two places, so the package's two reference pages disagreed.
- `tests/integration/annotation-fields-doc.test.ts` reads the field list off a decoded annotation
  rather than from a list written down beside it, so a field added to the interface fails the suite
  until the table lists it. It builds a file whose two onset axes genuinely differ, which is what
  makes the wording load-bearing rather than decorative.

## 0.3.57

- **Fixed** the zero-record chunk's start time, which was read off a segment on the wrong axis and
  only for a record a segment BEGINS at. Both halves were introduced by 0.3.38's fix for the same
  field.
  - `segment.startTicks` is **rebased** — `buildSegmentation` stores `absoluteOnset - originTicks`
    with `originTicks = timeline.startOffsetTicks` — while `readChunk` consumed it as a header-axis
    value and subtracted the offset a second time. On an EDF+ file whose record 0 begins part-way
    into a second, which is exactly what record 0's timekeeping TAL is for,
    `readRecords({ start: 0, count: 0 })` reported **-0.25 s**: before the instant that defines
    `t = 0`. At a segment boundary it reported 99.75 s while carrying a gap ending at 100 s — the
    self-contradiction 0.3.38 existed to remove, reintroduced one line away by its own fix.
  - The lookup matched only a segment's first record, so a mid-segment record fell through to the
    nominal grid, which knows nothing about gaps: `{ start: 5, count: 0 }` answered **5 s** where
    `{ start: 5, count: 1 }` answered **101 s**, for the same record of the same file.
  - The helper now reads the segment that CONTAINS the record and adds the origin back, so both
    forms answer identically at every record — boundary or not, offset or not.
- The 0.3.38 test asserted `gap.endTicks === chunk.startTicks + startOffsetTicks`. Both values are
  on the rebased axis, so the real invariant is equality; the extra term was only ever right
  because that fixture's offset is zero. A guard that states a relation which holds only at zero
  would have accepted this bug back, so it now states the relation itself, and the new test gives
  the file an offset.

## 0.3.56

- **Fixed** `trimToWindow` dropping the sample whose own start time the window was aligned to.
  - `gridSampleStartTicks` and `sampleStartTicksOf` round a sample's start **up** to a whole tick,
    deliberately, so that flooring it back names the same sample. `trimToWindow` selected on the
    sample's exact rational start instead. When a boundary is not a whole tick the published start
    is strictly later than the exact one, so the sample no longer qualified for a window beginning
    at its own published start and the trim began at `n + 1`.
  - 256 samples in a one-second record — the commonest EEG geometry there is — puts sample 1 at
    39,062.5 ticks, published as 39,063. **Half of all sample indices** were affected at that rate.
    At 128 samples per 0.29 s a one-sample-wide window aligned to a sample start came back
    **empty**.
  - 0.3.32 fixed this exact mismatch in `readTriggers` and wrote down the rule it settled on:
    "`sampleAt`, `sampleStartTicksOf`, a window bound and `readTriggers` all name the same sample."
    The window bound was the one of the four still using the other rounding.
- Both edges stay a bigint product of on-disk quantities — no division, no sample rate, no float
  bound. Sample `j` is in the window when `ceil(j * D / S)` is in `[R, Rend)`, and since
  `ceil(x) >= R` iff `x > R - 1`, that is `floorDiv((R - 1) * S, D) + 1` and
  `floorDiv((Rend - 1) * S, D)`.
- Identical to the old form whenever a boundary falls on a whole tick, so **no window on a
  power-of-ten geometry moves**, and the whole existing suite passed unchanged. A sample admitted
  by the new rule starts at most one tick — 100 ns, below the resolution edfcore reports in —
  before the bound, and it is exactly the sample the caller aligned to.

## 0.3.55

- **Fixed** `streamRecords` never comparing record onsets across a chunk boundary, so an
  always-fatal `TIMELINE_NOT_MONOTONIC` was suppressed and chunks were yielded in reverse time
  order — and whether it fired at all depended on `chunkRecords`.
  - `readRecords` runs `assertMonotonicOnsetArray` over the onsets of the chunk it just read, so
    every adjacent pair **inside** a chunk is checked and no pair that straddles two is.
    `readWindow` hands a whole contiguous run to one call, so it checks all of them; splitting the
    same run into `chunkRecords`-sized reads checked none of the seams.
  - On an eight-record file whose only backwards pair is 3 → 4, `readWindow` threw and
    `streamRecords` threw at `chunkRecords` 3 and 5 while returning the data at 1, 2, 4 and 256.
    At `chunkRecords: 1` **every** pair is a seam, so nothing was checked at all and the chunks came
    back at 0, 1, 2, 4, 3, 5, 6, 7 seconds.
  - `chunkRecords` is documented as "the unit of I/O and of memory". A performance knob must never
    decide whether a file is refused — the fourth time that shape has been swept out of this
    package.
  - A consumer that places each chunk at its own `startSeconds`, which is what the docs prescribe,
    silently overwrote earlier trace with later samples.
- The seam check costs no extra read. A chunk's span is `lastOnset + recordDuration - firstOnset`,
  so its last record's onset is `startTicks + durationTicks - recordDurationTicks`, already on the
  same rebased axis as the next chunk's `startTicks`. It is reset per run, because `readWindow` does
  not compare across a gap either and a streamed chunk must stay the object a read would give.

## 0.3.54

- **Fixed** `decodeStatusWord` reading the BioSemi quality flags from the wrong bits. Both
  `cmsInRange` and `batteryLow` were wrong, in both directions, on every ActiveTwo file.
  - BioSemi's Status word ("Trigger signals", biosemi.com; the same table is in BIOSIG/FieldTrip's
    `read_biosemi_bdf`) is: bits 0–15 the parallel trigger inputs, 16 new epoch, **17–19 speed bits
    0–2, 20 CMS in range, 21 speed bit 3, 22 battery low, 23 ActiveTwo MK2**.
  - edfcore used bit 17 for `cmsInRange` and bit 18 for `batteryLow` — the two bits directly above
    the trigger field, which are speed bits. So an amplifier with CMS genuinely in range reported
    `cmsInRange: false`, and a rig running at a speed mode with bit 0 set reported
    `cmsInRange: true` with the CMS bit clear. The two bits that carry the flags were never read.
  - `trigger` and `newEpoch` were always right, which is why this survived: the field an ERP
    pipeline actually uses is the low 16 bits, and it never moved.
- The module comment had it backwards. It said "inventing meanings for the bits above 18 would be
  guessing" — but 20, 22 and 23 are precisely the documented ones and 17 and 18 are the guess. The
  full layout is now written out beside the constants, and `api-helpers.md` carries it as a table.
  The speed field and the MK2 flag stay unnamed and reachable through `raw`, which is the rule the
  module always stated.

## 0.3.53

- **Fixed** the README status line, which said **"Status: 0.1.x, early"** — through fifty-one
  releases and two minor versions. It is the first thing a reader sees on npm, and it named a
  series nobody could install.
- `tests/integration/readme-status.test.ts` reads the series back out of the line and compares it
  with `package.json`, which changes on its own every release. The line cannot go stale again
  without failing the suite.
- The "1,200+ tests" in the same sentence is left as written. It is a floor and it is still true —
  the suite runs 1,772 — and raising it to a number no test can verify would reintroduce exactly
  the kind of unchecked claim this release is about.

## 0.3.52

- **Documented** `-v`. `parseArgs` has accepted it as an alias for `--version` for as long as it has
  accepted `--version`, and the usage banner printed `--version` alone — while printing `--help, -h`
  with its alias two lines above. A flag that works and is not in `--help` is one nobody can find
  and nobody can rely on.
- `tests/integration/cli.test.ts` now derives the flag list from `parseArgs` itself and requires
  every accepted flag to appear in the usage banner, so a new one fails the suite until it is
  documented.
  - The check matches whole tokens, not substrings. `expect(usage).toContain('-v')` is satisfied by
    the `-v` inside `--version` — that is, by the exact text that had the bug — so the obvious
    spelling of this guard would have passed on it. There is an assertion pinning that distinction
    beside the others, because it is the only reason this test works.

## 0.3.51

- **Corrected** the `filterAnnotationsByText` docblock, which said a string "matches on the exact
  trimmed text". Nothing is trimmed: `annotation.text` is the TAL's bytes as written — `api-types.md`
  calls the field "verbatim; never trimmed, never case-folded" — and the comparison is a bare `===`.
  - The word mattered because the failure it hides is silent. An event a scorer spelled
    `'Sleep stage W '` is not matched by `'Sleep stage W'`, and the call returns an empty list
    rather than an error, so a hypnogram over a file with a padded vocabulary comes back with no
    stages and no explanation.
  - Both the docblock and `api-helpers.md` now say verbatim on both sides, and both name the
    one-liner for the other question: `filterAnnotationsByText(events, (t) => t.trim() === label)`.
- No behaviour change — `edfcore` matched verbatim before and matches verbatim now. The exact rule
  is pinned by a test in both directions, so the comment cannot drift away from it again.

## 0.3.50

- **Fixed** the "Renamed in 0.3.0" note in `api-helpers.md`, which was attached to the wrong family
  of functions and so told a reader migrating from 0.2 to call a function that answers a different
  question.
  - The note sat at the end of **The recording-aware form**, saying that `sampleAt`,
    `sampleStartTicksOf` and `sampleStartSecondsOf` "were `sampleIndexAt`, `sampleStartTicks` and
    `sampleStartSeconds`" and that "the behaviour did not change". The rename table in
    `migrating-to-0-3.md` and the 0.3.0 CHANGELOG entry both say those became **`gridSampleIndexAt`,
    `gridSampleStartTicks` and `gridSampleStartSeconds`** — the family documented in the section
    above.
  - The two families are exactly the distinction the rename existed to make. On a six-record file
    with a seven-second hole, `gridSampleStartSeconds(signal, 12, d)` is `3` and
    `sampleStartSecondsOf(recording, i, 12)` is `10`. A reader who followed the note moved every
    answer by the gaps, under a sentence promising nothing had changed. On a file with gaps and a
    probed index, `sampleStartTicksOf` throws instead.
  - The note now sits under the grid functions, and says out loud that the recording-aware family
    below is a different one.
- `tests/integration/rename-note.test.ts` derives the rename from the migration table, checks the
  CHANGELOG spells it the same way, and requires the code block the note is attached to to import
  the names the table produces. A note that drifts onto the wrong family is a test failure.

## 0.3.49

- **Fixed** `splitSubfields` splitting the EDF+ identification fields on JavaScript's `\s` instead
  of on the ASCII space the spec names, so a NO-BREAK SPACE inside a subfield silently cut it in
  two.
  - EDF+ tells a writer to replace a space inside a subfield with another character and mandates
    neither the character nor a way back. NBSP is one of the choices that leaves, and it is header
    byte 0xA0 — which `decodeHeaderLatin1` turns into U+00A0, which `\s` matches. `Mac<NBSP>Donald`
    parsed as `name: 'Mac'` with `'Donald'` demoted to `extraSubfields`.
  - Nothing warned. The split **adds** a subfield rather than removing one, trailing extras are
    legal under EDF+, so the count check passed and `conformant` stayed `true`.
  - In `parseRecordingId` it was worse than a truncation: every code after the NBSP shifted one
    position left, so `investigationCode`, `technicianCode` and `equipmentCode` each held the
    previous field's value and all three looked plausible.
- The module docblock says `raw` and the subfields "both keep what the file wrote". That was true
  of `raw` only. A tab or a CR in the field now also stays inside its subfield, where
  `NON_ASCII_HEADER_FIELD` reports it, rather than acting as a separator the spec never named.

## 0.3.48

- **Fixed** the identification lines in `formatHeader` and in `edfcore json --patient` using
  `String.prototype.trim` on the raw 80-byte fields, which does not strip U+0000.
  - A large share of real writers pad those fields with NUL rather than with space. The padding
    therefore survived, and `printable` rendered every NUL as a `.`: an **empty** patient field
    printed as eighty dots — which reads as redaction, not as an absent value — and a populated one
    trailed dozens of dots that read as truncation. The `|| 'unknown'` fallback beside it could
    never fire, because the string was never empty.
  - Both now use `trimEdfField`, which strips 0x20 **and** 0x00, and which every other consumer of
    these same bytes already used: `parsePatientId`, `validateRecording` and `redactDiagnostic`.
    `edfcore json --patient` was leaking the same padding into JSON as a run of `\u0000`.
- This is the gap `redactDiagnostic` already names in `diagnostics/format.ts`, where the same
  `.trim()`-is-not-`trimEdfField` mismatch made a redacted diagnostic print the name it had just
  withheld (fixed there in 0.3.31). The module docblock's "It never invents a value: a field
  edfcore could not resolve prints as `unknown`" is true again.

## 0.3.47

- **Fixed** `formatHeader` printing a signal's `physicalDimension` unsanitised, so eight header
  bytes can forge a signal row for a channel the file does not contain.
  - The label three columns to its left has gone through `printable` since the beginning, under a
    comment saying exactly why: "A label holding a newline would otherwise render as two rows and
    forge a signal the file does not contain." The dimension is the same eight-arbitrary-bytes
    problem and is worse placed — it ends the row, so everything after a newline in it starts at
    column 0. A dimension of `"\n  1  Fp"` printed a second `  1  Fp` line under signal 0.
  - `trimEdfField` strips 0x20 and 0x00 and nothing else, so 0x0a reaches `signal.physicalDimension`
    intact. The raw bytes stay available on `signal.raw`; only the rendering is sanitised.
- `edfcore signals` already ran this same field through `printable`, so the two CLI commands
  disagreed about whether the same eight bytes were safe to print. They now agree.
- This class has been fixed three times — 0.3.2 in five outputs, 0.3.16 in the two identification
  lines, and now the last column of the signal table. The new test sits beside the label one, in
  the block named for what it is defending.

## 0.3.46

- **Fixed** the two documented code examples that did not compile under the compiler settings
  edfcore itself builds with. Both are on the pages that tell a reader to go and write their own
  code, which is the worst place for a snippet that has to be debugged before it can be used.
  - `api-sources.md`, the custom `FetchLike` adapter: `return fetch(url, { ...init, signal })` is
    rejected under `exactOptionalPropertyTypes`, because `RequestInit.signal` is
    `AbortSignal | null` and the local is `AbortSignal | undefined`. It now writes
    `signal: signal ?? null`, and says why.
  - `api-primitives.md`, the duplicate-label resolver: `getSignal(header, error.matchingIndices[0])`
    is rejected under `noUncheckedIndexedAccess`, which types the element `number | undefined`. It
    now destructures and narrows first.
  - Neither was wrong at runtime; both compiled cleanly with the flag off. This is specifically the
    strict-mode shape, and `tsconfig.json` and `tsconfig.build.json` both set both flags.
- `tests/types/documented-examples.test-d.ts` holds a copy of each snippet as REAL code, so
  `npm run typecheck` compiles them, and then reads the fenced blocks back out of the pages and
  asserts every line is present in that copy. Editing a snippet in the docs without editing the
  compiled copy now fails, in both directions.

## 0.3.45

- **Fixed** `formatAnnotations` printing a NEGATIVE onset as an instant slightly **after** the
  event, which is the one thing the function's own docblock promises it never does.
  - The clock took the magnitude of the tick count and then truncated it, so the truncation ran
    toward zero rather than toward -Infinity. `-1.5009 s` printed `-00:00:01.500` — 0.9 ms after
    the event. The positive twin `+1.5009` printed `00:00:01.500`, correctly *before* its event, so
    the guarantee held for exactly the half of the range that never needed it.
  - It now floors with `floorDiv` before splitting into fields: `-1.5009` prints `-00:00:01.501`.
    Positive onsets, zero, and exact milliseconds are unchanged — flooring only moves a value with
    a remainder, and only downward.
- Negative onsets are not an edge case here: EDF+ measures onsets from the header start time and a
  recording may begin after its first annotation, which is why 0.2.63 made them print as negatives
  rather than clamp to zero. Sub-millisecond digits are equally ordinary — the parser keeps seven
  fractional decimal places on purpose. As this module's own comment says, an event list is exactly
  where someone reads a number off the screen and types it into something else.
- The docblock said "truncates"; it now says "floors", which is what makes the promise true.

## 0.3.44

- **Added** the types each subpath's own signatures need, so a consumer taking one part of the
  package does not have to reach into the root entry to write a single annotation.
  - `edfcore/validate` now exports **`EdfRecording`** — the parameter type of `validateRecording`,
    the subpath's headline function. It exported `EdfRecordIndex` and eleven other types, but not
    the one a caller has to name to pass anything in.
  - `edfcore/node` now exports **`ByteSource`** and `ReadOptions`. `ByteSource` is the return type
    of both `fileSource` and `fileHandleSource` — the subpath's entire output — and it was declared
    locally without being re-exported.
- Type-only additions; nothing at runtime changes, and neither subpath gains a value export.
- `tests/types/subpath-self-sufficiency.test-d.ts` writes each annotation the way a consumer of the
  subpath ALONE would have to, and imports from nothing else — a root import there would defeat the
  check. It compiles under `npm run typecheck`, so a subpath that stops exporting a type in its own
  signature is a build failure rather than something a user discovers.

## 0.3.43

- **Fixed** `cachedSource` letting one reader's abort cancel unrelated concurrent readers. A block
  read serves every reader of that block — the dedup is the point — but it carried the FIRST
  caller's options, `signal` included. Aborting one reader rejected the others, **including a
  reader that passed no signal at all**, with `AbortError: The read was aborted through
  options.signal` describing something that never happened to it.
- That is the ordinary stale-request pattern in a viewer: the user scrolls, the app aborts the
  window they left and issues the new one. Both land in the same 1 MiB block, and the **fresh**
  window is the one that dies. Because the message reads as self-cancellation, the app's own
  `catch` swallows it — a blank panel and no error anywhere. Which reader died depended on which
  touched the block first.
- The shared read no longer carries a signal. `read` already polls each caller's own signal before
  and after the block joins, so an aborting caller still rejects promptly; it simply no longer
  decides for anyone else. The cost is that an abort does not tear down the underlying request,
  which is the right trade for a read other readers are waiting on — the bytes are valid and
  already paid for, so they are admitted to the cache and a later read is served from it.
- One underlying read per block, exactly as before. `maxMaterializeBytes` still travels with the
  shared read, because that one genuinely is a property of the fetch rather than of a caller.

## 0.3.42

- **Fixed** `toPhysical` and `clampToDigitalRange` reporting a *"NaN-byte maxMaterializeBytes
  budget"* — the exact message 0.3.21 says it eliminated — and advising the caller to "produce
  fewer samples per call", which no sample count can satisfy against `NaN`.
- 0.3.21 routed four budget reads through one resolver and **missed a fifth**: `decode/physical.ts`
  carries its own copy of the guard, and grepping for the option's name found the four in the I/O
  and scan paths. They are the only two allocating primitives on the public surface that never
  validated it.
- Both now go through `resolveMaterializeBudget`, so a non-finite or negative value is a plain
  `RangeError` naming `options.maxMaterializeBytes` and pointing at the expression that produced
  it. A real budget still refuses a too-large allocation exactly as before, which is asserted.

## 0.3.41

- **Fixed** `mergeChunks` refusing an overlap with *"chunk 1 is preceded by a gap of -0.2 s"* — a
  gap of negative duration — and explaining it as the inverse of what happened. Across a GAP two
  samples either side of the join are seconds apart; across an OVERLAP they cover the same time,
  so concatenating stores it twice rather than skipping it. The message asserted the first.
- **0.3.33's own headline was "in the two places that still said it was", and it named exactly
  two.** This is a third. `src/chunks.ts` contained no mention of an overlap anywhere, so the
  partition 0.3.3 stated — *a gap is time no record covers; an overlap is one instant two records
  both claim* — had never reached it. Counting the sites from memory was the mistake, twice now.
- The refusal is unchanged and correct either way; only the wording branches on the sign, and the
  magnitude is printed positive.
- `api-reading.md`'s `precededByGap` example printed `gap of ${durationSeconds} s` unconditionally,
  which produces `gap of -0.2 s` on the same file. It branches on the sign now, since that is what
  a reader will copy.

## 0.3.40

- **Fixed a regression introduced two releases ago.** 0.3.37 split the 206 `Content-Range` guard on
  `claimed.first === offset`, and that condition matches two different responses: one that stopped
  EARLY, which is what the split was written for, and one that sent MORE than was asked for.
- The over-delivering case is not hypothetical — a CDN edge or nginx's `slice` module answers with
  a whole fixed-size block whatever range was requested — and it got a message wrong in every
  clause: *"stopped at byte 511, because that is the end of a 4096-byte resource"* (511 is not the
  end of 4096), a range plainly inside the declared length said not to exist, and advice to drop an
  `options.byteLength` that is correct. The one fix that would help, varying the cache on `Range`,
  is printed only by the branch it had been routed away from.
- The branch now also requires `claimed.last < expectedLast`, so anything else falls through to the
  cache/CDN message that was always right for it. Both paths still refuse and still carry
  `receivedLength`; only the routing changed.

## 0.3.39

**The published diagnostic tables disagreed with the code in five places, and with themselves in
two more.** Documentation only, plus a test that stops it recurring.

- `DATE_CLIPPED_TO_1985_2084` is **`info`**, and has been since the first commit. Nearly every EDF
  file carries it, because the mandated `dd.mm.yy` startdate cannot express a year outside
  1985–2084. Two pages listed it under **Warnings**, a third called it "a warning" in prose, and
  two more printed a sample `formatDiagnostics` block reading `warning [DATE_CLIPPED_TO_1985_2084]`
  — output the function cannot produce, since it prints `${severity} [${code}]`.
- `SCALE_UNAVAILABLE` was missing from the deferred-fatal table entirely.
- Three prose counts were wrong: eight always-fatal codes where there are **nine**, two `info`
  codes where there are **three**, and thirty-one warnings where there are **twenty-nine** (the
  table also carries two reserved names that nothing emits, which the page explains in a note).
- README, `physical-values.md` and `design-decisions.md` still said the pyEDFlib/MNE golden-value
  harness "has not been built yet" and that "edfcore claims no numeric parity with those readers".
  It was built in **0.2.34–0.2.48**, and `physical-values.md` said so itself forty lines above the
  note denying it.
- `tests/integration/diagnostic-docs.test.ts` derives every count and every grouping from
  `codes.ts`, so a new code fails the suite until the page is updated — and checks that no sample
  output in any page prints a severity the formatter would not.

## 0.3.38

- **Fixed** a zero-record chunk contradicting the gap it carries. `readRecordBytes` explicitly
  supports a zero-record range — *"A zero-record range issues no read at all"* — and with no
  records there is no onset to observe, so `readChunk` fell back to the nominal grid. On an EDF+D
  file `readRecords({ start: 3, count: 0 })` then reported `startSeconds` **3** while carrying a
  `precededByGap` running **3..13 s**: one object claiming to begin at 3 s and to be preceded by a
  gap that ends at 13 s, which is where record 3 truly begins.
- The nominal grid is now the last resort rather than the first. A scanned index knows where that
  record is, and `gapBefore` already reads it from the same place, so consulting it costs nothing
  and makes the two fields agree. A probed index still has nothing better to offer and the nominal
  grid is still used — correctly, since on a file with no gap it is the right answer.

## 0.3.37

- **Fixed** `httpSource` telling a user to bypass their CDN when the server had behaved perfectly.
  The 206 `Content-Range` guard (0.2.23) fires whenever the claimed range is not the requested one,
  and that covers two different failures. A server that STARTED where it was asked to and stopped
  because the resource ends there honoured the Range exactly — the bytes returned are the bytes
  requested — and what is wrong is the LENGTH this source is working from: a stale or proxied HEAD
  `Content-Length`, a caller-supplied `options.byteLength`, or a file replaced by a shorter one
  mid-session.
- Both cases got the same message: *"its Content-Range says it sent bytes 990..999 — a different
  part of the resource ... this is usually a cache or CDN keyed on the URL without the Range
  header; bypass it"*. So the reader was sent to reconfigure a correctly-behaving CDN, **while the
  resource's real size sat unread in the header of the response just rejected**.
- The two are now separate. A short tail says the server stopped at byte N because that is the end
  of an M-byte resource, that this source was built for a different length, and points at
  `options.byteLength` and the origin's `Content-Length`. The genuine wrong-region message is
  unchanged, and both still refuse — reading past the end is still an error, and `receivedLength`
  still carries the real count.

## 0.3.36

- **Fixed** `edfcore recording.edf` — forgetting the subcommand — reporting
  `edfcore recording.edf: no file given`. `parseArgs` puts the first non-flag argument in
  `command`, and the file check ran before the command check, so the message printed the filename
  that WAS given as though it were the command and blamed the one argument that is not missing.
- The command is now checked first, and a bare filename gets a hint: *unknown command
  "recording.edf" — that looks like a file, so the command before it is missing*. An unknown
  command that does not look like a path is named without the hint, and a real command missing its
  file still says "no file given". Exit code stays 2 for all three.
- Forgetting the subcommand is the commonest CLI slip after `--help`, which this project already
  had to fix once — `edfcore --help` used to fall through to "no command" and exit 2.

## 0.3.35

- **Changed** the envelope path to refuse a bad `signalIndex` with `EdfChannelNotFoundError`, which
  is what `readWindow`, `readRecords` and `streamRecords` already throw for the identical mistake.
  It threw a bare `RangeError`, so `isEdfError` — the package's documented discriminator — answered
  **differently depending on which read the caller had reached for**, and the error carried neither
  `selector` nor `availableLabels`.
  *This is a type change on an existing throw path.* A caller catching `RangeError` from
  `readEnvelope` for an out-of-range index now needs `EdfChannelNotFoundError` or `isEdfError`.
  The annotations-channel refusal stays a plain `RangeError`, exactly as `resolveSignals` keeps it:
  handing a text channel to a sample read can only ever be a caller's mistake.
- **Fixed** three shared helpers hard-coding `readEnvelope():` into their messages while being
  shared by `readEnvelopeAtResolution` and `envelopeOfSamples` — so two of the three callers named
  the wrong function. `resolveSignals` on the read path deliberately carries no prefix for exactly
  this reason, and these now do the same.

## 0.3.34

- **Fixed** `validateHeader` reporting nothing about a starttime field the parse had refused. A
  file with a good `dd.mm.yy` and a blank 8-byte starttime produced no timing diagnostic at all
  from the sweep, so a caller concluded the header's timing fields were conformant while
  `startTime.clock` held a substituted `00:00:00` the file never stated.
- `validateHeader` is documented as independent of `header.diagnostics` — *"running both costs
  nothing and neither can mask the other"* — so a caller who runs only the two-read, no-I/O path
  both doc pages recommend is exactly the caller the docs sanction, and exactly the one who saw
  nothing.
- **This is a claim I made twice without making it true.** 0.3.17 rewrote `api-validate.md` and
  `validation.md` to describe a `validateHeader` check for a refused clock, and 0.3.27 rewrote them
  again for the split code — both times documenting a branch that was never added. Every other
  consumer of `clockSource` already knew: `formatHeader` prints `unknown`, `formatStartTimeNaive`
  returns `undefined`. Only the conformance sweep was blind.
- It now emits `STARTTIME_UNPARSEABLE` with `field: 'startTime'` at byte 176, beside the
  `DATE_UNPARSEABLE` branch it mirrors, saying what is true: the clock is a substituted midnight,
  `clockSource` is `'none'`, and the calendar date and every elapsed time are unaffected.

## 0.3.33

**An overlap is not a gap, in the two places that still said it was.** 0.3.3 stated the rule while
fixing `edfcore gaps` — *a gap is time no record covers; an overlap is one instant two records both
claim* — and gave the CLI a fourth column. These two sites never got the same partition.

- **`resolveTimeWindow`'s refusal.** It fires on `spanTicks !== coveredTicks`, which is a two-sided
  test, and the message hardcoded the gap reading. On a file whose records overlap it produced
  *"its 4 records span 3.5 s but cover only 4 s, so it contains at least one gap"* — arithmetic
  nonsense, since 4 is not "only" anything beside 3.5, and a structural claim that is the opposite
  of what the bytes say. The same file's open-time diagnostic already called it an overlap, so one
  file produced two edfcore messages contradicting each other.
- **`validateRecording`'s structural diagnostic.** It counted every entry of `index.gaps` as a gap,
  and an overlap travels there with a NEGATIVE duration (0.2.69). A file with an overlap and no
  hole anywhere was reported as having "1 gap(s) between them" — while the
  `RECORD_ONSET_SPACING_VIOLATION` a few lines below in the same array correctly called the same
  boundary an overlap.
- Both now branch on the sign and say which they found; a report with one of each says so. Neither
  refusal changes: a probed index still cannot map a window across either kind of discontinuity,
  and the next step is still `buildRecordIndex`. A real hole is still called a gap.

## 0.3.32

- **Fixed** `readTriggers` timestamping a Status sample by TRUNCATING to a whole tick, so an
  event's own reported time mapped back to the previous sample. `sampleAt(event.seconds)` returned
  sample **100** for an event `readTriggers` called sample 101.
- A sample boundary need not fall on a whole tick — 10^7 / 512 is 19531.25 — and edfcore's two
  sample-start functions round UP for the reason `gridSampleStartTicks` gives in its own comment:
  *"Truncating would return 23,437 — a tick that lies inside sample 0 — so `gridSampleIndexAt`
  would send it straight back to the previous sample."* `readTriggers` was the one function that
  truncated, and three boundaries in four are affected at any power-of-two rate BioSemi actually
  uses.
- The ERP consequence is the sharp one. Align a window to the stimulus with
  `sampleStartSecondsOf(rec, status, 101)` and the event sat one tick before the window's left
  edge, so the onset came back as sample **102** — 2 ms at 512 Hz, on the one number an evoked-
  potential pipeline reads. A one-sample-wide trigger at that edge disappeared entirely, which
  contradicts this function's own rule that the first in-window sample always produces an event.
- Now `ceilDiv`, the same rule as `gridSampleStartTicks` and `sampleStartTicksOf`. An event's tick
  is the first whole tick at or after the sample's true start, so `sampleAt`, `sampleStartTicksOf`,
  a window bound and `readTriggers` all name the same sample.

## 0.3.31

**Two ways patient identification reached the output with `--patient` absent.** Both produced text
that LOOKED redacted — `raw:` and `actual:` said `[redacted]` — which is worse than an obvious leak,
because a reader has no reason to check.

- **A NUL-padded identification field was printed verbatim.** `redactDiagnostic` substituted
  spellings derived from `raw`, including `raw.trim()`. Every identification diagnostic builds its
  message from `trimEdfField(raw)`, and `trimEdfField` strips 0x20 **and 0x00** while
  `String.prototype.trim` strips whitespace but not U+0000. On a field padded with NULs — which a
  large share of real writers emit, and which `header/fields.ts` treats as normal — none of the
  spellings matched. `edfcore header` printed the whole name and MRN; `edfcore validate` printed it
  twice.
- **`DATE_IMPLAUSIBLE` printed the patient's date of birth.** It spells the date `2050-05-02` while
  the file writes `02-MAY-2050`, so no spelling derived from `raw` could ever match it — and it
  fires on a perfectly conformant identification field, with no NUL padding and no grammar
  violation needed. `formatHeader`'s own comment names "a name and a birth date" as what the flag
  exists to withhold.
- Both close at the substitution: the field's `trimEdfField` spelling and the diagnostic's own
  `actual`, captured before `actual` is replaced, are now removed from the message too. `actual`
  already carries whatever the message chose to print, whatever spelling that is.
- 0.2.26 established that withholding `header.patient` while the diagnostic below it spells the
  same string out is not withholding it at all. These are the two spellings that fix could not
  reach. The rule, the code, the byte offset and the recording's own start date are not patient
  data and stay readable.

## 0.3.30

- **Fixed** `readEnvelopeAtResolution` crushing the tail of a run into one bucket whenever the
  requested resolution is finer than the sample interval. A 4 s run of a 2 Hz signal asked at 0.25 s
  per bucket came back as **8 buckets covering 2 s**, with the entire second half of the run in the
  last one — while `secondsPerBucket` still reported 0.25. A viewer placing bucket `b` at
  `startSeconds + b * secondsPerBucket`, which is the documented way to use this function, drew half
  the run stacked on one pixel and nothing at all past the halfway point.
- The cause is a clamp that belongs to the other rule. `readEnvelope` takes a pixel width, so
  clamping the count to the sample count is right there — a smaller count is simply a coarser even
  division of the same run. Under the fixed-width rule the count is **not a free parameter**: it is
  `ceil(runTicks / bucketTicks)`, and reducing it shortens the grid. `bucketStartsFor` was handed
  the clamped count, so the boundary array covered less time than the run and the fold's cursor
  pinned every later sample into the final bucket.
- Empty buckets are the honest answer for a resolution finer than the data supports — `counts[i]`
  is `0`, and `toPhysicalEnvelope` has converted those to `NaN` since 0.3.10.
- **The clamp was also the only thing bounding the allocation.** One microsecond over an hour is
  billions of buckets, so the ceiling is now stated rather than implied: an envelope needing more
  than `maxMaterializeBytes` is refused with `EdfBudgetError` before anything is allocated, naming
  both numbers, the way every other allocation in the package is.
- The three CHANGELOG entries before this one (0.2.31, 0.3.5, 0.3.9) all fixed how the bucket COUNT
  is derived or how the fold assigns a sample. None covered the count being reduced after it was
  derived, and every existing test used a `secondsPerBucket` coarser than its fixture's sample
  interval, so the clamp never fired in the suite.

## 0.3.29

- **Fixed** a missing timekeeping TAL in **record 0** setting `startOffsetTicks` to zero, which
  invented a discontinuity in a perfectly contiguous file. `spanTicks` then exceeded `coveredTicks`
  by the start offset, `openEdf` reported `DISCONTINUITY_IN_CONTINUOUS_FILE`, `readWindow` refused
  **every window in the file**, and `buildRecordIndex` reported two segments with a gap that does
  not exist. `t = 0` also stopped being the start of record 0, so the whole axis shifted against
  the identical file with its TAL intact.
- **0.1.4 fixed exactly this for the LAST record** — "a missing TAL in the last record faked a
  discontinuity and made readWindow refuse an entire conforming file" — by handing every later
  probe record 0's onset as its origin. Record 0 is the one case that fix could not reach: it has
  no origin to be handed, so its own derivation still fell back to zero.
- The offset is now recovered from **record 1**: `onset(1) - recordDuration`. Adjacent records are
  the weakest assumption available — only that one pair is contiguous. Deriving from the last
  record instead would absorb every gap in the file into the offset and **hide** a real
  discontinuity, which is worse than inventing one.
- It costs one extra read, and only on a file that is already defective; a file whose record 0 is
  fine still opens in exactly two probes, which is asserted. `TIMEKEEPING_TAL_MISSING` is still
  reported — that defect is real. The invented one is gone.

## 0.3.28

**`buildRecordIndex` returned a different index — or a different fatal — for the same recording,
depending on `maxMaterializeBytes`.** On a six-record EDF+D file whose record 4 has an unreadable
timekeeping TAL, it built a two-segment index at some budgets and threw
`TIMELINE_NOT_MONOTONIC` at others. Same file, same recording object; only the memory ceiling
differed. `validateRecording` mirrored it, and `readRecords` reported two different `startTicks` for
one record depending on how many neighbours shared the call.

- `scanOnsets` states the invariant it broke, in so many words: *"The origin comes from the
  recording, not from whatever this chunk happens to contain. Chunking is a memory-bounding detail
  and must not change the answer."*
- The grid origin for a record with no timekeeping TAL was derived as
  `firstObserved.ticks - firstObserved.recordIndex * recordDuration` — **chunk-local whenever the
  chunk contained any readable TAL.** On a discontinuous file `firstObserved` may be a post-gap
  record, so that expression is record 0's start PLUS the gap. A supplied origin now outranks it,
  the same precedence `resolveStartOffsetTicks` has always applied to the rebasing origin.
- 0.3.14 and 0.3.15 fixed the two neighbouring instances: a range that observes nothing at all, and
  the rebasing origin. Both stopped at the branch in front of them. **This is the third and last
  place the origin was derived**, and it was the only one the chunked callers actually reach on the
  files that have a gap.
- The derivation is now the one `TIMEKEEPING_TAL_MISSING` promises in its own message —
  `start + recordIndex * recordDuration` — at every chunk size. Where that lands before a
  neighbour, the timeline genuinely is not monotonic and edfcore says so **every time** rather than
  when the budget happens to make it visible. A contiguous file is unaffected: the derivation and
  the supplied origin agree there, which is why this hid for so long.

## 0.3.27

**`STARTTIME_UNPARSEABLE` is a new diagnostic code.** A refused clock no longer reports as
`DATE_UNPARSEABLE`.

- That code was emitted from four places. Three are about the calendar date — an impossible
  `dd.mm.yy`, the `yy` escape with no `Startdate` subfield to resolve it, and no readable date at
  all. The fourth was the STARTTIME field, which is a different field describing a different thing,
  and a file can fail either half on its own with the other perfectly good.
- A caller branching on the code therefore acted on the wrong half of the start time, and the
  message under it said *"header.startTime.clock is still exact"* — which is exactly false in the
  case that was borrowing the name.
- 0.3.17 corrected the prose in three doc pages to describe the overload. **Describing it was the
  wrong fix**; this splits the condition, and those three pages now say the simple true thing they
  originally tried to. `EdfDiagnosticCode` is an open union precisely so a case like this does not
  have to borrow a wrong name, as `inspect.ts` says in so many words.
- Pair it with `startTime.clockSource` (added 0.3.17) to branch without reading a message:
  `dateSource === 'none'` goes with `DATE_UNPARSEABLE`, `clockSource === 'none'` with
  `STARTTIME_UNPARSEABLE`. Severity is `warning`, same as before, and nothing else about the parse
  changes — `clock` is still a substituted midnight and every elapsed time is still unaffected.

## 0.3.26

- **Fixed** `NON_ASCII_HEADER_FIELD` quoting bytes that contradict its own claim. The evidence
  window was the first 16 bytes of the field, anchored to the start and never moved to the byte
  that triggered the report.
- `patientId` and `recordingId` are 80 bytes each and `reserved` is 44, and in the EDF+ layouts the
  subfields that realistically carry a non-ASCII byte — the patient NAME, the recording EQUIPMENT —
  begin well past byte 16. So for the exact case this warning exists for, an accented patient name
  or a bare `0xB5` for micro, **every one of the sixteen bytes quoted was printable ASCII** while
  the sentence around them said those bytes were the non-conformant ones. A reader could see they
  were not, and had no way from the message to find the real one.
- The window is now centred on the first offending byte with a few bytes of lead-in, elided with
  `...` at whichever end it does not reach, and the message names that byte's absolute offset in
  the file. `MCH-0234567 F 02-MAY-1951 José_Álvarez` now shows the `0xe9` and the `0xc1`.
- `rawBytes` still carries the whole field content, so nothing programmatic changed — this is the
  message and `actual` only.

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
