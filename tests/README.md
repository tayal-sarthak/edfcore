# Test suite

`git clone && npm test` is green and offline. There are no binary fixtures in this repository.

## How that works

Every EDF, EDF+, BDF and BDF+ file the suite uses is built in memory by
[`support/writer.ts`](support/writer.ts). Damage a well-formed builder cannot express —
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
| `support/` | The writer, the corruptor, and a `ByteSource` spy. Never exported from the package |

## The safety invariant

`property/fuzz.test.ts` states it in one line, and it is the property the whole library exists
to uphold:

> For any byte sequence, edfcore either parses it or throws an `EdfError`. It never hangs, never
> allocates unboundedly, never returns `NaN`, and never returns believable garbage.

Fuzzing found four real defects during development, all of the last kind — headers whose numeric
fields were individually valid but whose *derived* scale silently produced `NaN` for every sample.
Any input that violates the invariant should be printed with its bytes and become a permanent
regression case here.

## Fixture policy

Three tiers were planned; only the first is in use today.

- **Tier 1 — synthetic, in memory.** Everything currently in the suite. No binaries in git, no
  licence questions, no network.
- **Tier 2 — a small number of committed real files.** Only files under a clear open licence
  (e.g. the ODC-By PhysioNet hypnograms) with the licence text and a NOTICE alongside them. Not
  yet added.
- **Tier 3 — download on demand.** A manifest of URL, byte size, SHA-256 and licence, fetched
  into a gitignored directory, with tests `skipIf`-guarded so the default run stays offline. Not
  yet added.

**No file from teuniz.net or edfplus.info may be committed.** Neither site attaches a licence to
its data, and `eeg_recording.zip` is an identifiable patient recording.

## Running

```bash
npm test          # once
npm run test:watch
npm run check     # lint + typecheck + test
```
