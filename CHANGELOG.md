# Changelog

Notable changes per release. Fixes say what was wrong and what it cost, because a version number
alone does not tell you whether you were affected.

edfcore is pre-1.0. Patch releases have carried behaviour changes where the old behaviour was a
defect; those are called out below.

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
