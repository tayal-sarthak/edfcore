---
title: Data sources
description: How bytes reach edfcore — the ByteSource contract, the adapters for memory, files, blobs and HTTP, and how to write your own.
section: Guides
order: 7
lead: edfcore never opens a file itself. Every entry point that reads a recording takes a ByteSource, so the same code path serves a local file, an object store, a drag-and-dropped File and a URL served over HTTP Range.
---

## Start here

A `ByteSource` is a random-access byte range reader. You build one, hand it to `openEdf`, and read from the recording it returns.

```ts
import { fileSource } from 'edfcore/node';
import { openEdf } from 'edfcore';

const source = await fileSource('night.edf');
try {
  const recording = await openEdf(source);
  console.log(recording.header.variant, recording.header.recordCount, 'records');
} finally {
  await source.close?.();
}
```

Nothing above is specific to the filesystem. Replace `fileSource` with `blobSource(file)` and the same code runs in a browser tab; replace it with `httpSource(url)` and it runs against a 13 GiB recording on a CDN, reading only the parts you ask for.

## The interface

Three members, one of them optional.

```ts
interface ByteSource {
  readonly byteLength: number;
  read(offset: number, length: number, options?: ReadOptions): Promise<Uint8Array>;
  close?(): Promise<void> | void;
}
```

`byteLength` is the size of the whole resource in bytes, and it has to be known before the first read. EDF addresses everything by absolute byte offset — record `r` begins at `headerByteLength + r * recordByteLength` — so a source that does not know how far it extends cannot say whether an offset is addressable. edfcore also uses it to recover the record count when the header field reads `-1`, which is what a writer leaves behind when it never closed the file.

`read` returns the bytes at `[offset, offset + length)`. Offsets are plain JavaScript numbers, exact to 2^53, so a source over a multi-gigabyte BDF needs no special handling. The returned array belongs to the caller: an implementation that retains state must hand back a copy, never a view into a buffer it will reuse.

`ReadOptions` carries `signal` for cancellation and `maxMaterializeBytes` for the allocation budget. Both are optional, and both are passed straight through from whatever call started the read.

## The contract

> **Warning**
> A read resolves with exactly `length` bytes or rejects. It never pads, and it never truncates.

edfcore checks this on every call, including calls into a source you wrote, because neither way of breaking it announces itself. A source that quietly returns a short buffer is indistinguishable from a truncated file: without the guard, the likeliest outcome of one hiccuping socket is a confident `TRUNCATED_FILE` diagnostic about a perfectly good recording, and a bug hunt in the wrong file. Padding is worse. Zero is a valid sample value, so a padded read decodes into a flat line — plausible, wrong, and reported by nobody.

A violation raises `EdfSourceError` with the real numbers on it.

```ts
import { byteSource, isEdfError, openEdf } from 'edfcore';
import type { ByteSource, EdfSourceError } from 'edfcore';

const bytes = new Uint8Array(await (await fetch('/night.edf')).arrayBuffer());

// A source that drops one byte from every read. This is the bug the guard exists for.
const truncating: ByteSource = {
  byteLength: bytes.byteLength,
  async read(offset, length) {
    return bytes.subarray(offset, offset + length - 1);
  },
};

try {
  await openEdf(truncating);
} catch (error) {
  if (isEdfError(error) && error.edfErrorKind === 'source') {
    const sourceError = error as EdfSourceError;
    console.log(sourceError.offset, sourceError.requestedLength, sourceError.receivedLength);
    // 0 256 255
  }
}
```

The message says the same thing in words, and names the fix:

```
ByteSource.read(offset 0, length 256) resolved with 255 bytes. A ByteSource must resolve with
exactly the requested number of bytes or reject: padding or truncating makes a short read
indistinguishable from a truncated file. Next: make read() loop until `length` bytes have
arrived, and reject if they never do.
```

`EdfSourceError` also covers ranges a source cannot serve: a negative or non-integer offset, and a range that ends past `byteLength`. Discriminate it with `error.edfErrorKind === 'source'` rather than `instanceof`, which is false across a worker or iframe boundary.

## byteSource — bytes you already have

```ts
import { byteSource, openEdf } from 'edfcore';

const bytes = new Uint8Array(await (await fetch('/night.edf')).arrayBuffer());
const recording = await openEdf(byteSource(bytes));
```

`byteSource` accepts a `Uint8Array` or an `ArrayBuffer`, and reads are zero-copy: each one returns a `subarray` view over your own buffer. That is safe precisely because the buffer is yours — the ownership rule exists to stop an adapter handing out a view into state it retains, and this adapter retains nothing you do not already hold.

A `Uint8Array` with a non-zero `byteOffset` is respected. Offset 0 of the source is the first byte of the view, not the first byte of the underlying `ArrayBuffer`, so a recording embedded in a larger container needs no offset arithmetic at the call site.

```ts
// A 16-byte envelope, then the EDF file.
const view = envelope.subarray(16);
const recording = await openEdf(byteSource(view));
```

## blobSource — a browser File or Blob

```ts
import { blobSource, openEdf } from 'edfcore';

const input = document.querySelector('input[type=file]') as HTMLInputElement;
input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (file === undefined) return;

  const recording = await openEdf(blobSource(file));
  console.log(file.name, recording.header.signals.map((signal) => signal.label));
});
```

Nothing is loaded into memory here. `blobSource` slices the blob per read, so opening a 2 GiB file picked from disk reads its header — plus two small probes if the file is EDF+ — and stops there.

edfcore never names the DOM `Blob`. The parameter type is `BlobLike`, a structural interface declaring exactly `size`, `slice` and `arrayBuffer`, which is why the published type definitions carry no dependency on the DOM library and still accept a real `File` with no cast. It also means anything with those three members works: an OPFS handle wrapper, a test double, a `Blob` from Node's global.

A `Blob` read is the one place where the platform may legitimately return fewer bytes than asked — a `File` whose backing file changed on disk since the picker ran — so the exact-length contract is verified rather than assumed, and you get an `EdfSourceError` instead of shifted samples.

## fileSource and fileHandleSource — Node

These live in `edfcore/node`, the only module in the package that imports anything from `node:`. Keeping the import in exactly one file is what lets the universal entry point bundle for a browser with no polyfill and no resolver alias.

```ts
import { fileSource } from 'edfcore/node';
import { openEdf, readRecords } from 'edfcore';

const source = await fileSource('night.edf');
try {
  const recording = await openEdf(source);
  const chunk = await readRecords(recording, {
    records: { start: 0, count: 10 },
    signalIndices: recording.header.dataSignalIndices,
  });
  console.log(chunk.signals[0]?.sampleCount);
} finally {
  await source.close?.();
}
```

`fileSource` opens the path, takes the size from the handle it now holds rather than from a separate `stat` of the path, and closes the handle if anything fails before you own it. Taking the size from the handle means the size and the bytes describe the same file even if the path is replaced between the two, which on a rotating log or an rsync target is not hypothetical.

Reads are positional and they loop. `FileHandle.read` is allowed to return fewer bytes than asked — a signal interrupted the syscall, the file lives on a network mount — so the adapter keeps reading until `length` bytes have arrived, and a genuine end of file falls out as an `EdfSourceError` naming both counts. Because reads are positional, the handle's own file position is never used and concurrent reads through one handle cannot interleave into each other's buffers.

If you already hold a handle, wrap it and supply the length yourself:

```ts
import { open } from 'node:fs/promises';
import { fileHandleSource } from 'edfcore/node';
import { openEdf } from 'edfcore';

const handle = await open('night.edf', 'r');
try {
  const { size } = await handle.stat();
  const recording = await openEdf(fileHandleSource(handle, size));
  console.log(recording.header.variant);
} finally {
  await handle.close();
}
```

The length is a parameter rather than something the adapter reads off the handle, because the two ways of learning it promise different things: `fileSource` knows the size of the file it opened, while a caller wrapping an existing handle may know something better — a range it intends to expose, a size it verified. Neither is guessed for you.

> **Warning**
> Do not reach for `fs.openAsBlob(path)` and pass the result to `blobSource`. It reports `size` modulo 2^32 and yields zeros above 4 GiB, which turns a 13 GB BDF into a file that reads as silence with no error anywhere.

## httpSource — a URL, over Range requests

```ts
import { httpSource, openEdf, readWindow } from 'edfcore';

const source = await httpSource('https://example.org/recordings/night.edf');
const recording = await openEdf(source);

const chunks = await readWindow(recording, {
  startSeconds: 3600,
  durationSeconds: 30,
  signalIndices: recording.header.dataSignalIndices,
});
```

This is the adapter that makes a 13 GiB BDF openable in a browser tab. Opening an EDF+ file costs five requests — one `HEAD` for the length, two ranges for the header, then two probes of the first and last records for their timestamps — and the 30-second window above costs one more. A plain EDF has no per-record timestamps to probe, so it opens in three. Nothing else is transferred.

`httpSource` is async, unlike the other adapters, because it has to learn the length before it can serve a read. It tries three things, cheapest first: `options.byteLength` if you passed one, then a `HEAD` request's `Content-Length`, then a one-byte `Range: bytes=0-0` probe and the total in the `Content-Range` reply. A rejected or forbidden `HEAD` is common enough — CORS, some object stores — that it falls through to the probe rather than failing on it. If all three come up empty, `httpSource` rejects with `EdfSourceError`: no byte offset can be addressed, so random access is impossible and pretending otherwise would only move the failure somewhere less obvious.

### When the server ignores Range

A `200 OK` answer to a Range request means the server did not honour the header and is sending the whole resource. edfcore refuses that by default:

```
The server answered 200 OK instead of 206 Partial Content for Range bytes=0-0 on
https://cdn.example.org/night.edf, so it ignored the Range header and is sending the whole
resource (HTTP_RANGE_IGNORED). edfcore will not silently buffer a recording nobody asked for.
Next: serve the file from an origin or CDN that supports byte ranges, or pass
allowFullDownload: true to fetch it once and serve reads from memory.
```

Silently buffering gigabytes because a CDN is misconfigured is exactly the cost this library exists to make visible. If you know the file is small, or you have no way to fix the origin, opt in:

```ts
const source = await httpSource(url, { allowFullDownload: true });
```

The body then arrives once, is held in memory, and every later read is served from it as a copy. The refusal happens during the length probe, before a second request is made, so accepting means one download rather than two.

### Options

| Option | Default | What it does |
| --- | --- | --- |
| `fetch` | `globalThis.fetch` | The fetch implementation. Required on a runtime that exposes none. |
| `headers` | `{}` | Sent on every request, including the `HEAD` and the length probe. |
| `byteLength` | probed | Skips the `HEAD` and the probe entirely. |
| `maxConcurrency` | `4` | In-flight requests, enforced by a semaphore. |
| `allowFullDownload` | `false` | Accept a `200` answer instead of rejecting. |
| `signal` | — | Handed to `fetch` for the length probe, and for any read that carries no signal of its own. |

`headers` is the hook for authentication, and `fetch` is the hook for everything else — retries, a signed-URL refresher, an instrumented client. Anything matching `FetchLike` works, so a test double needs no network at all:

```ts
import { httpSource } from 'edfcore';
import type { FetchLike, HttpResponseLike } from 'edfcore';

const withRetry: FetchLike = async (href, init): Promise<HttpResponseLike> => {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(href, init as RequestInit);
    if (response.status !== 503 || attempt === 2) return response;
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
};

const source = await httpSource(url, {
  headers: { Authorization: `Bearer ${token}` },
  maxConcurrency: 2,
  fetch: withRetry,
});
```

`httpSource` accepts a `URL` object as well as a string, or anything else with an `href` property. One detail to know if you ever read the request log rather than write it: an HTTP byte range is inclusive at both ends, so a 512-byte read at offset 256 goes out as `bytes=256-767`.

## cachedSource — an LRU over any source

Every adapter above is thin, and none of them caches. `cachedSource` is the only cache in edfcore: you opt into it, it is visible at the call site, and you remove it by deleting one wrapper.

```ts
import { cachedSource, httpSource, openEdf } from 'edfcore';

const source = cachedSource(await httpSource(url), {
  blockBytes: 4 * 1024 * 1024,
  maxBytes: 128 * 1024 * 1024,
});
const recording = await openEdf(source);
```

Reads are served out of block-aligned blocks kept in an LRU — 1 MiB blocks and a 64 MiB budget by default. Two properties matter more than the hit rate. A read returns a copy, never a view into a retained block, so a caller who writes into the result cannot corrupt what the next reader sees. And concurrent reads that want the same block issue exactly one underlying read: over HTTP, the difference between one request and eight is the difference between usable and not.

Two sizes are clamped rather than left to misbehave. A `blockBytes` wider than `maxBytes` would evict itself on every insert, so it is clamped to the budget. A single read wider than `maxBytes` cannot benefit from the cache and would evict every block on its way through, so it goes straight to the source.

Block boundaries are byte-aligned, not record-aligned. The cache is format-independent by construction and never sees a header, so there is no record size for it to align to. If you want block boundaries to fall on record boundaries, read the header first and do the arithmetic yourself:

```ts
import { cachedSource, httpSource, openEdf, readHeader } from 'edfcore';

const raw = await httpSource(url);
const header = await readHeader(raw);

const target = 1024 * 1024;
const recordsPerBlock = Math.max(1, Math.floor(target / header.recordByteLength));
const source = cachedSource(raw, { blockBytes: recordsPerBlock * header.recordByteLength });

const recording = await openEdf(source);
```

`readHeader` costs two reads against the uncached source, and `openEdf` then reads the header a second time through the cache. That second pass pulls in block 0, which is the block your first record read needs anyway.

## Writing your own ByteSource

If your bytes live somewhere edfcore has no adapter for, implement the interface. The whole job is: know the length, return exactly the bytes asked for, and reject otherwise.

Here is a source over a storage API that hands back a stream per range — the shape most object stores have. The loop is the part that matters: a stream delivers chunks of whatever size it likes, so the read is not done until `length` bytes have arrived, and a stream that ends early is an error rather than a short return.

```ts
import { EdfSourceError } from 'edfcore';
import type { AbortSignalLike, ByteSource, ReadOptions } from 'edfcore';

interface RangeStore {
  size(key: string): Promise<number>;
  /** Inclusive at both ends, like an HTTP byte range. */
  openRange(key: string, start: number, end: number): Promise<ReadableStream<Uint8Array>>;
}

function throwIfAborted(signal: AbortSignalLike | undefined): void {
  if (signal?.aborted !== true) return;
  // DOMException cannot be named without the DOM library, and what consumers branch on is
  // error.name, so that is what this produces.
  const error = new Error('The read was aborted through options.signal.');
  error.name = 'AbortError';
  throw error;
}

export function rangeStoreSource(
  store: RangeStore,
  key: string,
  byteLength: number,
): ByteSource {
  return {
    byteLength,

    async read(offset: number, length: number, options?: ReadOptions): Promise<Uint8Array> {
      throwIfAborted(options?.signal);

      if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > byteLength) {
        throw new EdfSourceError(
          `read(${offset}, ${length}) is outside the ${byteLength}-byte object ${key}.`,
          { offset, requestedLength: length },
        );
      }
      if (length === 0) return new Uint8Array(0);

      const out = new Uint8Array(length);
      let filled = 0;

      const reader = (await store.openRange(key, offset, offset + length - 1)).getReader();
      try {
        while (filled < length) {
          throwIfAborted(options?.signal);
          const { value, done } = await reader.read();
          if (done) break;
          const take = Math.min(value.length, length - filled);
          out.set(value.subarray(0, take), filled);
          filled += take;
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }

      if (filled !== length) {
        throw new EdfSourceError(
          `read(${offset}, ${length}) on ${key} ended after ${filled} bytes: the object is ` +
            'shorter than its reported size, or the transfer was cut short.',
          { offset, requestedLength: length, receivedLength: filled },
        );
      }
      return out;
    },
  };
}
```

Using it is the same as any other source:

```ts
const key = 'recordings/night.edf';
const source = rangeStoreSource(store, key, await store.size(key));
const recording = await openEdf(source);
```

Four things to get right, in order of how badly they bite:

1. **Never return a short buffer.** Loop until full, then reject. edfcore checks anyway and will raise `EdfSourceError` on your behalf, but the error it can produce says only that your source misbehaved — yours can say which key, which range, and why.
2. **Never pad.** Zeros decode as a valid, silent signal.
3. **Return bytes the caller can keep.** If you read into a buffer you reuse, copy before returning.
4. **Honour `options.signal`.** See below.

## Cancellation

Every bundled adapter checks `options.signal` before it starts, and again at each point where it resumes after an await — the loop in `fileHandleSource`, the slice in `blobSource`, the request in `httpSource`, the block gather in `cachedSource`. `httpSource` additionally hands the signal to `fetch` when it is a real `AbortSignal`, so an in-flight request is torn down rather than merely ignored. The rejection is a plain `Error` with `name === 'AbortError'`, not an `EdfError`, so `isEdfError` returns false for it and a `catch` that re-throws aborts stays simple.

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);

const chunks = await readWindow(
  recording,
  { startSeconds: 0, durationSeconds: 600, signalIndices: [0, 1] },
  { signal: controller.signal },
);
```

> **Warning**
> Cancellation lives entirely in the source. edfcore itself does not poll the signal between reads — a custom `ByteSource` that ignores `options.signal` makes cancellation a complete no-op, including for a long `validateRecording` sweep that issues hundreds of reads. This is a real limitation of 0.1, not an oversight in your code: if you write a source, check the signal, and check it inside your read loop as well as at the top.

## Closing, and who owns what

`close` is optional and most adapters do not define one, because most have nothing to release. `byteSource`, `blobSource` and `httpSource` all return a source with no `close`. `fileSource` and `fileHandleSource` close the underlying file handle, and `cachedSource` drops its blocks and then delegates to whatever it wraps.

The consequence is a single rule: whoever opened the resource closes it, and `await source.close?.()` is always safe to call.

```ts
const source = cachedSource(await fileSource('night.edf'));
try {
  const recording = await openEdf(source);
  // ... reads ...
} finally {
  await source.close?.();   // clears the cache, then closes the file handle
}
```

Closing a source does not invalidate the `EdfRecording` built from it. The header, the timeline and the segment list are plain data and stay readable after the handle is gone. Anything that goes back for bytes will fail — `readRecords`, `readWindow`, `readAnnotations`, and `index.locate` on a file whose onsets it has not already memoised. edfcore has no other lifetime mechanism in 0.1, because `Symbol.asyncDispose` is not Baseline yet, so there is no `using` form to reach for.

Next: [reading signals](/docs/reading-signals) covers what to do with the recording once it is open, and [validation](/docs/validation) covers checking a file for conformance.
