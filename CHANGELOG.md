# Changelog

Notable changes per release. Fixes say what was wrong and what it cost, because a version number
alone does not tell you whether you were affected.

edfcore is pre-1.0. Patch releases have carried behaviour changes where the old behaviour was a
defect; those are called out below.

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
