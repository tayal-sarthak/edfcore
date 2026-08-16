---
title: "API: sources"
description: "Every way to get bytes in: memory, Blob, HTTP range requests, a block cache, and the Node file adapter — all behind one ByteSource interface."
section: Reference
order: 3
lead: edfcore never opens a file itself. Everything it reads arrives through one three-member interface, which is why the same code path serves memory, disk, a dropped File and an HTTP URL.
---

```ts
import { byteSource, blobSource, httpSource, cachedSource } from 'edfcore';
import { fileSource, fileHandleSource } from 'edfcore/node';
```

`edfcore/node` imports one Node built-in, `node:fs/promises`, and the universal entry cannot reach it. Keeping every such import out of that graph is what lets the universal entry point be bundled for a browser with no polyfill and no resolution alias. The `bin` program (`dist/cli.js`) imports `node:fs/promises` and `node:process`, and no import path from `edfcore` reaches it. A packaging test walks the whole module graph reachable from `edfcore` and checks that no `node:` specifier hides in it.

## ByteSource

```ts
interface ByteSource {
  readonly byteLength: number;
  read(offset: number, length: number, options?: ReadOptions): Promise<Uint8Array>;
  close?(): Promise<void> | void;
}
```

A random-access byte range reader. That's the entire contract, and every entry point in edfcore that reads a recording takes one.

| Member | Meaning |
| --- | --- |
| `byteLength` | The size of the whole resource, in bytes. Must be known before any read. [`parseHeader`](/docs/api-primitives#parseheader) needs it to recover a `-1` record count and to detect truncation. |
| `read(offset, length, options?)` | Resolves with **exactly** `length` bytes, or rejects. Never pads, never truncates. The returned array is owned by the caller. |
| `close?()` | Optional. Releases whatever the source holds. edfcore never calls it for you. |

### The exact-length rule

**A read resolves with exactly `length` bytes or it rejects.** edfcore verifies this on every call, including calls into a source you wrote yourself, and a violation throws `EdfSourceError` carrying `offset`, `requestedLength` and `receivedLength`.

A source that returns a short buffer is indistinguishable from a truncated file. Without the check, a network mount that hiccupped shows up as `PARTIAL_FINAL_RECORD` on an otherwise good file. If your `read` can return early, loop until the bytes have arrived and reject if they never do.

### Ownership

The array a `read` resolves with belongs to the caller. A caching implementation must therefore hand back a **copy**, not a view into a block it retains. Otherwise a caller that writes into the result corrupts what the next reader sees.

`byteSource` is the exception. It hands back a `subarray` of the caller's *own* buffer, so it retains nothing the caller doesn't already hold.

### Writing your own

```ts
import type { ByteSource, ReadOptions } from 'edfcore';

function sliceSource(inner: ByteSource, start: number, length: number): ByteSource {
  return {
    byteLength: length,
    async read(offset: number, count: number, options?: ReadOptions): Promise<Uint8Array> {
      if (offset < 0 || count < 0 || offset + count > length) {
        throw new RangeError(`read(${offset}, ${count}) is outside this ${length}-byte slice`);
      }
      return inner.read(start + offset, count, options);
    },
    close: () => inner.close?.(),
  };
}
```

Two things to respect. Offsets are plain JavaScript numbers throughout edfcore, exact to 2^53. Never truncate one with `| 0`, which wraps past 2 GiB and turns a 13 GB BDF into nonsense. And honour `options.signal` if you can: edfcore polls it around its own reads, but only your source knows how to cancel a request in flight.

## byteSource

```ts
function byteSource(bytes: ArrayBuffer | Uint8Array): ByteSource
```

The in-memory adapter. Zero-copy by construction: a read hands back a `subarray` view over the buffer you passed in.

A `Uint8Array` given with a non-zero `byteOffset` over a larger buffer is respected. `subarray` is relative to the view, so there's no offset arithmetic to get wrong. An `ArrayBuffer` is wrapped in a fresh view. The returned source has no `close`.

Detection uses `ArrayBuffer.isView` rather than `instanceof Uint8Array`, because `instanceof` is false for a view that crossed a realm boundary, and this is a public entry point.

```ts
import { byteSource, openEdf } from 'edfcore';

const response = await fetch('/small.edf');
const source = byteSource(await response.arrayBuffer());
const recording = await openEdf(source);
```

Use this for files small enough to hold entirely (a few tens of megabytes). For anything larger, [`httpSource`](#httpsource) or [`fileSource`](#filesource) read only what you ask for.

## blobSource

```ts
function blobSource(blob: BlobLike): ByteSource
```

The `Blob` and `File` adapter. Use it for a file the user picked from `<input type="file">` or dropped onto the page. The browser reads ranges off disk, so a 2 GB recording never enters memory.

`byteLength` comes from `blob.size`. A zero-length read short-circuits to an empty array. `Blob.slice` takes an **exclusive** end, unlike an HTTP byte range, and this adapter handles that difference so you never see it.

A `Blob` read is one of the few places where the platform can legitimately hand back fewer bytes than asked. One case is a `File` whose backing file changed on disk since the picker ran. The exact-length contract is verified rather than assumed there, and a short read throws `EdfSourceError`.

```ts
import { blobSource, openEdf } from 'edfcore';

input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (file === undefined) return;
  const recording = await openEdf(blobSource(file));
  console.log(recording.header.signals.map((s) => s.label));
});
```

The DOM `Blob` type is never named in edfcore's own types; [`BlobLike`](#structural-platform-shims) is a structural shim a real `File` satisfies.

## httpSource

```ts
function httpSource(
  url: string | { readonly href: string },
  options?: HttpSourceOptions,
): Promise<ByteSource>
```

Turns a URL into random access over HTTP Range requests, without downloading the recording. This is the adapter for opening a 13 GiB BDF in a browser tab. It accepts a `URL` object as well as a string, because `URL` structurally satisfies `{ href: string }`.

It's `async` because the source length must be known before any read. Three ways are tried, cheapest first, and failing to find one is fatal:

1. `options.byteLength`, if you passed it. No network request at all.
2. A `HEAD` request, using its `Content-Length`. A rejected or forbidden `HEAD` is common (CORS, some object stores) and falls through to the next step.
3. A `GET` with `Range: bytes=0-0`, using the total from `Content-Range`.

Three behaviours are load-bearing:

- **A byte range is inclusive at both ends.** `bytes=0-0` is one byte. edfcore emits `bytes=${offset}-${offset + length - 1}`.
- **A `200 OK` answer to a Range request means the server ignored the header** and is sending the whole resource. That throws `EdfSourceError` by default, rather than buffering gigabytes because a CDN is misconfigured. Pass `allowFullDownload: true` to accept it. The body is then buffered once, and every subsequent read is served from memory.
- **Concurrency is bounded by a semaphore.** A released slot is handed straight to the next waiter rather than returned to a pool, so the in-flight count can never overshoot the limit.

Any other non-2xx status throws `EdfSourceError` naming the status and the range.

```ts
import { httpSource, openEdf } from 'edfcore';

const source = await httpSource('https://data.example.org/night.bdf', {
  headers: { Authorization: `Bearer ${token}` },
  maxConcurrency: 6,
});

const recording = await openEdf(source);
```

Opening an EDF+ file over that source issues five requests in total. One `HEAD` for the length, then `bytes=0-255` and one more range covering the rest of the header. Then one whole data record at each end of the file, for the timekeeping probes. Every header you passed goes on all five. Wrap the result in [`cachedSource`](#cachedsource) if you expect overlapping reads.

### HttpSourceOptions

Extends `ReadOptions`, so `signal` and `maxMaterializeBytes` are available too.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `fetch` | `FetchLike` | `globalThis.fetch` | The implementation to use. Throws `EdfSourceError` at construction when neither is available. |
| `headers` | `Readonly<Record<string, string>>` | `{}` | Sent on every request, including the `HEAD` and the length probe. This is where authentication goes. `Range` is added by edfcore on top. |
| `byteLength` | `number` | probed | The resource size, when you already know it. Skips both probes entirely. Must be a non-negative safe integer or construction throws. |
| `maxConcurrency` | `number` | `4` | In-flight requests. Floored, and never below 1. Small enough to stay easy on a shared origin, large enough to hide latency. |
| `allowFullDownload` | `boolean` | `false` | Accept a `200` answer to a Range request and buffer the whole resource. |
| `signal` | `AbortSignalLike` | none | From `ReadOptions`. Used as the default for every request; a `signal` passed to an individual `read` wins over it. |

## cachedSource

```ts
function cachedSource(source: ByteSource, options?: CacheOptions): ByteSource
```

A block-aligned LRU over any other `ByteSource`. **This is the only cache in edfcore**: opt-in, visible at the call site, and removed by deleting one wrapper from the expression that built the source.

Two properties matter more than the hit rate. A read returns a **copy**, never a view into a retained block, so a caller who writes into the result can't corrupt what the next reader sees. And concurrent reads wanting the same block issue **one** underlying read. Over HTTP that is one request instead of eight.

A read wider than the entire budget bypasses the cache and goes straight to the source, because it would evict every block on its way through. `close()` clears the cache and delegates to the wrapped source's `close`, if it has one.

```ts
import { httpSource, cachedSource } from 'edfcore';

const remote = await httpSource('https://data.example.org/night.bdf');
const cached = cachedSource(remote, { blockBytes: 4096, maxBytes: 1024 * 1024 });

await cached.read(0, 256);   // one 4096-byte request to the origin
await cached.read(256, 256); // served from that block — no request
await cached.read(0, 100);   // served from that block — no request
```

### CacheOptions

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `blockBytes` | `number` | `1048576` (1 MiB) | Block size. Floored, never below 1, and clamped down to `maxBytes`, since a block wider than the whole budget evicts itself on every insert. |
| `maxBytes` | `number` | `67108864` (64 MiB) | LRU budget. Floored, never below 0. |

Blocks are **byte-aligned, not record-aligned**. This module never sees a header, so there's no record size for it to align to. To make block boundaries fall on record boundaries, round `blockBytes` to a multiple of `header.recordByteLength` yourself.

> **Note**
> Caching a source that is already in memory buys nothing and costs a copy per read. `cachedSource` is for `httpSource`, and for a `fileSource` on a slow or networked mount.

## fileSource

```ts
function fileSource(path: string): Promise<ByteSource>
```

From `edfcore/node`. Opens a file for reading and exposes it as a `ByteSource`.

The size comes from the open handle rather than from a separate `stat(path)` call. The size and the bytes therefore describe the same file even if the path is replaced between the two, which happens on a rotating log or an rsync target. When the operating system reports a size that is not a safe non-negative integer, `fileSource` throws `EdfSourceError`. Its message tells you to check that the path names a regular file rather than a directory, a pipe or a device.

The handle is closed if anything goes wrong before it has an owner. After that, **closing is yours**. Call `source.close()` when you're done. edfcore has no other lifetime mechanism yet; `Symbol.asyncDispose` is not Baseline yet.

```ts
import { fileSource } from 'edfcore/node';
import { openEdf, readWindow } from 'edfcore';

const source = await fileSource('/data/night.edf');
try {
  const recording = await openEdf(source);
  const chunks = await readWindow(recording, {
    startSeconds: 0,
    durationSeconds: 30,
    signalIndices: recording.header.dataSignalIndices,
  });
} finally {
  await source.close?.();
}
```

> **Warning**
> `fs.openAsBlob` is never used internally, however tempting `blobSource(await openAsBlob(path))` looks. It reports `size` modulo 2^32 and yields zeros above 4 GiB, which turns a 13 GB BDF into a file that reads as silence with no error anywhere. Use `fileSource`.

## fileHandleSource

```ts
function fileHandleSource(handle: FileHandleLike, byteLength: number): ByteSource
```

From `edfcore/node`. Wraps a file handle you already hold. `close()` on the returned source closes the handle.

Reads are **positional and loop**. `FileHandle.read` is allowed to return fewer bytes than asked (a signal interrupted the syscall, the file lives on a network mount). The loop runs until `length` bytes have arrived. A genuine end of file falls out as an `EdfSourceError` naming both counts. The handle's own file position is never used, so concurrent reads through one handle can't interleave into each other's buffers.

`byteLength` is supplied by you rather than read from the handle. `fileSource` takes it from the handle it has only now opened. A caller wrapping a handle it already had may know something better: a range it intends to expose, or a size it verified.

```ts
import { open } from 'node:fs/promises';
import { fileHandleSource } from 'edfcore/node';
import { readHeader } from 'edfcore';

const handle = await open('/data/night.edf', 'r');
const { size } = await handle.stat();
const source = fileHandleSource(handle, size);

const header = await readHeader(source);
await source.close?.();
```

### FileHandleLike

```ts
interface FileHandleLike {
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}
```

A positional reader with a lifetime. A real `fs.promises.FileHandle` satisfies it structurally, with no cast. It is declared here rather than imported, so `@types/node` never enters edfcore's published `.d.ts`.

## Structural platform shims

edfcore compiles with `lib: ["ES2022"]` and `types: []`. Neither the DOM nor `@types/node` leaks into the published `.d.ts`. A library that names `Blob` forces every consumer to have `lib.dom`, and one that names `Buffer` forces `@types/node` on every browser build. The platform types edfcore needs are all **structural**, so it declares the minimum shape it uses and lets the real ones satisfy it.

The real platform types are assignable to these. You never write one by hand except when building a test double.

### BlobLike

```ts
interface BlobLike {
  readonly size: number;
  slice(start?: number, end?: number): BlobLike;
  arrayBuffer(): Promise<ArrayBuffer>;
}
```

A DOM `Blob` and a `File` both satisfy it. Taken by [`blobSource`](#blobsource).

### AbortSignalLike

```ts
interface AbortSignalLike {
  readonly aborted: boolean;
}
```

A real `AbortSignal` satisfies it. Carried by `ReadOptions.signal`.

edfcore polls `.aborted` before and after each read and throws an `Error` whose `name` is `'AbortError'`. `DOMException` cannot be named without the DOM lib, and `error.name` is what consumers actually branch on.

### HttpResponseLike

```ts
interface HttpResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}
```

A `fetch` `Response` satisfies it. A real `Headers` lookup is case-insensitive, but a hand-written test double usually is not, so `httpSource` tries both the given spelling and the lowercase one.

### FetchLike

```ts
type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; method?: string },
) => Promise<HttpResponseLike>;
```

`globalThis.fetch` is assignable to this.

**`signal` is absent from the `init` type, and it is still passed at runtime.** The reason is parameter contravariance, and there's no way around it. `init` is a parameter, so for `globalThis.fetch` to remain assignable to `FetchLike`, edfcore's `init` type must be assignable to `fetch`'s own `RequestInit`. Declaring `signal?: AbortSignalLike` breaks that, because the shim is not assignable to the real `AbortSignal`, which has far more members. Declaring `signal?: AbortSignal` puts the DOM type into the published `.d.ts`, which is the exact dependency these shims exist to avoid. The type therefore says less than the runtime does.

At runtime the signal is attached to `init` only when it carries `addEventListener`, i.e. when it genuinely is an `AbortSignal`. The platform `fetch` throws a `TypeError` on anything else. A caller who passed a bare `{ aborted }` shim is still served by the polls around the request, so cancellation works either way.

If you write your own `FetchLike`, read `signal` off `init` with a cast:

```ts
import type { FetchLike } from 'edfcore';

const instrumented: FetchLike = async (url, init) => {
  const signal = (init as { signal?: AbortSignal }).signal;
  console.log(url, init.headers.Range);
  // `?? null` rather than `signal`: `RequestInit.signal` is `AbortSignal | null`, and under
  // `exactOptionalPropertyTypes` an `undefined` is not assignable to it.
  return fetch(url, { ...init, signal: signal ?? null });
};
```

No cast is needed on the way out: a real `Response` already satisfies `HttpResponseLike`.

## Choosing an adapter

| Situation | Adapter |
| --- | --- |
| Bytes already in memory | `byteSource` |
| A `File` from a picker or a drop | `blobSource` |
| A path on disk, in Node | `fileSource` from `edfcore/node` |
| A handle you already opened | `fileHandleSource` from `edfcore/node` |
| A URL whose origin supports Range | `httpSource` |
| Any of the above, over a slow transport | wrap it in `cachedSource` |

For the reasoning behind each, and for what a read pattern looks like in practice, see [Data sources](/docs/data-sources) and [Large files](/docs/large-files).
