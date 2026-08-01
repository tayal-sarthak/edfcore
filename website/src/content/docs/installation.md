---
title: Installation
description: Install edfcore, check your runtime, and learn what each of the three entry points gives you.
section: "Start here"
order: 1
lead: One package, no dependencies, three entry points. The universal one works everywhere; the other two exist because filesystem access and conformance checking are not things every consumer should pay for.
---

## Install

```bash
npm install edfcore
```

That is the whole install. edfcore has no runtime dependencies — not optional ones, not peer ones — so nothing else is pulled in, and the only code that runs is code you can read in this repository.

TypeScript declarations ship in the package. There is no `@types/edfcore` to install, and the published `.d.ts` files reference neither the DOM lib nor `@types/node`, so adding edfcore to a project cannot change what else your compiler thinks is available.

## Runtimes

| Runtime | Minimum |
|---|---|
| Node | 22.12.0 |
| Chrome, Edge | 94 |
| Firefox | 93 |
| Safari | 15.4 |

Deno and Bun work through the same build the browser uses. There is nothing runtime-specific to configure for them.

Those browser versions are where the four platform features edfcore relies on all became available: ES2022 syntax, `BigInt`, `Blob.prototype.slice`, and `TextDecoder`. `BigInt` is not incidental — annotation onsets are parsed into exact 100-nanosecond ticks rather than floats, because float equality on event times is how alignment silently breaks, and that arithmetic has nowhere else to live.

The Node floor is 22.12.0 for one specific reason, covered next.

## ESM only, and why `require()` still works

edfcore is published as ES modules only. There is no CommonJS build, and there will not be one: two builds means two copies of `EdfFormatError` in a dependency tree, and then `instanceof` starts returning false for errors that plainly came from this library.

You can still `require()` it from CommonJS on Node 22.12.0 or newer. That version is exactly where `require(esm)` became available unflagged, and it works for edfcore specifically because there is **no top-level `await` anywhere in the module graph** — Node refuses to synchronously require an ES module that has one. Nothing in edfcore is initialised asynchronously, so the constraint costs nothing and the guarantee holds.

```js
// CommonJS, Node >= 22.12.0
const { openEdf, blobSource, getSignal } = require('edfcore');
const { fileSource } = require('edfcore/node');
```

From ES modules, which is the normal case:

```ts
import { openEdf, getSignal, readWindow, toPhysical } from 'edfcore';
import { fileSource } from 'edfcore/node';
```

## The three entry points

### `edfcore` — universal

Everything that parses, decodes and reads bytes. This entry point imports no Node built-in, transitively, which is what makes it safe to bundle for a browser with no polyfill and no resolution alias.

It gives you the parser (`parseHeader`, `decodeDigital`, `decodeAnnotations`, `toPhysical`), the time layer (`resolveTimeWindow`, `trimToWindow`, `buildRecordIndex`, `buildTimeline`), the convenience layer (`openEdf`, `readRecords`, `readWindow`, `readAnnotations`, `inspectEdf`), the runtime-independent I/O adapters (`blobSource`, `byteSource`, `httpSource`, `cachedSource`), the error classes, and every public type.

### `edfcore/node` — filesystem adapters

Two functions, and the only module in the package that imports from `node:`.

```ts
import { fileHandleSource, fileSource } from 'edfcore/node';
```

`fileSource(path)` opens a file and hands you a `ByteSource` over it; you close it with `source.close()` when you are done. `fileHandleSource(handle, byteLength)` wraps a file handle you already opened, for the cases where you know something about the size that the handle does not.

Keeping the `node:` import in exactly one file is the mechanism behind the previous section's claim, and a packaging test greps the built universal bundle for that scheme prefix to prove it stayed true.

### `edfcore/validate` — conformance

```ts
import { validateHeader, validateRecording } from 'edfcore/validate';
```

The dividing line is one question: does the check affect a byte offset? If it does, it is in the core and always runs, because correctness is not an optional install. If it only tells you the file is impolite — a label that does not follow the EDF+ `"<type> <sensor>"` convention, a blank transducer field, a patient identification that does not parse as subfields — it lives here. A consumer who never imports this module reads exactly the same samples.

## No environment conditions

The `exports` map has no `"browser"`, `"node"`, `"import"`, `"require"`, `"worker"` or `"development"` conditions. Each subpath resolves to one `types` entry and one `default` entry, and that is all:

```json
{
  ".":          { "types": "./dist/index.d.ts",    "default": "./dist/index.js" },
  "./node":     { "types": "./dist/node.d.ts",     "default": "./dist/node.js" },
  "./validate": { "types": "./dist/validate.d.ts", "default": "./dist/validate.js" }
}
```

This is deliberate. Conditional exports are the single largest source of "it works in my test runner but not in my bundler" reports across the ecosystem, because every tool applies a slightly different condition set and the failure is a silently different build rather than an error. With no conditions to disagree about, Vite, webpack, esbuild, Rollup, Metro, Jest, Vitest and Node all resolve `edfcore` to the same file. If a bundler hands you something surprising, it is not because edfcore offered it a choice.

`./package.json` is also exported, which some tooling looks for.

## Where to go next

Read [Quick start](/docs/quick-start) to get real sample values on screen in either runtime, then [Concepts](/docs/concepts) for the mental model that makes the rest of the API predictable.

> **Note**
> edfcore is at 0.1.0. It is complete against its design and has a thorough test suite built on synthetic files, but it has not yet been validated against the large public corpora (sleep-edfx, CHB-MIT, the BioSemi test files). Treat the physical values as trustworthy and the API surface as still able to move.
