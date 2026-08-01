---
title: EDF libraries for JavaScript, compared
description: An honest look at the other ways to read EDF in JavaScript, what each one does well, and when you should use one of them instead of edfcore.
section: Background
order: 3
lead: A handful of packages on npm read EDF, and one of them is serious prior art. This page says what each does, where the gaps are, and why the most common approach of all is still to write your own parser.
---

## Which JavaScript library should I use to read EDF files?

Every claim on this page comes from a survey of the npm registry and the projects' own repositories carried out in **mid-2026**. Package ecosystems drift, maintainers ship, and a capability listed here as absent may exist by the time you read it. Check before you decide anything on the strength of a table.

Where this page does not know something, it says so rather than guessing. The behavioural notes below come from reading each project's published source, and the capability table marks anything this survey did not check either way.

## @epicurrents/edf-reader

The strongest prior art, by a distance. It does real TAL parsing rather than approximating it, it does genuine partial reads rather than loading the file whole, and it handles BDF's 24-bit samples. Someone thought carefully about this format, and it shows.

The catch is not quality, it is packaging. It is a plugin for the Epicurrents EEG application framework, so it arrives with that framework's module system, its study/resource abstractions and its worker plumbing attached. That is a feature if you are building on Epicurrents and a substantial imposition if you wanted a function that turns bytes into numbers. There is a second wrinkle worth checking for yourself: the artifact published to npm predates a good deal of the work in the repository, so what `npm install` gives you and what the source tree contains are not the same library.

**Use it if you want a viewer stack.** If the job is "build an EEG application" rather than "read this file", Epicurrents gives you a coherent whole — rendering, montages, resource management — and edfcore gives you a parser you would then have to build the rest around. That is a real recommendation, not a courtesy.

## edfjs

Reads EDF and parses it into channel objects. It is the shortest path from a file to a plottable array if the file is small and well formed.

Two things constrain it. It allocates a `Float32Array` per channel for the whole recording eagerly, so a multi-hour study is loaded in full before you can look at any of it, and float32 costs about a quarter of a quantisation step on 24-bit data if you ever get there. And it signals failure by throwing bare strings rather than `Error` objects, which means no stack, no `instanceof`, nothing to switch on — a `catch` block can only re-read the message text and hope it does not change.

## edfdecoder

A decoder in the codec-utils family, with a clean enough shape to it. Its error handling is the problem: a malformed file produces a `console.warn` and a `null` return. Nothing is thrown, so a caller that does not check gets a `TypeError` several frames away from the byte that caused it, and a caller that does check learns only that something was wrong somewhere.

It also carries a transitive dependency on `codecutils`, which has not been published since March 2018. For a parser handling files from arbitrary sources, an unmaintained transitive dependency is not just a maintenance question.

## edf-parser

Small and direct. Its notable defect is that it reuses singleton `Error` objects rather than constructing one per failure, so a message can describe a different failure than the one you caught, and two concurrent parses can overwrite each other's error state.

## The write-only packages

Some packages on npm write EDF rather than read it — the inverse problem, and a genuinely useful one if you are producing files from an acquisition pipeline. They are not alternatives for reading and are not in the table below. edfcore does not write EDF either, and will not before 1.0; if you need to produce a file, pyEDFlib and EDFlib both do it well.

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

Read the `@epicurrents` column as describing its repository, not the artifact currently on npm. "Not established" means this survey did not verify it either way — it is not a polite way of writing "no".

Two of those rows carry more weight than the others. **Random access** decides whether a 24-hour study is usable at all in a browser tab, and **EDF+D** decides whether a discontinuous recording produces a correct timeline or a plausible wrong one; a reader that treats an `EDF+D` file as contiguous does not fail, it reports every record after the first gap at the wrong time. [The EDF format](/docs/edf-format) explains why nothing about the bytes warns you.

## The honest market note

Combined weekly downloads across every EDF package on npm come to roughly **320**, surveyed in mid-2026. That is not a market with an incumbent to displace. It is a gap: people building EEG viewers in JavaScript overwhelmingly do not install an EDF package at all. They write a parser, because the format looks simple for an afternoon, and then they rediscover the field-major signal header, the 1985–2084 year rule, the `-1` record count and the timekeeping TAL, one production bug at a time.

edfcore's goal follows from that. It is not to win a comparison against edfjs. It is to be good enough and boring enough that the next person does not write another parser from scratch — which means the bar is not "better than the alternatives", it is "correct enough to trust with a clinical recording, and small enough that installing it costs less than writing one".

## Where edfcore is not the right answer

Being fair cuts in this direction too.

**You want a whole viewer.** Use `@epicurrents`. edfcore is one layer of what you need.

**You are in Python already.** pyEDFlib and MNE are mature, validated against enormous amounts of real data, and have years of clinical use behind them. edfcore targets exact float64 bit-parity with pyEDFlib precisely because pyEDFlib is the thing worth agreeing with.

**You need to write EDF.** Not before 1.0. [Design decisions](/docs/design-decisions) explains why that is a deliberate hold rather than a backlog item.

**You need a guarantee today.** edfcore is 0.1. The library is complete against its design and has a thorough test suite, but that suite is built almost entirely on synthetic files, and validation against large public corpora — sleep-edfx, CHB-MIT, the BioSemi and edfplus.info test files — has not happened yet. Nothing on this site claims numerical interop that a golden test did not produce, and until that harness exists, treat the API as still able to move.
