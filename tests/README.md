# Test suite

`git clone && npm test` is green and offline.

Almost every fixture is built in memory. The exception is six small EDF/BDF files under
`corpus/golden/`, which are committed on purpose — see [Fixture policy](#fixture-policy). No file
anyone else wrote is in this repository.

## How that works

Every EDF, EDF+, BDF and BDF+ file the suite uses, apart from the six under `corpus/golden/`,
is built in memory by [`support/writer.ts`](support/writer.ts). Damage a well-formed builder cannot express —
truncation, byte flips, garbage tails — is applied by [`support/corrupt.ts`](support/corrupt.ts).

`writer.ts` is deliberately written from the format specification and imports nothing from
`src/`. A reader and a writer that share a misunderstanding agree with each other and are wrong
together; keeping them independent is what makes the round-trip and property tests worth running.

## Layout

| Directory | What it covers |
|---|---|
| `unit/` | Pure functions over `Uint8Array`: byte grammars, header parsing, sample decode, TAL parsing, time arithmetic |
| `io/` | The read *pattern* — how many requests, which ranges, how many bytes. This is where "does not load the whole file" is actually proven |
| `property/` | Writer→reader round-trip and seeded byte-flip fuzzing against the safety invariant |
| `integration/` | End-to-end journeys through the public barrel |
| `types/` | `.test-d.ts` type-level checks: what each subpath can name on its own, and that the documented examples typecheck |
| `corpus/` | Real EDF/BDF files from teuniz.net and PhysioNet, skipped unless fetched, plus the reference-parity harness — see below |
| `support/` | The writer, the corruptor, and a `ByteSource` spy. Never exported from the package |
| `scratch/` | Throwaway reproductions, gitignored and excluded from this suite. Run with `npm run test:scratch` |

## The safety invariant

`property/fuzz.test.ts` states it in one line, and it is the property the whole library exists
to uphold:

> For any byte sequence, edfcore either parses it or throws an `EdfError`. It never hangs, never
> allocates unboundedly, never returns `NaN`, and never returns believable garbage.

Fuzzing found four real defects during development, all of the last kind — headers whose numeric
fields were individually valid but whose *derived* scale silently produced `NaN` for every sample.
Any input that violates the invariant should be printed with its bytes and become a permanent
regression case here.

## Checking against files we did not write

Everything above is edfcore reading bytes edfcore's own writer produced. That is a real
cross-check — the writer was built from the specification and imports nothing from `src/` —
but both are still this project's reading of the format.

`corpus/` closes that gap two ways.

**Files other people's software wrote.** The teuniz generator files are labelled with their own
expected content, so a channel called `sine 8.5 Hz` gives an expectation nobody here chose. The
PhysioNet recordings add the messy real cases — a 22-hour polysomnography, and a scoring file whose
record duration is legally zero.

**Values another implementation computed.** `golden-values`, `annotation-parity`, `mne-parity` and
`corpus-parity` compare edfcore against pyEDFlib and MNE rather than against itself. edfcore
reproduces pyEDFlib's float64 physical values *bit for bit*, on synthetic files and on the real
corpus alike. See [`../scripts/golden/README.md`](../scripts/golden/README.md) for what each
harness claims and how strong that claim is — they are not all equally strong, and the file says
which is which.

`coverage.test.ts` always runs and prints whether the corpus was present, because a skipped test
and a passing one look identical in a summary line.

```bash
npm run corpus:fetch    # ~59 MB, hash-verified, gitignored
npm test
```

## Fixture policy

Three tiers were planned, and all three are in use.

- **Tier 1 — synthetic, in memory.** Almost everything. No binaries in git, no licence questions,
  no network.
- **Tier 2 — a small number of committed files.** In use since 0.2.34, for the reference-parity
  harness and nothing else: six EDF/BDF files under `corpus/golden/`, about 1.4 MB with their
  goldens.

  These are **generated locally by pyEDFlib**, not downloaded from anyone. They have to be
  committed rather than built in memory, because the whole point is to compare against bytes a
  DIFFERENT implementation wrote — regenerating them with `support/writer.ts` would make the
  comparison circular and prove nothing. They are excluded from the published package, which ships
  only `dist`, `src` and the changelog.
- **Tier 3 — download on demand.** In use. [`corpus/manifest.json`](corpus/manifest.json)
  records the URL, byte size, SHA-256, licence and purpose of each file;
  `npm run corpus:fetch` downloads them into a gitignored directory and verifies every hash;
  [`corpus/corpus.test.ts`](corpus/corpus.test.ts) is `skipIf`-guarded so the default run
  stays offline.

**No file from teuniz.net, PhysioNet or edfplus.info may be committed.** Neither site attaches a
licence to its data, and `eeg_recording.zip` is an identifiable patient recording. That rule is
unchanged by Tier 2 above: the committed files are ones this machine generated, and the downloaded
corpus stays in the gitignored `corpus/files/`. Only the JSON goldens reference it, by name and
hash.

## Running

```bash
npm test          # once
npm run test:watch
npm run check     # lint + typecheck + test
```
