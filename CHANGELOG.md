# Changelog

Notable changes per release. Fixes say what was wrong and what it cost, because a version number
alone does not tell you whether you were affected.

edfcore is pre-1.0. Patch releases have carried behaviour changes where the old behaviour was a
defect; those are called out below.

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
