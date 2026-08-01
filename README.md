# edfcore

Read EDF, EDF+, BDF and BDF+ biosignal files in TypeScript — in the browser and in Node, with
real random access and no dependencies.

```bash
npm install edfcore
```

## How do I read an EDF file in JavaScript?

Open a source, pick a signal, read a time window, convert it to physical units. In the browser,
a `File` from an `<input type="file">` works directly:

```ts
import { openEdf, blobSource, getSignal, readWindow, toPhysical } from 'edfcore';

const recording = await openEdf(blobSource(file));
const fp1 = getSignal(recording.header, 'Fp1');

const [chunk] = await readWindow(recording, {
  signalIndices: [fp1.index],
  startSeconds: 30,
  durationSeconds: 10,
});

const microvolts = toPhysical(fp1, chunk.signals[0].digital);   // Float64Array
```

In Node, swap the source and nothing else changes:

```ts
import { openEdf, getSignal, readWindow, toPhysical } from 'edfcore';
import { fileSource } from 'edfcore/node';

const recording = await openEdf(await fileSource('./overnight.edf'));

console.log(recording.header.variant);                  // 'EDF+C'
console.log(recording.header.signals.map((s) => s.label));
console.log(recording.timeline.spanSeconds);
```

Reading those ten seconds out of a twelve-hour recording reads roughly ten seconds' worth of
bytes. Nothing loads the whole file.

Events come from the same recording, with exact times:

```ts
import { readAnnotations } from 'edfcore';

const { annotations } = await readAnnotations(recording, {
  start: 0,
  count: recording.header.recordCount,
});

for (const event of annotations) {
  console.log(event.onsetSecondsFromFirstRecord, event.durationSeconds, event.text);
}
```

> **Status: 0.1.0, early — but checked against real files.** Alongside 1,100+ tests on
> generated fixtures, edfcore is verified against public corpora it did not author: the
> EDF, EDF+ and 24-bit BDF+ test files from teuniz.net, and PhysioNet's sleep-edfx — a real
> 22-hour polysomnography recording and its sleep-staging file. Those checks are numeric, not
> just "it parsed": channels labelled `sine 8.5 Hz` decode to 8.5 Hz at their stated
> amplitude, the 24-bit and 16-bit paths agree on identical signals, and the rectal
> temperature channel of a real recording reads 37 °C. Run them yourself with
> `npm run corpus:fetch && npm test`.
>
> Still outstanding: a golden-value harness comparing edfcore's float64 output against
> pyEDFlib and MNE element by element. Until that exists, no claim of numeric parity with
> those readers ships. Treat the API as still able to move. See [Roadmap](#roadmap).

---

## When to use edfcore, and when not to

**Use it when** you need to read EDF, EDF+, BDF or BDF+ in JavaScript or TypeScript: a
browser-based EEG or sleep viewer, an Electron desktop tool, a Node data pipeline, a research
upload portal that must not send recordings to a server, or any case where you want real types
and errors that tell you which byte was wrong.

**Use something else when:**

- **You are already in Python.** pyEDFlib and MNE are mature, validated against enormous
  amounts of real data, and have years of clinical use behind them. Do not port a working
  Python pipeline to JavaScript for the sake of it.
- **You want a whole viewer stack.** [`@epicurrents/edf-reader`](https://github.com/epicurrents/edf-reader)
  is strong prior art and arrives with an EEG application framework attached.
- **You need analysis, not file access.** edfcore does not filter, resample, re-reference,
  build montages, run ICA, reject artifacts, or detect events, and it never will — those are
  permanent non-goals, not gaps.
- **You need to *write* EDF.** edfcore is read-only through 1.0.

---

## Why this exists

EDF is the standard container for EEG, sleep studies, ECG and EMG. Python has excellent tooling
for it. JavaScript did not, and the gap is not subtle — surveying every EDF package on npm as of
mid-2026:

| | state of the art |
|---|---|
| TypeScript types | No standalone reader ships them |
| Random access | Nothing published does byte-range reads; a 24 h study is loaded whole or not at all |
| BDF (24-bit) | No published package can read it — BioSemi hardware has no JS support |
| EDF+D (gaps) | Unsupported or, worse, decoded as if contiguous, producing a silently wrong timeline |
| Errors | `console.warn` and `null`, or bare thrown strings; nothing typed or located |
| Header validation | Essentially none — no size checks, no degenerate-range checks |

The result is that people building EEG viewers don't use an EDF package at all. They hand-roll a
parser, and reproduce the same bugs.

edfcore is the boring infrastructure that should have existed: parse the format correctly, expose
it honestly, and be loud when the bytes are wrong.

**Prior art worth knowing about.** [`@epicurrents/edf-reader`](https://github.com/epicurrents/edf-reader)
is the strongest existing implementation — genuine TAL parsing, real partial reads, BDF support.
It is a plugin inside an EEG application framework, so it arrives with that framework attached. If
you want a whole viewer stack, use it. edfcore's pitch is different: a small, standalone,
dependency-free, fully typed file-format library you can drop into any project.

---

## Design in one page

**It never invents data.** If edfcore cannot proceed without making something up, it throws. If it
can proceed truthfully, it records a diagnostic on the result. There is no third option, and
nothing is ever written to the console.

```ts
const recording = await openEdf(source);
for (const d of recording.header.diagnostics) {
  console.log(d.code, d.message, d.byteOffset);   // your logger, your call
}
```

Every diagnostic carries the field, the byte offset, the raw bytes as written, the spec clause it
violates, and what to do next. Pass `{ strict: true }` and the first one throws instead.

**Digital and physical are two functions, not a flag.** `chunk.signals[i].digital` is an
`Int32Array` of raw stored values; `toPhysical(signal, digital)` returns a `Float64Array` in the
signal's own units. An option that changes a return type is a bug waiting to happen, and `Float32`
would cost a quarter of a quantisation step on 24-bit BDF.

**Scaling can be refused.** When a header declares `digitalMinimum === digitalMaximum`, there is no
scale — the reference C implementation quietly substitutes a gain of 1 and hands back ADC counts
labelled as microvolts. edfcore sets `signal.scale` to `undefined` instead, so `toPhysical` throws
and `strictNullChecks` makes the mistake unrepresentable. `decodeDigital` keeps working.

**Different sample rates stay different.** An EDF file can hold EEG at 256 Hz, ECG at 512 Hz and
temperature at 1 Hz. edfcore never pretends one universal rate exists. Sample indexing uses
`samplesPerRecord`, never a floating-point rate, and `sampleRateHz` is `undefined` when the record
duration is zero (which is legal).

**Time is compared in exact ticks.** Annotation onsets are parsed digit-by-digit into `bigint`
hundred-nanosecond ticks, never through `parseFloat`. Float equality on event times is how ERP
alignment silently breaks.

**Gaps are structural, not optional.** `readWindow` always returns an *array* of chunks — one per
contiguous run — even for a continuous file. A window that falls inside a gap returns `[]`. There
is no gap-filling and no option to enable it, because if two shapes existed, people would write
against the easy one and it would misbehave on the first discontinuous recording.

**No `Date`.** EDF stores local time at the patient with no timezone, so a `Date` silently applies
the reader's zone and is worst exactly at DST boundaries. You get `EdfCalendarDate` and
`EdfClockTime`, plus `formatStartTimeNaive()` for a zone-free ISO-like string.

---

## Reading data

The unit of I/O is the **record range**, never the channel range. EDF interleaves every channel
within each data record, so there is no cheap single-channel read — asking for one channel over a
window still reads the records that contain it. edfcore makes that visible rather than hiding it:
`chunk.byteLength` is the bytes actually read.

```ts
import { openEdf, readWindow, resolveTimeWindow } from 'edfcore';
import { fileSource } from 'edfcore/node';

const recording = await openEdf(await fileSource('./overnight.edf'));

// Audit the cost before paying it — resolveTimeWindow is pure and does no I/O.
const ranges = resolveTimeWindow(recording.timeline, recording.index, 3600, 30);

const chunks = await readWindow(recording, {
  signalIndices: [0, 1, 2],
  startSeconds: 3600,
  durationSeconds: 30,
});
```

Chunks are record-aligned and may be slightly wider than requested. `trimToWindow()` narrows them
to a sample-exact window using integer arithmetic on `(record, sampleWithinRecord)` — not
`round(t * rate)`, which is the rounding error consumers introduce when a library makes them do it
themselves.

### Sources

One interface, four adapters, all universal:

```ts
byteSource(arrayBufferOrUint8Array)
blobSource(fileOrBlob)                    // structural — no DOM types required
httpSource(url, { headers })              // HTTP Range requests
cachedSource(inner, { blockBytes })       // the only caching, opt-in and removable
```

and from `edfcore/node`:

```ts
fileSource('./recording.edf')
fileHandleSource(handle, byteLength)
```

Bring your own by implementing `ByteSource` — three members. The contract is *exactly `length`
bytes or reject*, and edfcore verifies it on every call, including on sources you supplied.

### Discontinuous recordings

Opening a file never scans it. For EDF+D that means the index starts out `'probed'` — record 0 and
the last record only — and it will **refuse** to map a timestamp to a record across an unmapped
gap rather than guess:

```ts
const index = await buildRecordIndex(recording, { onProgress: (done, total) => … });
const located = { ...recording, index };

index.coverage;   // 'complete'
index.segments;   // EdfSegment[] — only defined once coverage is complete
index.gaps;       // EdfGap[]
```

`segments` is `undefined` while coverage is `'probed'` by design: no property is allowed to read
as "continuous" before anything has checked.

### Triage

`inspectEdf()` reads at most 128 KiB and never throws on malformed content. It is the right first
call for an unfamiliar file:

```ts
const { ok, variant, header, diagnostics } = await inspectEdf(source);
console.log(formatDiagnostics(diagnostics));
```

---

## What it deliberately does not do

edfcore is a file-format library. It is not an EEG analysis framework, and the following are
permanent non-goals, not missing features: filtering, resampling, re-referencing, montages, ICA,
artifact rejection, bad-channel detection, spectral analysis, event detection, channel-type
inference from labels, unit normalisation to SI volts, and anything involving AI or a network
service.

Writing EDF is out of scope through 1.0. Producing a *correct* file is a much larger normative
commitment than tolerating an incorrect one, and a subtly non-conformant writer would undermine
the reason to trust the reader.

---

## Compatibility

- **Node** ≥ 22.12.0 · **Chrome/Edge** 94+ · **Firefox** 93+ · **Safari** 15.4+
- ESM only. `require()` works on Node ≥ 22.12 (there is no top-level `await` anywhere in the
  module graph, which is what makes that safe).
- Zero runtime dependencies, permanently. `edfcore/node` imports `node:fs/promises` and nothing
  else.
- Three entry points, no environment conditions in the exports map: `edfcore`, `edfcore/node`,
  `edfcore/validate`.

---

## Roadmap

**0.1 — reads everything, lies about nothing.** All six variants, the primitive/I/O/convenience
layers, `inspectEdf`, `edfcore/validate`, six source adapters, the full diagnostic vocabulary.

**Before 1.0.** Validation against public corpora (sleep-edfx, CHB-MIT, the BioSemi and
edfplus.info test files) and a golden-value harness cross-checking physical values against
pyEDFlib and MNE. Until that harness exists this README makes no numerical-interop claim, and it
will not make one that a test did not produce.

**Later, additive.** Min/max envelope decimation as its own type. The `edffloat` logarithmic
inverse transform, opt-in (currently detected and refused, never silently applied). BioSemi
Status-byte helpers. JSR publication.

---

## Documentation

The full documentation site lives in [`website/`](website/) — an Astro build with nineteen
pages, plus a **local inspector** that opens an EDF file and shows its header, channels, events
and waveforms entirely in your browser, with nothing uploaded.

```bash
npm install --prefix website
npm run dev --prefix website
```

Start with **Concepts**, which is the mental model the rest of the API follows from. Then the
guides (reading signals, physical values, annotations, discontinuous recordings, diagnostics,
data sources, large files, validation), the API reference, and the background pages — including
a standalone primer on the EDF format itself.

### Deploying the site

[`vercel.json`](vercel.json) is set up so that linking this repository to Vercel just works —
**leave the Root Directory as the repository root** and do not pick a framework preset. The
build compiles the library first (the site imports `edfcore` from the parent package) and then
builds the site into `website/dist`.

Nothing needs configuring for URLs: Astro reads Vercel's own production-domain variable, so the
sitemap and canonical links are correct on the first deploy. If you later point a custom domain
at it, set `SITE_URL` to that origin in the project's environment variables.

**Design decisions** — why the API is shaped the way it is, including the choices that look
like bugs and are not (the pinned scaling expression, `readWindow` always returning an array,
`scale` being `undefined` rather than fabricated) — are documented on the site under
*Background → Design decisions*.

- [`tests/README.md`](tests/README.md) — how the suite builds every fixture in memory, and why
  no binaries are committed.

## License

MIT © Sarthak Tayal
