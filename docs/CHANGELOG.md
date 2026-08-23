# Changelog

Notable changes per release. Fixes say what was wrong and what it cost, because a version number
alone does not tell you whether you were affected.

edfcore is pre-1.0. Patch releases have carried behaviour changes where the old behaviour was a
defect; those are called out below.

## 0.4.448

- **Added** tests for what `edfcore json` puts in a file you are about to pipe somewhere. Piping is
  the whole reason the command exists — into `jq`, a manifest, a ticket, a spreadsheet a directory
  sweep produced — which is why identification is opt-in here as it is in `formatHeader`.
- `json` defends differently from the other two commands. `header` and `validate` redact, putting
  a placeholder where a value was; `json` omits the key entirely, because an object recording that
  a patient field existed and was withheld is a different thing for a machine to read.
- The diagnostics are the quieter half. They are reduced to `code` and `severity` — no message, no
  raw, no actual — so identification cannot arrive through a diagnostic that quoted the field it
  was complaining about, and every identification diagnostic does quote it. That is achieved by an
  object literal naming two properties, which is one careless spread away from carrying all of
  them.
- `trimEdfField` rather than `.trim()` is the third. `.trim()` leaves U+0000 in place, so on the
  NUL-padded fields a large share of real writers emit, `JSON.stringify` escapes each one into a
  six-character sequence inside the value — unreadable, and a disclosure of the field's exact
  width.

## 0.4.447

- **Added** a check that a machine which has not downloaded the corpus still gets a green suite.
  `tests/README.md` opens with "`git clone && npm test` is green and offline"; the offline half is
  a property — a trap replaces `fetch` and `offline.test.ts` proves it is armed — and the other
  half, that a fresh clone passes without the ~59 MB the fetch script pulls, was enforced by
  convention.
- It is the half a contributor meets first, and it fails unwelcomingly: they clone, run the suite,
  and watch it fail on files they were never told to download, in tests named after recordings they
  have never heard of, with the fix in a README they have not reached yet.
- CI is what makes the convention load-bearing rather than theoretical. It runs `npm ci` and
  `npm run check` and never fetches the corpus, so every job is a run in the skipping state — an
  unguarded corpus test fails every job on every push, blocking every release, and looks like a
  problem with the corpus rather than with the guard.
- The rule is mechanical: a test file that builds a path into the downloaded directory has to ask
  whether the file is there. Both halves are needed — `fixture-policy.test.ts` sits in the same
  folder, names the directory in a git check, reads nothing from it, and must not be required to
  guard.

## 0.4.446

- **Added** a property test that flooring a sample's published start names the same sample again,
  including before t = 0. `gridSampleStartTicks` rounds a start up to a whole tick on purpose — 256
  samples in a one-second record puts sample 1 at 39,062.5 ticks, published as 39,063 — and the
  rounding exists so that flooring it back names the sample it came from. `time/window.ts` records
  what happens when a bound uses the other rounding: half of all indices excluded from a window
  beginning at their own published start, and a one-sample window coming back empty (0.3.56).
- Examples are where this arithmetic hides. A geometry whose boundaries land on whole ticks — 100
  or 256 samples a second — cannot tell the two roundings apart at all, and those are the
  geometries anyone writing a test reaches for first. The fractional ones are generated
  deliberately.
- Negative indices are the half with a branch of their own. A time before the recording gives a
  negative index rather than truncating toward zero and colliding with sample 0 — a pre-stimulus
  window in an ERP analysis is exactly that — and for a negative numerator bigint division already
  truncates toward positive infinity, so the ceiling is the quotient itself and stepping would be
  wrong. One `?:` separates the two, and nothing had ever asked it for a negative index.

## 0.4.445

- **Added** tests for what a cached read passes down to the source and what it keeps. A block read
  serves every concurrent reader of that block, which makes the caller's read options a question
  rather than a detail: an option belonging to one reader must not travel, and one belonging to the
  read must.
- `signal` does not travel, and `cache.test.ts` covers why at length — a viewer aborting the window
  the user scrolled away from killed the fresh window whenever both landed in the same block
  (0.3.43). `maxMaterializeBytes` does travel, and nothing checked it. It is not one reader's
  preference but a ceiling on what may be allocated, and the block read is the allocation.
- `cachedSource` over `httpSource` is the composition `api-sources.md` recommends, and there the
  block read is the request that goes out. A caller who lowered the budget for a read on a phone,
  and had it dropped on the way to the transport, gets exactly the allocation they were refusing.
- The pair is the point: two options, two answers, one call site, and the reason each is what it is
  has nothing to do with the other. An unset budget is checked to be absent rather than present and
  `undefined`, because `exactOptionalPropertyTypes` is on and a source reading it with `??` would
  see a different thing.

## 0.4.444

- **Fixed** the likeliest mistake anyone makes with this library saying nothing about itself.
  Every example is `openEdf(byteSource(bytes))`, `openEdf(fileSource(path))`,
  `openEdf(blobSource(file))` — the wrapper is the whole design, and it is also one more call than
  a reader expects, so leaving it out is what people do. `openEdf(bytes)` answered with
  `TypeError: source.read is not a function`, and `openEdf()` with a `TypeError` about a property
  of `undefined` from a different line. Neither names edfcore, the adapter that was missing, or the
  one word that fixes it.
- `byteSource` has refused a wrong argument by name since the beginning and says what to pass
  instead. This is the same courtesy one call earlier, where more people meet it, and on
  `inspectEdf` too — the triage call is where an unfamiliar file arrives, so it is where a caller
  who has not met `ByteSource` arrives.
- The advice is chosen by shape, because the right adapter differs and a list of four is a list a
  reader has to work through. Bytes get `byteSource`; a string is almost always a path, and the
  adapter for that lives in a different entry point, which is worth saying; anything with a `size`
  and an `arrayBuffer` is a `Blob` or a `File` from a picker.
- The check is structural — a `read` function and a numeric `byteLength` — because `ByteSource` is
  an interface `api-sources.md` documents implementing. A caller's own adapter is a `ByteSource`
  whether or not it inherits from anything, and refusing one would be worse than the `TypeError`
  this replaces. A `read` with no length is still refused: without one nothing can be range-checked,
  and every read would be a request into the dark.

## 0.4.443

- **Fixed** a missing record range throwing a raw `TypeError`. `assertRecordRange` was already
  thorough about the values a range can hold — a negative start, a fractional one, a `NaN` count, a
  range past the last record, and shapes that are not ranges at all — and refused each with the
  file's record count and a next step. Two values were not: `undefined` and `null` reach
  `records.start` before anything has looked at them, and produced `Cannot read properties of
  undefined (reading 'start')`, which names neither the option, nor the file, nor anything to do
  about it.
- They are also the likeliest two. A range built from JSON, from a config file, from a JavaScript
  call site, or from an object spread that dropped a key is absent rather than malformed —
  `{ start: 0, count: undefined }` is what a half-built object looks like, and that was already
  handled. The whole thing missing was not.
- One guard, two entry points: `readRecords` and `readAnnotations` share it. A count of zero is
  still accepted, because a range naming no records is answerable and the answer is nothing; only
  the absence of a range is a mistake. `requested` on the error is the stand-in, so a handler
  reading it finds an object rather than `undefined`.

## 0.4.442

- **Fixed** the one required option with no default saying nothing useful when it was left off.
  `reading-signals.md` explains why `signalIndices` has no "all signals" default — so a 256-channel
  file "is never read wholesale because an argument was left off" — which makes omitting it a
  mistake the API is designed around, and it was the only bad argument on this path that answered
  with a raw `TypeError: signalIndices is not iterable`.
- TypeScript catches it at a typed call site, and TypeScript is not the only way in: a selection
  built from JSON, from a config file, from a JavaScript call site, or from an object spread that
  dropped a key arrives at run time. `readWindow` already refused a non-finite `startSeconds` with
  a sentence and a next step; the array beside it did not.
- The refusal names the option, says what to pass instead, and carries the page's reason with it —
  the answer to "why can I not just omit it?" belongs at the call site. An empty array is still
  accepted: a caller who computed an empty list asked for nothing, which is answerable, and only a
  value that is not a list at all is a mistake.
- No caller prefix, for the reason `resolveSignals` carries none. It is shared by `readWindow`,
  `readRecords`, `streamRecords` and both envelope calls, and a hard-coded name would be wrong for
  all but one — the mistake `envelope.test.ts` records three functions making once already.

## 0.4.441

- **Added** a property test that the chunk size is a memory bound and not an answer.
  `streamRecords` exists so a caller can walk a twelve-hour recording without holding it, and
  `chunkRecords` is the only knob — so everything it hands back has to be independent of it. The
  existing demonstration uses chosen sizes on one file; the sizes that break this kind of code are
  the ones nobody chooses: one record at a time, a chunk larger than the file, one that divides the
  range exactly, one that leaves a record over.
- The failure is not a crash. A boundary handled one record short returns every sample from the
  right file in the right order with one missing at each seam, and a caller concatenating the
  chunks gets an array of plausible length whose timestamps — computed from each chunk's own record
  range — are all correct. It shows up as a recording that is quietly a few seconds short.
- The three things `api-helpers.md` promises beyond the samples are checked at every chunk size
  too: chunks arrive in time order, never span a gap, and carry the same `precededByGap` a
  `readWindow` chunk does. The gap one is why the chunking is not simply "every n records" — a run
  ending mid-chunk has to end the chunk — so a discontinuous file is generated deliberately, with a
  complete index read back onto the recording the way the page tells a caller to.

## 0.4.440

- **Fixed** a carriage return inside a diagnostic message being able to forge a diagnostic line.
  `formatDiagnostics` renders every entry starting at column 0 and indents everything belonging to
  it, which is how a reader — and any script grepping the output — tells one diagnostic from the
  next. A newline in a message was already handled by splitting and indenting the continuation. A
  carriage return was not split on at all.
- On a terminal that returns the cursor to column 0, so the text after it overwrites
  `warning [REAL_CODE] ` in place and the forged line lands exactly where a real one would: no
  indent, no marker, nothing on screen to distinguish it — in a conformance report, which is read
  precisely because a file is suspect.
- The message is now split on any line terminator, so both produce an indented continuation. The
  indent is the property, not the absence of the character, which a caller may legitimately want
  kept. `expected` and `actual` were already immune by the other route: they are emitted whole, so
  they go through `printable` and every control byte becomes a dot.
- The reach is the public one. `formatDiagnostics` takes any `EdfDiagnostic[]`, so a caller merging
  diagnostics from their own checks decides what is in `message`. No diagnostic edfcore builds
  contains a line terminator today, because the file bytes reaching a message go through
  `JSON.stringify` first — a fact about today's messages rather than a property of the renderer.

## 0.4.439

- **Added** a check that everywhere a stranger learns what this package does, it says it reads.
  `design-decisions.md` gives the constraint a heading of its own — "edfcore does not write EDF,
  and will not before 1.0. A writer exists in the test suite and is not exported" — and four other
  places carry it, each reaching a different reader: AGENTS.md tells an agent, the README tells
  someone deciding whether to install, `comparison.md` sends a would-be writer to pyEDFlib, and the
  npm description tells everyone who opens none of them.
- The `keywords` array is the one that can quietly say otherwise. It is metadata nobody reviews
  closely, it exists to be matched against searches, and adding `edf-writer` for discoverability is
  a plausible thing to do. It would work: the package would surface for a search it cannot serve,
  and the people it brought in are exactly the ones `comparison.md` is written to send elsewhere.
  No code change, and nothing to fail.
- So the keywords are checked from both directions — every format the package reads is listed, so a
  search for `bdf+` finds it, and nothing in the list advertises writing.

## 0.4.438

- **Added** tests for `--limit 0` and the blank line that belongs to the rows rather than to the
  notice. A truncated listing has to say so, since a silently shortened one reads as a complete
  one, so every capped command prints a notice naming what it withheld, separated from the rows
  above it by a blank line.
- That blank line belongs to the rows. With `--limit 0` there are none, and emitting it anyway left
  two blank lines and a notice hanging under the count, as though the rows had failed rather than
  been asked for (fixed in 0.4.181). It is one ternary, and the only thing distinguishing it from a
  stray newline nobody would defend is knowing what the blank line is for.
- `--limit 0` is not a contrived argument. It is what a script passes to ask "how many are there?"
  without paying to print them, and what `--limit "$N"` becomes when `N` is empty. The count line
  and the notice are then the whole of the useful output.
- The notice is also pinned to name what was withheld rather than what was shown, and to stay
  absent when nothing was — across the events listing and the header's diagnostics, which cap the
  same way through different formatters.

## 0.4.437

- **Added** a check that the throwaway probes stay runnable and cannot reach the suite, the
  typecheck or a commit. `tests/scratch/` holds reproductions written while chasing a defect: they
  assert whatever behaviour was current when they were written, which makes them useful for an
  afternoon and poison afterwards, because a committed probe pins a defect as if it were a
  decision.
- Four mechanisms keep that true, in four different files, and none was checked. `.gitignore` keeps
  them out of a commit, which matters because `scripts/release.mjs` stages with `git add -A`. The
  main vitest config excludes the directory so a leftover probe cannot join the run that gates a
  tag. `tsconfig.json` excludes it for the same reason on the other half of `npm run check`, and
  the vitest config's own comment says the two move together — only one of which is where anyone
  would look. And the scratch config is what makes a probe runnable anyway, because vitest applies
  `exclude` even to an explicit filename filter.
- The exemption is stated too: the scratch config deliberately does not load the offline trap, since
  a probe reproducing a defect against a real server is a legitimate thing to write. That is an
  absence, and an absence is what someone adds for consistency.
- The strongest check is the live one — nothing under `tests/scratch/` is tracked, asked of git
  rather than of the ignore file, because that is the property and the rest is mechanism.

## 0.4.436

- **Added** tests that a real `AbortSignal` reaches `fetch` and a bare `{ aborted }` shim never
  does. `FetchLike` deliberately does not name `signal` — naming it would pull the DOM
  `AbortSignal` into the published types by parameter contravariance, the exact dependency the
  structural shims exist to avoid — so the signal is handed over at runtime, on one line.
- Both halves matter and they fail differently. Attaching a shim is loud: the platform `fetch`
  throws a `TypeError` on an init whose `signal` is not an `AbortSignal`, so every request from a
  caller using the published `AbortSignalLike` type would fail at once. Not attaching a real one is
  silent, and that is the half nothing had exercised — no test had ever given `httpSource` a
  genuine `AbortSignal`.
- Without the attach, `throwIfSignalAborted` still rejects the caller's promise at the next poll,
  so an abort looks like it worked, while the request runs to completion. On a range covering a few
  hundred megabytes that is the difference between cancelling a transfer and paying for it, and the
  only visible symptom is a bill, or a phone that stays warm after the user navigated away.
- The caller's own signal object has to be the one attached, not a copy, or aborting theirs aborts
  nothing. A source-level signal and a per-read one are both checked, since the page documents the
  first as the default for every request and the second as winning over it.

## 0.4.435

- **Added** a check that the announce script cuts one release and that a dry run cuts none.
  `npm run announce` is the last step of every batch and the only command here that writes to
  GitHub. Everything else — the bump, the commit, the tag, the publish — is either reversible or
  gated by `npm run check`. A release is neither: it is public the moment it exists, it notifies
  watchers, and a second one over the same range is not something anyone undoes quietly.
- Three properties keep that safe and none was checked. Exactly one mutating call, because one
  release per version is precisely what this script replaced and a per-version loop reintroduced by
  someone would look like a fix. A dry run that exits rather than falling through, or the flag
  people use to preview a batch would announce it. And a refusal to announce past a tag with no
  changelog entry, because the notes *are* the changelog entries — a missing one produces a release
  whose body skips a version, in the one artefact a reader trusts to be complete.
- The title is pinned too: `edfcore <first>–<last>` with an en dash, dropping the range for a
  single version, cut on the newest tag so it points at the code the range ends with. A small thing
  to get wrong and a permanent one, since release titles are what the release list looks like
  forever.

## 0.4.434

- **Added** a check that asking a source for nothing costs nothing, in every adapter. A zero-length
  read is what a caller gets from `end - start` when a window selects no samples, from a range
  computed off a record count that turned out to be zero, or from a loop whose last iteration has
  nothing left to take. `assertReadRange` allows it, so every adapter has to decide what to do with
  it, and each decides separately.
- The wrong answers are quiet ones. Handing the request to the transport gets a `bytes=100--1`
  range no server will honour, or a `Blob.slice(100, 100)` and a promise allocated for nothing.
  Neither is an error a caller could act on, and both are about a request nobody meant to make.
- All five adapters are checked in one table rather than one at a time, because the contract is
  about `ByteSource` and an adapter added later inherits it. The offset still has to be real:
  `offset === byteLength` is legal, since that is where a read of nothing sits at the end of a
  file, and past it the offset is outside the source whether or not any bytes would have been read.

## 0.4.433

- **Added** tests for what a conformant header is allowed to say. `validateHeader` raises three
  advisory diagnostics about how a header is written, each checked somewhere for the case where it
  fires, and none for the case where it stays quiet — which is the direction with consequences.
- A conformance report is only worth reading if a clean file produces a short one. `PREFILTERING_NONE`
  holds four spellings of "no filtering" that EDF+ and real writers use interchangeably, and
  dropping one means every file from that writer carries a warning about a field it filled in
  correctly. Nobody debugs that; they stop reading the warnings, which are the same warnings that
  would have told them something real.
- The headline is the whole of it at once: a header that follows EDF+ to the letter — an
  `EEG Fpz-Cz` label, a named transducer, `HP:` and `LP:` terms — produces no conformance
  diagnostics at all. That sentence is the product these checks exist to make possible and it was
  never asserted.
- One subtlety is pinned deliberately. A bare `EEG` label is flagged, because the rule is
  `<type> <sensor>` and a type with no sensor names a category rather than a channel. The condition
  that gets that right reads like a redundant length check beside the set membership next to it,
  and simplifying it away would silently accept `EEG`, `ECG` and `Temp` as channel names.

## 0.4.432

- **Added** a check that every version is still signed, and of the four lines that make it so.
  `scripts/release.mjs` ends a successful run by telling whoever cut it that the version "is on npm
  with a provenance attestation". It prints that unconditionally, nothing verified the workflow
  still signs anything, and nothing could notice if it stopped: npm accepts an unsigned publish
  exactly as it accepts a signed one, and the only difference is a panel missing from a web page
  nobody reloads.
- The attestation is not decoration here. AGENTS.md explains that the
  `archive/pre-squash-2026-08-16` branch is load-bearing precisely because every version published
  that day carries a signed attestation naming the commit it was built from — a whole branch is
  kept alive so those Source Commit links keep resolving.
- Four things hold it together and each is a line a tidy-up removes without a thought:
  `id-token: write`, where the signing key comes from and whose removal looks like tightening
  permissions; `--provenance` on the publish step, which looks redundant next to `publishConfig`;
  `--provenance` *not* in `publishConfig`, the opposite tidy-up, because there it would apply to a
  publish from a laptop that has no OIDC token to sign with; and `registry-url` on `setup-node`,
  without which the publish is unauthenticated and never gets far enough to sign anything.
- The reasons written beside them are checked too, since they are the only thing standing between
  the next reader and the tidy-up.

## 0.4.431

- **Added** tests that a 16-bit channel labelled `Status` is not a BioSemi Status channel.
  `api-helpers.md` explains why `readTriggers` locates the channel itself rather than taking a
  `signalIndices` — "a 24-bit EEG sample decoded as a trigger word yields plausible-looking events
  out of ordinary data" — and that reasoning is about the wrong channel of the right file. The
  other way in is the right channel name in the wrong kind of file.
- `Status` is not a BioSemi word. Plenty of systems label a channel that way, and a plain EDF file
  carrying one is an ordinary thing to be handed. Its samples are 16 bits of a measurement; a
  BioSemi Status word is 24 bits of a latched bit field with the trigger input in the low 16 and
  flags at bits 16, 20 and 22. Read one as the other and the low bits become codes, bit 16 becomes
  an epoch marker that flips constantly, and what comes back is a dense list of events with real
  timestamps from a channel that recorded a voltage. Nothing about that output says it is wrong.
- The guard is one line, and it is what makes the documented
  `getStatusSignal(header) !== undefined` check mean "this is an ActiveTwo recording" rather than
  "something here is called Status". It had never been given a 16-bit file to refuse. The label
  matching is deliberately forgiving about case and padding; the width is not.

## 0.4.430

- **Added** tests for a patient's date of birth being redacted out of a message that never quotes
  the field. `redactDiagnostic` withholds identification by substituting the field's value out of
  the message by text, and `DATE_IMPLAUSIBLE` defeats every spelling of it: the field says
  `02-MAY-2050`, the message says `2050-05-02`, because it is comparing two dates and prints both
  in one form. No substring of the raw field appears in that sentence. It is redacted anyway, from
  `actual` — which carries whatever the message chose to print.
- It is also the case with the widest reach. The other identification diagnostics fire on a
  malformed field, so a conformant file never produces them; this one fires on a perfectly
  conformant patient field whose only fault is a year the two-digit header rule resolved into the
  future, which is what a recording made before 1985 or after 2084 looks like. A clinical file with
  nothing wrong with it, printed by a command asked to withhold the patient, and a date of birth in
  the output.
- The other half is what must survive. Substitution is on the value, never on the code or the rule,
  so the code, the byte offset, the field name, the spec clause and the recording's own start date
  are all still there — and a field nobody asked to withhold is still quoted verbatim.

## 0.4.429

- **Added** tests for `edfcore validate` exiting 1 because validation failed. The exit-code table on
  `cli.md` gives `1` two meanings in one row — "the file could not be read, or validation failed" —
  and only the first was exercised. `runCli` returns `report.ok ? 0 : 1`, and nothing had ever
  driven it down the `false` side, which is the entire reason the command exists.
- A CI job gating on conformance branches on that number without reading a word of the output, and
  it can fail in two opposite ways. A gate that never fires passes every recording, including the
  ones the library refused to scale, and nobody investigates a green tick. A gate that always fires
  gets switched off, and the conformance checking goes with it.
- The second is likelier, and it turns on a boundary now stated as a subject: a warning is not a
  failure. `LABEL_CONVENTION_NONCONFORMANT` is on almost every real recording, CHB-MIT ships a
  duplicated channel label, a file marked EDF+C whose onsets drift is a warning because real
  writers do that, and a zero record duration is legal EDF. A gate rejecting any of those would
  reject the corpus this library was built to read.
- `header` on the same refused file exits 0, and that contrast is checked. It reports what the
  header says and adjudicates nothing, which is what makes asking for a verdict worth doing.

## 0.4.428

- **Added** a check that a version number which never reached npm says so at the heading and says
  where its work went. Nineteen of the six hundred-odd headings in this file name a version nobody
  can install; they exist because a reader comparing `npm view edfcore versions` against the file
  would otherwise find a hole and be unable to tell a lost number from a missing note.
- `changelog-continuity.test.ts` checks the sequence. What it cannot see is whether a heading tells
  the truth about itself, which is the half 0.4.307 was about: fourteen entries had been written
  before their release failed, so each read exactly like one that shipped, with the correction in a
  different entry further up that a reader landing on `## 0.4.288` never sees.
- So the marker has to be first — a note further down is a note nobody scrolling to a version
  reads — and it has to point forward, because "Never released" alone strands the reader with work
  that exists under a number they now have to search for. The pointer is bounded at twenty patches
  and every real one is within six, so an incidental mention of some later release cannot stand in
  for it: the 0.2.29 entry names 0.4.194 as the release that wrote it down, and that is not where
  its work went.
- The two forms are kept apart on purpose. A number consumed before a tag was cut never became
  public at all; a version that was tagged and whose publish then failed is public on GitHub and
  absent from npm, which is a different thing to be told.

## 0.4.427

- **Added** a property test for `trimToWindow` against the rule it states rather than the examples
  it was written from. The source says which samples belong in a window in one line — "Sample j is
  in the window when `ceil(j * D / S)` is in `[R, Rend)`" — and what the code does is a closed form
  derived from it: two `floorDiv`s over bigint products, with the derivation written above them. A
  closed form is exactly where an off-by-one lives, and the derivation is the part a reader takes
  on trust.
- So the rule is implemented the obvious way, asking every sample, and the two must select the same
  set for arbitrary geometries and windows. The naive version is too slow for a library and is
  obviously right, which is the only pairing worth testing a closed form against.
- The rounding it turns on is not incidental. 256 samples in a one-second record puts sample 1 at
  39,062.5 ticks, published as 39,063, and selecting on the exact start rather than the published
  one excluded that sample from a window beginning at its own published start — half of all indices
  at that rate, and at 128 samples per 0.29 s a one-sample window came back empty (0.3.56).
  Geometries whose boundaries miss whole ticks are generated deliberately, because the ones that
  land on them cannot tell the two rules apart.
- Three obligations from the docblock come with it, none previously checked in general: adjacent
  windows partition a chunk exactly, a window covering the chunk is the identity, and the result is
  a view rather than a copy.

## 0.4.426

- **Added** a property test that the cache is invisible at every size it can be configured to.
  `api-sources.md` describes `cachedSource` as "removed by deleting one wrapper from the expression
  that built the source", which is the property a caller relies on when they add it: the reads get
  cheaper and nothing else changes.
- The existing demonstration is one script of six reads at the default block size, where the 1 MiB
  block swallows the fixture whole — so it demonstrates a cache that never evicts, never stitches
  and never splits. The interesting sizes are the other ones: a block smaller than a read makes
  every answer a stitch, a budget smaller than a few blocks makes the cache evict mid-sequence, and
  a read wider than the budget bypasses the cache entirely. All three are reachable from an
  ordinary configuration — blocks sized to a record, a budget sized to a phone.
- The failure is not a crash. Stitching arithmetic off by a block start returns the right number of
  bytes from the right file, taken from the wrong offset: a header that parses, samples that plot,
  and a recording quietly shifted.
- The copy rule is scoped rather than assumed. It is asserted for reads the cache actually serves;
  a read wider than the whole budget returns the wrapped source's own array by design, because
  nothing is retained on that path, and `cached.ts` says so. Each property builds its fixture
  fresh, since a test that writes into a result would otherwise edit the bytes it compares against
  and pass on the damage.

## 0.4.425

- **Added** tests for the one sentence `api-reading.md` gives about the shape of `signalIndices`:
  "Duplicates are dropped; the order you give is the order of `chunk.signals`." It was prose, in
  the options table every reader consults before their first read.
- Both halves are reached by ordinary code. A repeated index comes from a multi-select that appends
  on click, a "select all" over a list that already had one checked, or `[...montage, ...extras]`
  where the two overlap. The order comes from wherever the indices were built, and a caller drawing
  `chunk.signals[0]` as the top trace is trusting it.
- They fail differently and both quietly. A duplicate that is not dropped costs a second decode and
  returns an array with one more entry than the caller's legend has rows, so every trace below the
  repeat is drawn with the wrong label. An order that is not preserved swaps two traces outright,
  and on a montage two channels of EEG look like two channels of EEG.
- `readRecords`, `readWindow` and `streamRecords` are all checked. They share one resolver today —
  `stream.ts` says it must produce the byte-identical refusal `readWindow` does — but that is a
  fact about the code and the promise is about the API.

## 0.4.424

- **Added** a property test that reading a stretch in pieces and joining them is reading it whole.
  That is the promise `mergeChunks` exists to make, and it is what lets a caller bound memory
  without changing an answer. `merge-chunks.test.ts` demonstrated it on one split of one file, and
  every check around it is about a merge that must be refused — the thing that has to hold for
  every split of every file was shown for one.
- The failure it guards is silent and arithmetic. A merge that dropped the last sample of each
  piece, or summed the wrong bytes, returns an array of the length a caller expects, holding real
  samples from the real file, shifted. Nothing downstream can tell: the timestamps come from the
  record range, which is right, and the values are plausible because they came from the recording.
  It surfaces as an event marked half a second late, weeks later, in someone else's analysis. So
  the bookkeeping is checked alongside the samples — `records`, `byteLength` and the chunk's own
  start in ticks are all quantities a caller reads off the result.
- **Removed** an unreachable branch from `byteSource`'s argument description, and the comment
  claiming it prevented a message nothing can produce. It named an `ArrayBuffer` or a
  `SharedArrayBuffer` in a refusal — but the description is built on the throw path alone, which is
  reached only when the same `BUFFER_TAGS` test has already answered no.
- It was reachable once. The branch was added when a refusal called those buffers "a plain
  object", and it stopped being reachable in 0.3.20, when the acceptance check was widened from
  `instanceof` to the same tags. Nothing noticed, because dead code that agrees with the code
  around it reads as thoroughness.
- `BUFFER_TAGS` itself stays: it is what accepts a buffer from another realm, which 0.4.422 now
  exercises through `node:vm`.

## 0.4.423

Never released. The release run bumped the version, passed its own checks and pushed, and CI then
failed all three Node jobs on formatting: a test file written after `npm run format` had run was
swept into the commit by `git add -A` unformatted. Nothing was tagged and nothing went to npm, but
the bump was already public, which consumed the number. The same failure as `0.4.176`, arriving
from the other side — there the local check caught it after the bump, here the local check never
saw the file. The work that carried this heading shipped in `0.4.424`.

## 0.4.422

- **Added** tests for what `byteSource` accepts and what it says about everything else. It is the
  first call almost everyone makes, and the one place a caller's mistake can be mistaken for a
  defect in their file: `new Uint8Array(x)` accepts almost anything — a string, a plain object and
  `null` all yield an empty array, a `number[]` one of the wrong length — so a source built from
  any of them reads back as `[SOURCE_TOO_SMALL] the header is 0 bytes`, blaming the recording for
  an argument.
- Two acceptances are load-bearing and neither is obvious from the signature. A Node `Buffer`
  works because it is a `Uint8Array`, and `await readFile(path)` is how almost everyone in Node
  gets bytes. A buffer or view from another realm works because the guard is
  `Object.prototype.toString`, not `instanceof` — until 0.3.20 the ArrayBuffer half used
  `instanceof` while the SharedArrayBuffer half already used the tag, so a real, usable
  ArrayBuffer from an iframe was refused as "a plain object" and told to pass the ArrayBuffer
  itself, which is what the caller had done. That case now runs through `node:vm`, because a
  same-realm buffer passes `instanceof` and would let the defect back in unnoticed.
- Two refusals are load-bearing too. An `Int8Array` has one byte per element, so it passes every
  length check and then has its already-signed elements sign-extended a second time during decode:
  fabricated microvolts with no error anywhere. A `DataView` is the other shape that looks like
  bytes and is not.

## 0.4.421

- **Fixed** the first line of `edfcore validate`, which did not pluralise. A report with two errors
  and two infos opened `FAIL — 2 error, 1 warning, 2 info`, directly above a line reading
  `scanned 12 records`. One function, two conventions, and the ungrammatical one on the line a
  reader sees first — `pluralise` was defined three lines above it and used for the record count
  only.
- The severity counts now go through it: `2 errors, 1 warning, 2 infos`. The test pins the plural
  and the singular on the same line, because either alone reads fine until you see the other.

## 0.4.420

- **Added** tests for how long a TAL timestamp field may be. An onset and a duration are digits
  with no declared length — the grammar ends them with a structural byte, so their size is whatever
  the writer put between two markers, in a region that is 30 bytes on one file and 60 kilobytes on
  another.
- `MAX_TIMESTAMP_FIELD_CHARS` is that bound. Both fields carry the check; the onset's was
  exercised and the duration's was not, and they matter differently. An over-long onset is a
  malformed TAL from the first byte. An over-long duration arrives after a perfectly good onset,
  which is the shape that gets past a reader's attention.
- The guard sits before the decode, which is the property worth having: past it, a region full of
  digits between two markers is a bigint the size of the region, parsed on every record of every
  read that touches annotations.
- A skipped TAL is skipped alone — the parser resumes at the terminator, so the events after a
  hostile one are still read, and the bound is checked from both sides so it is where the message
  says it is.

## 0.4.419

- **Added** tests for the two ways `mergeChunks` can be handed an input whose numbers look right.
  It concatenates by position — signal `i` of the second chunk continues signal `i` of the first —
  and the refusal for a different NUMBER of channels was pinned. The same channels in a different
  ORDER was not.
- A caller reaches that without doing anything strange: `signalIndices` built from a `Set`, from
  `Object.keys`, from a checkbox list re-rendered between reads, or from `getSignal` calls made in
  whatever order the labels came back. Merging those splices one electrode's samples onto another's
  and returns a chunk that looks entirely normal — right length, right record range, right
  timestamps — with two channels swapped halfway through. Nothing downstream would catch it,
  because there is nothing wrong with the numbers, only with which channel they belong to. On a
  montage that is the difference between a left-temporal seizure and a right-temporal one.
- The second is the array itself. `mergeChunks` addresses its input by index, so a hole left by a
  `filter` or a splice would read as `undefined` and be dereferenced; it is refused by name
  instead, pointing at the array `readWindow` returned.

## 0.4.418

- **Fixed** the rest of what 0.4.417 was about. Memoising the diagnostic sweep cut
  `spec-references.test.ts` from 13.0 s to 4.4 s and did not settle the timeouts: whichever check
  ran first still did the whole sweep inside its own five-second budget, and on a machine running a
  video call and an emulator that alone took 6.5 s. Three release runs failed on it after the
  memo landed.
- The sweep is now paid for in a `beforeAll` with a timeout of its own. The work is real rather
  than a hang, so the honest answer is to say how long it may take — once, in one place, rather
  than as a number repeated on seven checks. Every check then finds the memo warm and runs at the
  default timeout, which is the budget that should govern a check.
- Worth stating plainly: the previous entry claimed more than it delivered. It reduced the risk by
  more than a factor of five and left the first caller carrying the whole cost.

## 0.4.417

- **Fixed** the cost of `spec-references.test.ts`, which was the most expensive file in the suite by
  a wide margin. Seven checks in it ask questions of the same set of diagnostics, and each rebuilt
  it from scratch: nine targeted parses plus 2,700 bit-flipped ones, seven times over. The sweep is
  now run once for the file. It drops from 13.0 s to 4.4 s, and the work inside the tests from
  10.3 s to 1.9 s.
- The reason to care is not the seconds. Every one of those seven checks sat within reach of
  vitest's default 5 s timeout, which makes a test that passes or fails on how busy the machine is —
  and two of them did fail, on a laptop running a video call and an emulator, for reasons that have
  nothing to do with the code. A shared CI runner is the same machine on a bad day, and
  `scripts/release.mjs` gates the tag on CI going green.
- Memoised rather than hoisted to a module-level `await`, so the sweep starts when the first check
  asks for it and a rejection surfaces inside a test rather than as an unhandled one.

## 0.4.416

- **Added** tests for a file with no annotations signal, whose record onsets are arithmetic. Plain
  EDF and plain BDF carry no timekeeping TALs, so record `r` starts at `r * recordDuration` by
  definition and reading the data would answer a question the bytes do not contain.
- The consequence is a cost, and cost is why the index is shaped the way it is.
  `locate-cost.test.ts` pins the EDF+ numbers the page prints for a file whose onsets have to be
  read. For the majority of files in the world the number is zero, and nothing said so — a refactor
  that probed unconditionally would be invisible in every result, because the probe would derive
  the same arithmetic value it found written nowhere. Only the request count changes, and on a
  remote recording that is the difference between opening a file and paying one range request per
  step of a binary search.
- `buildRecordIndex` is the sharper case. On an EDF+ file it is a full traversal, which is why the
  page tells you to gate it on the two-probe verdict; on a plain EDF it must be free, and it still
  has to call `onProgress` once with the traversal complete, so the fastest possible file is not
  the one whose progress bar never moves.

## 0.4.415

- **Raised** the test-count figure from 2,000 to 2,500 in the README's status line, the note at the
  foot of `installation.md` and the docblock of `browser-safety.test.ts`. The suite has outgrown
  the old number: 2,002 written-out cases, and vitest reports around 2,900 once `it.each` rows
  expand.
- Found by `test-count-claims.test.ts`, added in 0.4.388 for exactly this. A claim of the form
  "N or more" stays true forever once it is true, which is the property that makes it worthless —
  it can never be wrong, so it is never re-read, and half the real scale is a wrong impression
  conveyed in a true sentence. This is the first time the guard has fired.
- **Fixed** the same self-quotation trap in that file, for the second time. The comment documenting
  the regex illustrated it with the two spellings it matches, so the scanner read its own examples
  as a fourth statement of the figure — and the one place raising the claim elsewhere would never
  touch. The comment now describes the shape instead of spelling a number.

## 0.4.414

- **Added** a check that binds every entry of AGENTS.md's "Things that look like bugs and are not"
  to the test that pins it. The section exists because each entry is something a reader improves on
  sight — the scaling expression has an obviously better rearrangement, `readWindow` returning an
  array for a continuous file is an obviously unnecessary wrapper, an optional `signal.scale` is an
  obviously missing default — and every one of them has been proposed.
- It closes with a promise about itself: "Each of the code rules has a test pinning it and a comment
  explaining why." Nothing checked that sentence, and both ways it stops being true are ordinary. A
  rule gets added because someone was bitten by it and no test comes with it, so the list reads as
  enforced while it is not. Or a test is renamed in a tidy-up, and nothing fails — the rule is still
  checked, or it is not, and nobody can tell which from the list.
- The binding is checked in both directions: a new bullet with no entry fails, and an entry naming
  a file that no longer exists or no longer mentions the rule fails too. Each binding carries a
  phrase the file must contain, so a filename alone cannot stand in for a check.
- The last entry is exempt by the sentence's own words — it is a fact about a branch on a remote,
  which an offline suite cannot see — and it is required to still BE the last, because a rule
  appended after it would inherit an excuse written for something else.

## 0.4.413

- **Added** tests for the calendar edfcore validates against. `isValidCalendarDate` exists because
  a `Date` is the wrong tool: real files carry 31 April and 29 February in common years, and
  `new Date(1997, 3, 31)` rolls both forward into a neighbouring month rather than rejecting them.
  A recording silently dated a day later than it was made is the kind of error nobody finds,
  because the wrong answer is a perfectly ordinary date.
- `date-ban.test.ts` proves no `Date` is constructed anywhere. That left the arithmetic which
  replaced it, exercised only through the parser, where a rejected date is indistinguishable from a
  rejected field.
- The month lengths are not restated — restating a table checks a transcription, and the
  transcription is what would already be wrong. The properties it must satisfy are checked instead,
  from the Gregorian calendar rather than from this file: the twelve months sum to 365 or 366 for
  every year from 1 to 9999; four hundred consecutive years hold exactly 97 leap years and 146,097
  days, which is a whole number of weeks; and a century not divisible by 400 holds 24, not 25.
- A table with a month a day short fails the first for every year, and a leap rule missing its
  century exception fails the second by three days a cycle.

## 0.4.412

- **Added** tests for four header fields that are all finite and imply a gain that is not. An EDF
  physical bound is eight bytes of ASCII, which is room for an exponent, so a physical range can
  underflow against the digital range — `0` to `5E-324` over -1..1 puts `bitValue` at zero and
  `offset` at infinity — or overflow it, where `-9.9E307` to `9.9E307` exceeds float64 before the
  division happens.
- Nothing about such a file looks wrong. The header parses, every field is in range for its width,
  and a reader who does not check `signal.scale` gets a column of `NaN` where microvolts should be
  — which plots as an empty panel, or silently poisons a mean. The scale is refused exactly as the
  obvious degeneracies are, and `decodeDigital` keeps working, which is the whole reason
  `toPhysical` is a separate call.
- A signal declaring a negative `samplesPerRecord` is the other shape of "parses and cannot be
  used", and it is fatal rather than diagnosed: every later signal's byte offset inside a record is
  a running sum of that field, so a negative one does not make one signal wrong, it makes every
  signal after it point at the wrong bytes.

## 0.4.411

- **Added** tests for the envelope of the files and selections a viewer produces by accident.
  `readEnvelope` exists to draw a recording at pixel width, so its caller is a UI: the signal
  indices come from a multi-select, the bucket count from a canvas width, and the file from
  whatever was dropped on the page.
- **The same signal asked for twice** — a multi-select that appends on click, a "select all" over a
  list that already had one checked — is now pinned as one series in order of first mention, and
  costing what asking once costs. **A signal with no samples in a record** draws as an empty series
  rather than failing the whole envelope, so a "plot everything" loop still gets a slot for every
  channel it named. **A file whose records do not advance in time** buckets without dividing by the
  duration: `readEnvelope` divides the samples evenly, because there are no timestamps to place
  them along, and `readEnvelopeAtResolution` gets one bucket, because the span is zero.
- A fourth case is a request rather than a file: a `secondsPerBucket` finer than one tick has no
  whole-tick answer, and asking for one bucket per tick and letting the fold clamp to one bucket per
  sample was a comment with nothing behind it.

## 0.4.410

- **Added** a check that nothing on the site tells a crawler to stay away. `robots.txt.ts` opens
  with a decision and its reasoning — everything is open to every crawler, including the AI
  training crawlers, because an open-source library wants the opposite of what a publisher
  protecting paid content wants — and that decision was enforced by nothing.
- Every way of reversing it is a normal-looking edit no reviewer would flag as a policy change: a
  `Disallow:` added during a "block the AI scrapers" tidy-up; `Google-Extended` or
  `Applebot-Extended` added to look thorough, whose only effect is to opt out of model training; a
  `<meta name="robots" content="noindex">` copied from a staging site; an `X-Robots-Tag` in
  `vercel.json`, which overrides the page and the file both. None changes anything a visitor sees.
- `check-site-output.mjs` reads the built `robots.txt` and checks one thing — that the sitemap it
  names was emitted — and runs in CI only. This is the source-level half, in `npm run check`.
- The emitted lines are read out of the `body` array rather than the whole file. Scanning the file
  for quoted strings does not work: the docblock is English, and one apostrophe in "a model's
  training data" shifts the pairing for everything after it — which is how a `Disallow` line added
  to the body went unseen while this check was being written.

## 0.4.409

- **Added** tests for the start offset a chunk has to derive when it does not begin at record 0.
  A caller following the `decodeAnnotations` example on `api-primitives.md` hands over a record
  range that usually excludes record 0, so record 0's sub-second offset — what every published
  onset is rebased on — has to be derived by subtracting the nominal distance back to it.
- That subtraction is valid only while the records in between are contiguous, which is what a
  discontinuous file is not. A derived value outside [0, 1) is therefore evidence about the file:
  on one marked EDF+C it means the file is either discontinuous while claiming continuity or its
  onsets drift, and the diagnostic says so instead of rebasing on a number known to be wrong. On an
  EDF+D file the same value implies nothing, so nothing is reported — otherwise `strict` would
  reject every conformant discontinuous recording.
- A supplied `originTicks` or `startOffsetTicks` outranks the derivation even when it lies outside
  [0, 1), because it came from the timeline rather than from arithmetic across a gap. That is what
  keeps the diagnostic count a property of the file: before 0.3.15 the three internal callers
  re-derived it per chunk, and one file produced 1, 2, 4, 7, 16 or 31 of them purely as a function
  of `maxMaterializeBytes`.

## 0.4.408

- **Added** tests for the refusals in the sample helpers. `sampleAt`, `sampleStartTicksOf` and
  `gridSampleIndexAt` all map between a time and a sample index, all three sit behind a guard
  rejecting the signals and files where no such mapping exists, and none of those guards had ever
  been executed.
- None of the inputs is exotic. An annotations channel is in `header.signals`, so
  `signals.map((s, i) => sampleAt(recording, i, t))` reaches it on the first EDF+ file. A signal
  declaring zero samples per record opens with a warning, beside live channels. A file whose
  records do not advance in time opens with a warning too, and `api-errors.md` names a scoring file
  as the reason it is legal.
- The three messages differ because the ways out differ — an annotations channel to
  `onsetTicksFromFirstRecord`, a zero-sample signal to the diagnostic explaining it, a zero-duration
  file to `readRecords` — so the pairing is checked rather than the error type. `sample-grid.ts` and
  `sample-locate.ts` carry the same three refusals and are checked side by side, because 0.3.78 was
  the two disagreeing about which onset field to recommend.

## 0.4.407

- **Added** tests for a window over a recording whose records do not advance in time.
  `concepts.md` calls a zero record duration legal and says what edfcore does about it — a
  `ZERO_RECORD_DURATION` warning, `sampleRateHz` left `undefined`, "and keeps reading" — and
  `api-errors.md` names the shape it comes from: an annotations-only EDF+ recording, whose records
  carry events and no samples.
- "Keeps reading" is the part with a window in it. Every record sits at one instant, so a window
  either contains that instant or it does not and there is no interval arithmetic to do. That is
  why the code has a separate branch for it, and why that branch is where a division by zero would
  otherwise live. Both index shapes carry their own copy — a complete index answers from its
  segments, a probed one from the nominal grid — and the two are now required to agree on every
  window put to them.
- The boundary rule is the same as everywhere else: a window opening exactly on the instant
  contains it, one closing exactly on it does not.

## 0.4.406

- **Added** tests for the index `validateRecording` is handed, and whether it is allowed to answer
  for the file. `api-validate.md` describes the option as a complete index "whose onsets the sweep
  reuses instead of reading them again", and nothing checked what happens when the index does not
  fit.
- That is an ordinary mistake — a viewer holding indices for several open recordings, a helper that
  caches one per session, a loop that forgets to rebuild — and the consequence is not a wrong number
  but a wrong file: the segments and gaps of recording A reported as the structure of recording B,
  in a report whose whole purpose is to say whether *this* file conforms.
- The rejection is checked by observation rather than by reading the guard. A rejected index makes
  the sweep read the onsets itself, so a spy counts it, and the cost is required to equal passing no
  index at all — which is what "ignored" has to mean.
- Also covers `DISCONTINUITY_IN_CONTINUOUS_FILE` on a file that both skips and repeats time. Gaps
  travel in one array partitioned by sign, an overlap being an entry with a negative duration
  (0.2.69), and counting the array told a reader that a file missing no data had a gap (0.3.3). One
  of each is the case where the message has to say both, and no fixture produced it.

## 0.4.405

- **Added** tests for `locate` at the edges of a file. `discontinuous.md` states the contract in
  one sentence — "`undefined` means the instant is in a gap or outside the recording, never that
  the lookup failed" — and only the gap half was covered.
- A caller cannot distinguish the two. A viewer scrubbing to a timestamp gets `undefined` and draws
  nothing; if that came from a search that ran off the end of an array it would draw nothing for a
  time that does exist, and the recording would appear to be missing data it holds.
- Four shapes, each a different branch: a time before the first record, which is also where a
  negative time lands; a file with one record, where there is no interval to bisect; a file with no
  records, where every instant is outside; and records of zero duration, which contain only the
  instant they start on and answer with the last record sharing it, because with no interval there
  is nothing to prefer an earlier one by.
- `onsetTicks` is the other refusal on the index and the one a caller reaches by arithmetic — an
  index computed from a duration and a rate is exactly where a fractional or out-of-range number
  comes from. Its `requested` and `available` fields are checked, not just its message.

## 0.4.404

- **Added** tests for the buffered whole body — what `allowFullDownload: true` leaves behind once
  the transfer is done. `hardening.test.ts` pins the transfer count, which was a real
  out-of-memory defect; everything about the buffer itself was unchecked.
- A read off it returns a **copy**. `sliceFullBody` says `slice`, not `subarray`, because the body
  is retained state: a view into it makes one caller's write change what the next caller reads, and
  the samples that change belong to a different part of the recording. Same property
  `api-sources.md` states for `cachedSource`, on the other object that retains bytes.
- The resource can be **shorter than the source was told**. `options.byteLength` with
  `allowFullDownload` is exactly the pair `data-sources.md` recommends for a broken origin, so a
  stale `Content-Length` behind it is the combination a reader actually reaches for. The message
  for that names the real size from the body in hand rather than offering `assertExactRead`'s
  advice, which no retry could act on (0.3.75).
- A transfer that **fails** must not poison the source, and the probe-time entry — a length probe
  answered with a 200, where the size is learned from the download rather than a header — is a
  second route to the same buffer.
- Folded the stranded one-line docblock above `sliceFullBody` into the real one. It has been the
  first commit's comment sitting under a longer block added in 0.3.75, where no editor would show
  it, and the `slice`-not-`subarray` reason it states is now the property above.

## 0.4.403

- **Fixed** the length probe taking a `Content-Range` total from a range unit that is not bytes.
  RFC 7233 lets a server answer in a unit of its own, and `Content-Range: items 0-0/4096` was read
  as a 4,096-byte resource — building a source whose every read is then range-checked against a
  number measuring something else. That is exactly the fiction `options.byteLength` is validated to
  prevent, arriving by the route nobody validates.
- `totalFromContentRange` now requires the `bytes` unit, as `rangeFromContentRange` beside it
  already did. The other caller reaches it only after that stricter parse has already accepted the
  header, so nothing that worked before stops working; a header in another unit now falls through
  to the fatal "could not determine the size", which tells the caller to pass `byteLength`.
- **Added** tests for the three routes to a length, in the order they are tried. The
  `Content-Length` route in particular had never been taken: every double in the suite answers the
  probe, so the HEAD's own answer was the cheapest path and the untested one.
- The fall-through is the clause with teeth. An object store answering `403` to `HEAD` while
  serving ranges happily is the ordinary case for a bucket with a narrow policy. It is a `catch`
  that swallows every rejection, so what it must swallow is pinned — and so is the fact that it
  stops swallowing once the probe itself is what failed.

## 0.4.402

- **Added** tests for what `httpSource` accepts before it issues anything: a URL, a `fetch` and a
  length. Three sentences on `api-sources.md` describe constructing a source, and all three were
  prose.
- "It accepts a `URL` object as well as a string, because `URL` structurally satisfies
  `{ href: string }`." A `URL` is what `new URL(name, base)` hands you, so passing one is the
  normal case rather than the clever one — and nothing here had ever passed anything but a string
  literal.
- `fetch` defaults to `globalThis.fetch`, and throws `EdfSourceError` at construction when neither
  is available. That is the path every browser caller takes and the one no test could take, because
  the suite replaces the global with a trap that refuses. It is exercised now by standing a
  counting double in the global's place for the length of one test, which is the only way to
  observe the fallback without reaching a network.
- `byteLength` must be a non-negative safe integer. Its whole purpose is to skip the probes, so a
  bad value is a value that would otherwise be trusted as the size of a resource nobody measured,
  and every read is then range-checked against a fiction. Zero is accepted, because an empty
  resource is a real one.

## 0.4.401

- **Added** a check that the palette has one definition. `tokens.css` opens by explaining the
  pairing — the signal green carries the trace, the rose is semantic and marks events, and rose
  rather than red because red-on-green is the one pairing red-green colourblindness collapses, with
  the measured separation written down. That reasoning is worth something only while the colours it
  describes are the colours a visitor sees.
- Three places cannot say `var(--signal)` and so restate the value. `og.svg`, because an SVG
  exported by `qlmanage` has no stylesheet: nine literal hexes. The two `theme-color` metas, because
  the browser paints the chrome before any CSS arrives — wrong values put a stale band above and
  below a scrolling page, on phones, where nobody developing the site is looking. And
  `TraceStrip.astro`, which reads the tokens at runtime and is right to, but whose fallbacks are the
  palette written a third way in decimal RGB — the copy least likely to be recognised as one.
- Each is now required to be the specific token that does its job, resolved through `var()` the way
  the cascade does: `theme-color` is `--bg` in each layer, the card's rose is on the annotation, and
  each canvas fallback is its own token's default-theme value.
- The beam head is deliberately exempt. Its core is a near-white green brighter than any token,
  because a phosphor blowout is additive light and there is no palette entry for it.

## 0.4.400

- **Added** a check that the two tsconfigs differ only where they are meant to. `npm run typecheck`
  runs both on purpose — the build config compiles `src/` with `lib: ["ES2022"]` and `types: []` so
  the DOM and `@types/node` cannot leak into the published declarations — and AGENTS.md states that
  split. What it does not state is that everything else about them has to match.
- That is the half with consequences. Every strictness flag in the root config is the setting the
  suite is written under, including the `tests/types/*.test-d.ts` files whose job is to prove the
  public API compiles for a consumer. Turn `noUncheckedIndexedAccess` off there alone and they keep
  passing while they stop testing what they claim: `src/` still compiles strictly, and the snippet
  asserting a consumer's experience is now checked under settings no consumer has.
- The repository has already paid for that flag once. Until 0.4.259 the snippet AGENTS.md tells
  agents to copy ended `chunks[0].signals[0].digital` and did not compile in a strict project.
- The eleven strictness flags are also asserted individually, so turning one off in *both* configs —
  which a comparison alone would call agreement — still fails. Divergences must be named, and a
  named divergence the configs have since settled fails too, because a stale exception is a hole.

## 0.4.399

- **Added** to `verify:tarball` the three files npm packs by convention rather than because `files`
  asks for it: `package.json`, `README.md` and `LICENSE`. `files` is an allow-list and none of the
  three is on it, so all three ship on a rule this repository does not state and cannot see.
- A package that arrives without `LICENSE` is an MIT package whose terms are not in it, which is
  the half of 0.4.398 a text comparison cannot reach. Without `README.md` the npm page is blank —
  the first thing anyone sees of the project, and the last thing anyone would think to check.
- `.npmignore` is what makes this reachable rather than theoretical: it overrides `files` outright,
  so adding one for an unrelated reason can take all three out at once.

## 0.4.398

- **Added** a check that the licence is one licence. `package.json` declares `"license": "MIT"` —
  the string npm indexes, GitHub's sidebar reads and every corporate approval process greps for —
  and `LICENSE` is the only one of the five copies that actually grants anything. The other four
  describe it.
- The failure this guards is not someone changing the licence. It is someone changing one copy: a
  relicensing that updates `LICENSE` and leaves the manifest saying MIT ships a package whose two
  statements of its own terms disagree, which is worse than either being wrong alone. The holder is
  the same shape — three hand-typed copies of one name, in the manifest, the file and the README.
- The body is checked as well as the heading, because a truncated `LICENSE` is still a `LICENSE`.
  The grant and the warranty disclaimer are what make it MIT rather than a title over an empty
  file, and one that lost its disclaimer is a licence someone could argue carries a warranty.
- The copyright year is deliberately not checked. There is no `Date` in this repository, and a year
  assertion is a test that fails on the first of January for no reason anyone would want.

## 0.4.397

- **Fixed** `website/design/og.svg`, which had been missing its final newline since it was drawn.
  `.editorconfig` has asked for one on every file in this repository the whole time.
- **Added** the check that would have caught it. Biome formats the `.ts`, `.mjs`, `.json` and
  `.jsonc` files and reports a deviation as a lint error; everything else here — the markdown, the
  two workflows, the `.astro` components, the stylesheet, the Python under `scripts/golden/`,
  `og.svg` and `LICENSE` — was governed by `.editorconfig` and by nothing at all, and between them
  they are most of what a reader ever opens.
- `.editorconfig` is a request to an editor, not a check, and every way of breaking it is invisible
  in review: a missing final newline shows as one line in one diff and then never again, and a CRLF
  ending shows as nothing until the day a whole file appears rewritten.
- The rules are read out of `.editorconfig` rather than restated, so deleting a line turns its
  check off — and a separate assertion that all five are still declared is what makes that a
  visible decision. The `[*.md]` exemption for trailing whitespace is honoured, because two spaces
  is a hard line break.

## 0.4.396

- **Added** a check that the share card is the image the page says it is. `og.png` is 537 KB of
  pixels nothing in this repository opens, and it is the only thing many people ever see of the
  project — every link posted in a channel or pasted into a chat renders it.
- `Base.astro` declares `og:image:width` and `og:image:height` to scrapers that lay the preview out
  before the bytes arrive, so wrong numbers letterbox or crop the card at the far end, where nobody
  who could fix it is looking. Those are now read out of the PNG's own IHDR chunk rather than taken
  on trust.
- The export is `qlmanage` then `sips -c 630 1200`, which keeps the middle of a square thumbnail.
  That works only because `og.svg` is a 1200x1200 canvas with the card in a band offset by half the
  leftover; changing the canvas takes the wrong rows, quietly, because a wrongly cropped card is
  still a card. The offset is now derived from the two numbers instead of being a literal.
- `og:image:alt` is what a screen reader says and what shows when the image fails. It quotes the
  line the card prints, names the annotation the card draws and calls the trace green, and all
  three are now checked against the SVG.

## 0.4.395

- **Added** a check that `vercel.json` describes the site this repository builds. It is the one
  configuration file here nothing reads on a normal day — the tests do not need it, `npm run check`
  does not touch it, and it takes effect on a machine nobody watches — and its couplings are all
  silent when broken.
- The build command names four scripts across two workspaces, and each has to exist. Its
  `outputDirectory` has to be the directory `check-site-output.mjs` inspects, or one of them is
  looking at a build nobody serves. The two `Content-Type: text/plain` rules have to name routes a
  page generator produces, or `/llms.txt` arrives as a download while CI still finds the file in
  `dist/` and passes. And `trailingSlash` is stated here and again in `astro.config.mjs` in
  different vocabularies: disagreeing gives every documentation URL a redirect it did not ask for.
- The `Permissions-Policy` row is checked for a different reason. `inspector-privacy.test.ts`
  proves the demo sends nothing; this is the other half — the header that stops the page asking for
  a camera, a microphone or a location at all. That is the kind of line dropped in a config tidy-up
  because nothing appears to use it.

## 0.4.394

- **Added** a check that every field the error tables on `api-errors.md` document is on the error
  you actually catch. Those tables are the point of the classes: a caller reads `matchingIndices`
  to offer a choice of channel, `budgetBytes` to decide how much to ask for next time, `available`
  to clamp a range, `receivedLength` to tell a short read from a truncated file.
- `error-classes.test.ts` checks the class-to-`edfErrorKind` table above them, because that is what
  a cross-realm `catch` switches on. The field tables underneath were never executed, and a renamed
  field passes everything here: TypeScript is happy, because the rename is consistent inside the
  package, the page still describes the old name, and the consumer reading it gets `undefined` —
  which in a handler looks like "this error did not carry that detail" rather than a breaking
  change.
- So one error of each class is provoked by the condition its row describes, and every documented
  field is looked for on the instance with the documented type. A field documented as `X |
  undefined` may be absent, but the name still has to be one the class defines, which is what stops
  a misspelt row from being unfalsifiable.

## 0.4.393

- **Added** a property test for the rule `design-decisions.md` states about out-of-range samples: a
  sample outside the declared digital range comes back as it was stored, is counted for free during
  decode, and converts on the affine map that produced the samples inside the range. Clamping
  instead flat-tops real peaks and draws saturation the hardware did not produce, so `edfcore` ships
  the clamp as a separate function you call on purpose — EDFlib clamps on read, and cross-validating
  against it needs the same operation.
- The unit tests check that with chosen values against chosen ranges. What examples cannot say is
  that nothing clamps for some combination: a negative gain, a range that does not straddle zero, a
  24-bit signal whose declared span is narrower than a 16-bit one's. Those are the shapes where a
  stray `Math.min` looks correct in review.
- Four properties over generated ranges, generated samples and both storage widths: the decoded
  integers are the integers written, `outOfDigitalRangeCount` is what an independent pass finds,
  the physical step per digital unit outside the range equals the step inside it — which is what
  "extrapolates" means — and `clampToDigitalRange` moves exactly the samples outside the range and
  nothing else.

## 0.4.392

- **Added** a check that the docblocks reach the published types, which five other checks quietly
  assume. `config/tsconfig.build.json` sets `removeComments: false`, and that one line is why the
  module docblock of `src/index.ts` is the hover text an editor shows over an import, and why
  `readme-status.test.ts`, `node-floor.test.ts`, `module-layers.test.ts`, `file-references.test.ts`
  and `next-clause.test.ts` each say some version of "this comment ships, so a stale one is stale
  in the package".
- Nothing asserted it. Flip the flag and all five keep passing — they read `src/`, and the claim
  they draw from it is about `dist/`. What changes is that the published `.d.ts` files lose every
  line of documentation, an editor shows a bare signature on hover, and the package's reasoning
  about itself stops being visible to anyone who installs it.
- The setting is asserted and then the artifact is checked rather than the setting: a distinctive
  sentence from three source docblocks has to be present, verbatim, in the `.d.ts` built from it.
  `removeComments` is one of several ways to lose them, and reading the file catches the rest.

## 0.4.391

- **Added** a check that the defaults the option tables print are the defaults the code applies.
  Four reference pages carry a `Default` column, and between them they publish the numbers almost
  every caller gets by passing nothing: 256 MiB for `maxMaterializeBytes`, 1 MiB blocks and a
  64 MiB budget for `cachedSource`, four in-flight requests for `httpSource`.
- They are observed rather than imported. Comparing the tables with `DEFAULT_MAX_MATERIALIZE_BYTES`
  would pass just as happily on a release where that constant is no longer what resolves — the
  failure `options.ts` opens by describing, where the budget is resolved in six modules across the
  stack. So the budget is read off the `EdfBudgetError` a refused allocation carries, the block
  size off the read the cache issues, the LRU budget off the clamp it applies to an oversized
  block, and the concurrency off the peak number of requests in flight.
- Finding out what 256 MiB is costs a few hundred bytes: the budget is checked against the header
  geometry before anything is allocated, so the fixture is a header that declares 4,000 records of
  120,000 bytes over a source that fabricates them.
- The last check is the closure. Every numeric cell in those `Default` columns has to be one of the
  values observed here, so a newly documented number either gets an observation or fails and names
  the page it is on.

## 0.4.390

- **Changed** the CLI's print cap from a literal repeated at four call sites to one
  `DEFAULT_ITEM_LIMIT`. Behaviour is identical: `--limit` still defaults to twenty diagnostics or
  events. What changes is that `header`, `validate` and `events --list` can no longer drift apart
  from each other, which is the failure a number written out four times invites — one command
  printing twenty while another prints fifty, with both pages still saying twenty.
- The usage line and the message a bad `--limit` raises are now built from that constant too, so
  the two places the CLI states the number cannot disagree with the number it applies.
- **Added** the check for the rest of it. The cap is observed rather than imported — sixty events
  in, lines counted out — and the usage text, the error message and the README's "print twenty at
  a time" are each checked against what was counted. Raising the cap and updating the pages passes;
  raising it and forgetting one of them does not.

## 0.4.389

- **Added** a check that the three verifications outside `npm run check` are run by something.
  `AGENTS.md` says CI runs all three, and that arrangement is sound and fragile: `verify:package`
  packs the tarball and asks publint and `@arethetypeswrong/cli` what a consumer would resolve,
  `verify:tarball` asks what npm would ship and what it must not, `verify:site` reads the generated
  endpoints out of `website/dist`. None can run inside the suite, so the suite could not notice one
  of them ceasing to run at all.
- Deleting a `- run:` line from `ci.yml` is a one-line edit that turns a check into a script nobody
  invokes, leaves every test here green, and leaves that paragraph saying CI runs it. The gap would
  surface the next time the thing it guards broke, which is when nobody is reading CI config.
- The set comes from `package.json` rather than from the prose — every `verify:*` script has to be
  a step in `ci.yml`, and none of them may be reachable from `npm run check`, which is the premise
  of the arrangement. The fenced block in `AGENTS.md` is then checked against that same set, so
  "three" is a number this can be wrong about.

## 0.4.388

- **Fixed** the figure three places give for the size of this suite. The README said 1,900 or more
  tests, the note at the foot of `installation.md` said 1,200 or more, and the docblock of
  `browser-safety.test.ts` said 1,900-odd — three figures for one fact, the smallest of them eight
  hundred behind. All three now say 2,000.
- None of them was ever false, which is why nothing caught them. A claim of the form "N or more"
  stays true forever once it is true, and the property that makes it safe is the property that
  makes it worthless: it can never be wrong, so it is never re-read. What a reader takes from it is
  a sense of scale, and half the real scale is a wrong impression conveyed in a true sentence.
- **Added** the check that keeps it current: the figure has to be one figure wherever it is stated,
  and no smaller than the number of `it(...)` and `test(...)` declarations the suite writes out. It
  fails when the suite grows past what the pages claim, which is the direction this rots in.
- It does not check the other direction. Four dozen of those declarations are `it.each(...)`,
  expanding at run time to one case per row, so the count read out of the files is a floor rather
  than the total — the right side to be wrong on, since a figure that clears it is true of the real
  total too, but nothing here would notice one inflated past both.

## 0.4.387

- **Added** a check that the published `bin` runs as a program. `cli.test.ts` and the rest drive
  `runCli` through an injected `CliIo`, deliberately, so they need no build; `cli-pipe.test.ts`
  spawns the built file but always as `node dist/cli.js`, naming the interpreter itself. Between
  them they covered every line of the program and none of the mechanism that starts it.
- Delete the `#!/usr/bin/env node` from `src/cli.ts` and every test here still passes: the build
  succeeds, `verify:tarball` finds the bin target in the tarball, and `node dist/cli.js header
  f.edf` works exactly as before. `npx edfcore header f.edf` — the first command the README prints
  — fails on the first line of JavaScript, because the shell it was handed to is not a JavaScript
  engine.
- So the built file is given the executable bit npm's tarball carries for a bin and run with no
  interpreter named, which is the only way to check the shebang rather than the file's first line:
  a CRLF ending, a leading blank line or a BOM each leave the text intact and the program
  unloadable.
- Both spawns close stdin and carry a timeout, because that failure does not look like an error. A
  file with no shebang is handed to `/bin/sh`, which reads JavaScript as shell and sits waiting for
  input — without the timeout a deleted shebang hangs the suite instead of failing it.

## 0.4.386

- **Added** a property test for the window rule annotations are filtered by: overlap rather than
  containment for an event with a duration, and half-open containment of the onset for an instant,
  so adjacent windows partition a recording without double-counting the boundary.
- `tests/unit/annotations-query.test.ts` checks that with hand-placed events at hand-picked
  boundaries and is thorough about the cases someone thought of — the instant at t = 0, the epoch
  ending exactly where the window starts, the duration a writer spelled `0` rather than omitting.
  What no example can say is that the rule holds for a partition it was not written against.
- So the events are generated, written into a real EDF+ file and read back through the parser
  before anything is filtered. The comparison is on `onsetTicksFromFirstRecord`, and those ticks
  are parsed digit by digit out of the TAL: an oracle fed hand-built objects would agree with the
  filter about numbers no file ever produced.
- Three properties over that: every instantaneous event gets exactly one window of a partition,
  an event with a duration gets every window it overlaps and no other, and the result matches an
  independent case analysis in ticks. Changing `onset >= from` to `onset > from` in the filter —
  one character — fails the first two with a shrunk counterexample.

## 0.4.385

- **Added** a check that the file the inspector hands a first-time visitor is one edfcore accepts.
  `website/src/scripts/sample-edf.ts` writes an EDF+C by hand from the specification for the demo's
  "load a sample recording" button, and it is the only EDF writer here the suite never touched:
  `tests/support/writer.ts` is checked constantly, and that one was checked by whoever last loaded
  the page.
- A drift there is the worst-placed defect on the site. The visitor clicks the one button the page
  offers and the inspector reports diagnostics about a file we wrote, which reads as edfcore being
  wrong about a valid recording — on the page built to demonstrate the opposite.
- It opens as EDF+C with 120 one-second records and five signals, validates with `ok: true` and one
  info diagnostic (the two-digit startdate year every conforming EDF+ file carries), carries its
  seven scored events with the apnea spanning 70 s to 84 s, and decodes inside every declared
  physical range without flattening to a line.
- The generator is compiled with `tsc` and imported from a temporary directory rather than
  imported directly, because `transform-boundary.test.ts` forbids pulling TypeScript out of
  `website/` — vite would resolve that file's tsconfig out of `website/node_modules`, which the CI
  check job does not install. `tsc` on a named file reads no tsconfig at all.

## 0.4.384

- **Added** the browser half of `node-floor.test.ts`. The Node floor is checked in eleven places
  against `engines.node`, a field a package manager reads; the browser floor has no such field —
  no browserslist, nothing in `package.json` — and its three statements (the README's compatibility
  line, the Runtimes table on `installation.md`, and the summary string `llms.txt` hands an agent)
  were three independent sentences that happened to agree.
- The table is the source, since it is the one with the reasoning printed under it, and the other
  two are checked against it. A floor raised in one place tells a reader their browser is supported
  on one page and unsupported on the next.
- The check with teeth is the last one. The table's stated basis is "ES2022 syntax, `BigInt`,
  `Blob.prototype.slice`, and `TextDecoder`", and the first of those is not an observation about
  the code — it is `target` and `lib` in `config/tsconfig.build.json`. Raising either to ES2023 is
  a one-word edit that compiles, ships, passes every other test here, and invalidates all three
  published floors at once.
- It does not check that 94, 93 and 15.4 are the right versions for those four features. That is a
  question about browser release history, which nothing in this repository can settle.

## 0.4.383

- **Added** a check for the last paragraph of `data-sources.md`, which says what survives
  `close()`: the header and the timeline stay readable, and `readRecords`, `readWindow`,
  `readAnnotations` and an unmemoised `index.locate` fail. Every `fileSource` example on the site
  is wrapped in `try { … } finally { await source.close?.() }`, so a recording outliving its handle
  is the ordinary shape of a program here, and that paragraph was the only statement of which half
  of the object still works.
- The carve-out in it turned out to be narrower than it reads. A probed index memoises records 0
  and n−1 at open and every record a search walks over, so `locate(0.5)` answers after the close
  only if it already ran before it — on a freshly opened file the binary search probes a midpoint
  first. Both cases are pinned, since a later memoisation change makes that quietly more generous.
- It does not claim the rejection is an `EdfError`. It is whatever the source raises: for
  `fileHandleSource` that is Node's own `Error: file closed`, and `isEdfError` returns false for
  it. Closing your own handle is not a file defect.

## 0.4.382

- **Fixed** the docblock at the top of `scripts/release.mjs`, which described the scheme that was
  replaced in 0.4.326: "this script only moves the version forward and creates the GitHub Release;
  `publish.yml` sees that release and publishes to npm". It has created no release and watched no
  release since — the tag it pushes is what publishes — and that paragraph is the first thing
  anyone reads before running the script.
- `release-model.test.ts` has asserted the trigger, the ordering and the absence of `gh release
  create` since 0.4.327, and every one of those checks passed the whole time. They read what the
  script calls, and a comment calls nothing.
- So the docblock is checked too, by the affirmative rather than the negative: it has to name the
  pushed tag as what publishes, say outright that the script creates no release, and point at
  `npm run announce`. A docblock rewritten back to the old scheme has to delete those sentences to
  read coherently, and deleting them fails.

## 0.4.381

- **Added** the closure this batch earned: every documentation page has to be named by a test that
  is about that page. `docs-coverage.test.ts` sweeps all of them for exported names and
  `doc-snippets-compile.test.ts` compiles every fence, but a generic sweep says nothing about
  whether a page's own tables, worked numbers and refusals have ever been executed.
- Several pages had none until recently. `edf-format.md` and `physical-values.md` were the first
  two found that way, `migrating-to-0-3.md`, `api-validate.md` and `quick-start.md` the next three,
  and each turned out to be carrying claims worth checking — one of them a wrong one. All
  twenty-three are named now, and a page added tomorrow either gets a test or fails this and says
  which page it is.
- The sweeps are excluded from counting rather than forbidden from naming a page. The first version
  forbade it and was wrong to: `docs-coverage.test.ts` anchors its own non-vacuity with
  `DOCS.has('api-helpers.md')`, which is reasonable and is not a check about that page. What
  matters is that no page is covered only by a sweep.

## 0.4.380

- **Added** enforcement for the fixture policy in `tests/README.md`: "No file from teuniz.net,
  PhysioNet or edfplus.info may be committed." That is a licence rule and a privacy one — one of
  those files is a real person's overnight polysomnogram, and committing it would publish it to
  npm's mirrors and to every fork, permanently, in a way no later commit can undo.
- It held by one line in `.gitignore` and by nobody adding an exception, which is the shape of rule
  that survives until the day someone wants a test to run in CI. Now every file the corpus can
  download is checked against what git tracks, the whole download directory is checked rather than
  the manifest's filenames alone, and every manifest entry has to record its source and licence —
  a file whose licence nobody wrote down is one nobody can decide about later.
- The committed exception is checked to be exactly what the README says it is: the only tracked
  EDF, BDF or REC files are the six goldens, none of which shares a name with anything the manifest
  fetches, because they were generated locally rather than downloaded from anyone.

## 0.4.379

- **Added** an execution of the "Oddities that bite implementers" section of `edf-format.md`, which
  is that page's payload: seven paragraphs each naming a thing about EDF that produces a wrong
  answer rather than an error. The page is written for someone about to write their own parser —
  which the comparison page says is what people overwhelmingly do — so these are the claims most
  likely to be acted on by a reader who never installs the package.
- Each is checked against the library, because that is the only way to check them and because each
  is a place edfcore could regress into the naive behaviour being warned about. A date eighty years
  wrong, a record count silently short, a rate of `Infinity`, a first header byte mangled by the
  decoder that read it, and a redundant header size believed over the computed one — every
  paragraph describes a bug that looks like working software.

## 0.4.378

- **Added** a check that the browser inspector uploads nothing, which is the most consequential
  claim on the site. `demo.astro` says a browser can read these files "so a researcher never has to
  hand a patient recording to a server", and somebody will drop a real clinical recording on that
  page on the strength of that sentence.
- It is a claim about an absence, and nothing notices an absence breaking. A copy button that
  reported usage, an error handler that posted a stack trace with a filename in it, an analytics
  snippet in the shared layout — each is a normal thing to add to a website, and each would make
  the sentence false without changing anything a visitor can see. So every source the site ships is
  scanned for a way to send bytes: `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`,
  `EventSource`, a form, a remote dynamic import.
- `navigator.clipboard` is allowed by name rather than by permitting `navigator` generally, and the
  pattern is asserted to still reject `navigator.sendBeacon` — the primitive built for exactly the
  thing this forbids. The check covers the layout too, since the promise is about the page a
  visitor is on and the layout wraps it.

## 0.4.377

- **Added** a check that the exports badge and the API-surface table on the README show the same
  number, and a check on the reason they can. `/api.json` sums the runtime exports of the three
  published entry points at build time; `api-surface.test.ts` counts the same thing from the
  barrels and asserts the table. Two counters, one number, printed a screen apart on the same page.
- They agree because the three entry points share no runtime name, so a sum is the same as a union
  — and nothing stated that. Re-exporting `openEdf` from `edfcore/node` so a Node consumer needs
  one import is an obvious convenience, and it would make the badge count it twice: 79 above a
  table reading 78, on the page a reader is looking at to decide whether to install the package.
  Neither number would be wrong about what it measures, which is what makes the disagreement hard
  to explain and easy to ship.

## 0.4.376

- **Fixed** a gap in `.gitignore`: `.venv/` was not in it. `scripts/golden/README.md` tells you to
  build a virtualenv at the repository root and install pyedflib and mne into it, and
  `scripts/release.mjs` stages with `git add -A` — whose docblock says that `-A` honours
  `.gitignore`, "which is what keeps `dist/`, `node_modules/` and `tests/scratch/` out". A
  regeneration run followed by a release would have put a few hundred megabytes of Python into a
  release commit, by following two sets of documented instructions in order.
- **Added** the check that found it, over the rest of what that README promises. The regeneration
  block has to name four scripts that exist and every script in the directory, so none is
  undocumented and none is named that is not there. "The venv is not committed and CI never builds
  it" is checked both ways: the ignore rule, and no workflow step that installs or runs Python.
- And the claim the whole harness rests on — "Nothing in `tests/corpus/golden/` is produced by
  edfcore" — is read off the files rather than trusted. Every golden carries a `producer`, and no
  producer names this package: a golden regenerated with edfcore's own writer would compare edfcore
  against itself and pass no matter what either did.

## 0.4.375

- **Added** `tests/property/read-agreement.test.ts`: the two ways to read the same records return
  the same samples. `readWindow` resolves a time window and splits it; `readRecords` is handed a
  range directly. Every worked example in the documentation uses whichever is more convenient, so a
  caller who computes a range with `resolveTimeWindow` and reads it with `readRecords` has to get
  exactly what `readWindow` would have returned — and nothing said so.
- Each has thorough tests of its own and they share a decoder, but the layer above the decoder is
  separate, and a divergence there is not a decode bug: the samples would be individually correct
  and attached to the wrong records, which is the failure mode this package treats as the worst
  kind because nothing about the numbers looks wrong.
- So the fixture's generator makes every sample a function of its own record and position, and the
  second property checks each returned value against where the chunk says it came from — over
  arbitrary geometries, since the interesting windows are the awkward ones: shorter than a record,
  starting mid-record, running off the end.

## 0.4.374

- **Added** a check over what `installation.md` says each entry point contains. The page names
  roughly twenty functions across three paragraphs as the answer to "what do I get if I import
  this", and a name in that list that is not an export sends a reader to an import error on their
  first line. It is also checked to name nothing that lives behind `edfcore/node`, which is the
  claim the whole browser story rests on.
- The exports map is printed as JSON — not a description of `package.json` but `package.json`,
  retyped, which is the strongest form of a copy and the easiest to let drift. `publint` and
  `packaging-claims.test.ts` check the real map for shape and for the absence of environment
  conditions; neither can see that the page prints the same three entries. It is now parsed and
  compared entry for entry, and the six condition names the page lists are checked against the
  manifest.
- "Two functions" for `edfcore/node` is asserted as an exact count rather than a floor: that entry
  point exists to be the only module a browser build must not reach, so every name added to it is
  another thing a bundler has to be kept away from.

## 0.4.373

- **Added** a cross-check between the two tables of the four onset fields — `annotations.md` lists
  them by axis, `api-helpers.md` under "Which onset field to compare" — so the two agree about
  which four exist, which axis each is measured from, and which two are exact. Two tables of one
  fact is the shape this repository keeps finding wrong; their orders differ by design, so the sets
  are what have to match.
- The "exact" column is a claim about arithmetic rather than a label, and it is now executed: it is
  why `filterAnnotationsByTime` compares ticks, and the page warns that comparing the seconds
  fields means "an onset and a bound that should be equal need not compare equal". Three tenths is
  three times one tenth to the tick and not in seconds, on the rebased axis a window is measured
  on.
- The worked example's four values are produced from a file built to its description, and the two
  axes are checked to differ by exactly `timeline.startOffsetSeconds` — which is the whole reason
  there are two of them.

## 0.4.372

- **Added** checks for the sample-grid section of `api-helpers.md`. The page opens by naming what a
  reader would otherwise write — `Math.round(seconds * signal.sampleRateHz)` — and tabulating three
  ways it fails silently. Two of them are now demonstrated: an undefined rate on a zero-duration
  file makes the expression `NaN` where the grid functions throw a `RangeError`, and rounding
  rather than flooring reaches the next sample before its boundary.
- The rounding rule is checked as the property the page states it as: rounding a sample's start up
  to a whole tick keeps `gridSampleStartTicks` and `gridSampleIndexAt` inverse for every index,
  because a truncated tick lands inside the previous sample. Verified across every sample of six
  records at 128 samples over 0.3 s — the geometry whose boundaries are half ticks — and with the
  truncating alternative shown to land early.
- The third row, the index drifting by one over a long recording, is deliberately NOT asserted, and
  the test says so. Fed the tick this package publishes, the naive expression agrees with the
  integer arithmetic for every index of every geometry tried; the two roundings cancel. The drift
  belongs to times a caller arrives at some other way, and a fixture manufacturing one would be
  asserting about its own construction rather than about the library.

## 0.4.371

- **Added** a check on where the type tests are actually verified. `tests/types/` holds five
  `.test-d.ts` files carrying the only assertions a runtime test cannot make — what each subpath
  can name alone, that the documented examples typecheck, that a `Blob` and a `Response` satisfy
  the structural shims — and vitest runs them with its own typecheck disabled.
- That combination reports a false green. Put a plain type error into one and vitest loads it,
  finds the runtime half fine, and prints a pass; only `npm run typecheck` catches it, because
  `tsconfig.json` happens to include `tests`. Nothing connected that line to the five files
  depending on it, and narrowing the include to `src` would look like an ordinary tidy-up: `npm run
  check` would stay green, vitest would keep reporting the type tests as passing, and every
  type-level guarantee in the package would be unchecked.
- So the wiring is asserted rather than assumed — which config the typecheck script names, that its
  include reaches every type test, that the only exclusion is the gitignored scratch directory, and
  that vitest is deliberately not the thing doing the checking.

## 0.4.370

- **Added** an execution of the annotations-signal section of `concepts.md`, the page the README
  calls the mental model the rest of the API follows from. Both claims in it describe a wrong
  answer that looks right.
- Decoding an annotations channel as samples yields "a plausible-looking trace made of ASCII" with
  no wobble to say anything went wrong, so the refusal is the feature and the page prints the whole
  message — now compared word for word. It is a plain `RangeError` rather than an `EdfError`
  because it can only be a caller's mistake, which is checked from the consumer's side: a handler
  branching on `isEdfError` must not catch it, or a caller's bug gets reported as a bad file.
- The second is that only the first annotations signal carries timekeeping, so only its first TAL
  is stripped. Stripping the others deletes a real event silently — the annotation is simply not in
  the list and nothing says one is missing — so a file with two annotation channels now has to
  return both of their first events.

## 0.4.369

- **Added** a check over what a `ValidationReport` promises on `validation.md`. `ok` is the field a
  caller branches on and means less than it looks like — exactly "no diagnostic has severity
  `error`", not a claim that the file is conformant, and a false `ok` not a claim it is unreadable.
  The four codes the page says survive to a report at that severity are checked to be the only ones
  that do, on a file where one signal has no scale and the other is fine.
- The sentence pinned hardest is the one about what cannot appear: no always-fatal code reaches a
  report, because a file carrying one cannot be opened, and a report about such a file would be
  incoherent rather than merely wrong. The single exception is asserted from the other side —
  `TIMELINE_NOT_MONOTONIC` makes the sweep reject.
- `signalStats` has a shape a caller indexes by: one entry per data signal in `dataSignalIndices`
  order, with annotation channels excluded because their bytes are text, so an off-by-one gives
  every channel its neighbour's statistics. And a signal with no samples reports zeroes rather than
  infinities — `-Infinity` is what an unseeded reduce produces, and it is a number a caller would
  plot.

## 0.4.368

- **Added** `tests/property/inspect-safety.test.ts`. `inspectEdf` is the triage call and makes the
  strongest promise in the package: `openEdf` and `parseHeader` promise to throw an `EdfError`
  rather than escape the error model, and `fuzz.test.ts` holds them to that over flipped, random
  and truncated bytes — `inspectEdf` promises not to throw about content at all. That promise had
  only ever been tested against fixtures somebody wrote.
- A promise of the form "never, for any input" is exactly the kind a fixture cannot establish: the
  inputs a person thinks of are the ones already handled, and the four defects fuzzing found during
  development were all of that shape. Random bytes, random bytes behind a valid version block, a
  bit flipped anywhere, and every truncation length exhaustively now go through it.
- The report is checked as well as the call, because "never returns believable garbage" is the
  fourth clause of the safety invariant and a triage report full of `NaN` would satisfy "did not
  throw" while telling a reader nothing true. Every source is in memory, so nothing can fail except
  on what the bytes say — which makes any rejection a broken promise rather than an ambiguous one.

## 0.4.367

- **Extended** 0.4.338's interface check to the three structural shims `api-sources.md` prints and
  to the adapter table under them. The shims exist so neither the DOM nor `@types/node` leaks into
  the published `.d.ts` — naming `Blob` forces `lib.dom` on every consumer — and each is the
  minimum shape edfcore uses.
- `shim-assignability.test-d.ts` already proves a `Blob`, a `File`, an `AbortSignal` and a
  `Response` all fit. What it cannot see is whether the page prints the same shape it proves things
  about, and a shim is exactly the declaration someone copies off a page to build a test double
  from: a member the page shows and the type does not is a double that compiles against the page
  and is refused by the library.
- `FetchLike` is checked for an absence instead. `signal` is deliberately not in its printed `init`
  and is still passed at runtime, because naming it would break the assignability of
  `globalThis.fetch` — so the check is that it stays absent from both, and that the page still
  explains why, since without the explanation the omission reads as an oversight.
- The adapter table's rows now have to name real exports from the entry point each row names, with
  the two filesystem adapters behind `edfcore/node` and everything else reachable from the
  universal entry — the split the shims exist to protect.

## 0.4.366

- **Added** a check that every version number this repository cites is one it released. The
  codebase explains itself in release numbers — docblocks say "fixed in 0.3.56", the documentation
  pages date every behaviour they describe, the changelog cross-references itself — and there are
  several hundred such citations across 248 files, none of which had ever been checked.
- They rot silently in two directions: a transposed digit points a reader at nothing, and a
  citation written while a version is still being cut names a number that never shipped, which is
  the same failure the fourteen changelog holes were. A wrong version number looks exactly like a
  right one to a compiler, a linter and a human skimming a diff.
- The hard part is telling a version from everything else shaped like one, since this tree is full
  of EDF startdates and starttimes, spec clauses like `2.1.1` and runtime floors like `22.12.0`. A
  loose scan reports forty-five of those and no real defects; `0.` with no leading zero separates
  them exactly, and that narrowing is asserted against the lookalikes rather than left to luck.

## 0.4.365

- **Added** a check that the layer table in `AGENTS.md` names the modules that are actually at each
  layer. `module-layers.test.ts` already enforces that every module declares a layer, that no
  runtime import goes up one, and that the table names every layer the source declares — but not
  the contents of any row.
- AGENTS.md calls the table "a summary of it, not a second definition", and a summary that
  disagrees with its source is still wrong. This one is easy to disagree with, because two rows
  split a directory: layer 5 is `io/` and layer 6 carves `io/read.ts` back out, exactly as layers 1
  and 3 split `tal/`. So a directory claims everything under it except what another row names by
  file, and both splits are asserted as the point of the rule rather than exceptions to it.
- Row 7 names nothing — "entry points, and the pure helpers over them" — which supplies the
  closure that makes the check tight: every module no row claims has to be at layer 7. Only a path
  counts as a claim, since row 5 also mentions `ByteSource`, which is the type the adapters
  implement rather than a module being placed.

## 0.4.364

- **Added** checks for three claims in the README's "Design in one page", each of which is an
  absence and therefore hard to notice. There is no recording-wide rate — a header field holding
  one would be the obvious convenience and can only ever be right for one channel, so its
  non-existence is asserted alongside the three per-signal rates the README names.
- `sampleRateHz` is `undefined` when the record duration is zero, which is legal EDF and which
  PhysioNet's hypnograms really declare. `Infinity` is what an unguarded division gives, would pass
  every `typeof` check, and would make `NaN` of every time converted through it — so the check is
  that it is neither a number nor that number.
- And there is no gap-filling option, checked as an absence across every option name the public
  types declare. An option to fill a gap is an option to fabricate samples the amplifier never
  recorded, and once it exists somebody's config turns it on.
- Also pinned: that a window is measured on `onsetTicksFromFirstRecord` rather than `onsetTicks`.
  The fixture puts the two axes in different records on purpose — a half-second offset leaves both
  inside the same record-aligned chunk, which is how this advice would look correct while being
  untestable.

## 0.4.363

- **Corrected** the README's promise about diagnostics and widened 0.4.325's check to cover it. It
  said every diagnostic carries "the field, the byte offset, the raw bytes as written, the spec
  clause it violates, and what to do next". Two of them carry neither the offset nor the raw bytes:
  `DISCONTINUITY_IN_CONTINUOUS_FILE` and `RECORD_ONSET_SPACING_VIOLATION` are about the spacing of
  record onsets, so there is no one offset the defect sits at and no field text to quote.
- That is the right answer rather than a gap — an offset invented for them would point at a record
  that is individually fine — so the sentence now says which diagnostics carry which. It also
  distinguishes the two ways the first of them is raised: against the last probed record when one
  record is at fault, and as a whole-file summary when the shape is, which is why not even a record
  index is always available.
- The sweep now checks all five properties instead of the spec clause alone: every diagnostic names
  its field and says what to do next, everything anchored to a header field carries an offset and
  its raw bytes, and the two relational codes carry neither and are asserted to be reached, so the
  exemption is examined rather than assumed.

## 0.4.362

- **Added** a check over the edfcore column of the capabilities table on `comparison.md`. Seven
  rows, and only one column this repository is entitled to check: the other four describe packages
  nobody here controls, surveyed at a point in time, and asserting anything about them would be
  asserting about someone else's release schedule. The claim under test is that every "Yes" in our
  own column is true of the package as it stands.
- Worth checking because a comparison table is the most self-serving thing a project publishes and
  the one a reader is least able to verify. The two rows the page itself calls load-bearing are the
  two easiest to overstate, so both are demonstrated rather than asserted: random access by a
  partial read counted through a recording source and landing past the middle of the file, and
  EDF+D by a gap that puts record 3 at 13 seconds where the nominal grid would put it at 3.

## 0.4.361

- **Added** a check over the error-class table on `api-errors.md`. Seven classes, each with an
  `edfErrorKind` — the field a caller branches on, since `instanceof` is false across a realm
  boundary — so the table is the map between the class you catch and the string you switch on. Each
  row now has a fixture that produces the condition it describes, so none is checked by assertion
  alone, and a class whose kind changed would otherwise fall silently into a different branch of
  every consumer's handler.
- The distinction below the table is checked too. An error raised from a diagnostic opens with its
  code in brackets; `EdfDiagnostic.message` does not, because `formatDiagnostics` renders the code
  from the field beside it. Prefixing `error.code` when displaying a diagnostic therefore prints it
  twice, which is what the inspector on this site did until 0.4.185 — a convention, and a
  convention is what the next message quietly breaks.

## 0.4.360

- **Added** checks for the two things `toPhysicalEnvelope` does that `toPhysical` must not be used
  for. A bucket no sample landed in carries a digital `0`, because `min` and `max` are
  `Int32Array`s and cannot hold a sentinel — and through the affine map that becomes mid-scale for
  any channel whose range is not centred on zero. On the 0..1000 channel the page names it is 500,
  which is now computed from the scale rather than quoted: a completely believable reading, drawn
  as a flat trace across a hole.
- That failure is worth a test precisely because everything about it looks right — the number is
  inside the channel's range, the arrays agree in length, the trace is continuous, and the only
  sign is a stretch nobody sampled drawn as a steady midpoint. Both arrays now have to be `NaN`
  wherever `counts` is zero, and `counts` itself has to be untouched.
- The second is polarity: a negative gain makes the map decreasing, so mapping `min` to `min`
  yields an envelope drawn inside out. Every filled bucket on such a channel is checked to come
  back with its lower bound below its upper one.

## 0.4.359

- **Added** a check for the two bucket-count rules on `api-helpers.md`. `readEnvelope` clamps
  `buckets` to the densest signal's sample count, because more buckets than samples leaves holes
  that mean nothing. `readEnvelopeAtResolution` does not clamp, because a resolution is a promise
  about seconds per pixel and honouring it by dropping buckets would silently shorten the span the
  caller is drawing.
- The page gives the case where they part company — a 4-second run of a 2 Hz signal at 0.25 s per
  bucket reporting 16 buckets with 8 filled — and it is now produced. That sentence is what a
  viewer's indexing depends on: `bucketCount` is the field to read before indexing, and a caller
  who trusts the number they passed walks off the end of a short run or draws a grid narrower than
  the window it claims to cover.

## 0.4.358

- **Added** checks for three small pure functions on `api-primitives.md`. `decodeHeaderLatin1` is
  the one with teeth: the page does not merely say `TextDecoder` is unused, it says why, with a
  measurement — every relevant label reports `windows-1252` on Node and decodes `0x80` as U+0080,
  while the WHATWG standard mandates U+20AC, so the same header bytes become different strings on a
  server and in a tab. `text-decoder-ban.test.ts` forbids the call; this checks the behaviour the
  ban buys, at the byte the two disagree about and across all 256 of them.
- `formatStartTimeNaive` returns `undefined` for two conditions, and the second is the one worth
  having: a starttime of `23.59.60` fails its grammar, and without that branch the file came back
  as midnight — an instant it never gave, and for a sleep study the most believable start there is.
- Its example renders `1951`, which is the FORMAT rather than the result of the field in the
  fixture: the two-digit year rule puts 00..84 in 2000..2084, so `02.08.51` is 2051 and only a
  four-digit EDF+ `Startdate` can say 1951. The check compares the shape against the page and the
  value against the rule, which is what the first version of it got wrong.

## 0.4.357

- **Added** an execution of the two-signal `trimToWindow` example on `api-primitives.md`. It exists
  to make one point — a 256 Hz channel and a 3 Hz channel asked for the same window start at
  different instants and hold different counts — and that is why `startSeconds` lives on
  `EdfChunkSignal` rather than only on the chunk. Both printed rows are now produced.
- The rule underneath is also pinned: membership is decided against the tick edfcore PUBLISHES for
  a sample, not against its exact rational start. The page's own worked figure is checked both
  ways — 256 samples in a one-second record put sample 1 at 39,062.5 ticks, which is not a whole
  tick, published as 39,063 — because selecting on the exact start excluded the very sample a
  caller had aligned the window to, a defect this project shipped and fixed in 0.3.56.
- Plus the three things trimming promises about its result: a subarray view rather than a copy so
  it allocates nothing, a zero-length result rather than an error for a window that misses, and a
  refusal when the header is not the one the chunk was read with.

## 0.4.356

- **Added** an execution of the `resolveTimeWindow` example on `api-primitives.md`: a one-second
  window from t = 2.5 on a file with one-second records, straddling records 2 and 3. The function
  exists so the price of a window is auditable before a byte is read, and a reader planning a
  viewport from that example is doing arithmetic that has to hold — including that two records are
  paid for to get one second.
- The three ways to get nothing back are checked as well, since returning `[]` rather than throwing
  is what lets a caller loop over ranges with no special case: a non-positive duration, a window
  outside the recording, and one inside a gap on an index that knows where the gaps are. The last
  is paired with the case either side of it, so the emptiness is about the gap rather than about
  the file. And a probed index over a file with gaps throws rather than guessing at onsets nobody
  has read.

## 0.4.355

- **Fixed** a test of mine that could time out. The signature check added in 0.4.354 spawned `tsc`
  inside an `it`, which takes a couple of seconds alone and rather more under a loaded suite —
  past the default per-test timeout. It passed every run alone and failed the first time the whole
  suite ran it.
- Now compiled once at module scope, which is what `doc-snippets-compile.test.ts` next door
  already does with its own compiler run. Collection time is not on a per-test clock, so the work
  happens where it is not being timed, and nothing about the check weakens.

## 0.4.354

- **Added** a compile check over every signature the reference pages print. Four pages open each
  function with a `ts` fence holding its declaration and nothing else — thirty-odd across
  `api-primitives`, `api-reading`, `api-sources` and `api-validate` — and every one is hand-typed.
  They are the first thing a reader sees for a function and what they write their call against.
- `doc-snippets-compile.test.ts` compiles the fences that are complete programs and skips these: a
  bare declaration imports nothing, so it never matched the filter that finds runnable examples.
  The most load-bearing line on each reference page was the one nothing compiled.
- Assignability is checked in BOTH directions, which is the difference between "the documented
  shape is usable" and "the documented shape is the real one" — one direction alone accepts a page
  that widens a parameter or narrows a return, and a widened parameter describes a function that
  does not exist. Signatures are extracted per fence rather than by scanning the page, because a
  lazy match for the parameter list's closing paren runs past it into the prose: `Promise<{ … }>`
  has no `):` to stop at and the next parenthetical sentence does.
- The types a declaration mentions are resolved through `barrel-types.ts` rather than a hard-coded
  list. The first version used a list and missed four, which is the failure that helper was
  extracted to stop repeating.

## 0.4.353

- **Added** a cross-check between the two places `openEdf`'s cost is published. `large-files.md`
  states it as a four-row table and `api-reading.md` states it as a sentence, and both are read by
  someone deciding whether opening a file is cheap enough to do on a click.
- The table was already checked against the library in 0.4.340. This checks the prose against the
  table, so all three agree rather than two agreeing while a third drifts — the shape this
  repository keeps finding wrong, in the section list, the diagnostic tables and the `ByteSource`
  interface before it. It is also the cheaper direction to automate: the prose spells its counts as
  words, and nobody diffs a word against a digit by eye.

## 0.4.352

- **Added** `tests/property/window-cost.test.ts`, which states in general what four checks in this
  batch pinned one file at a time. Each of those is a specific recording with a number beside it,
  and each would keep passing if the rule behind it broke for every file except the one in the
  example.
- The rule: for any well-formed continuous recording and any window that overlaps it, `readWindow`
  issues exactly one read, and that read is a whole number of records. `byteLength` is asserted as
  an identity rather than a bound — exactly the records the chunk reports, whatever fraction of
  them the caller wanted — because that is what makes the number in the result worth publishing,
  and it is what a per-signal narrowing would quietly break while still returning the right
  samples.
- The third property is the general form of the table on `reading-signals.md`: asking for one
  channel costs the same reads and the same bytes as asking for all of them, on arbitrary
  geometries rather than on the three-signal file the page measures.

## 0.4.351

- **Added** checks for two read counts on `api-reading.md`, a page that opens by inviting them:
  "They are exact and testable: wrap your source in a recorder and count."
- Both are about paths a well-formed file never takes, which is why neither had a test.
  `readHeader` is exactly two reads, and one when the signal-count field is unreadable — because
  the second read's size is computed from that field, and a speculative read of an unknown size is
  the thing being avoided. The saved read is not the point: the caller gets `SIGNAL_COUNT_INVALID`
  rather than a complaint about a byte range, and that is what is asserted.
- The same distinction on the next line. A file too short for the header it declares is a file
  defect, `SOURCE_TOO_SMALL`, not an `EdfSourceError` about a range past the end — getting it
  backwards is not a crash but a truncated recording reported as an I/O error, which sends the
  reader to their network stack instead of to their file. Also pinned: the probe costs nothing
  without an annotations signal, and both probed onsets are memoised into the index while a record
  between them is not.

## 0.4.350

- **Added** an execution of the truth table on `validation.md` — four rows over two independent
  conditions, whether the file carries per-record timestamps and whether `scanSamples` was asked
  for — plus the `0 0` the page prints when a complete index is handed over.
- The `none` rows are a promise about cost: a sweep that quietly started traversing a plain EDF
  would return exactly the same report, and the only evidence would be the wall clock on a 13 GiB
  file. The `every record` rows are a promise about correctness: skipping them would report a
  clean file it had not checked.
- The row with a trap in it is the one about the index. A PROBED index is what `openEdf` hands you
  and the obvious thing to pass, and it describes two records; the page says it is ignored and
  "buys nothing", so a version that accepted it would report a clean file on the strength of the
  first and last record. That it still reads everything is now asserted.

## 0.4.349

- **Added** an execution of the cost table on `reading-signals.md`: one call for three channels
  against three calls for one, at one read and 15,380 bytes versus three and 46,140. The file is
  rebuilt from the sentence above the table, and both rows are measured through a recording source.
- The table is an argument about how to write a loop, and it is the argument most likely to be
  ignored, because three calls return the same answers as one and nothing in the result says the
  caller paid triple. The check also constrains the direction that would look like an improvement:
  narrowing a multi-signal read to per-signal ranges decodes fewer bytes and turns one request into
  three. The row that must not move is the first — one read, and the whole record.
- The three calls are additionally asserted to read the identical byte range each time, which is
  what makes the extra two waste rather than work.

## 0.4.348

- **Added** a check for what `index.locate` costs, against the two read counts `discontinuous.md`
  prints — three for the first call, zero for a second one nearby.
- The zero is the one worth holding. A UI that calls `locate` on every pointer move is either free
  or a request per frame, and nothing at the call site says which; a memo dropped in a refactor
  changes no result at all, so no other test would notice. The three is worth holding for its
  parenthesis rather than its size: records 0 and 5 are already known because `openEdf` probed
  them, so the search starts from what the open already paid for.
- Also pinned: that the search reads one record at a time rather than widening to a range, which
  would still answer correctly and cost far more over HTTP; and the file the page draws, whose span
  of 16 and coverage of 6 are computed independently and differ by the ten seconds no record
  covers.

## 0.4.347

- **Added** an execution of the `bigint` ticks decision on `design-decisions.md`. It is defended
  with a specific, hard-to-notice failure — two onsets that are one instant on disk comparing
  unequal after a round trip through a binary fraction, an averaging window landing a sample off
  for a subset of trials — and that is arithmetic, so it can be shown instead of asserted.
- Worth showing, because the cost paragraph underneath is a standing invitation to convert to
  seconds and be done with it. Three tenths is now demonstrated to be three times one tenth to the
  tick and not in seconds, and a seven-decimal onset survives exactly while its float does not.
- The path itself is checked from the source. `tal/ticks.ts` states that `parseFloat`,
  `Number(text)` and float arithmetic appear nowhere on it, and nothing made that true — it is one
  careless conversion away from being false while every existing test passes, because the two agree
  on almost every value. Scanned with comments stripped, since the docblock making the claim quotes
  the very calls being looked for.

## 0.4.346

- **Added** an execution of the `strict` section of `design-decisions.md`, which is where the
  odd-looking choices are defended and where two pieces of load-bearing behaviour had no test that
  read the page.
- The `info` exemption is the first. Without it, `strict: true` would reject nearly every real
  recording — `DATE_CLIPPED_TO_1985_2084` is on almost all of them — and it would do it while
  looking correct, because the mode is called strict and rejecting is what it is for. Removing it
  reads as tightening. A conforming file now has to open under strict and still carry that
  diagnostic.
- The second is the list of conditions that throw "either way". Three of the four are properties of
  the header and are checked in both modes. The fourth, record onsets that go backwards, gets its
  own section, because choosing a fixture where it throws at open would have hidden something real:
  `openEdf` reads records 0 and n-1 and nothing else, so a reversal between them throws immediately
  and one in the middle is not something it has seen. That file opens with a probed index and
  throws the moment `buildRecordIndex` reads the records — "either way" is about the two modes, not
  about throwing before the bytes are read.

## 0.4.345

- **Added** a check that the six single-interface field tables on `api-types.md` list exactly the
  members those interfaces have, in declaration order. That page is the field-by-field reference
  and where someone goes to learn what is on an `EdfHeader` without opening `types.ts`, and all six
  tables are hand-typed copies of a declaration.
- Both directions of drift are silent. A member added to `types.ts` and not to the page is a field
  nobody can discover — which is how `declaredRecordCount` or `recordCountSource` would go unused
  by exactly the caller who needed them. A row for a member that no longer exists is worse: it
  reads as an API, the reader writes `header.something`, and the answer is `undefined` rather than
  an error. `docs-coverage.test.ts` proves every export is mentioned; nothing had looked inside a
  type.
- One table spans three interfaces and cannot have its rows attributed to any one of them, so it
  is skipped by name and the number of skipped tables is asserted — an exemption that cannot
  quietly grow.

## 0.4.344

- **Added** a check over what `data-sources.md` publishes about `cachedSource`. `cache.test.ts`
  covers the behaviour thoroughly — eviction order, deduplication, copies, clamping, abort — but
  every one of those tests passes its own sizes in order to be deterministic, so the two DEFAULTS
  a caller inherits by writing `cachedSource(inner)` were invisible to all of them.
- Those defaults are what almost every caller actually gets. They are checked twice: against the
  private constants they come from, and behaviourally — one byte asked for, one whole 1 MiB block
  fetched, and the rest of that block then free.
- Also executed: the worked recipe at the end of the section, which is arithmetic a reader is told
  to do themselves and which makes a claim about cost. `readHeader` costs two reads against the
  uncached source, the derived block size is a whole number of records, and `openEdf`'s second pass
  pulls in block 0 — the block the first record read needs anyway.

## 0.4.343

- **Added** `tests/property/scaling.test.ts`, which measures the bound 0.4.342 asserted. Random
  declarations are built, written, parsed and converted at both endpoints, and the error is
  compared against what the file itself declares — the fourth property file in the suite and the
  first over the scaling expression.
- Two wrong units on the way to the right one, both recorded in the file. ULP distance is the
  mistake `mne-parity.test.ts` already documents: a declaration with bounds of 0.0002 and -4827
  sits 5.4 million ULP from the smaller one while being physically indistinguishable from it.
  Relative error fails at the other end — a bound of 0.001 beside one of 99,999 shows a relative
  error of 1.3e-3 for an absolute error far below anything the file can express. Quantisation steps
  are the only unit in which "you could not notice this" is a statement about the recording, and
  they are what the rest of the page already uses. The measured worst is about 2e-5 of a step, and
  0.4.342's note has been corrected from a relative figure to that one.
- The property found a real constraint on its first run: a physical bound lives in an
  eight-character field, so `1e-6` is written `0.000000` and comes back degenerate. Everything is
  now measured against the parsed header rather than the numbers handed to the writer, which makes
  this a property about declarations a file can actually hold.

## 0.4.342

- **Corrected** a claim on `physical-values.md` that read as general and holds only for the range
  it introduces. "The two forms agree at the endpoints and disagree in the last place elsewhere"
  is true of the tabulated -500..500 over -32768..32767, and false of most declarations: the
  EDFlib expression derives an offset from `physicalMaximum / bitValue` and multiplies back, and
  nothing in that round trip has to land on the declared bound. A signal declaring `1`..`1000`
  over `0`..`4095` converts its digital minimum to `1.000000000000092`.
- Not a defect in edfcore — EDFlib does the same and reproducing it bit for bit is the entire
  point — but a reader who took the sentence generally would derive a plot axis from `toPhysical`
  at the extremes and get a bound an ulp or two off. The sentence is now scoped to its range, and
  a note gives the general case and points at `physicalRangeOf`, which reads the declared fields
  and is exact.
- Checked from both sides: the two quoted values are produced, the tabulated range still lands
  exactly, and `physicalRangeOf` returns the declared bounds on all three.

## 0.4.341

- **Added** an execution of the read pattern `large-files.md` measured. The page prints four byte
  ranges and a total for opening a 29,925,760-byte EDF+C, and the file is now rebuilt from the
  sentence describing it — eight channels at 256 Hz, 7,200 one-second records — and opened through
  a recording source, so all four offsets and lengths have to match, in order.
- Rebuilding it is itself a check on having read the description right: the annotation channel is
  not in the parenthesis and is implied by the record size, since eight channels at 256 samples is
  4,096 bytes and the page says 4,156. The assembled file comes out at exactly the byte count in
  the sentence. The read block is matched inside its own fence, because the page prints the same
  shape again for the eight-hour window further down and a page-wide match reports six reads for a
  call that issues four.

## 0.4.340

- **Added** a check for the table `large-files.md` opens with: a read count and a byte count for
  each of four shapes of file, supporting the sentence that is the reason to reach for this
  library at all — "That is the entire cost, whatever the file size." All four rows are now opened
  through a recording source and counted.
- A read count is not something a type or a lint can hold. It is a property of the call graph and
  it changes by accident: a helper that fetches a field it already has, a probe that stops
  short-circuiting on a one-record file, a header read split per signal block. The page names that
  last one outright, and over HTTP it is the difference between one round trip and sixty-four on a
  call the caller believes is free — so it is checked on a 64-signal file. Also pinned: the header
  read uses the computed `256 * (ns + 1)` rather than the byte-length field, checked against a file
  that declares a wrong one.

## 0.4.339

- **Added** the three refusals `quick-start.md` promises, each of which is a single clause on the
  page and a real guard in the library: passing the annotations index to `readWindow` throws rather
  than plotting timestamped text as a waveform, a label differing only in case is refused because
  matching is exact and case-sensitive, and a duplicated label is refused rather than resolved to
  the first.
- The detail the page attaches to each is checked too, not just that something throws. The
  not-found error has to list every label in the file — all three, not only the near miss — and the
  ambiguous one has to name the indices that carry the label, which is what makes either message
  actionable rather than a report that the call did not work.

## 0.4.338

- **Added** a check that the three published copies of `ByteSource` agree. It is the one type a
  caller implements rather than consumes — the extension point that lets a file, a blob, an object
  store and an HTTP range share one path — so it is printed in full on `data-sources.md`, again on
  `api-sources.md`, and declared in `src/types.ts`. Two of those are hand-typed copies of the
  third.
- A drift here is worse than a stale sentence: someone writes an implementation against a printed
  signature, TypeScript disagrees with the page, and the page is what they trusted. A dropped
  `readonly`, a `close` that stopped being optional, a `ReadOptions` parameter that gained a
  sibling — each is a one-word edit that neither `astro check` nor `tsc` can see, because a fenced
  block is not code either of them compiles. `doc-snippets-compile.test.ts` compiles the fences
  that are complete programs; this one is a declaration, so it is compared against the declaration.

## 0.4.337

- **Added** an execution of the annotation listing on `quick-start.md`. The page's own format
  string is transcribed and applied to what `readAnnotations` returns, and it has to reproduce all
  three printed lines exactly — which catches a `durationSeconds` arriving as `0` instead of
  `undefined`, since that would print `(+0 s)` on an event with no duration, a different claim
  about the recording.
- The docblock states what the check does NOT claim. The fixture is built from the page's own
  lines, so the onset values vouch for themselves and a page edit changes both sides. Two things
  are independent of that and are checked as such: the formatting between the numbers, and that
  every decimal onset survives the round trip as a whole number of ticks, whatever the decimal is.
- Also pinned: the record range `readAnnotations` requires, which the page says has no default
  because scanning a whole file for annotations is expensive.

## 0.4.336

- **Fixed** wrong advice on `quick-start.md`. It said an annotation carries its onset "three ways"
  and then named `onsetSecondsFromFirstRecord`, `onsetSecondsFromHeaderStart` and `onsetTicks` —
  one float from each axis and a bigint from only one of them — closing with "Print the seconds;
  compare the ticks." Followed literally on a file that declares a sub-second start offset, that
  prints the rebased seconds and compares the header-axis ticks: on a 0.5 s offset, an event shown
  at 1.25 s and tested at 1.75 s, silently.
- There are four fields, two per axis, and `annotations.md` has had them right in a table all
  along. The quick start now names both members of both pairs, keeps the "print the seconds,
  compare the ticks" advice with "from the same axis" attached, and says what the two axes differ
  by. Checked on a file with an offset and again on one without, where the two collapse — which is
  why this was easy to miss.
- This is the same shape as the defect the rename in 0.3.0 exists to prevent: two quantities that
  agree on an ordinary file and part company on the one that matters.

## 0.4.335

- **Added** a check over the console output `quick-start.md` prints. Between two `text` blocks the
  page pins the whole shape of a read — variant, record geometry, three channels with their kinds
  and sample counts, and `2560 samples, 6040 bytes read` — and the fixture is now built from the
  block's own description of the file rather than from a fixture that happens to resemble it.
- The byte count is the number worth holding. The page stops to explain that 6040 "is more than
  the 5120 bytes those 2560 samples occupy", because a record is the smallest readable unit and
  every channel is interleaved into it — so the overhead a reader budgets from this page follows
  from the annotation channel's width, three lines further up the same block. That subtraction is
  checked, not just the total.
- The individual sample values are deliberately not checked. They come from a recording nobody
  here has, and a fixture reproducing them would be asserting against its own generator.

## 0.4.334

- **Added** a check over the `validateHeader` table on `api-validate.md`, which was one of the four
  pages no test named. The table lists ten codes; the sentence under it does the real work, saying
  four of them "exist nowhere else in edfcore" and that "the other six are also emitted by the
  parser, so a report stands on its own instead of only making sense next to
  `header.diagnostics`."
- That claim rots silently in both directions. Moving one of the four into the parser makes a
  validation report redundant for that code while the page still calls it exclusive; moving one of
  the six out breaks the sentence the other way. Both halves are now settled by asking which
  modules under `src/` name each code. Also checked: none of the ten is fatal, since a fatal code
  here would let `validateHeader` condemn a file the parser opened without complaint, and the
  fourteen label types the page spells out are read out of `STANDARD_LABEL_TYPES` in order.
- `diagnostic-docs.test.ts` covers how severe a code is across every page. This is the narrower
  question it does not ask: who is entitled to emit one.

## 0.4.333

- **Added** the rest of `migrating-to-0-3.md`: the difference the page calls structural. `sampleAt`
  returns `undefined` for each of the three reasons the page gives — the instant falls in a gap,
  before the recording, or after it — and returns a location either side of the hole, so that
  `undefined` is a statement about the file rather than the function's usual answer.
- The other half is that the grid form has no way to say it. Given only a signal and a record
  duration it returns an index at every instant, including one past the end of the file, which is
  checked against the record count. And both refuse a probed index on a file with gaps: the same
  fixture throws before `buildRecordIndex` and answers after it, with `contiguityOf` reporting
  `'unknown'` in between.

## 0.4.332

- **Fixed** a test of mine that could time out. The UTF-8 sweep added in 0.4.324 encoded each of
  the 1.1 million code points above U+007F on its own and walked the result with an iterator, which
  took about 2.6 seconds alone and over five under a loaded suite — past the default timeout. It
  had passed every run until the suite grew enough to starve it.
- Now encoded in blocks and scanned by index. UTF-8 is context-free, so the bytes of a run of code
  points are the concatenation of each one's, and the check covers the same 4,382,464 bytes in
  about a tenth of the time. Raising the timeout was the other option and the wrong one: it would
  have left a five-second check running on every commit to prove something that takes a third of a
  second to prove.

## 0.4.331

- **Added** an execution of the example `migrating-to-0-3.md` builds its whole argument on: on a
  file with a seven-second hole after record 2, the grid form puts sample 12 at 3 seconds and the
  recording-aware form puts it at 10. Both numbers, the size of the hole and the record it follows
  are read out of the page, and the fixture is built from them.
- The sentence the rename exists for is checked too, from the other side: before the hole the two
  forms return the same number for every sample, which is exactly why the difference was easy to
  miss. And the gap accounts for the whole of the difference after it — the page says both numbers
  are correct about different things, and this is the arithmetic that makes that true.

## 0.4.330

- **Added** a check over `migrating-to-0-3.md`, which was one of four documentation pages no test
  named. It is a rename table and a `sed` recipe, and both can go stale in a way a reader cannot
  detect: the table's three new names now have to be exports, and its three old names have to be
  absent, because a barrel still carrying `sampleIndexAt` would let an unmigrated call site keep
  working and make the whole page fiction.
- The recipe is lifted out of the page's own fence and run. The page warns in the next paragraph
  that `sampleStartTicks` is a prefix of `sampleStartTicksOf` and that a substring replace would
  damage the second, so the `\b` anchors are load-bearing — and that is checked both ways: the
  recipe leaves the longer name alone, and the same recipe without the anchors turns it into
  `gridSampleStartTicksOf`, which is not a name this package has. Run as regexes rather than by
  shelling out, since `sed -i` takes an argument on BSD and not on GNU.

## 0.4.329

- **Added** `--through` to `npm run announce`, which closes a batch at a version that is not the
  newest tag. A batch is what was asked for rather than what happens to be tagged, so two of them
  can be in flight at once — and without this the only expressible range ended at the newest tag,
  so announcing an older batch would have swallowed the newer one.
- It refuses a version that has no tag rather than announcing an empty or a wrong range, and the
  default is unchanged: everything since the last release.

## 0.4.328

- **Added** a guard for the release model 0.4.327 introduced. Three files describe it and none of
  them enforced it, and the dangerous edit is small and looks like a revert: putting `release:
  types: [published]` back on `publish.yml` leaves every test green, every workflow valid, and
  `scripts/release.mjs` pushing tags that trigger nothing.
- That is not hypothetical. It is exactly how 0.4.287 through 0.4.292 were lost — six versions
  tagged, six green CI runs, nothing on npm, found only by looking at the registry. So the trigger
  is asserted from the outside, along with the two orderings the gate depends on: that `ci.yml`
  still runs on a push to main, since the release polls for check runs that would otherwise never
  register, and that `release.mjs` pushes main before it tags rather than after.

## 0.4.327

- **Changed** how publishing is triggered: `publish.yml` now runs on a pushed **tag** rather than
  on a published GitHub release. The two had been the same thing, which made a GitHub release a
  mandatory step in shipping a patch version rather than an announcement — a hundred of them for
  changes of two or three lines each, burying anything worth reading. The tag was already the
  per-version record; now it is also the door to npm.
- **Added** `npm run announce`, which cuts ONE release for a whole batch. Its range runs from the
  newest tag that already has a release to the newest tag, so running it twice is a no-op and an
  interrupted batch is picked up by the next run. The notes are the changelog entries for those
  versions verbatim, and a tag in the range with no entry stops it rather than being announced
  past.
- **Reordered** `scripts/release.mjs` so the gate got stricter rather than weaker. It now pushes
  main, waits for CI to go green on that exact commit, and only then creates and pushes the tag.
  Before, the tag was already public while CI ran, so a red commit spent the version number and
  the fix had to become the next one. Now a failure leaves the number free: the repair is an
  ordinary commit on top and another run, and the changelog entry already written stays true.
- Nothing about the per-version contract moved. One commit, one tag, one npm publish, and the
  script still refuses to exit until the version is installable.

## 0.4.326

- **Added** the last unchecked section of `physical-values.md`: the four conditions that leave a
  signal with no scale. Each row's code is produced by building the signal the row describes and
  catching what `toPhysical` refuses it with, and the table's introduction — "checked in this
  order" — is exercised against signals that trip two conditions at once, because the order is
  what decides which code such a signal reports.
- The page's second verbatim message block is pinned the way 0.4.316 pinned the first: only the
  hard wraps are undone, since the runs of spaces inside it are the raw eight-byte fields quoted as
  the file holds them. Also checked is the asymmetry the section turns on — an inverted physical
  range keeps its scale, because a negative amplifier gain has a documented meaning, and an
  inverted digital range does not and is refused.
- With this, `edf-format.md` and `physical-values.md` are no longer the two pages nothing in the
  suite reads.

## 0.4.325

- **Added** a check for the claim `edf-format.md` closes with: "Every diagnostic edfcore emits
  names the clause it comes from." That is the promise that makes a warning adjudicable — `EDF+
  additional specification 5` can be checked against a document — and nothing held it.
  `specReference` is optional on `DiagnosticInit`, so leaving it out is neither a type error nor a
  lint error, and most emission sites pass it positionally through a helper, which is why a static
  scan of the object literals answers the wrong question.
- So the diagnostics are asked instead: nine targeted files for the header defects that need a
  particular pair of fields, plus a bit-flip sweep over the first 900 bytes of a well-formed EDF+
  file. Between them they produce twenty-four of the forty-six codes, every one of which names a
  document rather than a feeling. The reach is asserted rather than assumed, and the docblock says
  plainly that this demonstrates the claim over half the table rather than proving it over all of
  it — the other twenty-two need conditions one fixture cannot reach.

## 0.4.324

- **Added** an execution of the TAL grammar `edf-format.md` prints as ABNF. Two of its five lines
  carry a rule the rest of the page argues from: `Onset` requires its sign and `Duration` forbids
  one, and `tal/ticks.ts` refuses a signed duration outright because a signed duration means the
  field layout is not the one being read. Both are now checked against the page's own text.
- The claim underneath the block is proved rather than quoted. "Every byte of a multi-byte UTF-8
  sequence is at least `0x80` and can never collide with one of them" is why the region may be
  split on the structural bytes BEFORE decoding, and it is checked over every code point above
  U+007F rather than sampled — about three million bytes. The other order, which the page says
  corrupts any non-ASCII annotation, is exercised end to end through a file carrying one.

## 0.4.323

- **Added** an execution of the four-line record arithmetic on `edf-format.md` — the sample width
  per family, the record length as the summed sample counts, each signal's offset within a record
  as the sum of the counts before it, and the file offset of record `r`. The four lines are checked
  to still be on the page, then run against four shapes: both families, a five-signal file, a
  one-signal file, and the mixed-rate case the page describes, EEG at 256 samples per record beside
  a channel at 1.
- `concepts-arithmetic.test.ts` covers one specific file from the concepts page. These are the
  general equations that file is an instance of, including the closing one: the last record has to
  end exactly at the end of the file, with no padding and no trailer.

## 0.4.322

- **Fixed** a wrong claim on `edf-format.md`. It named `|0`, `<<` and `>>>` together as operators
  that "wrap it negative without warning" past 2^31. `>>>` is the unsigned shift and never returns
  a negative number: it truncates to 32 bits and keeps handing back a plausible offset until 2^32,
  then a wrong one. Grouping it with the other two described the safer failure and hid the more
  dangerous one — a negative offset is caught by the first bounds check it meets, and a positive
  wrong one is not.
- Found while writing 0.4.321, whose demonstration would not assert what the sentence said. The
  corrected wording is now pinned by that test, and both behaviours are shown at the sizes where
  they actually occur.

## 0.4.321

- **Added** a guard for the offset rule `edf-format.md` states: offsets stay in plain floats, which
  are exact to 2^53, because a data offset in a multi-gigabyte BDF crosses 2^31 and a bitwise
  operator wraps it negative there without warning. Nothing checked it, and the failure is the
  silent kind — a 22-hour BDF passes 2^31 bytes about nine hours in, so a truncated offset would
  read plausible samples from the wrong place for the whole back half of the recording.
- Not a ban: `decode/digital.ts` assembles every sample with `|` and `<<` and must, and the same
  page prints those two lines as the definition of the format. The guard is an inventory instead —
  every bitwise operator in `src/` has to sit in one of three modules with a written reason, which
  makes adding a fourth a deliberate act. `record-index.ts` is one of the three, and its entry
  records why `(low + high) >> 1` is safe: the record count comes from an eight-character header
  field, so the index cannot approach 2^30.
- The demonstration corrects a detail the page leaves implicit. `| 0` and `>>` wrap the offset
  negative at 2^31, but `>>>` is unsigned and returns something plausible until 2^32 — about
  eighteen hours into the same recording — which is the more dangerous of the two behaviours.

## 0.4.320

- **Extended** 0.4.319 to the second copy of the harness table. `scripts/golden/README.md` carries
  the complete one — four rows rather than the documentation page's three, because it includes
  `corpus-parity.test.ts`, the only harness whose inputs nobody here chose — and `tests/README.md`
  sends the reader to it for "what each harness claims and how strong that claim is".
- That copy names each harness by file, which is the stronger form, so a row cannot outlive the
  test it describes. Every named file has to exist, every bit-for-bit row has to belong to a
  harness that compares with `Object.is` and no tolerance, and the MNE bound has to match both the
  constant in the harness and the figure the other table publishes.

## 0.4.319

- **Added** a check that the three cross-implementation harnesses claim on the page exactly what
  they assert in code. `physical-values.md` tabulates them precisely because they are not equally
  strong — pyEDFlib values bit for bit, pyEDFlib onsets exact to the tick, MNE only to 1e-12
  relative and explicitly not bit-exact — and that is a claim about the tests, so no test could
  previously be wrong about it in a way that showed.
- The MNE bound is now read out of `mne-parity.test.ts` rather than restated: loosening that one
  constant for a flaky run would otherwise leave the page publishing a parity claim a thousand
  times stronger than the one being made, with the whole suite still green. The two exact rows are
  checked for the ABSENCE of a tolerance, with comments stripped first — `golden-values.test.ts`
  explains at length why it does not use one, and the explanation must not vouch for itself.

## 0.4.318

- **Strengthened** the check that the golden fixtures can tell the two scaling forms apart.
  `physical-values.md` justifies pinning EDFlib's expression with one measurement — the textbook
  form "fails it on 140 of 256 samples of the symmetric fixture", with an example pair of values —
  and the existing assertion was that more than a quarter of the asymmetric file's samples differ.
- That bound is the right shape for "the fixtures are not vacuous" and the wrong shape for a
  sentence quoting an exact count and an exact pair of decimals. Both numbers and both values are
  now read out of the page and reproduced from the committed pyEDFlib output, so the page's
  evidence is measured rather than remembered. The looser bound stays; it says something different.

## 0.4.317

- **Added** an execution of the out-of-range section of `physical-values.md` — the four samples the
  window returns unclamped, the count of two beside them, and the four values
  `clampToDigitalRange` produces — all read out of the printed comments rather than restated.
- Also checked is the sentence those two features turn on: both order the declared bounds before
  using them. A file whose digital minimum and maximum are the wrong way round still reports two
  samples out of range rather than every one of them, and still clamps to four distinct values
  rather than folding the channel onto a single one, which is what the pair as written would do.

## 0.4.316

- **Added** an execution of the negative-gain section of `physical-values.md`: the scale it prints,
  the three samples it converts, the envelope `physicalRangeOf` reports in size order rather than
  field order, and the whole `INVERTED_PHYSICAL_RANGE` message it quotes for a one-signal file,
  compared word for word against the one the package emits.
- Only the page's hard wraps are undone for that comparison. A run of spaces inside a line is not
  wrapping — it is the eight-byte physical minimum field quoted as the file holds it, padding
  included — so collapsing every space would have compared against a message edfcore does not
  emit. The byte offset in the quote is resolved through `signalFieldOffset`, which is the same
  `256 + ns*104 + i*8` the address table on `edf-format.md` gives.

## 0.4.315

- **Added** a measurement of the float32 cost `physical-values.md` cites as the reason `toPhysical`
  has no `Float32` option. Every one of the 2^24 BDF samples on a -500..500 uV channel is converted
  through the scale edfcore publishes and rounded to float32, and the worst error is compared with
  the 0.26 of a quantisation step the page prints.
- The sentence the number supports is checked too: float32 carries 24 significand bits and a BDF
  sample is a 24-bit integer, so the digital values themselves survive the round trip exactly and
  there is nothing left for the scaling. Run as a scalar loop — 2^24 float64 samples is 134 MB, and
  the point is the worst case, not the array.

## 0.4.314

- **Added** the census underneath the table 0.4.313 pinned: the two conversion forms are run over
  every one of the 65,536 encodings and the four numbers the page states are computed from the
  result — 37,144 differing values, 57 % of them, a largest gap of 8.5e-14 and 5.6e-12 of a
  quantisation step. The quoted figures are parsed from the page and compared at the two
  significant figures they are written to.
- The sentence after them, that the gap is eleven orders of magnitude below anything an amplifier
  can express, is derived rather than trusted. It is the reason the difference is safe to have,
  and it is the number most likely to be left behind by a change to either form.

## 0.4.313

- **Added** an execution of the conversion table on `physical-values.md`: four rows of exact
  float64 literals showing where EDFlib's expression and the textbook one part company. The
  literals are parsed from the page, edfcore's column is produced by `toPhysical` and the other by
  the rejected form, and both are compared with `Object.is` — the comparison the golden-value
  harness uses, and the only one that can see the digit the table exists to show.
- The table is the argument for the package's one deliberate numerical choice, so its numbers
  being right mattered more than most. They were, and nothing held them there. The scale the page
  prints beside it and the claim that the two forms agree only at the endpoints are checked from
  the same rows.

## 0.4.312

- **Added** a cross-check of the sample decoders printed on `edf-format.md` against edfcore's own.
  The page's `decodeEdfSample` and `decodeBdfSample` are three lines each and derived straight
  from the specification; `decode/digital.ts` de-interleaves whole records through a plan and a
  typed-array fast path. Every one of the 65,536 EDF encodings now goes through both, along with
  the BDF boundaries where sign extension from bit 23 is decided.
- The results the page prints beside each call are parsed out of it rather than restated, so
  `decodeBdfSample(0xff, 0xff, 0x7f)` has to keep printing what those bytes actually hold.

## 0.4.311

- **Added** an execution of the worked address on `edf-format.md`. The page prints a hand-written
  `byteOfSample` and one result — byte 1832 for sample 20 of a 16-samples-per-record channel,
  "record 1, sample 4" — as the fastest way to understand the layout. The index and the address
  are parsed out of the page, the arithmetic is run against a file built to the snippet's
  description, and the two bytes at that address are decoded and compared with the sample edfcore
  returns for the same index.
- The page says "edfcore does that arithmetic for you", and that sentence is the one worth
  holding: the value of the printed byte is that it is the byte the library reads, so the check
  is against a real read rather than against the formula restated.

## 0.4.310

- **Added** the second half of 0.4.309: the per-signal address table on `edf-format.md`, ten rows
  of `256 + ns*K + i*W`. Each row's `K` and `W` are checked against `SIGNAL_FIELD_BLOCK_OFFSETS`
  and `SIGNAL_FIELD_WIDTHS`, each address is resolved for several signal counts and compared with
  `signalFieldOffset`, and the two claims the page makes about the table's own shape — that every
  `K` is the sum of the widths before it, and that the widths total 256 — are computed from it.
- This is the table the page calls "the layout detail that produces the most wrong parsers", and
  the reason is in the check: at `ns = 1` the field-major and struct-per-signal layouts are
  identical, so a one-signal fixture cannot tell them apart. The addresses are resolved at 1, 2 and
  30 for that reason.

## 0.4.309

- **Added** a check over the fixed header table on `edf-format.md`: ten rows giving the offset and
  width of every field in the first 256 bytes. The rows are parsed out of the page and compared
  with `HEADER_FIELDS`, and they also have to tile the block — no gap, no overlap, ending exactly
  at 256.
- That page and `physical-values.md` were the only two documentation pages no test named at all.
  The page is a hand-typed copy of the same table the parser reads, and its whole value is being
  independent of the library, so an offset corrected in `constants.ts` alone would leave it
  teaching a byte address that no longer exists.

## 0.4.308

- **Added** the guard for what 0.4.307 fixed: a version another entry calls a hole has to say so in
  its own entry. The list is derived rather than kept — an entry saying "0.4.287 through 0.4.292
  were never released" declares six, and each of those six must carry the note itself.
- Nothing here knows what npm holds, because the suite is offline. Checking the changelog against
  itself is the strongest form available, and it is the failure that actually happened: fourteen
  entries written before their release failed, each reading like one that shipped, with the
  correction sitting in a different entry the reader never reaches.

## 0.4.307

- **Marked** the fourteen changelog entries for versions that were never released. Each of them —
  0.4.231 through 0.4.236, 0.4.241, 0.4.242, and 0.4.287 through 0.4.292 — was written before its
  release failed, so the entry reads exactly like one that shipped. The correction lived in a
  different entry further up, which a reader at `## 0.4.288` never sees: they get a normal-looking
  changelog entry for a version `npm install edfcore@0.4.288` cannot fetch.
- The older holes already did this right. 0.2.29, 0.2.36, 0.2.59 and 0.4.176 each open by saying
  "Never released" and naming the version that carried the work, which is the convention
  `scripts/release.mjs` points at when it tells you to record a consumed number. These fourteen
  now do the same, and say which version carried them.

## 0.4.306

- **Built** the file `discontinuous.md` draws and read it. The page opens with a diagram — six
  one-second records with a ten-second gap between record 2 and record 3 — and everything after is
  arithmetic on that picture: which chunk starts where, which carries the gap, that a two-record
  read either side spans twelve seconds for two seconds of data, and that `locate(13.5)` answers
  record 3 at 13 s plus half a second.
- Those figures are the page's argument. "Reading such a file as if it were contiguous puts record
  3 at t = 3 s when it truly starts at t = 13 s. Nothing throws, the waveform looks fine, and every
  event you align against it is ten seconds out." `discontinuous.test.ts` covers EDF+D thoroughly
  against a different fixture — hour-long intervals in a sleep latency test — so this builds the
  page's own file, and the numbers a reader copies are the ones a run produces.

## 0.4.305

- **Pinned** the budget refusal `large-files.md` prints — `requiredBytes` 442,368,000,
  `budgetBytes` 268,435,456, `optionName` `'maxMaterializeBytes'`. The middle one is the 256 MiB
  default; the first is every record of the eight-hour file measured in RECORD bytes, not the
  Int32Array one channel would decode into. Those two differ by an order of magnitude here and the
  smaller would have looked just as plausible on the page, which is the sort of number a reader
  copies into a capacity estimate.
- `optionName` is checked by triggering a real refusal rather than by reading the type: the field
  exists so a message can point at an argument the caller can actually change, and a message
  naming an option that had been renamed would be worse than none.

## 0.4.304

- **Executed** the costing on `large-files.md`. Its whole argument is numeric: an eight-hour,
  30-channel, 256 Hz EDF — 28,800 one-second records of 15,360 bytes — where a ten-second window
  is one read of 153,600 bytes out of 442,375,936, or 0.035 % of the file, opening it costs 7,936
  bytes, and asking for one channel out of thirty costs byte-for-byte the same. That is the
  random-access claim stated as money, and every figure was prose.
- They are the numbers a reader checks their own instinct against. Someone who expects
  `signalIndices: [0]` to be thirty times cheaper needs the page to be right about it, because the
  advice to name every channel in one call rests on that. The header is built at full width and
  the arithmetic checked against what edfcore reports for it — record size, the byte offset the
  window lands at, the last byte the read touches, and the overread factor of 30, which is the
  record over one signal's block.

## 0.4.303

- **Executed** the request budget on `api-sources.md`: one `HEAD` for the length, `bytes=0-255`,
  one more range for the rest of the header, and one whole record at each end for the timekeeping
  probes — five in total, with the caller's headers on all five. That is the paragraph a reader
  consults before pointing this at S3, and every clause is a cost they are budgeting.
- The count was pinned elsewhere against a literal; the composition was prose, and so was the
  promise about headers — the clause with a security shape, since one request quietly going out
  without the configured `Authorization` 403s in production and nowhere else. All of it is now
  driven through an injected `fetch`, which the suite requires of anything touching the network
  and which is also how the page tells a reader to test their own adapter.

## 0.4.302

- **Made** `api-reading.md`'s read counts the expectation rather than a second statement of it.
  "On a plain EDF or BDF it costs two reads. On a file that carries an annotations signal it costs
  four. A single-record file is probed once, for three reads total" is the random-access claim in
  miniature, and the number a reader budgets an HTTP round trip against.
  `read-pattern.test.ts` already pins those counts — against literals it holds itself, so the page
  and the suite each stated the contract and nothing compared them.
- The numbers are parsed out of the sentence and each case driven through the counting source,
  including the one the page states without a number: a file with no data records is not probed at
  all, so it costs the plain count. Spelled-out numbers are read through a word list, the same
  treatment the fixture counts get, because prose is the right place for them to be words.

## 0.4.301

- **Executed** the worked example on `concepts.md`, the page the site opens with and the README
  calls "the mental model the rest of the API follows from". It is built almost entirely out of
  arithmetic on one described file — a 768-byte header, thirty 544-byte records, 17,088 bytes
  total, and a ten-record read of the narrow channel costing 5,440 bytes for 160 samples — and
  every number was prose. A reader who works through it and gets a different answer from their own
  file has no way to tell which of the two is wrong.
- All of them are correct. What was missing is anything keeping them so: they follow from
  `headerByteLength = 256 * (signals + 1)` and the record layout, and a change to either would
  leave the page teaching the old ones. The fixture is built to the page's description with the
  suite's own writer, which imports nothing from `src/`, so the numbers are checked against a file
  assembled from the specification rather than against edfcore's idea of one.

## 0.4.300

- **Executed** the claim the error API is shaped around. `src/errors.ts` says class identity is
  false across a realm boundary, `api-errors.md` repeats it, and `public-api.test.ts` files
  `isEdfError` under a heading calling it the cross-realm discriminator — none of them showed it
  happening. An API built entirely around a property nobody demonstrated is an API built around a
  belief.
- Two copies of the module rather than a `vm` realm, because two copies is the case that reaches
  people: one dependency tree resolving edfcore twice, which npm does whenever two packages want
  incompatible ranges. `instanceof` fails across them, `isEdfError` does not, and the
  discriminator survives — while `instanceof` keeps working inside one copy, which is what makes
  the failure invisible to every test a consumer writes against their own.
- Writing it corrected my reading of `isEdfError`: it is a duck type, and a plain object with a
  string `edfErrorKind` passes. That is the design rather than a hole — tightening it to
  `instanceof Error` would reintroduce the problem, since `Error` identity is per-realm too, so
  the check would fail on exactly the foreign errors it exists to recognise. The test says so.

## 0.4.299

- **Extended** `verify:site` to check the generated markdown carries the page, not just its head.
  Every check before this one asked whether a URL exists, and a generator that emitted the
  frontmatter and dropped `entry.body` would have satisfied all of them: `llms-full.txt` would
  still list all 23 pages, every `.md` twin would still render its title and canonical link, and
  the whole thing would be a table of contents for text nobody shipped. `entry.body` is one
  property access away from being forgotten in either generator.
- One distinctive prose line is taken from the middle of each page's source and looked for in both
  outputs. Dropping it from the twin route flagged all 23.

## 0.4.298

- **Corrected** the promise over the "things that look like bugs and are not" list, which 0.4.254
  made untrue. It says "each has a test pinning it and a comment explaining why", and that held for
  the seven code rules — the scaling expression, the `TextDecoder` ban, `readWindow` returning an
  array, `scale` being `undefined`, no `Date`, no bitwise on an offset, `info` under `strict` — and
  then an eighth entry was added about the `archive/pre-squash-2026-08-16` branch being
  load-bearing. That one is a fact about the repository rather than about the code, and an offline
  suite has no way to check a branch on a remote. An unqualified "each" over a list where one has
  no test is the shape this project keeps correcting elsewhere.

## 0.4.297

- **Exercised** the inspector's sample recording, which nothing had. `sample-edf.ts` writes an
  EDF+C file in the browser so the demo has something to decode without asking a visitor for a
  patient recording — three hundred lines of EDF writing that the test suite cannot reach, because
  anything imported from `website/` drags in a tsconfig the root install does not have. `verify:site`
  runs in the job that installed the site's dependencies, so it can.
- A round trip rather than a snapshot: the generator is a writer, edfcore is a reader, and the
  page's headline numbers are what the reader has to find — EDF+C, five signals, 120 seconds, and
  no error-severity diagnostic. If those agree, both agree about the format. Verified by deleting a
  channel and watching it report four.

## 0.4.296

- **Documented** the commands that existed and no page mentioned. 0.4.268 checks that every
  documented script is real; nothing checked the other direction, and `format`, `release` and the
  three `verify:*` scripts had accumulated unmentioned. A contributor-facing script nobody
  documents is a script nobody runs — `verify:tarball` and `verify:site` were both added this week
  and would have been found only by reading `package.json`.
- The three `verify:*` get their own block with the reason they are not in `npm run check`: each
  needs the network or an artifact `check` does not build, and `check` staying offline is a
  property `tests/README.md` opens with.

## 0.4.295

- **Corrected** the release script's closing message, which 0.4.294 made false one release ago. It
  said "publish.yml is now running and will publish to npm" and offered `npm view edfcore version`
  to confirm — advice from when the script exited before the publish began. It now waits for that
  publish, so by the time those lines print the version is already installable. It says so, and
  gives the install command and the release URL instead of two ways to check something already
  known.

## 0.4.294

- **Added** the last wait the release was missing: whether the version actually reached npm. The
  CI wait from 0.4.244 asks about the commit; `publish.yml` is a different workflow, triggered by
  the release that was just created, and it runs its own `npm run check` afterwards — so it can
  fail on something the commit's checks passed, and the script had always exited 0 before it
  started. That gap cost 0.4.287 through 0.4.292: six versions tagged, six green CI runs, six
  GitHub releases, and nothing on npm, found only by looking.
- npm is polled rather than the workflow's status, because the question is whether the version is
  installable. On timeout it says the tag, release and commit are all correct and the publish is
  what did not happen, gives the two commands to see why, and warns that re-running the script
  would cut the next version and leave this one a hole — which is exactly how the six were lost.

## 0.4.293

- **Moved** the tarball check out of the test suite, which is the only place it could not live.
  Packing this package runs `prepublishOnly` — `npm run check && npm run build` — so a test that
  packs runs the suite containing itself, and `npm pack --json` printed the whole run before its
  JSON. 0.4.292 tried to parse around that with `--ignore-scripts` and a located JSON array; the
  publish runner's npm ran the lifecycle anyway, and the extra output then broke the parser a
  second way. It is `npm run verify:tarball` now, in CI's `package` job beside `verify:package`,
  where nothing recurses.

  **0.4.287 through 0.4.292 were never released** — six versions, all tagged, all with green CI,
  none reaching npm, because `publish.yml` runs its own `npm run check` after the release exists.
  Everything they carried is in this one. The release script waits for CI on the commit, and the
  publish is a separate workflow that starts later, so the wait added in 0.4.244 cannot see it.

## 0.4.292

> **Never released.** This version was tagged and its publish run failed, so it is not on npm. Everything below shipped in `0.4.293`.

- **Fixed** the tarball check added in 0.4.287, which broke the publish it was written to protect.
  It ran `npm pack --dry-run --json` without `--ignore-scripts`, so `npm pack` ran the pack
  lifecycle — and this package's `prepublishOnly` is `npm run check && npm run build`. The pack
  performed by the test therefore ran the suite containing the test, printed all of it to stdout,
  and left `JSON.parse` reading `npm notice run biome check` as JSON. It bites only where a
  lifecycle actually fires, which is why it passed on this machine and failed in `publish.yml`.
  The JSON is now located in the output rather than assumed to start at byte zero, and a missing
  file list says so instead of throwing `Cannot read properties of undefined`.

  **0.4.287 through 0.4.291 were never released.** All five were tagged, all five had green CI —
  the failure is in `publish.yml`, which runs after — and none reached npm. Everything they
  carried is in this release. That is five more numbers on the list with 0.2.29, 0.2.36, 0.2.59,
  0.4.176, 0.4.231-0.4.236 and 0.4.241-0.4.242.

## 0.4.291

> **Never released.** This version was tagged and its publish run failed, so it is not on npm. Everything below shipped in `0.4.293`.

- **Extended** `verify:site` to the rendered head of every built page. `Base.astro` builds it once
  for all of them, which is exactly why a page that misses it misses it silently — nothing renders
  differently. Title, description, canonical and the two Open Graph tags are now required on all 27
  pages, and every documentation page must carry the `rel="alternate"` markdown link.
- That last one has a stated purpose rather than being SEO housekeeping. `[...slug].md.ts` records
  what was measured: no AI crawler uses content negotiation, and the ones that found markdown found
  it through an explicit `<link rel="alternate">` in the HTML. A docs page without it has a
  markdown twin nothing can discover, which is the whole feature quietly not working.
- The `/docs` redirect stub Astro generates is exempt, and correctly: it carries `robots: noindex`
  and exists to be followed rather than read.

## 0.4.290

> **Never released.** This version was tagged and its publish run failed, so it is not on npm. Everything below shipped in `0.4.293`.

- **Added** `npm run verify:site`, which checks what the site build produced rather than that it
  produced something. `llms.txt`, `llms-full.txt`, the markdown twin of every page, `robots.txt`
  and `api.json` are generated from the collection and nothing looked at the output — and each
  fails silently. A page missing from `llms.txt` is a page an agent never learns about; a `.md`
  twin that did not render leaves a documented URL 404ing while the HTML page beside it is fine;
  a `Sitemap:` line naming a file the build did not emit tells a crawler to fetch nothing.
- It runs in CI's `site` job, after the build, rather than in `npm run check`. These generators
  live under `website/`, where an import pulls in a tsconfig the root install does not have —
  the boundary 0.4.264 guards — so the artifact is the only place the question can be asked.
  Verified by narrowing `llms.txt`'s section list and watching three pages disappear from the map.

## 0.4.289

> **Never released.** This version was tagged and its publish run failed, so it is not on npm. Everything below shipped in `0.4.293`.

- **Tested** `header/fields.ts` directly, the last source module no test imported. It is the sole
  owner of where each of the ten fixed fields lives and which diagnostic a field that fails its
  grammar deserves, and every function in it ran only as a step inside `parseHeader` — covered by
  whichever inputs some larger fixture happened to produce.
- The offsets are the part a whole-file parse cannot check at all: a field read from the wrong
  offset still parses, it just parses the neighbouring field's bytes. So the table is checked
  against a header whose every field is filled with a distinct letter, which makes a misread
  visible rather than plausible, and against the property that the ten fields tile all 256 bytes
  with no gap and no overlap. The spec's offsets are written out from the specification rather
  than imported from `constants.ts` — importing them would compare the table with itself, and the
  two have to agree because both describe a format neither of them defines.

## 0.4.288

> **Never released.** This version was tagged and its publish run failed, so it is not on npm. Everything below shipped in `0.4.293`.

- **Tested** `options.ts` directly for the first time. It is 66 lines of Layer 1 whose whole job is
  refusing bad input, and no test imported it — every path through it ran only as a side effect of
  some larger read. Its own docblock records two misdiagnoses that reached users from a `NaN`
  budget: an `EdfBudgetError` advising "read fewer records per call", which no record count
  satisfies, and an `EdfRangeError` about `count: NaN` telling the caller to clamp a range the
  function does not take. The distinction it exists for — `undefined` means "use the default",
  `NaN` means a caller computed something and got nothing — is now pinned from both sides, along
  with the ordering that makes the message right: `NaN >= 0` is false, so a sign check written
  first would call `NaN` negative.
- **Pinned** the inventory the module states: six modules resolve the budget and two hand it on.
  That sentence is the argument the guard is worth anything — "a guard that only one of the eight
  applies is not a guard" — and a seventh consumer reading the option raw is how it stops being
  true.

## 0.4.287

> **Never released.** This version was tagged and its publish run failed, so it is not on npm. Everything below shipped in `0.4.293`.

- **Added** a check on what `npm publish` would actually send. `publint` runs in CI and checks the
  manifest is well formed; it says nothing about membership, and membership is where the claims
  are — `tests/README.md` promises "nothing under `tests/` ever ships", and the fixture policy
  says the six committed binaries are excluded from the published package.
- Wrong in either direction is quiet. A stray `tests/` ships 2.1 MB of other people's EDF files to
  every consumer, with the licence questions that policy exists to avoid; a missing `dist/` ships
  a package that installs and cannot be imported. Neither surfaces until someone downloads it, and
  by then the version is immutable. Asked through `npm pack --dry-run`, which is the code path a
  publish takes, rather than by reimplementing npm's ignore rules — which is the whole difficulty
  of the question. Every exports and `bin` target is checked to be present, and `docs/` is checked
  to contain the changelog and nothing else.

## 0.4.286

- **Guarded** the two `git push` calls, which were the last unguarded network steps in the release.
  Both reach the network, so both fail for reasons unrelated to the code, and each leaves a
  different half-done state that re-running the script cannot repair — the commit and the tag
  already exist locally, so a second run refuses the tag rather than retrying.
- Found by living it. Cutting 0.4.285 the tag push timed out with `Recv failure`: main was public,
  the tag was not, nothing triggered a release, and the script exited without a word. The recovery
  0.4.226 added covers the step after these two and never fired, so the only evidence was a version
  on `main` with no release behind it. Each push now says which half is done and gives the exact
  commands to finish, rather than the one that would cut the next version.

## 0.4.285

- **Added** a check that every diagnostic code edfcore emits is registered, or is one of six that
  deliberately are not. `EdfDiagnosticCode` is an open union on purpose — `validate.ts` emits four
  recommendations from EDF+ additional specification 9, and `inspect.ts` needs a name for "the
  header did not fail its grammar, some other rule refused it" without borrowing a wrong one. The
  cost is that a typo is also a valid code: `code: 'TRUNCATED_FIL'` compiles, `dispositionOf` ends
  `?? 'warning'`, and a misspelled fatal code becomes a warning on a file that should have thrown.
  The six intentional ones and a seventh nobody meant were indistinguishable at runtime.
- **Corrected** the accounting while listing them. `validate.ts` says "four codes here are not in
  the core vocabulary", which is true of its own four and reads as the whole set; `inspect.ts`
  adds two more and no single place said so. It now says "four HERE" and points at the list.

## 0.4.284

- **Added** a check that the README's first badge and `/api.json` are the same contract. The badge
  URL carries a JSONPath — `query=%24.exports.total` — against an endpoint generated from the three
  built entry points, and that design exists so the number is counted rather than typed: the site
  footer read "Version 0.1.0" for three minor series. The two halves had never been compared.
  Renaming `total` in the endpoint leaves the badge querying a path that is gone, and shields.io
  does not fail loudly for that — it renders an empty value in the corner of the README, which is
  the one place nobody looks after the first week.
- The path is extracted from the badge and walked through the object the endpoint builds, the URL
  is checked against `package.json`'s `homepage`, and the total is checked against the API surface
  row it should agree with. The endpoint is read as text rather than imported, because it lives
  under `website/` and importing it would pull in a tsconfig CI does not install — the boundary
  0.4.264 exists to hold.

## 0.4.283

- **Added** a check that the sidebar order is a total order. `content.config.ts` requires `section`
  and `order` on every page so "a new page cannot silently land at the bottom of the wrong group",
  and it cannot require the thing that makes the order deterministic: that no two pages in a
  section share a number. `DocsNav.astro` sorts by it and `Array.prototype.sort` is stable, so a
  tie falls back to whatever order the collection loader returned — a filesystem detail. Two pages
  would swap places between machines and nobody would call it a bug, because nothing said what the
  right order was.
- The same numbers are the reading order `llms.txt` and `llms-full.txt` hand an agent, which is
  where a tie stops being cosmetic: "the guides, in order" is the only structure those files have.
  Titles and descriptions are checked for uniqueness for the same reason — both are addresses
  rather than prose, and two pages sharing either are two pages a reader cannot tell apart from
  outside. Contiguous numbering is checked as well, which is a judgement rather than a rule: a gap
  breaks nothing, and it is what a deleted page leaves behind.

## 0.4.282

- **Fixed** the corpus manifest calling one field two names. Five of the seven entries recorded
  what a file is for under `exercises` and two under `purpose`, and `tests/README.md` names only
  the second: the manifest "records the URL, byte size, SHA-256, licence and purpose of each
  file". Nothing read either — that field exists to be read by a person deciding whether a 48 MB
  download is worth it — so the split had no symptom until something asked all seven entries the
  same question.
- **Added** the check that asked. The manifest is the provenance record on which this repository
  is willing to pull 59 MB of other people's recordings onto a contributor's machine: the hash is
  what makes the download reproducible, the licence is where permission is written down, and three
  of these entries record "no licence stated" together with why that is acceptable. Every field the
  README names is now required, digests are checked for shape — 64 lowercase hex — because
  checking the value needs the file, which is the thing this suite refuses to require, and a URL
  has to be one the fetcher could resolve.

## 0.4.281

- **Checked** that `sideEffects: false` is honest, rather than merely present. 0.4.230 read the
  flag out of the manifest; this imports the three entry points in a fresh child realm and watches
  what happens. A bundler reads that flag and feels free to drop any import whose bindings go
  unused, so a module that did something at load — patched a global, started a timer, registered a
  handler — would have licensed the bundler to delete behaviour a consumer depends on, with
  nothing about the failure pointing back here.
- A child process because the question is about a fresh realm: by the time any test runs, the
  parent has imported `src/` a hundred times over. Three things are watched — a new property on
  `globalThis`, a timer, a `process` listener — which is not exhaustive and is what a load-time
  side effect looks like in practice, each of them silent from the outside. Verified by adding one
  of each to the barrel and watching both fail.

## 0.4.280

- **Added** a check that the exit-code table on the CLI page is the code the CLI returns.
  `edfcore validate` exiting non-zero is the documented way to gate a CI job on file conformance,
  so those three numbers are an interface a script branches on without parsing a word of output.
  The page stated them and `cli.test.ts` asserted them against literals it holds itself — two
  statements of one contract, kept in step by hand, which is the shape 0.4.267 found in the
  `signals` column table.
- Each code is produced through both halves of the CLI, because `runCli` returns 0 and 2 and never
  1: an unreadable file throws, and `src/cli.ts` is what turns that into `error instanceof
  CliUsageError ? 2 : 1`. A check that drove only `runCli` would have quietly never exercised the
  row a CI gate depends on most. The row for 2 is also read for the four cases it lists — unknown
  command, missing file, extra files, bad flag value — and all four are produced.

## 0.4.279

- **Added** a check on which Node built-ins the package imports, read from the README's own
  sentence: "Zero runtime dependencies, permanently. `edfcore/node` imports `node:fs/promises` and
  nothing else." Every built-in in the graph is something a bundler has to shim, a serverless
  runtime has to provide and an Electron or Deno target has to allow — one is a footnote, three is
  a compatibility matrix. The neighbouring claims were checked and this one was not:
  `public-api.test.ts` proves the universal entry reaches no `node:` at all and
  `readme-status.test.ts` proves exactly two modules import one, but neither says which, so adding
  `node:path` to the Node adapters would have left both green and the README wrong.
- Comments are stripped and string literals deliberately are not, which is the reverse of what
  0.4.275 and 0.4.277 needed. An import specifier is a string literal, so the shared `codeOnly`
  removes the thing being counted — the first version of this file used it and reported every
  module as importing nothing. The match is anchored to an import statement instead, so a built-in
  named inside a diagnostic message is not mistaken for a dependency.

## 0.4.278

- **Corrected** a sentence in `tests/README.md` that contradicted the rest of the page and the
  repository. It opened with "No file anyone else wrote is in this repository", and the six
  committed binaries under `corpus/golden/` were written by pyEDFlib's own `EdfWriter` —
  `scripts/golden/README.md` says so in its second line, "nothing in `tests/corpus/golden/` is
  produced by edfcore", and `AGENTS.md` explains they exist "because the parity harness has to
  compare against bytes another implementation wrote". The page's own later section is headed
  "Checking against files we did not write".
- The true claim is narrower and worth stating properly: nobody else's *recording* is committed —
  the downloaded corpus is gitignored under `tests/corpus/files/` — and those six were generated
  locally from data this repository specifies. That another implementation wrote them is not an
  exception to the policy, it is the entire reason they are kept: regenerating them with
  `support/writer.ts` would make the comparison circular and prove nothing.

## 0.4.277

- **Fixed** a test budget that has now been wrong twice, by making it a different kind of number.
  `extreme-geometry.test.ts` asserts that a diagnostic per record does not blow the call stack —
  `TIMEKEEPING_TAL_MISSING` is per record, and `push(...array)` gives up around 125,000 arguments
  — and it carried a 30 second timeout. How long the sweep takes is not the property. A timeout
  set just above the observed duration measures the machine instead of the code, and reports a red
  build in something the test does not touch.
- It started at vitest's 5 second default, which the 200,000-record sweep landed a few hundred
  milliseconds under on its own, so it tipped over whenever the rest of the suite ran beside it.
  Thirty seconds fixed that and repeated the mistake one size up: the suite kept growing — 2,074
  tests now, one of which spawns a TypeScript compiler over 102 files — and on a machine already
  busy with unrelated work the sweep took 72 seconds and failed again. It is five minutes now, and
  named for what it is: an infinite loop still fails, a loaded laptop does not.

## 0.4.276

- **Added** the check for the other ban `AGENTS.md` lists: "No `Date` anywhere. EDF stores local
  time with no zone." An EDF header gives a wall-clock date and time and names no zone, because
  the machine that wrote it was in a sleep lab and the field is whatever the clock on the wall
  said. A `Date` cannot hold that — constructing one applies the running machine's zone, so a
  recording started at 23:14 in Leiden becomes a different instant on a laptop in California and
  every derived time moves with it. `EdfCalendarDate` is three numbers precisely so there is
  nothing to interpret.
- Two halves, and only one existed. `dates.test.ts` asserted a parsed HEADER holds no `Date`;
  this adds the source, where `Date.now()` would also make output non-deterministic, and a deep
  sweep of a whole read — recording, timeline, index, annotations, validation report — for any
  `Date` instance at all.
- **Extracted** the comment-and-string stripper both bans need into
  `tests/support/code-only.ts`. It was written for 0.4.275 a release ago, and a second copy is how
  the barrel type parser ended up with two that disagreed (0.4.224). Stripping strings is the part
  that matters: this codebase discusses dates constantly, and a file explaining why it avoids
  `Date` must not read as a file that uses one.

## 0.4.275

- **Added** the check for a ban `AGENTS.md` lists under things that look like bugs and are not:
  `TextDecoder` belongs in `src/tal/` and nowhere else. Verified on Node v24.4.0, every `latin1`
  label it accepts reports `windows-1252` and decodes byte `0x80` as `U+0080`, while the WHATWG
  standard mandates `U+20AC` — so a `TextDecoder` on the header path would make the same file
  produce different strings in Node and in a browser, from a library whose claim is that it reads
  the same bytes the same way everywhere. `src/tal/` is exempt because annotation text really is
  UTF-8, the one encoding every runtime agrees on.
- The stripper removes string literals as well as comments, and that is not tidiness:
  `header/fields.ts` contains the word `TextDecoder` inside a diagnostic message explaining this
  rule to a user, so a comments-only sweep reads the file that documents the ban as the file that
  breaks it. It looked like a live violation until the line was read.
- A second test asserts the consequence rather than the rule — `0x80` in a real signal label,
  read back through `openEdf`, comes out `U+0080` and not a euro sign. `latin1.test.ts` pins the
  decoder in isolation; this is the path a header actually takes.

## 0.4.274

- **Added** the check that edfcore never writes to the console. The README says it twice, and the
  survey table explaining why this library exists lists what the alternatives do instead —
  "`console.warn` and `null`, or bare thrown strings". Diagnostics are values on the result
  precisely so that reporting them is the caller's decision; a library that logs takes that
  decision away, breaks anything parsing the consumer's stdout, and on a header diagnostic puts a
  patient's name into whatever collects the logs. One `console.warn` left in during debugging
  would have shipped, and the only way to find it was to be the person whose output it landed in.
- Both halves, because neither is enough on its own. A static sweep of `src/` with comments
  stripped catches a call on a path no test happens to take — the survey table is quoted in
  comments, so stripping is load-bearing. Running the library with every console method trapped
  catches one the sweep cannot see, and that was verified rather than assumed: a call written as
  `globalThis['con' + 'sole'].warn` leaves no literal `console` in the file, passes the sweep, and
  is caught by the trap.

## 0.4.273

- **Made** the fuzz suite assert the clause it was missing. `tests/README.md` states the safety
  property in four parts — "it never hangs, never allocates unboundedly, never returns NaN, and
  never returns believable garbage" — and attributes all four to `property/fuzz.test.ts`, which
  opened by saying it asserts three and listed them. The gap was "never allocates unboundedly":
  its bounded clause was a wall-clock budget, which catches slowness, and slowness is a different
  failure from a corrupt header talking a reader into an allocation it cannot afford.
- Every fuzz read now runs under `maxMaterializeBytes`, and a read that succeeds must have stayed
  inside it. Exceeding it throws `EdfBudgetError`, which clause 1 already accepted as a legitimate
  refusal; the new half is that a decoder which allocated past the ceiling and handed the array
  back anyway would have satisfied every other clause in the file. Verified by lowering the
  ceiling below what the fixtures decode to and watching the violation report the byte count.

## 0.4.272

- **Executed** the offline claim instead of stating it. `tests/README.md` opens with
  "`git clone && npm test` is green and offline", which is a property of the suite and was
  enforced by nothing. `globalThis.fetch` is now replaced for the whole run, through
  `setupFiles`, with something that refuses and says to inject a `fetch` the way the `httpSource`
  tests do.
- That fallback is the route a test reaches the network by accident rather than on purpose:
  `httpSource()` uses `globalThis.fetch` when none is passed, which is right for a consumer in a
  browser, so forgetting the option used to send a real request and pass. It fails loudly now, at
  construction, where the length is resolved.
- The trap rejects rather than throwing synchronously, because a real `fetch` does not throw when
  a host is unreachable and a trap that behaved differently would send `httpSource` down an error
  path production never takes. `offline.test.ts` calls it and asserts it bites, since a setup file
  that failed to load would leave every test passing with nothing to show anything was guarded.

## 0.4.271

- **Added** the check the whole suite rests on: nothing in `tests/support/` takes a runtime import
  from `src/`. `tests/README.md` states it twice — "a reader and a writer that share a
  misunderstanding agree with each other and are wrong together" — and nothing enforced it.
  Ninety test files build their fixtures with that writer. Had it taken `EDF_HEADER_BLOCK_BYTES`
  from `src/constants.ts`, which looks exactly like sensible de-duplication and is one line, a
  wrong constant would have produced fixtures shaped to match the wrong reader and two thousand
  tests would have passed on a broken package, proving only that edfcore agrees with itself. That
  is the one failure a suite cannot see from the inside.
- Walked transitively, because independence one import deep is not independence — a helper
  importing both the writer and a `src/` constant would launder precisely what this forbids, and
  the check was verified against that shape as well as the direct one. `import type` is exempt on
  the same reasoning 0.4.256 used: `spy-source.ts` has to name the `ByteSource` it wraps, and
  naming a shape is not sharing an understanding of the bytes.

## 0.4.270

- **Added** a check that every file this repository names in a comment is a file that is there.
  Docblocks here point at each other constantly — `header/parse.ts` owns validation order,
  `tal/ticks.ts` owns the tick conversion — and 324 of those references are written as backticked
  paths that nothing reads. The `src/` half matters most: `removeComments: false` copies those
  docblocks into `dist/*.d.ts`, so a path that stopped existing ships to every consumer as hover
  text. Not hypothetical — `CHANGELOG.md` became `docs/CHANGELOG.md` at v0.4.1, and 0.4.264
  renamed a test file when its rule outgrew its name.
- **Reworded** two comments that named things which were never files: a hypothetical
  `guides/whatever.md` and the served route `api.json`, where the file is `api.json.ts`. Both
  would have needed an exemption, and an exemption for "paths that are not paths" is how a check
  stops meaning anything. `dist/` is the one that remains, because the build output is described
  in several places and committed in none.

## 0.4.269

- **Corrected** what `documented-examples.test-d.ts` claims to be. It opened by saying its five
  hand-written twins are the documented examples that get compiled, "deliberately small rather
  than derived" — true when it was written and not since 0.4.263, which compiles all 102 fenced
  blocks on the site in one pass. Leaving that sentence would be the defect this repository keeps
  finding: a file describing itself as the coverage after something else became the coverage.
- It still earns its place, for one fence and a reason worth stating. The sweep judges a block by
  compiling it alone, so a block that is a function body shown without its signature reports
  `TS1108` and gets set aside — the `edfErrorKind` switch on `api-errors.md` is written that way,
  and the hand-written twin is its only compilation. That is now asserted rather than described:
  the snippet must contain a bare `return` and no function signature, so rewriting it as a whole
  function fails here and prompts a reread of the division of labour instead of silently making
  half this file redundant.

## 0.4.268

- **Added** a check that every `npm run …` in the documentation is a script that exists.
  `AGENTS.md` opens with a Commands block, the README explains how to build the site, and
  `tests/README.md` covers `test:scratch` — none of it verified, and scripts here do move:
  `format` was rewritten in 0.4.225, `verify:package` added in 0.4.233, `lint` reshaped in
  0.4.210. A stale one is a bad first minute for a contributor, because `npm run` on a missing
  script prints an error and a list, which reads as a broken checkout rather than a stale page.
- `--prefix website` is followed rather than ignored. The two manifests have different scripts and
  `npm run build` means a different thing in each, so the prefix genuinely changes the answer —
  `dev` exists only in the site's.

## 0.4.267

- **Added** a check that the column table on the CLI page is the order `edfcore signals` emits.
  That command exists to be piped into `awk`, so its columns are a positional contract, and two
  places stated it: the table on `cli.md`, and `cli.test.ts`, which pinned it against a hard-coded
  array. Neither knew about the other, so a column inserted rather than appended could be made to
  pass by editing the test while the page went on describing the old layout to everyone parsing
  it. Not hypothetical: column 6 was appended in 0.2.42 precisely so nothing reading the first
  five by position would move, and before that the page claimed the command emitted samples per
  record where it emitted `kind`, with the authoritative field in no column at all.
- The expectation is read from the page, and the fixture gives every column a distinct value — a
  two-second record of fifty samples, so the rate is 25 and the count is 50 — because two columns
  holding the same number would let a transposition through.

## 0.4.266

- **Added** a check that every `npx edfcore …` written in the documentation is one the CLI
  accepts. The commands were checked two ways already and neither covered it: `api-surface.md`'s
  count is compared with `--help`, and `cli-command-list.test.ts` asserts `--help` offers exactly
  what the dispatch switch handles. Both compare the CLI with itself. The sixteen invocations
  spread across the README, the CLI page and the guides — the lines a reader actually copies into
  a terminal — were checked by nobody, and renaming a command is exactly the change that would
  leave both existing checks green while every page still named the old one.
- Driven through `runCli` rather than `parseArgs`, because an unknown command is not a parse
  error: `parseArgs` puts any non-flag word in the command slot quite happily, so checking the
  parser would have passed on `edfcore summary`. Exit code 2 is the documented contract for bad
  usage, and that is what this asserts against.

## 0.4.265

- **Added** the unit test `printable` never had. It is the smallest module in the package and its
  whole content is one rule — replace the C0 controls and DEL, leave everything else — and four
  test files mentioned it while testing something else. Nothing pinned which code points it acts
  on, in either direction: replacing too little lets a tab invent a column in the CLI's
  tab-separated output, and replacing too much mangles an electrode label written on a European
  system, where `0xB5` for micro is ordinary text.
- **Completed** the module's own argument for that rule. It justified leaving `0x80`-`0xFF` alone
  by pointing at ISO-8859-1 header decoding, which stops at `U+00FF` — and header text is not the
  only thing printed through it. Annotation text is UTF-8, so `U+2028 LINE SEPARATOR` really can
  arrive from a file and reach `edfcore events`. It passes through, which is right and now says
  why: no terminal and no HTML renderer breaks a line on it, so it is not structure in any output
  edfcore produces. The rule is about what the output treats as structure, not about what a
  language specification calls a line terminator.

## 0.4.264

- **Widened** the guard added in 0.4.239, which enforced the narrower half of its own rule. It
  forbade a test globbing a TypeScript file out of `website/` and said nothing about importing
  one, which reaches the same vite transform by the more obvious route — and the transform is what
  resolves `website/tsconfig.json` and its `astro/tsconfigs/strict`, which the CI `check` job
  never installs. Confirmed rather than assumed: `import { buildSampleEdf } from
  '../../website/src/scripts/sample-edf.js'` passes locally and dies with the same
  `[TSCONFIG_ERROR]` with `website/node_modules` moved aside, which is exactly how six versions
  were lost in 0.4.237. Static imports, re-exports and `import()` are all covered now, and the
  file is named for the boundary rather than for globs.
- Comments are stripped before the scan, the rule 0.4.232 arrived at for the same reason: this
  file's own docblock quotes the offending import to explain it, and the first run of the widened
  check reported itself.

## 0.4.263

- **Added** a sweep that compiles every self-contained example in the documentation, instead of
  the five somebody remembered to write a twin for. `documented-examples.test-d.ts` keeps a
  hand-written compiled copy per snippet, which is thorough and does not scale; the site has 102
  fenced blocks that import from `edfcore`. All of them are now extracted, pointed at `src/`, and
  compiled in one `tsc` under the flags this repository builds with. It costs about 1.5 seconds.
- **Fixed** the example it found on `discontinuous.md`, which passed `chunk.signals[0]` to
  `trimToWindow` — `EdfChunkSignal | undefined` under `noUncheckedIndexedAccess`, so
  `TS2345`. That is the fourth page with this defect and the last one; 0.4.260 through 0.4.262
  fixed the README, `reading-signals.md` and `annotations.md`.
- Fences that cannot stand alone are skipped, on two markers that both mean "part of something
  larger" rather than "wrong": `TS2304 Cannot find name`, for a block using a `recording` an
  earlier block declared, and `TS1108`, for a block that is a function body shown without its
  signature — which is how `api-errors.md` and `diagnostics.md` teach a handler. The number left
  standing alone is asserted to stay above twenty, so the exemption cannot quietly grow to cover
  everything.

## 0.4.262

- **Fixed** the worked example on `annotations.md` — read the sample under each sleep-stage event
  — which was the other complete program that failed to compile on nothing but an unnarrowed
  index. It ended `toPhysical(signal, chunk.signals[0].digital)`, and `chunk.signals[0]` is
  `T | undefined` under `noUncheckedIndexedAccess` even though the call asked for exactly one
  signal. It narrows with a `continue` now, which is the shape the loop around it already uses
  twice, and the numbered comment says the thing worth knowing: asking for one signal does not
  tell the compiler you got one.

  That closes both of the complete-but-unsound examples the 102-fence sweep in 0.4.261 turned up.
  The rest of the site's failures are fragments referencing a `recording` or a `header` declared
  in an earlier block on the same page, which is what a reference page is for.

## 0.4.261

- **Fixed** the opening example of `reading-signals.md`, which did not compile. It is the first
  complete program on the page a reader lands on from "how do I read a signal", and it had the
  same defect the README quick start had one release ago: `const [chunk] = await readWindow(...)`
  followed by `chunk.signals[0].digital`, which under `noUncheckedIndexedAccess` is `TS18048` and
  `TS2532`. Found by extracting every fenced example on the site that imports from `edfcore` and
  compiling all 102 of them; two were complete programs failing on nothing but this, and this was
  one. It also now says why the guard is there, because the reason is the same fact the page
  teaches: a window inside an EDF+D gap really does select nothing.
- Compiled it in `documented-examples.test-d.ts` alongside the other four, with the same
  narrowing check the README quick start got.

## 0.4.260

- **Fixed** the README's quick start, which did not compile. It is the first code most people run
  and it sits on the npm front page, and it ended `chunk.signals[0].digital` after destructuring
  `const [chunk] = await readWindow(...)`. Under `noUncheckedIndexedAccess` — on in this repo and
  in every strict TypeScript project — `chunk` is `EdfChunk | undefined` and so is `signals[0]`,
  so the last line was `TS18048` and `TS2532`. One guard fixes both, and it is the guard the
  reader needs anyway: a window that selects nothing returns no chunks, which is an ordinary
  answer rather than an error.
- **Added** it to `documented-examples.test-d.ts`, which has compiled three website snippets since
  0.3.46 and never the README's. That comparison runs one way — every line a page has must exist
  in the compiled copy — which catches a page gaining a line nothing compiles but not a page
  losing one, since the copy keeps its own guard either way. So the quick start also gets a direct
  check that the narrowing is still there, and the widening that lets the two texts be compared at
  all: runs of spaces collapse, because a page aligns a trailing `// Float64Array` by eye and
  Biome puts exactly one space before it.

## 0.4.259

- **Fixed** the snippet in `AGENTS.md` that does not compile. Its "Using edfcore in generated
  code" section exists to be copied verbatim into somebody's project, which makes it the
  highest-leverage code in the repository — and it ended `chunks[0].signals[0].digital`, which
  under `noUncheckedIndexedAccess` is two `error TS2532`s, because both index reads are
  `T | undefined`. That flag is on in this repo and in every strict TypeScript project, so the
  file agents are told to copy from was teaching a line the compiler rejects. It narrows now,
  which is what 0.4.208 settled on for this codebase over a `!`, and the two guards double as the
  lesson the list right below it already gives: `readWindow` returns an array, and an empty one is
  an ordinary answer.
- **Added** the compiled twin. `documented-examples.test-d.ts` has done this for three website
  snippets since 0.3.46 found two of them rejected the same way; the snippet an agent is likeliest
  to paste had no such guard. It runs both directions — the copy is real code `npm run typecheck`
  compiles, and the test reads the fenced block back out of `AGENTS.md` and fails if a line of it
  is missing here.

## 0.4.258

- **Added** a check on the `Next:` convention, which `AGENTS.md` states as an absolute — "every
  thrown message ends with a `Next:` clause naming what the caller should do" — and nothing
  enforced. All 151 messages keep it today; what was missing is that the 152nd would not have
  had to. The clause is the part that survives contact with a real user: "byte range [0, 512) is
  outside the 256-byte buffer" says what happened, and "Next: check that the header and these
  bytes came from the same file" says what it means.
- Both halves are covered, which took two passes. `EdfFormatError` is never thrown with `new` — it
  is built from a diagnostic by `fatalError`, `sink.fatal`, `scalingError` and `toFormatError` — so
  reading only `throw new` sees 90 messages and misses the 61 that carry the larger share of the
  contract. And finding where a `throw` ends cannot be done by balancing parentheses:
  `[${offset}, ${offset + length})` closes one, and the first version of this check reported the
  two messages using that interval notation as violations of a rule they keep.

## 0.4.257

- **Fixed** `AGENTS.md`'s description of the layering, which had been wrong about nearly every
  tier. It sketched six — "`bytes`/`text` → `diagnostics` → `header`/`decode`/`tal` → `time` →
  `io` → entry points" — where the declarations use eight, and grouped modules that are not
  together: `bytes` is layer 0 and `text` is layer 1, `header`, `decode` and `tal` are three
  different layers rather than one, and `io` spans two. 0.4.256 reasoned from that sentence to
  correct a module's layer, which is a good argument for the sentence being right. It is now a
  table of the eight, and says plainly that each module's own declaration is the source of truth
  rather than a second definition.
- **Added** a check that the summary names the layers that exist, and that the count in the
  sentence above it matches. Only the numbers are compared — a prose list of members is the
  inventory problem this project keeps deleting, and the declarations already answer membership.
  What a summary can still get wrong unnoticed is the shape: a tier added or removed in one place
  and not the other.

## 0.4.256

- **Corrected** `src/tal/ticks.ts` from layer 3 to layer 1, and started enforcing the direction
  the layers imply. `AGENTS.md` has always said a module may only import from a lower layer, and
  every module now declares its own — but nothing compared the two, and applying that comparison
  for the first time found two upward runtime imports, both real and both the same mistake:
  `header/parse.ts` and `header/lookup.ts` at layer 2 call `tal/ticks.ts`, which was labelled 3
  because it lives in `tal/`. It imports `constants.ts` and nothing else. A module's layer is its
  dependencies, not its folder, so the fix was the number and no code moved.
- **Exempted** `import type`, which is the architecture rather than a loophole: `src/types.ts`
  opens by saying it emits no runtime code so any layer may import it without creating a
  dependency edge. Without the exemption the check would report `types.ts` importing
  `diagnostics/codes.ts` — precisely the edge that does not exist. Level imports are allowed too;
  there are 28 of them inside layers 2, 3 and 7, so "only from a lower layer" is shorthand for
  "never from a higher one".

## 0.4.255

- **Gave four modules the layer declaration every other one has.** `AGENTS.md` states this
  project's single architectural rule — `bytes`/`text` → `diagnostics` → `header`/`decode`/`tal` →
  `time` → `io` → entry points, and a module may only import from a lower layer — and each file
  repeats its own position on the first line of its docblock. Forty-eight of fifty-two did.
  `cli.ts`, `cli-run.ts`, `diagnostics/summary.ts` and `format-report.ts` did not, so the one
  invariant the codebase has was stated everywhere except where someone had skipped it, and
  nothing noticed because nothing read the declarations. A missing one is now a failing test.
  `removeComments: false` ships these docblocks in `dist/*.d.ts`, so a layer is also what an
  editor shows on hover.

## 0.4.254

- **Wrote down** that the `archive/pre-squash-2026-08-16` branch cannot be deleted, in the "things
  that look like bugs and are not" list where someone tidying branches would meet it. It looks
  like leftover cruft. It is the only thing keeping 94 commits reachable: every version published
  on 2026-08-16 carries a signed npm provenance attestation naming the commit it was built from,
  `main` was squashed from 193 commits to 43 that day, and those SHAs live nowhere else. Deleting
  the branch lets GitHub collect them and turns every one of those "Source Commit" links on npm
  into a 404 — the attestations stay cryptographically valid, but the link breaks permanently and
  no force-push can restore it.

## 0.4.253

- **Fixed** three stale facts in `AGENTS.md`, which is the first file an agent working on this
  repository reads and the one nothing verified. It said the suite has "1906 tests" — it has
  2006, and a count in a file that is not the suite is a number with nothing keeping it honest, so
  it is gone rather than corrected. It described `npm run check` as "lint + typecheck + tests"
  when that script has run `build` between them since it was written, which matters because the
  build is what produces the `dist/` two tests load. And the `scripts/` row now says a release is
  one commit and needs `-m`, which changed in 0.4.246.
- **Extended** the committed-fixture check to `AGENTS.md`. It states the "six EDF/BDF files under
  `corpus/golden/`" claim that 0.4.241 started checking in the two READMEs, and was outside it.

## 0.4.252

- **Extended** the link check to the repository's own markdown. `README.md`, `AGENTS.md`,
  `tests/README.md`, `scripts/golden/README.md` and the changelog are read on GitHub rather than
  built by Astro, so the checks added in 0.4.236 and 0.4.240 never saw them — and they link at
  source files with ordinary relative paths, which is the form that breaks when a file moves. This
  repository has already moved one: the changelog was `CHANGELOG.md` until v0.4.1. Every relative
  target is now resolved against the working tree, and the file list is walked rather than named,
  so a new `.md` at the root is swept the day it lands. Nothing was broken today.

## 0.4.251

- **Added** a CLI reference page. The command line had no page of its own: the six commands, the
  flags, the tab-separated column order and the exit codes lived inside `api-helpers.md`, under a
  heading two thirds of the way down a page about plotting envelopes and joining chunks. That put
  the one part of edfcore you can use without writing any code where nothing pointed at it — no
  sidebar entry, no `llms.txt` line for an agent, and no URL to send anyone. It is now
  `/docs/cli`, and `api-helpers.md` keeps a pointer where the section was. Its own description no
  longer claims the CLI either; it lists the text formatters instead, which is what it actually
  covers.

## 0.4.250

- **Documented the last one.** `EdfAnnotationWindow` is what `filterAnnotationsByTime` takes, and
  `api-helpers.md` showed the object literal without naming the type or saying why it is not
  `WindowSelection`: there is no reading here and so no channel to name, which makes it the one
  window type in the package that never touches a `ByteSource`.
- **Emptied** `UNDOCUMENTED_TYPES`. It held fourteen exported types when 0.4.220 wrote it down,
  and six releases took them off — three formatter options, three selections, three envelope
  results, two BioSemi, two summary, and this one. The title of `docs-coverage.test.ts` has been
  qualified since 0.4.221 because it had to be; it is plain again. The empty set stays rather than
  being deleted: it is the seam a future exception would go in, and while it holds nothing the
  check above it is unconditional.

## 0.4.249

- **Added** documentation for the two diagnostic summary types, leaving one on the recorded
  undocumented list. `diagnostics.md` showed `summary.total`, `summary.worst` and `summary.byCode`
  field by field without naming `EdfDiagnosticSummary` or `EdfCodeCount`, which is exactly
  backwards for this call: its whole purpose is to be handed to a renderer, and writing that
  renderer means naming its parameter. Both now have a field table, including why `EdfCodeCount`
  carries a severity of its own — so ranking codes never has to reach back into the diagnostics
  array to find out whether the most frequent one is also the most serious, which it usually
  is not.

## 0.4.248

- **Added** documentation for the two BioSemi types, taking the recorded undocumented list from
  five to three. Every field of both was already explained on `api-helpers.md` — the bit table,
  the tick-versus-float rule, `precededByGap` — but neither `EdfTriggerEvent` nor `EdfStatusWord`
  was named, so the page taught the semantics and left you unable to write a function that takes
  one. Both now have a field table. It also surfaces `event.status`, which the prose had never
  mentioned: every trigger event carries the whole 24-bit word it was decoded from, so a rig that
  encodes something above the trigger field is readable without a second pass.

## 0.4.247

- **Added** documentation for the three envelope result types, taking the recorded undocumented
  list from eight to five. `readEnvelope` resolves to `EdfEnvelopeChunk[]` and every page showed
  `chunk.signals[0].min` without naming what `chunk` is, so anyone writing a plotting function
  that takes one had to read the `.d.ts`. `api-helpers.md` now gives `EdfEnvelopeChunk` and
  `EdfEnvelopeSignal` field tables, and says the thing that is easy to get wrong: `bucketCount` is
  buckets in the grid whether filled or not, `readEnvelope` clamps it to the densest signal's
  sample count and `readEnvelopeAtResolution` deliberately does not, and `counts` — not `min` and
  `max` — is what answers whether a bucket holds anything. `EdfPhysicalEnvelope` is named under
  physical units, with why it is a type of its own.

## 0.4.246

- **Changed** a release to be one commit instead of two. `scripts/release.mjs` refused a dirty
  tree, so every version cost the work commit plus a `Release vX` on top of it — the day that
  produced 0.4.150 through 0.4.244 put 193 commits on `main` for 94 versions. The precondition's
  stated reason was that a release must match a real commit, and that holds either way, because
  the script makes the commit itself; it still refuses to run with anything already committed but
  unpushed. Leave the work uncommitted, write the changelog entry, and pass `-m` with the subject
  line. A clean tree still releases the bump alone under `Release vX`.
- **Fixed** the failure path that would have made this dangerous. On a failed check the script
  restored the version files with `git checkout HEAD --`, which was right while the tree had to be
  clean and is destructive now that it holds the release: `package.json` is a file releases
  routinely change — 0.4.225 and 0.4.233 both edited its scripts — and checking it out of HEAD
  would have discarded that work silently, in the name of undoing a bump. The three files are
  captured in memory before the bump and written back from there.

## 0.4.245

- **Corrected** the note in `scripts/release.mjs` that tells you how to audit changelog headings
  against the tags. It says to compare `git show <tag>:docs/CHANGELOG.md`, which is how the 0.2.29
  and 0.2.36 drift was found, and that stopped being true for part of the history: 0.4.150 through
  0.4.244 were squashed into 43 commits, so 51 of those tags now share a commit with a later
  version and hand back that version's changelog. Tags before 0.4.150 are unaffected, and the
  original commits are on the `archive/pre-squash-2026-08-16` branch. The note says so, and says
  why the check itself is unaffected: it runs before the commit, so it never depended on the
  history being reconstructible afterwards.

## 0.4.244

- **Added** a wait for CI before the GitHub release is created, which is what stops a green local
  run from becoming a version that never reaches npm. `npm run check` runs on the machine cutting
  the tag, and that is not the same question as whether it passes: twice this week a check was
  green here and red on every runner — one read a file whose tsconfig lives in
  `website/node_modules`, which CI does not install, and one required the gitignored
  `tests/scratch/` to exist. Between them 0.4.231–0.4.236 and 0.4.241–0.4.242 were tagged and
  never published, eight numbers refused by `publish.yml` long after this script had exited 0.
  The script now polls the check runs for the exact commit it pushed and refuses to open the door
  to npm if any of them fails. That turns a silent hole into a stop with the tag intact and the
  version still recoverable by `gh release create` — the same recovery 0.4.226 wrote the message
  for. It gives up after twenty minutes and says so rather than hanging.

## 0.4.243

- **Fixed** the layout-table check added in 0.4.241, which compared `tests/README.md` against the
  filesystem and so required `tests/scratch/` to exist. That directory is gitignored — it holds
  throwaway reproductions, and committing one would pin whatever behaviour was current when it was
  written — so it is present on a machine that has chased a defect and absent from every fresh
  clone, which is every CI runner. The check passed locally and failed on all three matrix jobs.
  The table documents `scratch/` precisely *because* it can appear, so the rule is now: every
  directory present has a row, and every row names a directory that is present or listed as
  ignored in `.gitignore` — read from that file rather than named here.

  **0.4.241 and 0.4.242 were never released**, for the same reason and in the same way as
  0.4.231 through 0.4.236: tagged, and the publish run stopped at the failing check. Everything
  they carried is in this release. Both incidents share one cause — a check that passes on the
  machine cutting the tag and cannot pass on a runner — and this release was verified against it
  directly, with `tests/scratch/` and `website/node_modules` both moved aside first.

## 0.4.242

> **Never released.** This version was tagged and its publish run failed, so it is not on npm. Everything below shipped in `0.4.243`.

- **Fixed** the link checker's own hand-written inventory, six releases after it was added to
  catch exactly that. 0.4.236 listed the site's standalone routes — `/`, `/demo`, `/llms.txt` and
  the rest — as a literal set, so deleting a route would have left the list vouching for it, and
  the check meant to find dead links would have been the last thing claiming that one was alive.
  Nothing about the site is written down there now: the pages come from the collection, the
  standalone routes from the files under `pages/` and `public/`, and the redirects from
  `astro.config.mjs`. A route is a path with the framework extension removed and nothing else, so
  `llms.txt.ts` is `/llms.txt` — only the `.ts` comes off — and one assertion pins each shape the
  derivation has to get right.

## 0.4.241

> **Never released.** This version was tagged and its publish run failed, so it is not on npm. Everything below shipped in `0.4.243`.

- **Added** checks on `tests/README.md`, which described this suite with nothing checking that it
  still did. It is where the root README sends a contributor, and the fixture policy it states is
  the only reason six binary files are committed to a repository that otherwise builds every
  fixture in memory. Two of its claims were inventories — a table with one row per directory under
  `tests/`, and a count of the files under `corpus/golden/` stated four times across the two
  READMEs — and neither was derived, so a new directory would join the suite and not the table,
  and the number justifying those committed binaries could drift the way the site's page count did
  one release ago. Both are read from the tree now. The counts stay spelled out and are read
  through a word list: `tests/README.md` is prose someone reads start to finish, unlike the
  one-line parenthetical 0.4.238 turned into a numeral.

## 0.4.240

- **Extended** the link check added in 0.4.236 to the links that point back at this project by
  absolute URL — nine of them, seven `github.com/.../blob/main/<path>` or `tree/main/<path>` and
  two into `edfcore.vercel.app`. Those rot the same way a relative link does and are harder to
  notice, because they look external and nobody thinks of them as the project's own. This
  repository has already made the move that breaks them: the changelog was `CHANGELOG.md` until
  v0.4.1 and `docs/CHANGELOG.md` after, which `scripts/release.mjs` still has to explain when it
  tells you which spelling to use for which tag — and the README links to that file twice. A
  `blob/main` path is now checked against the working tree, a `vercel.app` URL resolves as an
  internal link, and the README's own `#roadmap` anchor is checked against its headings.

## 0.4.239

- **Added** the guard for what 0.4.237 fixed: no test may glob a TypeScript or `.astro` file out
  of `website/`. `?raw` returns bytes, but the path still goes through vite's transform, and the
  transform resolves that file's nearest tsconfig — which for anything under `website/` extends
  `astro/tsconfigs/strict` out of `website/node_modules`, a directory the CI `check` job never
  installs. That is a failure mode with no local symptom at all: the command passes on the machine
  cutting the release and dies on every runner, which is exactly how six versions came to be
  tagged and never published. Markdown stays allowed, because no JavaScript tooling reads a `.md`
  file's tsconfig. The scanner uses `readFileSync` rather than a glob, on the same reasoning one
  level up.

## 0.4.238

- **Fixed** the README undercounting the documentation site. It said "an Astro build with twenty
  pages" and the collection holds twenty-two — the same shape of defect as the API surface table
  two sections above it, which has been checked since 0.1.x. The number is now written as digits
  and read against the collection, because a number a test has to read should be written the way
  a test can read it.
- **Removed** the hand-written list of guides in the sentence after it, which named eight of the
  nine. The sidebar is generated from the pages, so it is the list; a paragraph that restates it
  is one more inventory to keep in step, and the site has now lost three of those in nine
  releases.

## 0.4.237

- **Fixed** `npm run check` failing on any machine without the website's dependencies installed,
  which is every CI runner. 0.4.231 added a check comparing the docs reader's glob pattern against
  the collection loader's, and read `website/src/content.config.ts` through `import.meta.glob`
  with `?raw`. A raw glob still hands the path to vite's transform, which resolves that file's
  nearest tsconfig — `website/tsconfig.json`, which extends `astro/tsconfigs/strict` out of
  `website/node_modules`. The CI `check` job installs the root workspace only, so the run died
  with `[TSCONFIG_ERROR] Failed to load tsconfig 'astro/tsconfigs/strict'` while the same command
  passed locally, where the site's dependencies happen to be present. Both files are read with
  `readFileSync` now: bytes, no transform, no tsconfig.

  **0.4.231 through 0.4.236 were never released.** Each was tagged and each publish run failed at
  the check above, so six numbers are holes on npm the way 0.2.29, 0.2.36, 0.2.59 and 0.4.176 are.
  Nothing is lost: every change they carried is in this release. The 0.4.200 revert cannot reach
  this case — the checks passed on the machine cutting the tag, and it was the *runner's*
  environment that differed, which is the gap 0.4.233 had just moved `publint` into CI to narrow
  from the other side.

## 0.4.236

> **Never released.** This version was tagged and its publish run failed, so it is not on npm. Everything below shipped in `0.4.237`.

- **Added** a check that every internal link on the site points at something that exists. The
  documentation pages carry over a hundred `/docs/...` and `#anchor` links between them and
  nothing checked one: `astro check` validates types and content collections, not hrefs, and a
  static build turns a link to a renamed page into a 404 for the reader rather than an error for
  the author. The 404 page exists because that happens — "the address may have moved when the docs
  were reorganised" — which is a good page to have and a poor substitute for not shipping the
  link. Anchors are the half that rots quietly, since one breaks when someone rewords a heading
  three sections away and the link still looks right; 0.4.234 nearly shipped exactly that, a table
  cell pointing at `#patient-identification` on a page whose redaction note has no heading. The
  nine links hard-coded in `.astro` routes are swept too — the 404's three ways out and the
  landing page's four are the ones a reader hits first. Nothing was broken today.

## 0.4.235

> **Never released.** This version was tagged and its publish run failed, so it is not on npm. Everything below shipped in `0.4.237`.

- **Added** documentation for the three selection types, taking the recorded undocumented list
  from eleven to eight. `StreamSelection`, `EnvelopeSelection` and `TriggerSelection` are what
  `streamRecords`, `readEnvelope` and `readTriggers` take, and every page showed an object literal
  without ever naming the type — so a wrapper that accepts one had nothing to import.
  `api-types.md` lists all three in the selections table and `api-helpers.md` names each in the
  section that teaches its call, including the fact that the first two are a `WindowSelection`
  plus one field.
- **Fixed** the sentence under that table, which said `signalIndices` is required "on both
  selections". There are five now, and `TriggerSelection` is the one with no channel field at all
  — `readTriggers` finds the BioSemi Status signal itself, because a 24-bit EEG sample decoded as
  a trigger word yields plausible events out of ordinary data.

## 0.4.234

> **Never released.** This version was tagged and its publish run failed, so it is not on npm. Everything below shipped in `0.4.237`.

- **Added** documentation for the three formatter options types, and took them off the recorded
  list of undocumented ones. `FormatHeaderOptions`, `FormatAnnotationsOptions` and
  `FormatReportOptions` are exported and every field of each was described somewhere in prose, but
  none of the three was named on a page — so writing a wrapper that accepts one, or building an
  options object ahead of the call, meant reading the `.d.ts`. `api-helpers.md` now gives each a
  field table with its default, and says why `includePatientId` defaults off while
  `diagnosticsHint` defaults on: the cost of forgetting the first is a person's name in an issue
  tracker, and the cost of forgetting the second is one redundant line. `UNDOCUMENTED_TYPES` is
  down from fourteen to eleven, which is the direction 0.4.220 built it to move in.

## 0.4.233

> **Never released.** This version was tagged and its publish run failed, so it is not on npm. Everything below shipped in `0.4.237`.

- **Changed** the packaging checks to run on every push instead of only at publish time.
  `publint --strict` and `@arethetypeswrong/cli` are the two things `npm run check` cannot do —
  they read the manifest against the files npm would actually pack, and resolve each subpath the
  way a consumer's TypeScript would — and they lived in `publish.yml`, which runs after the tag is
  pushed. That is the one window `scripts/release.mjs` cannot undo, so a packaging mistake found
  there could only be fixed by cutting another version. CI now has a `package` job, and both
  workflows call the same `npm run verify:package` so the two cannot drift. It stays out of
  `npm run check`: that one downloads nothing, and `git clone && npm test` being green offline is
  a property worth keeping.

## 0.4.232

> **Never released.** This version was tagged and its publish run failed, so it is not on npm. Everything below shipped in `0.4.237`.

- **Fixed** the site's version sweep reading only `.astro` files. `website/src/pages/` also holds
  seven `.ts` routes, and they emit prose exactly the way a component does: `llms.txt` is the map
  an agent is handed, `[...slug].md.ts` is the markdown twin of every documentation page, and
  `robots.txt` and `api.json` are served verbatim. A stale version in one of those reaches a
  reader the same way the footer's "MIT licensed. Version 0.1.0." did for three minor series.
  Widening it needed one more thing first: comments are now stripped before the scan, because
  `api.json.ts` quotes that footer defect as the reason it counts the surface rather than stating
  it, and a whole-file match finds the quotation rather than a claim. What a file emits is the
  claim; what it says about the past is history. HTML comments are left in — those ship.

## 0.4.231

> **Never released.** This version was tagged and its publish run failed, so it is not on npm. Everything below shipped in `0.4.237`.

- **Fixed** four documentation sweeps reading a narrower set of pages than the site publishes.
  `docs-coverage.test.ts`, `diagnostic-docs.test.ts` and `readme-status.test.ts` — the last of
  them twice — each wrote its own reader, three globbing `content/docs/*.md` and one calling
  `readdirSync(...).filter(name => name.endsWith('.md'))`. The collection loads
  `**/*.{md,mdx}` and `astro.config.mjs` registers the MDX integration, so a page in a
  subdirectory or written as `.mdx` was published and unswept. It fails in the unhelpful
  direction too: a name documented only on an unseen page reports as undocumented, and a type on
  the recorded `UNDOCUMENTED_TYPES` list stays there after the page documenting it is written.
  All four now read `tests/support/docs-pages.ts`, and a new check compares that reader's glob
  call against the loader's pattern, so narrowing either side fails rather than going quiet.

## 0.4.230

- **Added** a check on the three packaging promises in the README's compatibility list — zero
  runtime dependencies, three entry points with no environment conditions in the exports map, and
  ESM only. What the package *contains* is well covered: `api-surface.test.ts` counts the exports
  and `public-api.test.ts` walks the module graph. Nothing read the manifest that says how it is
  shipped. Adding a dependency is one `npm install --save` away and the tree stays green — nothing
  imports it, so no test fails, and "zero-dependency" stops being true in the one place a reader
  looks before installing. An environment condition next to `default` is the same shape of edit.
  Every export and `bin` target is also checked to exist in the build; `publint` and
  `@arethetypeswrong/cli` cover a stronger version of that, but they run in `publish.yml` only —
  after the tag is pushed, in the window 0.4.226 is about.

## 0.4.229

- **Added** a check that the Node floor is one number. It is written down eleven times — the
  README's compatibility line, four statements on `installation.md`, two on
  `design-decisions.md`, the `llms.txt` summary handed to agents, and the docblocks in
  `src/index.ts` and `src/cli.ts`, which `removeComments: false` ships verbatim into `dist/*.d.ts`
  as an editor's hover text — and one of the eleven is not prose. The CI matrix's lowest entry is
  the version the suite is actually proven against, while `engines.node` is the version consumers
  are told to have; raising one without the other gives either a package that installs where it
  was never run, or a matrix job on a version nobody may use, and nothing said which. All of them
  are now read against `engines.node`. The scan recognises a requirement and deliberately not
  `Node v24.4.0`, which is the shape `src/bytes/latin1.ts` uses for "the runtime this was verified
  on" — the `v` is what separates a version someone ran from one someone requires.

## 0.4.228

- **Added** a test that actually runs `require()` of the built package from CommonJS. That it
  works is the claim the Node floor rests on, stated five times — the README's compatibility
  list, `installation.md`, `design-decisions.md`, the docblock in `src/index.ts`, and the comment
  pinning 22.12 in the CI matrix — and nothing ran it. Nothing else in the suite could: the whole
  repository is ESM under vitest, where a top-level `await` is ordinary and the condition that
  breaks `require()` is invisible from inside. A child process now requires each of `dist/`'s
  three entry points from a CommonJS realm, which makes Node itself the oracle — a graph with a
  top-level `await` anywhere in it throws `ERR_REQUIRE_ASYNC_MODULE`, with no heuristic to agree
  with the same mistake a reader of the source would. A negative control in the same run proves
  the harness can fail.

## 0.4.227

- **Fixed** `npm run lint` not seeing any JavaScript in the repository. Biome's `files.includes`
  listed `**/*.ts`, `**/*.json` and `**/*.jsonc`, and `includes` is a filter rather than an
  addition — so `scripts/release.mjs`, `scripts/fetch-corpus.mjs`, `tests/support/browser-realm.mjs`
  and `website/astro.config.mjs` were excluded outright, and asking Biome to check one by name
  answered "these paths were provided but ignored". Three of the four were in a state lint would
  have rejected: `fetch-corpus.mjs` had an unsorted import block, which is the `organizeImports`
  error 0.4.225 was about. The release script has been edited in three of the last thirty releases
  with no formatter or linter over it at all.

## 0.4.226

- **Added** a recovery message for the one release step the 0.4.200 revert cannot reach. By the
  time `gh release create` runs, the bump is committed and the tag is pushed, so there is nothing
  local to undo — and `publish.yml` triggers on a PUBLISHED release rather than on a tag, so a
  failure there leaves a version that exists in git and never reaches npm. Nothing in the
  repository would notice: `changelog-continuity.test.ts` checks this file against itself, and the
  entry would be present and correct. The script now says how to finish the release, and warns that
  re-running it would cut the next version and leave this one a hole.

## 0.4.225

- **Fixed** `npm run format` being unable to produce a tree `npm run lint` accepts. `format` was
  `biome format --write`, which reformats but does not run Biome's assists; `lint` is `biome check`,
  which reports `organizeImports` as an error. So an unsorted import block was a failure that the
  repository's own formatter reported nothing about and could not repair — running format, seeing
  "no fixes applied", and then failing lint on the same file. It now runs the assists too, with the
  linter disabled so that formatting stays formatting and lint findings are still fixed on purpose
  rather than by a command named `format`.

## 0.4.224

- **Changed** the barrel type parser to live once, in `tests/support/barrel-types.ts`, instead of
  twice. The second copy was written in 0.4.220 by reading the first, which is how it inherited a
  blind spot that had been there since the first commit — and 0.4.222 and 0.4.223 then fixed the
  same line in two files, three releases apart. Two copies of a rule are two chances to hold a
  different one; the rule that a type is public because it leaves the barrel now has one home.

## 0.4.223

- **Fixed** the same blind spot in the type parser added by 0.4.220. It read only
  `export type { … } from` blocks, so `FileHandleLike` was outside the documentation check as well
  as outside the count 0.4.222 corrected. Nothing was actually undocumented — that type is
  described on `api-sources.md` — but it was exempt by accident rather than by the recorded list,
  which is the state the list exists to prevent. Both parsers now read both shapes and see 65.

## 0.4.222

- **Fixed** the README's public-type count, which said 64 and should say 65, and the guard that was
  supposed to keep it honest. `api-surface.test.ts` read type names only out of `export type { … }
  from` blocks, so it never saw `FileHandleLike` — `node.ts` declares that one and exports it in
  place. It has been exported since 01132e1, the first commit, so the table has undercounted for
  the life of the package while a test asserted it was right. The parser now counts a type because
  it leaves the barrel, not because of which syntax it left by.

## 0.4.221

- **Corrected** the title of `docs-coverage.test.ts` now that 0.4.220 gave it a list of exceptions.
  "Every exported symbol is documented somewhere" was true of what it checked before and is not
  true of what it checks now — fourteen types are exempted by name. Leaving it would have been the
  defect this file exists to catch, one level up: a claim of total coverage standing over a check
  that does not have it.

## 0.4.220

- **Added** the missing half of `docs-coverage.test.ts`. Its title is "Every exported symbol is
  documented somewhere", but it enumerates `Object.keys` of the barrels — runtime values only,
  since a type has nothing to enumerate — and the comment where the other half should have been
  claimed "types are documented under their own names too". Fourteen are not:
  `EdfAnnotationWindow`, `EdfCodeCount`, `EdfDiagnosticSummary`, `EdfEnvelopeChunk`,
  `EdfEnvelopeSignal`, `EdfPhysicalEnvelope`, `EdfStatusWord`, `EdfTriggerEvent`,
  `EnvelopeSelection`, `FormatAnnotationsOptions`, `FormatHeaderOptions`, `FormatReportOptions`,
  `StreamSelection` and `TriggerSelection` appear on no page. Type names now come from the
  `export type { … }` blocks, the fourteen are recorded as named debt so a fifteenth fails, and
  documenting one fails a second check until it is struck off — so the list shrinks rather than
  outliving the gap. **Fixing the fourteen is a documentation job, not this release.**

## 0.4.219

- **Added** the same check to `corpus-parity.test.ts`, and deliberately did not gate it on the
  corpus being present. Every other test in that file skips without `npm run corpus:fetch`, and CI
  never fetches, so a gated version would have been the one check there that runs nowhere. The
  goldens are committed, which is all it needs — and on a file whose normal state is "skipped", a
  golden nothing compares against is especially hard to see.

## 0.4.218

- **Added** the same check to `mne-parity.test.ts`: a case for every committed `.mne.json`. This
  file is the only thing that reads them, so a golden `generate-mne.py` produced and no entry names
  would be compared by nothing and noticed by nothing — the second-reader evidence the file exists
  to provide, silently absent.

## 0.4.217

- **Added** a check that `golden-values.test.ts` has a case for every committed golden that carries
  samples. The list stays hand-written — each entry says why that file exists, which a directory
  listing cannot — but it could fall behind `scripts/golden/generate.py`, and a golden generated
  and committed with no entry is a pyEDFlib reference value nothing compares against. That is
  indistinguishable from coverage until someone opens the directory.

## 0.4.216

- **Changed** `diagnostic-docs.test.ts` to import `EdfDiagnosticDisposition` instead of declaring
  its own identical union. It was the fifth copy of those four names and the one the compiler
  trusted: every `as Disposition` in the file would have gone on compiling against a union that no
  longer matched `codes.ts`, which is the opposite of what a cast is for. `SECTIONS` is now checked
  against the real union — a heading with a disposition that does not exist is a type error naming
  it, rather than a cast that quietly succeeds.

## 0.4.215

- **Changed** the two severity patterns in `diagnostic-docs.test.ts` to come from the `EdfSeverity`
  union rather than spelling out `error|warning|info`. They select the sample `formatDiagnostics`
  lines in the pages that get checked against the code, so a fourth severity would have meant every
  example using it was simply not looked at. Preventive rather than a fix: unlike the disposition
  list in 0.4.214 there is no second inventory for severity to fall out of step with, so nothing is
  wrong today and no canary demonstrates otherwise.

## 0.4.214

- **Fixed** two hand-written copies of the disposition list in `diagnostic-docs.test.ts`. One was
  the regex that decides which rows of `DISPOSITIONS` the file can see at all, so a fifth
  disposition would have matched nothing, its codes would never have entered the map, and "every
  code is documented" would have passed without having heard of them — invisible to the guard
  rather than merely undocumented. The other was `SECTIONS`, which drives the per-disposition
  checks. Both now come from the `EdfDiagnosticDisposition` union, and a new disposition without a
  documented section is now a failure that names it.

## 0.4.213

- **Fixed** the guard added in 0.4.205, which was the shape of the defect it catches. It compared
  the section list in three consumer files against the schema — and named those three by hand, so a
  fourth file writing the list out again would not have been one of them and the run would have
  stayed green while the new copy drifted. It now finds every file under `website/src` that
  declares `SECTIONS`. This is the third guard in three batches that turned out narrower than the
  claim it guards.

## 0.4.212

- **Added** the guard for 0.4.211, and the counterpart to 0.4.210 on the other side of the repo:
  `npm --prefix website run check` now passes `--minimumFailingSeverity hint`, so the site's type
  check fails on a hint instead of printing one and exiting 0. That is how the JSON-LD hint rode
  along in CI for as long as it did. Both halves of the repository now fail on the quietest thing
  their checkers can say.

## 0.4.211

- **Added** `is:inline` to the JSON-LD block in `Base.astro`, clearing the one hint `astro check`
  has been printing. Without it the tag goes through Astro's script processing, which is for code
  it is asked to bundle rather than for a literal payload that must reach the page exactly as
  written — and this one is hand-escaped, so passing it through anything is the wrong default.
  `astro check` now reports 0 errors, 0 warnings and 0 hints; the built `index.html` carries the
  same graph it did before.

## 0.4.210

- **Added** the guard for 0.4.208 and 0.4.209: `npm run lint` now passes `--error-on-warnings`, so
  a warning fails the run instead of printing under it. Both diagnostics cleared in those releases
  had been reported by every `npm run check` and every CI job without failing either, which is why
  they lasted. This only became possible once the output was empty, and it is what stops it filling
  up again.

## 0.4.209

- **Changed** the `signals` row to a template literal, clearing the last standing lint diagnostic.
  `biome check` now reports nothing at all, so the next warning this repository earns will be the
  only thing in the output instead of the third line of it. The row is byte-for-byte what it was —
  `hostile-text.test.ts` still pins six tab-separated fields.

## 0.4.208

- **Fixed** the one lint warning the repository has been carrying: a non-null assertion on
  `recordOnsetTicks[0]` in `annotation-timebase.test.ts`. `noUncheckedIndexedAccess` is on, so the
  index really can be `undefined`, and `!` turned an empty result into arithmetic on `undefined`
  rather than a failure naming itself. It now narrows and throws. `biome check` reports warnings
  without failing, so this sat in every run — and a run that always prints a warning is a run where
  the next one goes unread.

## 0.4.207

- **Changed** the `--patient` scope guard to derive the commands it probes. Its note says the scope
  is "DERIVED from behaviour rather than written down twice", and the scope was — but the list of
  commands to try it on was spelled out, and again as a regex alternation on the next line. A
  seventh command would have been probed by neither, so the banner could omit it and the guard
  would still pass. Both now come from the usage banner itself.

## 0.4.206

- **Added** a guard that `--help` offers exactly the commands the CLI will dispatch. `cli-run.ts`
  writes the list twice — as prose in `USAGE`, and as the `COMMANDS` set that refuses a word before
  the file is opened — and the two fail in opposite directions: one way a command works and is
  undocumented, the other it is advertised and then rejected as unrecognised. `api-surface.test.ts`
  compares the *number* of commands in `--help` to the README, so six of one and six of the other
  passed while naming different things.

## 0.4.205

- **Added** a guard that the four copies of the documentation section list agree. The `z.enum` in
  `content.config.ts` is written out again in `DocsNav.astro`, `llms.txt.ts` and `llms-full.txt.ts`,
  and each groups pages by walking its own array — so a name in the enum and not in an array is a
  section whose pages render at their URL and appear in no index, missing from the sidebar and from
  both files agents read. DocsNav's docblock says a fifth section "fails the build rather than going
  missing from the sidebar", which held only while four hand-written lists happened to match, and
  adding to the enum is the very edit that breaks it. `astro check` sees four well-typed arrays.

## 0.4.204

- **Corrected** the reason `publish.yml` pins npm. The step said trusted publishing needs
  >= 11.5.1, which was true when f363feb added it on 2026-08-01 — but ed89f67 moved the workflow
  to a granular access token two days later, and the note further down the same file now explains
  that registering trusted publishing returns 400 for this package. One comment justified the step
  by a mechanism another said was unavailable. The pin still earns its place; the reason is now
  the one that applies.

## 0.4.203

- **Corrected** the docblock of `changelog-continuity.test.ts`, which had gone stale twice over. It
  described a consumed number in the present tense, which 0.4.200 ended; and it quoted
  `scripts/release.mjs` verbatim — "the way 0.2.29, 0.2.36 and 0.2.59 are" — a sentence 0.4.197
  and 0.4.202 have both since rewritten. A quotation is the one kind of reference that cannot
  survive edits to its source, so it is now a paraphrase that stays true.

## 0.4.202

- **Corrected** the two places in `scripts/release.mjs` that still describe a consumed number as
  something that happens. 0.4.200 stopped it, and left its own file saying a failed run "consumes"
  the number in the present tense — once in the note above the heading check and once in the error
  that check prints. The note now says what that check still earns: a heading typed wrong by hand,
  and a run that dies after the commit exists, neither of which the revert reaches.

## 0.4.201

- **Fixed** the half of 0.4.200 it left out. The lockfile sync runs after the bump and before the
  checks, so it sat outside the `try` that puts the version back — and it is the step most likely
  to fail for a reason unrelated to the code, since it reaches the registry. A failed `npm install
  --package-lock-only` would still have consumed the number.

## 0.4.200

- **Fixed** `scripts/release.mjs` consuming a version number when its own checks fail. The bump is
  written before lint, typecheck, tests and build run, so a run that stopped there left the higher
  version on disk and the next run produced the one after it. Four numbers have been lost that way
  — 0.2.29, 0.2.36, 0.2.59 and 0.4.176 — and each cost an entry in this file explaining a hole
  instead of a release. The checks now run inside a `try`, and a failure puts the three version
  files back before exiting, so the number stays free for the run that fixes the problem.

## 0.4.199

- **Corrected** the title of `documented-examples.test-d.ts`, which read "The documented examples
  in the docs compile". Three do. The three pages it covers carry 55 `ts` fences, and each covered
  example needs a compiled twin written by hand, so the set is small on purpose — but a maintainer
  reading the title would think a new snippet was already checked.

## 0.4.198

- **Corrected** the list of budget readers in `src/options.ts`. It named six modules; eight read
  `maxMaterializeBytes`. `biosemi.ts` and `io/cached.ts` were missing, and neither is drift — both
  already read it when 905810c, whose subject is "Name the six modules that read the budget", was
  written. They read the raw option and hand it on rather than resolving it, so the six are now
  named as the resolvers and the two as what they are.

## 0.4.197

- **Corrected** the consumed-version count in `scripts/release.mjs`, which had drifted in the file
  written to stop exactly this. Its note said the failure "has happened twice" and named two; the
  error message it prints named three. It has happened four times, and 0.4.176 was in neither list —
  so the guidance handed to the next person to lose a number omitted the most recent one to be lost.

## 0.4.196

- **Added** the guard for 0.4.194: the changelog's version headings must descend without repeating
  and skip no number, so a run that consumes one has to be written down rather than leaving a hole
  a reader cannot interpret. Checked against the file alone, not `git tag` — CI checks out at depth
  1 and fetches no tags, so a tag-based version would find none and pass while asserting nothing.
  Removing the 0.2.29 entry fails it with `0.2.28 -> 0.2.30`.

## 0.4.195

- **Recorded** why `v0.1.1` has no tag, the last unexplained hole in the version history. It is not
  a consumed number like 0.2.29: it shipped to npm and is installable. It predates
  `scripts/release.mjs` by hours — the bump rode inside an ordinary commit, the publish was done by
  hand, and 0.1.2 fifty minutes later was the first release the script cut. Every other version in
  this file is either tagged or says it was never released.

## 0.4.194

- **Added** the missing `0.2.29` entry. Four numbers have been consumed by a release that failed
  after bumping, and three say so in this file. 0.2.29 said nothing — while the 0.2.36 entry cites
  it as the precedent for its own, and `scripts/release.mjs` tells the next person to record a skip
  "the way 0.2.29, 0.2.36 and 0.2.59 are". Both pointed at the one that was not. Reconstructed from
  7ea90ff, which carries the 0.2.28 → 0.2.29 bump alongside the lint fix that run died on.

## 0.4.193

- **Added** the guard for 0.4.191 and 0.4.192: both corpus sizes in `tests/README.md` are now
  measured against the manifest and the `corpus/golden/` directory. Each had gone stale by more
  than 30% because a file joined a set and the sentence describing it did not, and neither was
  checkable by reading the sentence. The tolerance is 10%, so a hedged "~" survives a fixture
  gaining bytes and fails when the set changes.

## 0.4.192

- **Corrected** the size of the committed parity fixtures, the other stale number in
  `tests/README.md`. "About 1.4 MB with their goldens" was exact at aa476d6 — 1,467,462 bytes over
  21 files — and two goldens added since put the directory at 2,168,993. The file count it sits
  next to, six, is still right; only the weight moved.

## 0.4.191

- **Corrected** the download size on `npm run corpus:fetch`. `tests/README.md` said ~59 MB, which
  was exact for the five files in the manifest when it was written on 2026-08-01. CHB-MIT arrived
  six days later and nearly doubled it; the manifest now totals 101,665,332 bytes across seven
  files. Someone deciding whether to run the fetch on a metered connection was off by 42 MB.

## 0.4.190

- **Widened** the docs-coverage guard to derive what `./validate` and `./node` export instead of
  hand-listing it. It named five symbols, so it covered those two subpaths as they stood the day it
  was written and nothing added afterwards — while the universal barrel beside it has been read from
  `Object.keys` all along. Checked by adding an undocumented export to `src/validate.ts`: the list
  passed it, the derived set names it.

## 0.4.189

- **Corrected** a pointer in `clock()` that sent the reader the wrong way. It cited "the paragraph
  below" for why a negative onset is the unusual half of the range; that paragraph is the module
  note at the top of the file, and nothing below the comment discusses it. It now names the note by
  position instead of by direction, which is what rotted.

## 0.4.188

- **Corrected** the `readWindow` docblock, which told the reader the sentence above it "said could
  not happen" about something that sentence no longer says. It did before 5f88404: the array
  "always has one element" on a continuous file. That commit both fixed the sentence and added the
  clause pointing back at it, so the accusation was false in the commit that shipped it. It now
  gives the reason the qualifier is there instead.

## 0.4.187

- **Corrected** the `FormatHeaderOptions` docblock, which opened "There is one, and it is opt-IN".
  0.4.174 added a second option and left the sentence behind, so the interface listed two fields
  directly under a summary that counted one — and `diagnosticsHint` is opt-OUT, the opposite of
  what that summary promises about the options as a group.

## 0.4.186

- **Documented** which errors already carry their diagnostic code. A diagnostic-backed
  `EdfFormatError` is written `[CODE] what happened`, while `EdfDiagnostic.message` is not —
  `formatDiagnostics` renders the code from the field beside it. Nothing said so, which is how the
  inspector on this site came to print `SOURCE_TOO_SMALL: [SOURCE_TOO_SMALL] ...` until 0.4.185.
  Any caller prefixing `error.code` before displaying one would have hit the same thing.

## 0.4.185

- **Fixed** the inspector printing a diagnostic code twice. Every diagnostic-backed error edfcore
  throws is written `[CODE] what happened`, and the demo page prefixed the code again, so a visitor
  opening a file that will not read saw `SOURCE_TOO_SMALL: [SOURCE_TOO_SMALL] the header is 4
  bytes`. It now prefixes only when the message does not already carry the code.

## 0.4.184

- **Added** the guard for 0.4.183: `header --limit 2` on a file with six defects must say how to
  see the rest, and an uncapped run must not - a hint under a complete list reads as a missing page.

## 0.4.183

- **Added** the missing next step to a truncated diagnostics block. `edfcore header` and
  `edfcore validate` ended with a bare `... and 11 more` and left the reader there, while
  `events --list` two commands over already said how to see the rest. The notice itself belongs to
  `formatDiagnostics`, where it is right as it stands - a library caller raises `maxItems`, not
  `--limit` - so the CLI adds the line it alone can write, and only when something was withheld.

## 0.4.182

- **Corrected** `tests/README.md` saying the published package "ships only `dist`, `src` and the
  changelog". That is the `files` list; npm adds `README.md`, `LICENSE` and `package.json` on its
  own, so a reader checking the tarball against the sentence would find three files it says are not
  there. The point it was making - that no test fixture ships - is now stated directly.

## 0.4.181

- **Fixed** `edfcore events --list --limit 0` printing two blank lines and a withheld-count notice
  hanging under the total. The blank line separates the notice from the rows above it, so it now
  appears only when there are rows.

## 0.4.180

- **Corrected** the same `--limit` scope on `api-helpers.md`, the other half of 0.4.179, and said
  outright that the counted `events` output is never capped.

## 0.4.179

- **Corrected** the `--limit` scope in `edfcore --help`. It said "(header, validate, events)", but
  the counted `events` output ignores it entirely; only `events --list` is capped. 0.3.124 added the
  scopes and this one was a command too broad.

## 0.4.178

- **Fixed** `edfcore <command> <directory>` reporting a raw `EISDIR: illegal operation on a
  directory, read` — an errno carrying no path and no next step. `fileSource` was fixed for this in
  0.3.98, but the CLI reads the file itself rather than going through that adapter, so it never got
  the fix. `ENOENT` is left as Node writes it, since that text already names the path.

## 0.4.177

- **Added** a test that runs the CLI as a process with its output piped into `head`. Every other
  CLI test drives `runCli` through an injected `CliIo`, which is why they need no build - and why
  nothing covered `cli.ts`, where the EPIPE crash 0.4.175 fixed actually lived. It skips when
  `dist/cli.js` is absent rather than passing on a binary it never ran.

## 0.4.176

Never released. `npm run check` failed on formatting in the new test file, and the release run had
already bumped the version by the time it stopped, which consumed the number before a tag was cut.
The pipe test that carried this heading shipped in `0.4.177`.

## 0.4.175

- **Fixed** the CLI crashing when its output is piped into something that stops reading.
  `edfcore signals big.edf | head -1` closed stdout mid-write; nothing listened for `error` on the
  stream, so Node rethrew EPIPE as an uncaught exception and printed a kilobyte of stack trace to
  stderr. `head`, `less`, `grep -m1` and a `jq` that exits early all do this, and `signals` is
  documented "for grep and awk". A closed pipe is now swallowed: the consumer got what it asked for
  and is entitled to stop listening. Every other stdout error still throws.

## 0.4.174

- **Added** `FormatHeaderOptions.diagnosticsHint`, and turned it off in `edfcore header`. That
  command printed "Call formatDiagnostics(header.diagnostics) for the detail" and then printed the
  detail two lines below it, so a reader looking at the answer was told to call a JavaScript
  function to get it. Library callers, who hold a header and no detail, still get the hint.

## 0.4.173

- **Added** `website/design/`, holding the share card's SVG source and the two commands that
  regenerate the PNG. 0.4.172 committed a binary nobody could edit; the source now sits beside a
  README whose commands were verified to reproduce the shipped file byte for byte. The directory is
  not served, so the site still ships one image.

## 0.4.172

- **Redrew** the share card, which listed three of the four formats the reader supports, and
  updated its alt text to match. That image is the most-seen artifact the project has — every link
  preview in a chat window renders it — and it was underselling BDF+.

## 0.4.171

- **Added** BDF+ back to the landing page's opening sentence. The sentence was taken from the
  repository's own one-line description, which lists three formats; the library reads four, and the
  footer of the same page said so, so the page contradicted itself in two paragraphs.

## 0.4.170

- **Corrected** the same attribution in the hero figure's caption, which is the text a screen
  reader announces: "encoded and decoded the way edfcore reads them" became a statement about the
  EDF format, which is what the canvas actually demonstrates.

## 0.4.169

- **Corrected** the `TraceStrip` docblock, which said the hero trace is "the output of the thing
  being sold, not a drawing of one". The EDF round-trip on that canvas is written out in the
  component; edfcore is not imported and does not run on the landing page. The round-trip is real,
  the attribution was not.

## 0.4.168

- **Removed** the `secondsToTicks()` prefix from the non-finite-seconds refusal. That helper is
  internal — it is not exported from any entry point, so no caller can have called it — and nine
  modules reach it, including the `readWindow` and `readEnvelope` paths. Passing `NaN` as a window
  bound reported a function name that appears nowhere in the public API.

## 0.4.167

- **Extended** the message-names-its-caller guard to `readWindow`, and widened the pattern it
  matches. It required a colon (`someFunction():`), so it passed for `resolveTimeWindow() cannot
  ...` — the guard written for this class could not see the instance 0.4.164 fixed. It is now
  anchored to the start of the message and accepts either punctuation. Mid-sentence mentions are
  still allowed: naming the function a caller should reach for next is advice, not
  self-identification.

## 0.4.166

- **Updated** `concepts.md`, the second and last page quoting the old prefix. No copy of the
  retired wording is left in the repo.

## 0.4.165

- **Updated** `discontinuous.md`, which quoted the probed-index refusal with the function-name
  prefix 0.4.164 removed.

## 0.4.164

- **Removed** the `resolveTimeWindow()` prefix from the probed-index refusal. Five entry points
  reach that helper — `readWindow`, `readEnvelope`, `readEnvelopeAtResolution`, `streamRecords`
  and `readTriggers` — so a caller of any of them was told about a function they never wrote. Same
  rule as 0.3.132-0.4.x; this was the last shared helper still naming itself.

## 0.4.163

- **Fixed** an ungrammatical sentence in the `DocsNav` docblock ("which the collection schema is
  what prevents") and named the mechanism it was reaching for: `section` is a `z.enum` over the
  same four values, so an unlisted one fails the build.

## 0.4.162

- **Rewrote** the JSON-LD comment added in the SEO pass. It argued the escape was unnecessary while
  the line below it performed one, and the sentence did not parse. It now says what the escape does
  and why it is there.

## 0.4.161

- **Fixed** `tests/README.md` contradicting itself five lines apart: its opening says six fixtures
  are committed on purpose, and the section below it said "every" file the suite uses is built in
  memory.

## 0.4.160

- **Fixed** the README saying `tests/README.md` covers "why no binaries are committed". Six small
  EDF/BDF files under `tests/corpus/golden/` are committed on purpose, and that page says so in its
  third sentence, so the pointer contradicted the page it points at.

## 0.4.159

- **Widened** the strict-mode guard to sweep the test suite, and corrected the third copy it found
  (`tests/unit/header/dates.test.ts`). 0.3.108 swept the doc pages and `src/`, which is how two
  copies survived in test comments until 0.4.157-0.4.158 — a comment in a test is read by whoever
  edits that behaviour next, so it is where a retired claim does the most damage.
- The TypeScript globs are matched on their COMMENTS rather than whole files. Running a prose
  matcher over code found a test name and the comment beneath it as one phrase; identifiers are not
  claims about behaviour.

## 0.4.158

- **Corrected** the second surviving copy of the same claim, in `tests/unit/tal/annotations.test.ts`.
  The assertion was right and its stated reason was not: the array is empty because that fixture is
  conforming, not because strict empties it.

## 0.4.157

- **Corrected** the retired strict-mode claim where it had survived: a doc comment in
  `tests/unit/diagnostics.test.ts` still said "under strict every `diagnostics` array is empty by
  construction". `info` diagnostics are exempt from the strict throw and are still collected.

## 0.4.156

- **Removed** the other "(decision 7)" citation, in `types.ts`. Same retired numbering, and this one
  ships in `dist/types.d.ts` as the hover text for `EdfRecordIndex.onsetTicks`. The sentence already
  states the decision, so the reference added nothing a reader could follow.

## 0.4.155

- **Fixed** a docblock citing "decision 7 of the design". The numbered DESIGN.md it referred to no
  longer exists; the decision record is the design-decisions page, whose sections are named rather
  than numbered. It now cites the decision by name.

## 0.4.154

- **Fixed** the README link still labelled "API — helpers", the last site of that rename. The
  README ships in the npm package, so it is the copy most consumers read.

## 0.4.153

- **Fixed** the link on `api-validate.md` still labelled "API — helpers", after that page was
  renamed.

## 0.4.152

- **Fixed** the two links on `api-types.md` still labelled "API — sources" and "API — reading",
  after those pages were renamed.

## 0.4.151

- **Fixed** a link on `api-errors.md` still labelled "API — reading". That page was renamed to
  "API: reading", so the label named a title the site no longer has.

## 0.4.150

- **Corrected** the `TalIssueKind` docblock. `TAL_MALFORMED` covers ten kinds, not nine, and three
  of them keep the TAL rather than two: the unterminated last text was missing from the list.

## 0.4.149

- **Added** a docblock to `Header.astro` naming why longest-prefix matching is there for two
  non-overlapping links: a plain `startsWith` over an unordered list lights two at once the first
  time a nested destination is added, and this is the rule that survives it. Repository only.

## 0.4.148

- **Added** a docblock to `CodeBlock.astro` naming what Shiki buys: highlighting runs at build
  time, so no syntax highlighter ships to the browser for text that never changes. Repository only.

## 0.4.147

- **Added** a docblock to `DocsNav.astro` naming why its section list is written out rather than
  derived: the order sections appear in is editorial, and no property of the entries expresses it.
  A page with an unlisted `section` renders but never appears in the nav. Repository only.

## 0.4.146

- **Added** a docblock to the docs route naming what follows from generating it off the
  collection: one markdown file publishes a page, and the same entries feed the nav, the outline
  and the `llms.txt` endpoints — which is why the schema is strict about `section` and `order`.
  Repository only.

## 0.4.145

- **Added** a docblock to `index.astro` warning that its code samples are template strings nothing
  typechecks. The documented examples on the docs pages are covered by `tests/types`; these are
  not, so anything a reader might copy belongs there instead. Repository only.

## 0.4.144

- **Added** a docblock to `demo.astro` naming what the page is for: it makes the library's central
  claim checkable, since a visitor can confirm from their own network tab that no request carries
  file data. Repository only.

## 0.4.143

- **Added** a docblock to `Base.astro`, the shell every page renders into. It names the two
  choices the file makes silently: fonts are bundled rather than linked, so the site fetches
  nothing from a third party, and every absolute URL is derived from the deployment origin rather
  than written down. Repository only.

## 0.4.142

- **Added** a docblock to `HeaderFieldName` and `SignalFieldName` naming why the corruptor writes
  its own offset tables: a test that damaged the bytes edfcore *believes* a field occupies would
  agree with any offset bug the parser has. Repository only.

## 0.4.141

- **Added** the missing docblock to `unit/diagnostics.test.ts`, the last test file in the suite
  without one. It names why the file works from literals rather than files: these are properties
  of the vocabulary, not of any recording. Repository only.

## 0.4.140

- **Added** the missing docblock to `unit/bytes/view.test.ts`, naming the distinction its two
  halves hold: `sliceBytes` shares memory and `copyBytes` does not, which is why a diagnostic's
  `rawBytes` cannot change under it later. Repository only.

## 0.4.139

- **Added** the missing docblock to `unit/bytes/numbers.test.ts`, naming why the header's number
  grammar is stricter than `Number()`: an empty field would become 0 and a hex literal 16, both
  silently. The file already tests both; it never said that was the point. Repository only.

## 0.4.138

- **Added** the missing docblock to `unit/bytes/latin1.test.ts`. 146 of the suite's 151 files open
  with one; this was among the five that did not, and it holds the rule that makes a header string
  the same value in Node and in a browser. Repository only.

## 0.4.137

- **Added** a docblock to the site's `collections` export naming what its schema guarantees:
  `llms.txt` groups by `section` and orders by `order`, so a page missing either fails the build
  instead of quietly vanishing from the map those endpoints hand to an agent. Repository only.

## 0.4.136

- **Added** a docblock to the demo's sample generator saying why the file is built in the browser
  rather than downloaded: the inspector's claim is that a recording never leaves the machine, and
  fetching a sample would undercut it on the page built to demonstrate it. Repository only.

## 0.4.135

- **Added** a docblock to `SpySource` naming why it extends the real `ByteSource` rather than
  mocking it: the code under test cannot tell the difference, so the spy sits in the read path
  rather than beside it. Repository only.

## 0.4.134

- **Added** a docblock to `spySource` naming what it exists to establish: "does not load the whole
  file" is a claim about the read pattern, and none of that is visible in the values a read
  returns. Repository only.

## 0.4.133

- **Added** a docblock to `RawHeaderFieldOverrides` pointing at the two fields worth overriding:
  a declared header size that disagrees with the signal count is writable, and is exactly what the
  mismatch diagnostics exist to report. Repository only.

## 0.4.132

- **Added** a docblock to `RawSignalFieldOverrides` naming what it is for: expressing damage a
  well-formed builder cannot, such as a non-numeric `physicalMaximum`, without the writer
  correcting it on the way out. Repository only.

## 0.4.131

- **Added** a docblock to `AnnotationSignalSpec` naming why its `tals` callback excludes the
  timekeeping TAL: the writer synthesises it, so a test cannot accidentally assert against its own
  idea of where records start. Repository only.

## 0.4.130

- **Added** a docblock to `SignalSpec` naming why `label` and `samplesPerRecord` are the only
  required fields: a channel needs a name to be found by, and its sample count is what every byte
  offset in the record is computed from. Repository only.

## 0.4.129

- **Added** a docblock to `EdfSpec` naming why nearly every field is optional: a test states only
  what it is about, so a fixture exercising one malformed field reads as a valid file with that
  single thing changed. Repository only.

## 0.4.128

- **Added** a docblock to `buildEdf`, the function every fixture in the suite is built with.
  `tests/README.md` explains why it imports nothing from `src/` — a reader and a writer sharing a
  misunderstanding agree with each other — and the function itself never said so. Repository only.

## 0.4.127

- **Added** a docblock to `ceilDiv` naming why it exists at all: BigInt division truncates toward
  zero, so neither flooring nor ceiling is what the operator gives for a negative operand — and a
  time before the recording's start is exactly where that shows.

## 0.4.126

- **Added** a docblock to `isValidCalendarDate` naming what it protects against: `new Date` rolls
  31 April and a leap-day-in-a-common-year forward into the next month instead of rejecting them,
  so a bad date in a header would silently become a plausible neighbouring one.

## 0.4.125

- **Added** a docblock to `requireFiniteOption` naming the distinction it exists to keep: an
  omitted option means "use the default", a `NaN` means a caller computed something and got
  nothing, and treating them alike would apply the default to a real mistake.

## 0.4.124

- **Added** a docblock to `SignalHeaderInput` naming the layout fact its shape follows from: the
  per-signal fields are field-major, so a signal cannot be parsed from a slice of its own and the
  count must be known before any field can be located.

## 0.4.123

- **Added** a docblock to `StartTimeInput` saying why all three sources arrive together: the
  resolved start depends on whether they agree, and a header date that hit the year escape is
  only completed by the EDF+ `Startdate` subfield.

## 0.4.122

- **Added** a docblock to `SubfieldDateParse` naming why it is a separate type from the header's
  date result: `dd-MMM-yyyy` carries a four-digit year, so there is no two-digit window to apply
  and nothing to report as clipped.

## 0.4.121

- **Added** a docblock to `HeaderStartTimeParse` naming what makes it simpler than the date
  counterpart 0.4.108 documented: there is no escape and no second field to rescue a partial
  answer, so `conformant` carries the whole "read because tolerated" distinction.

## 0.4.120

- **Added** a docblock to `resolveTwoDigitYear` naming the rule as the specification's rather than
  a heuristic. The pivot is fixed, so a recording from before 1985 or after 2084 cannot state its
  year in that field at all — which is what the EDF+ `Startdate` subfield carries instead.

## 0.4.119

- **Added** a docblock to `createDiagnostic` naming why severity is derived from the code rather
  than passed in: a caller choosing its own is how one code comes to mean two different things,
  and 0.3.12-0.3.22 was a sweep of exactly that class.

## 0.4.118

- **Added** a docblock to `severityOf` saying why `fatal` and `deferred` both surface as `error`:
  they differ in when they stop a parse, not in how wrong the file is, and that distinction is
  internal rather than something a consumer should branch on.

## 0.4.117

- **Added** a docblock to `DIAGNOSTIC_DISPOSITIONS` naming the property that makes it the registry
  worth counting: it is typed by the known-code union, so adding a code without deciding how it
  behaves fails to compile.

## 0.4.116

- **Added** a docblock to `runCli` naming what the shape buys: it returns an exit code and takes
  every side effect through `io`, which is what lets the CLI be exercised without spawning a
  process or building `dist` first.

## 0.4.115

- **Added** a docblock to `parseArgs` naming the reason an unrecognised flag throws instead of
  being ignored: a misspelled `--patinet` that did nothing would print a header without the
  identification the caller believed they had asked for.

## 0.4.114

- **Added** a docblock to `Args` saying why `command` and `file` are `undefined` rather than
  defaulted: a missing one is bad usage and exits 2, and a default here would turn a bare
  `edfcore` into a silent success.

## 0.4.113

- **Removed** the npm version, types and licence badges added in 0.4.112. They restate what the
  page already says a few lines down, and they pushed the one number worth showing into a row of
  four. The badges are now the two counters: exports and downloads.

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

## 0.2.29

Never released. The release run failed `npm run check` on two unused imports in
`tests/io/hardening.test.ts` after bumping the version, which consumed the number before a tag was
cut; the scan-buffer fix it was carrying shipped as 0.2.30 instead. Written down in 0.4.194 — it was
the only consumed number with no entry of its own, while `0.2.36` above and the guidance in
`scripts/release.mjs` both name it as one of the recorded ones.

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

Published by hand and never tagged, which is why `v0.1.1` is absent while every version around it
has a tag. The bump rode inside a34ffd0 rather than a `Release v0.1.1` commit, and the package went
to npm at 03:55 on 2026-08-03. `scripts/release.mjs` was added the same day, and 0.1.2 went out
fifty minutes later as the first release it cut. This is the last version published without it.

## 0.1.0

First release. Reads EDF, EDF+, BDF and BDF+ with real random access.
