# edfcore

edfcore reads EDF, EDF+, BDF and BDF+ biosignal files in TypeScript, in the browser and in
Node. Real random access, no dependencies.

```bash
npm install edfcore
```

## Look at a file without writing code

```bash
npx edfcore header overnight.edf          # signals, rates, ranges, diagnostics
npx edfcore events hypnogram.edf          # annotations, counted by text
npx edfcore events hypnogram.edf --list   # one event per line, with onsets
npx edfcore gaps overnight.edf            # the discontinuities, after a full scan
npx edfcore signals overnight.edf         # one tab-separated line per signal, for awk
npx edfcore validate overnight.edf        # full conformance sweep; exits 1 on failure
npx edfcore json overnight.edf            # the header as JSON, for jq
```

Patient identification is omitted unless you pass `--patient`.

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

> **Status: 0.3.x, early.** edfcore runs 1,900+ tests on generated fixtures, and it's checked
> against public corpora it didn't author: the EDF, EDF+ and 24-bit BDF+ test files from
> teuniz.net, and PhysioNet's sleep-edfx (a real 22-hour polysomnography recording and its
> sleep-staging file). Those checks are numeric. Channels labelled `sine 8.5 Hz` decode to
> 8.5 Hz at their stated amplitude, the 24-bit and 16-bit paths agree on identical signals,
> and the rectal temperature channel of a real recording reads 37 °C. Run them with
> `npm run corpus:fetch && npm test`.
>
> That harness exists as of 0.2.34-0.2.48: edfcore reproduces pyEDFlib's float64 output bit for
> bit on synthetic files and on the real corpus, agrees with MNE to 1e-12 relative, and matches
> pyEDFlib's annotation onsets to the tick. Regenerate the reference values with `scripts/golden/*.py`.
> The API can still move. See [Roadmap](#roadmap).

---

## When to use edfcore, and when not to

**Use it when** you need to read EDF, EDF+, BDF or BDF+ in JavaScript or TypeScript. That
covers browser-based EEG and sleep viewers, Electron desktop tools, Node data pipelines, and
research upload portals that must not send recordings to a server.

**Use something else when:**

- **You are already in Python.** pyEDFlib and MNE are mature, validated against enormous
  amounts of real data, and have years of clinical use behind them. Don't port a working Python
  pipeline to JavaScript for the sake of it.
- **You want a whole viewer stack.** [`@epicurrents/edf-reader`](https://github.com/epicurrents/edf-reader)
  is strong prior art and arrives with an EEG application framework attached.
- **You need analysis, not file access.** edfcore does not filter, resample, re-reference,
  build montages, run ICA, reject artifacts, or detect events. Those are permanent non-goals.
- **You need to *write* EDF.** edfcore is read-only through 1.0.

---

## Why this exists

EDF is the standard container for EEG, sleep studies, ECG and EMG. Python has excellent tooling
for it. JavaScript didn't. This is every EDF package on npm, surveyed in mid-2026:

| | Before edfcore |
|---|---|
| TypeScript types | No standalone reader ships them |
| Random access | Nothing published does byte-range reads; a 24 h study is loaded whole or not at all |
| BDF (24-bit) | No published package can read it. BioSemi hardware has no JS support |
| EDF+D (gaps) | Unsupported or, worse, decoded as if contiguous, producing a silently wrong timeline |
| Errors | `console.warn` and `null`, or bare thrown strings; nothing typed or located |
| Header validation | Essentially none. No size checks, no degenerate-range checks |

So people building EEG viewers don't reach for an EDF package. They hand-roll a parser and
reproduce the same bugs.

The strongest existing implementation is
[`@epicurrents/edf-reader`](https://github.com/epicurrents/edf-reader): real TAL parsing, real
partial reads, BDF support. It's a plugin inside an EEG application framework, so it arrives
with that framework attached. Use it if you want a whole viewer stack. edfcore is a small,
standalone, dependency-free file-format library you can drop into any project.

---

## Design in one page

**A bad file either throws or reports itself.** One rule decides which. If edfcore can't
continue without inventing something, it throws. If it can continue on what the file says, it
records a diagnostic on the result. There's no third option, and nothing is written to the
console.

```ts
const recording = await openEdf(source);
for (const d of recording.header.diagnostics) {
  console.log(d.code, d.message, d.byteOffset);   // your logger, your call
}
```

Every diagnostic carries the field, the byte offset, the raw bytes as written, the spec clause it
violates, and what to do next. Pass `{ strict: true }` and the first one throws instead.

**Digital and physical are two functions.** `chunk.signals[i].digital` is an `Int32Array` of
the values as stored. `toPhysical(signal, digital)` returns a `Float64Array` in the signal's own
units. There's no `{ physical: true }` option, because it would change the return type, and no
`Float32` output (it costs about a quarter of a quantisation step on 24-bit BDF).

**Scaling can be refused.** A header that declares `digitalMinimum === digitalMaximum` defines
no scale: the gain is a division by zero. edfcore sets `signal.scale` to `undefined`, so reading
the gain without checking is a compile error, and `toPhysical` throws `EdfScalingError` at
runtime (it accepts any `EdfSignal`, so the call itself is not type-gated). `decodeDigital`
keeps working. EDFlib substitutes a gain of 1 here and returns ADC counts labelled as microvolts.

**Sample rates stay per-signal.** An EDF file can hold EEG at 256 Hz, ECG at 512 Hz and
temperature at 1 Hz. There's no recording-wide rate. Sample indexing uses `samplesPerRecord`
rather than a floating-point rate, and `sampleRateHz` is `undefined` when the record duration is
zero (which is legal EDF).

**Event times are exact.** Annotation onsets are parsed digit by digit into `bigint`
hundred-nanosecond ticks, not through `parseFloat`. Compare `onsetTicks`, not the float.

**Gaps are structural.** `readWindow` always returns an array of chunks, one per contiguous
run, including for continuous files. A window that falls inside a gap returns `[]`. There's no
gap-filling and no option to enable it.

**No `Date`.** EDF stores local time at the patient with no timezone, and a `Date` would apply
the reader's zone instead. You get `EdfCalendarDate` and `EdfClockTime`, plus
`formatStartTimeNaive()` for a zone-free ISO-like string.

---

## Reading data

The unit of I/O is the **record range**, not the channel range. EDF interleaves every channel
inside each data record, so there's no cheap single-channel read: asking for one channel over a
window still reads the records containing it. `chunk.byteLength` reports the bytes actually
read.

```ts
import { openEdf, readWindow, resolveTimeWindow } from 'edfcore';
import { fileSource } from 'edfcore/node';

const recording = await openEdf(await fileSource('./overnight.edf'));

// resolveTimeWindow is pure and does no I/O, so you can audit the cost first.
const ranges = resolveTimeWindow(recording.timeline, recording.index, 3600, 30);

const chunks = await readWindow(recording, {
  signalIndices: [0, 1, 2],
  startSeconds: 3600,
  durationSeconds: 30,
});
```

Chunks are record-aligned and may be slightly wider than requested. `trimToWindow()` narrows
them to a sample-exact window using integer arithmetic on `(record, sampleWithinRecord)` rather
than `round(t * rate)`.

### Sources

One interface, four adapters, all universal:

```ts
byteSource(arrayBufferOrUint8Array)
blobSource(fileOrBlob)                    // structural, no DOM types required
httpSource(url, { headers })              // HTTP Range requests
cachedSource(inner, { blockBytes })       // the only caching, opt-in
```

and from `edfcore/node`:

```ts
fileSource('./recording.edf')
fileHandleSource(handle, byteLength)
```

Bring your own by implementing `ByteSource`, which has three members. The contract is *exactly
`length` bytes or reject*, and edfcore verifies it on every call, including on sources you
supplied.

### Discontinuous recordings

Opening a file never scans it. For EDF+D the index starts out `'probed'`, meaning record 0 and
the last record only. It throws rather than map a timestamp to a record across an unmapped gap:

```ts
const index = await buildRecordIndex(recording, { onProgress: (done, total) => … });
const located = { ...recording, index };

index.coverage;   // 'complete'
index.segments;   // EdfSegment[] — only defined once coverage is complete
index.gaps;       // EdfGap[]
```

`segments` is `undefined` while coverage is `'probed'`, so no property reads as
"continuous" before anything has checked.

### Triage

`inspectEdf()` reads at most 128 KiB and never throws on malformed content. It is the right first
call for an unfamiliar file:

```ts
const { ok, variant, header, diagnostics } = await inspectEdf(source);
console.log(formatDiagnostics(diagnostics));
```

---

## What it deliberately does not do

edfcore is a file-format library. It is not an EEG analysis framework. These are permanent non-goals: filtering, resampling,
re-referencing, montages, ICA, artifact rejection, bad-channel detection, spectral analysis,
event detection, channel-type inference from labels, unit normalisation to SI volts, and
anything involving AI or a network service.

Writing EDF is out of scope through 1.0. Producing a *correct* file is a much larger normative
commitment than tolerating an incorrect one, and a subtly non-conformant writer would undermine
the reason to trust the reader.

---

## Compatibility

- **Node** ≥ 22.12.0 · **Chrome/Edge** 94+ · **Firefox** 93+ · **Safari** 15.4+
- The browser half of that line is tested, not asserted. Every other test in this repository runs
  under `environment: 'node'`, where `process.env` and `Buffer.from` work perfectly — so none of
  them could catch a bare Node global, which needs no import and passes the module-graph walk
  untouched. Since 0.2.11 the built universal bundle is driven end to end in a realm whose
  Node-only globals throw the way a browser does. The version numbers above remain a
  syntax-and-API floor rather than a per-browser test matrix; what is now checked is that nothing
  reaches outside the platform.
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

**Numerical interop, as of 0.2.34.** edfcore reproduces **pyEDFlib's float64 physical values bit
for bit** on EDF and 24-bit BDF, across symmetric and asymmetric ranges. That is a test, not a
belief: `scripts/golden/generate.py` writes the fixtures with pyEDFlib's own writer, reads them
back with pyEDFlib, and records every sample as its exact IEEE-754 bit pattern;
`tests/corpus/golden-values.test.ts` compares with `Object.is`, so one ULP is a failure. Nothing in
`tests/corpus/golden/` was produced by edfcore. Substituting the numerically better textbook
expression fails it on 140 of 256 samples — which is why the EDFlib form is pinned.

**MNE, as of 0.2.44.** edfcore agrees with MNE to within 1e-12 relative — a weaker claim than the
one above, and deliberately so. MNE returns SI units, so a microvolt channel arrives divided by
1e6, and that division is lossy; the residue is MNE's unit conversion rather than a disagreement
about the sample. Bit-parity is claimed for pyEDFlib alone. Both readers also agree with the file's
own declaration about POLARITY on a negative-gain channel, which a value comparison alone could not
establish.

**The public corpora, as of 0.2.48.** The bit-for-bit claim above also holds on files nobody here
chose: a **22-hour clinical polysomnogram** from sleep-edfx, and the teuniz generator files in EDF,
EDF+ and 24-bit BDF+. Sampled at the start, the middle and the end of every signal — the end window
being the one that catches record arithmetic drifting with distance, which a sample near record 0
cannot.

What else those files establish, which synthetic fixtures cannot:

| Claim | Checked how |
|---|---|
| Annotation onsets match pyEDFlib | 154 sleep stages from a real scoring file, to the tick |
| A legally **zero** record duration works | that same file — where `sampleRateHz` is `undefined` and any rate-derived expression yields `NaN` |
| The 1985–2084 year rule is right | a 1989 recording, against a reader that implements it independently |
| Decimation keeps every extreme | 7,950,000 samples reduced to 1,000 buckets, compared with an exhaustive reduction |
| The bucket grid ignores chunk size | 265 chunks versus a handful |
| Memory is bounded by the chunk | that 22-hour envelope produced under a 512 KiB budget |
| Streaming equals reading | 42 streamed chunks concatenated and compared sample by sample |
| **Random access is real** | a 30-second window twelve hours in costs **under 64 KB** over HTTP |
| `validate` is usable as a CI gate | exits 0 on a real recording from a real sleep lab |
| The sample scan sees what pyEDFlib sees | whole-signal digital extremes, all five files |

Those tests need the corpus and skip without it. `coverage.test.ts` always runs and says which
state you are in, because a skipped test and a passing one look identical in a summary line:

```bash
npm run corpus:fetch
```

**CHB-MIT, as of 0.2.58.** A second real clinical recording, deliberately unlike the first: 23
channels at a uniform 256 Hz in one-second records, recorded in 2010 at another institution, where
sleep-edfx is 7 channels at mixed rates in 30-second records from 1989. Same bit-for-bit parity. It
also supplies something no synthetic fixture here had — a montage that names one derivation twice,
which is what `EdfAmbiguousChannelError` exists for and had until now only ever been raised against
a fixture written to raise it.

**The format author's own calibration file, as of 0.2.60.** `calib.rec` was written by Bob Kemp —
who wrote the EDF specification — expressly to check that a reader gets amplitude *and polarity*
right. It is the only fixture here whose expected values come from neither edfcore nor another
library but from the file's own design: its gain is 25/1024, exactly representable in binary, so
digital `-2048` is exactly `-50 µV` and a human can check it from the header by hand. edfcore
returns the exact levels, and the negative extreme comes from the negative code — which is the
whole point, since a reader that swapped the bounds would return plausible microvolts of the wrong
sign and invert the clinical reading of the trace.

**Still open before 1.0.** Nothing named. The remaining work is API, not verification — see the
0.3 note in [CHANGELOG.md](https://github.com/tayal-sarthak/edfcore/blob/main/CHANGELOG.md).

**Shipped since 0.1.6.** Min/max envelope decimation (`readEnvelope`,
`readEnvelopeAtResolution`). BioSemi Status-byte helpers (`readTriggers`). Streaming iteration
(`streamRecords`). Annotation queries, exact time-to-sample conversion, and text formatters for
the header and the validation report. Chunk joining that refuses to concatenate across a gap
(`mergeChunks`). Timeline lookup with no read (`segmentAt`, `gapAt`, `contiguityOf`). Signal
lookup by pattern (`matchSignals`) and ordered physical bounds (`physicalRangeOf`). See
[API — helpers](https://edfcore.vercel.app/docs/api-helpers) and
[CHANGELOG.md](https://github.com/tayal-sarthak/edfcore/blob/main/CHANGELOG.md).

**Still later, additive.** The `edffloat` logarithmic inverse transform, opt-in — still detected
and rejected, because applying an inverse edfcore cannot verify against a real edffloat file is
exactly the invention this library refuses. JSR publication.

---

## Documentation

The full documentation site lives in
[`website/`](https://github.com/tayal-sarthak/edfcore/tree/main/website), an Astro build with
twenty pages.
It includes a **local inspector** that opens an EDF file and shows its header, channels, events
and waveforms in your browser, with nothing uploaded.

```bash
npm install --prefix website
npm run dev --prefix website
```

Start with **Concepts**, which is the mental model the rest of the API follows from. Then the guides (reading signals, physical values, annotations, discontinuous recordings,
diagnostics, data sources, large files, validation), the API reference, and the background
pages. Those include a standalone primer on the EDF format itself.

### Deploying the site

[`vercel.json`](https://github.com/tayal-sarthak/edfcore/blob/main/vercel.json) is set up so
linking this repository to Vercel works as is.
**Leave the Root Directory as the repository root** and don't pick a framework preset. The
build compiles the library first (the site imports `edfcore` from the parent package), then
builds the site into `website/dist`.

Nothing needs configuring for URLs: Astro reads Vercel's own production-domain variable, so the
sitemap and canonical links are correct on the first deploy. If you later point a custom domain
at it, set `SITE_URL` to that origin in the project's environment variables.

**Design decisions** — why the API is shaped the way it is, including the choices that look
like bugs and are not (the pinned scaling expression, `readWindow` always returning an array,
`scale` being `undefined` rather than fabricated) are documented on the site under
*Background → Design decisions*.

- [`tests/README.md`](https://github.com/tayal-sarthak/edfcore/blob/main/tests/README.md) covers
  how the suite builds every fixture in memory,
  and why no binaries are committed.

## License

MIT © Sarthak Tayal
