---
title: Installation
description: Install edfcore, check your runtime, and learn what each of the three entry points gives you.
section: "Start here"
order: 1
lead: One package, no dependencies, three entry points. The universal one works everywhere. The other two cover filesystem access and conformance checking.
---

## Install

```bash
npm install edfcore
```

That's the whole install. edfcore has no runtime dependencies (not optional ones, not peer ones), so nothing else is pulled in. The only code that runs is code you can read in this repository.

TypeScript declarations ship in the package. There's no `@types/edfcore` to install. The published `.d.ts` files reference neither the DOM lib nor `@types/node`, so adding edfcore to a project can't change what else your compiler thinks is available.

## Runtimes

| Runtime | Minimum |
|---|---|
| Node | 22.12.0 |
| Chrome, Edge | 94 |
| Firefox | 93 |
| Safari | 15.4 |

Deno and Bun work through the same build the browser uses. There's nothing runtime-specific to configure for them.

Those browser versions are where the four platform features edfcore relies on all became available: ES2022 syntax, `BigInt`, `Blob.prototype.slice`, and `TextDecoder`. `BigInt` carries the annotation onsets, which are parsed into exact 100-nanosecond ticks rather than floats. Float equality on event times is how alignment breaks.

The Node floor is 22.12.0 for the reason covered next.

## ESM and `require()`

edfcore is published as ES modules only. There's no CommonJS build, and there won't be one. Two builds means two copies of `EdfFormatError` in a dependency tree, and `instanceof` then returns false for errors that came from this library.

You can still `require()` it from CommonJS on Node 22.12.0 or newer. That version is exactly where `require(esm)` became available unflagged. It works for edfcore because there is **no top-level `await` anywhere in the module graph**, and Node cannot synchronously require an ES module that has one. Nothing in edfcore is initialised asynchronously.

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

### `edfcore` (universal)

Everything that parses, decodes and reads bytes. This entry point imports no Node built-in, transitively, so it bundles for a browser with no polyfill and no resolution alias.

It gives you the parser (`parseHeader`, `decodeDigital`, `decodeAnnotations`, `toPhysical`), the time layer (`resolveTimeWindow`, `trimToWindow`, `buildRecordIndex`, `buildTimeline`) and the convenience layer (`openEdf`, `readRecords`, `readWindow`, `readAnnotations`, `inspectEdf`). It also gives you the runtime-independent I/O adapters (`blobSource`, `byteSource`, `httpSource`, `cachedSource`), the error classes, and every public type.

### `edfcore/node` (filesystem adapters)

Two functions, and the only module in the package that imports from `node:`. The universal entry
cannot reach it — that is what makes `edfcore` safe in a browser, and a test walks the module graph
to prove it.

```ts
import { fileHandleSource, fileSource } from 'edfcore/node';
```

`fileSource(path)` opens a file and hands you a `ByteSource` over it; you close it with `source.close()` when you're done. `fileHandleSource(handle, byteLength)` wraps a file handle you already opened, for the cases where you know something about the size that the handle does not.

Nothing `edfcore` can reach imports from `node:`, and a packaging test greps the built universal bundle for that scheme prefix. The `bin` program (`dist/cli.js`) does import `node:fs/promises` and `node:process` — it is a Node program, and no import path reaches it.

### `edfcore/validate` (conformance)

```ts
import { validateHeader, validateRecording } from 'edfcore/validate';
```

The dividing line is one question: does the check affect a byte offset? If it does, it's in the core and always runs. Checks that only report a departure from convention live here: a label that doesn't follow the EDF+ `"<type> <sensor>"` form, a blank transducer field, a patient identification that doesn't parse as subfields. A consumer who never imports this module reads exactly the same samples.

## Export conditions

The `exports` map has no `"browser"`, `"node"`, `"import"`, `"require"`, `"worker"` or `"development"` conditions. Each subpath resolves to one `types` entry and one `default` entry, and that is all:

```json
{
  ".":          { "types": "./dist/index.d.ts",    "default": "./dist/index.js" },
  "./node":     { "types": "./dist/node.d.ts",     "default": "./dist/node.js" },
  "./validate": { "types": "./dist/validate.d.ts", "default": "./dist/validate.js" }
}
```

Conditional exports are the single largest source of "it works in my test runner but not in my bundler" reports across the ecosystem. Every tool applies a slightly different condition set, and the failure is a different build rather than an error. With no conditions to disagree about, Vite, webpack, esbuild, Rollup, Metro, Jest, Vitest and Node all resolve `edfcore` to the same file.

`./package.json` is also exported, which some tooling looks for.

## Where to go next

Read [Quick start](/docs/quick-start) to get real sample values on screen in either runtime, then [Concepts](/docs/concepts) for the mental model that makes the rest of the API predictable.

> **Note**
> edfcore is pre-1.0. Alongside 1,200+ tests on generated fixtures, it's checked against public corpora it did not author: the teuniz.net EDF/EDF+/BDF+ test files and PhysioNet's sleep-edfx. That includes a real 22-hour polysomnography recording. Those checks are numeric rather than smoke tests. The physical-value expression is compared bit for bit against pyEDFlib by the harness on the [physical values](/docs/physical-values) page; a full element-by-element comparison against MNE is not made here. Treat the API surface as still able to move.
