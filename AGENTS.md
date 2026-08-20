# AGENTS.md

Guidance for coding agents working in this repository, or writing code that uses `edfcore`.

## What this project is

`edfcore` reads EDF, EDF+, BDF and BDF+ biosignal files (EEG, sleep studies, ECG, EMG) in
browsers and in Node. It is a **file-format library, and read-only through 1.0**. It has zero
runtime dependencies and that is a permanent constraint, not a current state.

## Repository layout

| Path | What it is |
|---|---|
| `src/` | The library, in eight layers. Every module opens its docblock with `Layer N`, and that declaration is the source of truth — the table below is a summary of it, not a second definition. A runtime import may go down a layer or stay level, never up; `tests/integration/module-layers.test.ts` enforces both halves. `import type` is exempt, because a type-only import emits nothing and so creates no edge. |
| `tests/` | Almost every fixture is built in memory by `tests/support/writer.ts`. The exception is six EDF/BDF files under `corpus/golden/`, committed since 0.2.34 because the parity harness has to compare against bytes another implementation wrote. See `tests/README.md`. |
| `config/` | `tsconfig.build.json` and the two vitest configs. Every path inside them is relative to `config/`, and every `npm` script names them explicitly — nothing here is found by a tool's default lookup. |
| `docs/CHANGELOG.md` | The release record. `scripts/release.mjs` refuses to tag unless its top `## <version>` heading matches. |
| `scripts/` | `release.mjs` cuts a release — one commit, so leave the work uncommitted and pass `-m`; `golden/*.py` regenerate the pyEDFlib and MNE reference values in a venv. Neither runs in `npm run check`. |
| `website/src/content/docs/design-decisions.md` | Why the API is shaped as it is. **Read it before proposing an architectural change** — most obvious improvements were considered and rejected for a stated reason. |
| `website/` | The Astro documentation site and the browser-based inspector. |

### The layers

| Layer | What is in it |
|---|---|
| 0 | `constants.ts`, `types.ts`, `bytes/` — no imports at all, or types only |
| 1 | `text/`, `diagnostics/`, `errors.ts`, `options.ts`, `tal/ticks.ts` |
| 2 | `header/` |
| 3 | `decode/`, `tal/grammar.ts`, `tal/annotations.ts` |
| 4 | `time/` |
| 5 | `io/` — the `ByteSource` adapters |
| 6 | `io/read.ts`, `recording.ts`, `record-index.ts`, `inspect.ts` — the read strategy |
| 7 | entry points, and the pure helpers over them |

`tal/ticks.ts` sits at layer 1 rather than with the rest of `tal/`, and that is the point of the
rule: it imports `constants.ts` and nothing else, and `header/` at layer 2 calls it. A module's
layer is its dependencies, not its folder (0.4.256).

## Commands

```bash
npm run check       # lint + typecheck (both configs) + build + tests — run this before finishing
npm test            # vitest, ~10s
npm run build       # tsc to dist/
npm run format      # biome, formatting and import order; `lint` reports the same as errors
npm run corpus:fetch # ~59 MB, gitignored — without it the corpus tests skip rather than fail
npm run dev --prefix website
npm run release -- patch -m "What changed"   # one commit, waits for CI and for npm
```

Three checks are deliberately outside `npm run check`, because each needs the network or an
artifact that check does not build. CI runs all three; run them by hand when you touch what they
cover.

```bash
npm run verify:package   # publint + @arethetypeswrong/cli against the packed tarball
npm run verify:tarball   # what npm would actually ship, and what it must not
npm run verify:site      # needs `npm --prefix website run build` first
```

`npm run typecheck` runs **two** configs on purpose: `config/tsconfig.build.json` compiles `src/` with
`lib: ["ES2022"]` and `types: []`, so neither the DOM nor `@types/node` can leak into the
published types. If you add a DOM or Node global to `src/`, that build fails — use the
structural shims in `src/types.ts` instead.

## Things that look like bugs and are not

Do not "fix" these. Each of the code rules has a test pinning it and a comment explaining why;
the last is a fact about the repository rather than about the code, and the offline suite has no
way to check a branch on a remote.

- **The scaling expression is `bitValue * (offset + digital)`.** It is numerically worse than
  the obvious rearrangement, and it is EDFlib's exact form, kept so output can be compared with
  pyEDFlib. `src/decode/physical.ts`.
- **`TextDecoder` is banned outside `src/tal/`.** Every `latin1` label Node accepts decodes
  byte `0x80` differently from the WHATWG standard, so the same header would yield different
  strings in Node and in a browser. Header bytes use `decodeHeaderLatin1`.
- **`readWindow` always returns an array**, even for continuous files. One chunk per contiguous
  run. If a single-chunk shape existed, people would write against it and break on the first
  discontinuous sleep study.
- **`signal.scale` can be `undefined`.** A header with no usable gain gets no gain; `toPhysical`
  throws rather than inventing one. `decodeDigital` still works.
- **No `Date` anywhere.** EDF stores local time with no zone.
- **Never `|0`, `<<` or `>>>` on a file offset.** Offsets exceed 2^31 routinely. Bitwise ops on
  *sample values* are correct and required.
- **`info`-severity diagnostics do not throw under `strict`.** They describe correct files.
- **The `archive/pre-squash-2026-08-16` branch is load-bearing.** It looks like leftover cruft and
  is the only thing keeping 94 commits reachable. Every version published on 2026-08-16 carries a
  signed npm provenance attestation naming the commit it was built from; `main` was squashed from
  193 commits to 43 that day, so those SHAs live nowhere else. Deleting the branch lets GitHub
  collect them and turns every one of those "Source Commit" links on npm into a 404. The
  attestations stay cryptographically valid either way — it is the link that breaks, permanently,
  and no force-push can put it back.

## Using edfcore in generated code

The five calls that cover almost everything:

```ts
import { openEdf, blobSource, getSignal, readWindow, toPhysical } from 'edfcore';

const recording = await openEdf(blobSource(file));      // or fileSource() from 'edfcore/node'
const signal = getSignal(recording.header, 'Fp1');
const [chunk] = await readWindow(recording, {
  signalIndices: [signal.index],
  startSeconds: 30,
  durationSeconds: 10,
});
// One chunk per contiguous run, and none at all for a window that selects nothing.
if (chunk === undefined) throw new Error('no records cover that window');
const [series] = chunk.signals;
if (series === undefined) throw new Error('no signal in that chunk');
const microvolts = toPhysical(signal, series.digital);
```

Both guards are load-bearing under `noUncheckedIndexedAccess`, which is on in this repo and in
every strict TypeScript project. Until 0.4.259 this snippet ended `chunks[0].signals[0].digital`
and did not compile — the file agents are told to copy from taught a line the compiler rejects.

The mistakes to avoid, in order of how often they happen:

1. **`chunk.signals[0].digital` is raw stored integers, not microvolts.** Call `toPhysical`.
2. **`readWindow` returns an array.** Destructure or index it; do not treat it as one chunk.
3. **Do not compute sample indices from `sampleRateHz`.** It is derived and can be `undefined`.
   Use `samplesPerRecord`, or `trimToWindow` for an exact window.
4. **Compare event times in `bigint` ticks, not the floats.** Against a window or a chunk use
   `onsetTicksFromFirstRecord`, which is the axis every read puts `t = 0` on. `onsetTicks` is the
   header's axis, for comparing annotations with each other; the two differ by record 0's
   sub-second offset.
5. **Signals have different sample rates.** There is no single rate for a recording.
6. **Diagnostics are values on the result**, not exceptions and not log output. Check
   `recording.header.diagnostics`; edfcore never writes to the console.

## Conventions

Biome, 2-space indent, single quotes, 100 columns. Comments state constraints the code cannot
show — a spec clause, a numerical hazard, a deliberate non-obvious choice — and never narrate
what the next line does. Match the surrounding voice.

**Every thrown message ends with a `Next:` clause** naming what the caller should do — over 150
do. If the cause is an edfcore bug rather than a caller mistake, say that: `Next: report this`.
