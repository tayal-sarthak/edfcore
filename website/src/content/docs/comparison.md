---
title: EDF libraries for JavaScript, compared
description: The other ways to read EDF in JavaScript, what each one does, and when to use one of them instead of edfcore.
section: Background
order: 3
lead: A handful of packages on npm read EDF, and one of them is substantial prior art. This page says what each does, where the gaps are, and how common it still is to write your own parser.
---

## Which JavaScript library should I use to read EDF files?

Every claim on this page comes from a survey of the npm registry and the projects' own repositories
carried out in **mid-2026**. Package ecosystems drift, maintainers ship, and a capability listed
here as absent may exist by the time you read it. Check before you decide anything on the strength
of a table.

Where this page doesn't know something, it says so rather than guessing. The behavioural notes
below come from reading each project's published source, and the capability table marks anything
this survey did not check either way.

## @epicurrents/edf-reader

The most complete prior art of the four. It parses TALs rather than approximating them, does
partial reads rather than loading the file whole, and handles BDF's 24-bit samples.

It's a plugin for the Epicurrents EEG application framework, so it arrives with that framework's
module system, its study/resource abstractions and its worker plumbing attached. One thing to check
for yourself: the artifact published to npm predates a good deal of the work in the repository, so
`npm install` and the source tree do not give you the same library.

**Use it if you want a viewer stack.** If the job is "build an EEG application" rather than "read
this file", Epicurrents gives you rendering, montages and resource management as one piece.
edfcore gives you a parser to build the rest around.

## edfjs

Reads EDF and parses it into channel objects. It's the shortest path from a file to a plottable
array if the file is small and well formed.

It allocates a `Float32Array` per channel for the whole recording eagerly, so a multi-hour study is
loaded in full before you can look at any of it. Float32 costs about a quarter of a quantisation
step on 24-bit data. It signals failure by throwing bare strings rather than `Error` objects, so
there's no stack, no `instanceof` and nothing to switch on. A `catch` block can only re-read the
message text.

## edfdecoder

A decoder in the codec-utils family. A malformed file produces a `console.warn` and a `null`
return. Nothing is thrown, so a caller that doesn't check gets a `TypeError` several frames away
from the byte that caused it. A caller that does check learns only that something was wrong
somewhere.

It also carries a transitive dependency on `codecutils`, which has not been published since March
2018.

## edf-parser

Small and direct. It reuses singleton `Error` objects rather than constructing one per failure, so
a message can describe a different failure than the one you caught. Two concurrent parses can
overwrite each other's error state.

## The write-only packages

Some packages on npm write EDF rather than read it, which is the inverse problem and a useful one
if you're producing files from an acquisition pipeline. They are not alternatives for reading and
are not in the table below. edfcore does not write EDF either, and will not before 1.0. To produce
a file, pyEDFlib and EDFlib both write EDF.

## Capabilities side by side

| Capability | edfcore | @epicurrents/edf-reader | edfjs | edfdecoder | edf-parser |
|---|---|---|---|---|---|
| TypeScript types | Yes | Yes | No | No | No |
| Random access | Yes | Yes | No | No | No |
| BDF / 24-bit | Yes | Yes | No | No | No |
| EDF+D | Yes | Not established | No | No | No |
| Annotations | Yes | Yes | Not established | Not established | Not established |
| Typed errors | Yes | Not established | No | No | No |
| Runtime dependencies | None | Framework | Transitive | Transitive | Not established |

Read the `@epicurrents` column as describing its repository, rather than the artifact currently on
npm. "Not established" means this survey did not verify it either way. It is not a polite way of
writing "no".

Two of those rows carry more weight than the others. **Random access** decides whether a 24-hour
study is usable at all in a browser tab. **EDF+D** decides whether a discontinuous recording
produces a correct timeline or a plausible wrong one. A reader that treats an `EDF+D` file as
contiguous does not fail; it reports every record after the first gap at the wrong time.
[The EDF format](/docs/edf-format) covers why nothing about the bytes warns you.

## The market note

Combined weekly downloads across every EDF package on npm come to roughly **320**, surveyed in
mid-2026. That is not a market with an incumbent to displace. It is a gap: people building EEG
viewers in JavaScript overwhelmingly do not install an EDF package at all. They write a parser,
because the format looks simple for an afternoon. Then they rediscover the field-major signal
header, the 1985–2084 year rule, the `-1` record count and the timekeeping TAL, one production bug
at a time.

edfcore's goal follows from that. It is that the next person does not write another parser from
scratch. The bar is not "better than the alternatives". It is "correct enough to trust with a
clinical recording, and small enough that installing it costs less than writing one".

## Where to use something else

**You want a whole viewer.** Use `@epicurrents`. edfcore is one layer of what you need.

**You are in Python already.** pyEDFlib and MNE are mature, validated against enormous amounts of
real data, and have years of clinical use behind them. edfcore targets exact float64 bit-parity
with pyEDFlib.

**You need to write EDF.** Not before 1.0. [Design decisions](/docs/design-decisions) has the
reasoning.

**You need a guarantee today.** edfcore is pre-1.0 and the API can still move. The suite is
largely synthetic by design, but not only: the golden harness compares every physical sample against
pyEDFlib's and MNE's own output, and the corpus tests run against sleep-edfx, CHB-MIT and the
BioSemi and edfplus.info test files. Those corpus tests SKIP without `npm run corpus:fetch`, so a
fresh clone proves the golden comparison and not the corpus one. Nothing on this site claims
numerical interop that a golden test did not produce.
