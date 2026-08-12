# AGENTS.md

Guidance for coding agents working in this repository, or writing code that uses `edfcore`.

## What this project is

`edfcore` reads EDF, EDF+, BDF and BDF+ biosignal files (EEG, sleep studies, ECG, EMG) in
browsers and in Node. It is a **file-format library, and read-only through 1.0**. It has zero
runtime dependencies and that is a permanent constraint, not a current state.

## Repository layout

| Path | What it is |
|---|---|
| `src/` | The library. Layered strictly: `bytes`/`text` → `diagnostics` → `header`/`decode`/`tal` → `time` → `io` → entry points. A module may only import from a lower layer. |
| `tests/` | 1906 tests. Every fixture is built in memory by `tests/support/writer.ts`; there are no binary files in git. |
| `config/` | `tsconfig.build.json` and the two vitest configs. Every path inside them is relative to `config/`, and every `npm` script names them explicitly — nothing here is found by a tool's default lookup. |
| `docs/CHANGELOG.md` | The release record. `scripts/release.mjs` refuses to tag unless its top `## <version>` heading matches. |
| `scripts/` | `release.mjs` cuts a release; `golden/*.py` regenerate the pyEDFlib and MNE reference values in a venv. Neither runs in `npm run check`. |
| `website/src/content/docs/design-decisions.md` | Why the API is shaped as it is. **Read it before proposing an architectural change** — most obvious improvements were considered and rejected for a stated reason. |
| `website/` | The Astro documentation site and the browser-based inspector. |

## Commands

```bash
npm run check       # lint + typecheck (both configs) + tests — run this before finishing
npm test            # vitest, ~10s
npm run build       # tsc to dist/
npm run dev --prefix website
```

`npm run typecheck` runs **two** configs on purpose: `config/tsconfig.build.json` compiles `src/` with
`lib: ["ES2022"]` and `types: []`, so neither the DOM nor `@types/node` can leak into the
published types. If you add a DOM or Node global to `src/`, that build fails — use the
structural shims in `src/types.ts` instead.

## Things that look like bugs and are not

Do not "fix" these. Each has a test pinning it and a comment explaining why.

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

## Using edfcore in generated code

The five calls that cover almost everything:

```ts
import { openEdf, blobSource, getSignal, readWindow, toPhysical } from 'edfcore';

const recording = await openEdf(blobSource(file));      // or fileSource() from 'edfcore/node'
const signal = getSignal(recording.header, 'Fp1');
const chunks = await readWindow(recording, {
  signalIndices: [signal.index],
  startSeconds: 30,
  durationSeconds: 10,
});
const microvolts = toPhysical(signal, chunks[0].signals[0].digital);
```

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
