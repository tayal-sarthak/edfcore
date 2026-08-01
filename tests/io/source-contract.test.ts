/**
 * The `ByteSource` contract, and the adapters that have to keep it.
 *
 * THE CONTRACT, from `types.ts` and DESIGN section 3, is one sentence: a read resolves with
 * EXACTLY `length` bytes or rejects — it never pads and never truncates — and it is verified on
 * every call, INCLUDING calls into a source the caller wrote. That last clause is the whole
 * point. A source that quietly returns a short buffer is indistinguishable from a truncated
 * file, so without the guard the parser would confidently report the wrong cause for the wrong
 * thing: `TRUNCATED_FILE` on a perfectly good file whose transport hiccuped.
 *
 * The other half of the boundary is what edfcore must NOT do with I/O:
 *
 * - An I/O rejection is not a diagnostic. `EdfDiagnostic` is a statement about the FILE, and a
 *   dead socket says nothing about the file. Even `inspectEdf`, which promises never to throw
 *   about content, performs its reads outside its `catch` so a transport failure still rejects.
 * - An offset out of range is `EdfSourceError` with the real numbers in it, never a silently
 *   clamped read and never a 32-bit-truncated offset.
 *
 * `blobSource` is exercised against a hand-written `BlobLike` rather than the DOM `Blob`,
 * because the structural shim being sufficient is the property under test — reaching for the
 * real `Blob` would test the platform instead.
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import { parseHeader } from '../../src/header/parse.js';
import { inspectEdf } from '../../src/inspect.js';
import { blobSource } from '../../src/io/blob.js';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { readHeader, readRecordBytes } from '../../src/io/read.js';
import { assertExactRead } from '../../src/io/source.js';
import { openEdf, readAnnotations, readRecords } from '../../src/recording.js';
import type { BlobLike, ByteSource } from '../../src/types.js';
import { failingSource, shortReadingSource, spySource } from '../support/spy-source.js';
import { minimalEdf, minimalEdfPlus } from '../support/writer.js';

// ---------------------------------------------------------------------------
// A minimal BlobLike, written by hand
// ---------------------------------------------------------------------------

interface SliceCall {
  readonly start: number | undefined;
  readonly end: number | undefined;
}

/**
 * Exactly the three members `BlobLike` declares — `size`, `slice`, `arrayBuffer` — and nothing
 * else. No `type`, no `stream`, no `text`: if edfcore reached for any of them this would fail.
 */
function fakeBlob(
  bytes: Uint8Array,
  calls: SliceCall[] = [],
  shortBy = 0,
): BlobLike & { readonly sliceCalls: readonly SliceCall[] } {
  return {
    size: bytes.byteLength,
    sliceCalls: calls,
    slice(start?: number, end?: number): BlobLike {
      calls.push({ start, end });
      return fakeBlob(bytes.subarray(start ?? 0, end ?? bytes.byteLength), calls, shortBy);
    },
    async arrayBuffer(): Promise<ArrayBuffer> {
      const kept = bytes.slice(0, Math.max(0, bytes.byteLength - shortBy));
      return kept.buffer.slice(kept.byteOffset, kept.byteOffset + kept.byteLength);
    },
  };
}

// ---------------------------------------------------------------------------
// The exact-length contract
// ---------------------------------------------------------------------------

describe('a read resolves with exactly `length` bytes or rejects', () => {
  it('rejects a short read with the offset, the length asked for and the length received', async () => {
    const bytes = minimalEdfPlus();
    const source = shortReadingSource(byteSource(bytes), 1);

    await expect(readHeader(source)).rejects.toMatchObject({
      name: 'EdfSourceError',
      edfErrorKind: 'source',
      offset: 0,
      requestedLength: 256,
      receivedLength: 255,
    });
  });

  // The guard runs on EVERY call, so every entry point that touches a user source is covered by
  // the same check rather than by a check each of them remembered to write.
  const entryPoints: Array<{ name: string; run: (source: ByteSource) => Promise<unknown> }> = [
    { name: 'readHeader', run: (source) => readHeader(source) },
    {
      name: 'readRecordBytes',
      run: (source) => {
        // The header is parsed from the bytes directly, so the failure below is unambiguously
        // the RECORD read rather than a header read that failed first.
        const header = parseHeader(minimalEdfPlus(), minimalEdfPlus().length);
        return readRecordBytes(source, header, { start: 0, count: 2 });
      },
    },
    { name: 'openEdf', run: (source) => openEdf(source) },
    { name: 'inspectEdf', run: (source) => inspectEdf(source) },
    { name: 'cachedSource.read', run: (source) => cachedSource(source).read(0, 64) },
  ];

  for (const entryPoint of entryPoints) {
    it(`raises EdfSourceError from ${entryPoint.name} on a user-supplied short-reading source`, async () => {
      const source = shortReadingSource(byteSource(minimalEdfPlus()), 3);

      const error = await entryPoint.run(source).then(
        () => undefined,
        (thrown: unknown) => thrown,
      );

      expect(error).toMatchObject({ name: 'EdfSourceError', edfErrorKind: 'source' });
      const sourceError = error as {
        offset: number;
        requestedLength: number;
        receivedLength: number;
      };
      expect(sourceError.receivedLength).toBe(sourceError.requestedLength - 3);
      expect(sourceError.offset).toBeGreaterThanOrEqual(0);
    });
  }

  it('names the block it was fetching when the short read happens under a cache', async () => {
    // The cache reads in BLOCKS, so the numbers in the error are the block's, not the caller's
    // — which is the honest report: that is the range the source failed to deliver.
    const bytes = minimalEdfPlus();
    const source = cachedSource(shortReadingSource(byteSource(bytes), 3));

    await expect(source.read(0, 10)).rejects.toMatchObject({
      name: 'EdfSourceError',
      offset: 0,
      requestedLength: bytes.length,
      receivedLength: bytes.length - 3,
    });
  });

  it('rejects an over-long read as loudly as a short one', async () => {
    const longSource: ByteSource = {
      byteLength: 100,
      read(_offset: number, length: number): Promise<Uint8Array> {
        return Promise.resolve(new Uint8Array(length + 1));
      },
    };

    await expect(cachedSource(longSource, { maxBytes: 0 }).read(0, 10)).rejects.toMatchObject({
      name: 'EdfSourceError',
      offset: 0,
      requestedLength: 10,
      receivedLength: 11,
    });
  });

  it('reports `undefined` when the source resolved with something that is not a byte array', async () => {
    // `EdfSourceError.receivedLength` is `number | undefined` for exactly this case, so the
    // error still carries what it knows rather than pretending to a length it never saw.
    const notAnArray = null as unknown as Uint8Array;

    expect(() => assertExactRead(notAnArray, 512, 64)).toThrowError(
      expect.objectContaining({
        name: 'EdfSourceError',
        offset: 512,
        requestedLength: 64,
        receivedLength: undefined,
      }),
    );
  });

  it('returns the value unchanged when the length is right, so it can wrap a read expression', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(assertExactRead(bytes, 0, 4)).toBe(bytes);
  });
});

// ---------------------------------------------------------------------------
// I/O failures are not diagnostics
// ---------------------------------------------------------------------------

describe('an I/O rejection propagates and is never swallowed into a diagnostic', () => {
  const entryPoints: Array<{ name: string; run: (source: ByteSource) => Promise<unknown> }> = [
    { name: 'readHeader', run: (source) => readHeader(source) },
    { name: 'openEdf', run: (source) => openEdf(source) },
    { name: 'inspectEdf', run: (source) => inspectEdf(source) },
  ];

  for (const entryPoint of entryPoints) {
    it(`${entryPoint.name} rejects with the underlying error, not an EdfError`, async () => {
      const source = failingSource(minimalEdf().length);

      const error = await entryPoint.run(source).then(
        () => undefined,
        (thrown: unknown) => thrown,
      );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('simulated I/O failure');
      // DESIGN section 6: a diagnostic is a statement about the FILE. A dead socket makes no
      // statement about the file, so converting it would be a claim edfcore cannot support.
      expect(isEdfError(error)).toBe(false);
    });
  }

  it('inspectEdf promises not to throw about CONTENT, and never promised to hide I/O', async () => {
    // A malformed file becomes ok:false plus a diagnostic...
    const truncatedHeader = minimalEdf().subarray(0, 300);
    const triage = await inspectEdf(byteSource(truncatedHeader));
    expect(triage.ok).toBe(false);
    expect(triage.diagnostics.map((diagnostic) => diagnostic.code)).toContain('SOURCE_TOO_SMALL');

    // ...but a source that cannot deliver bytes still rejects, because the reads happen outside
    // the catch. Reporting "this file is broken" for a network failure would be a lie.
    await expect(inspectEdf(failingSource(4096))).rejects.toThrow('simulated I/O failure');
  });

  it('propagates a failure from a record read, after the header parsed fine', async () => {
    const bytes = minimalEdfPlus({ recordCount: 4 });
    const header = parseHeader(bytes, bytes.length);

    await expect(
      readRecordBytes(failingSource(bytes.length), header, { start: 1, count: 2 }),
    ).rejects.toThrow('simulated I/O failure');
  });
});

// ---------------------------------------------------------------------------
// byteSource
// ---------------------------------------------------------------------------

describe('byteSource', () => {
  it('respects a Uint8Array byteOffset instead of reading from the start of its buffer', async () => {
    // The classic bug: a view handed in over a larger ArrayBuffer, read with `buffer[offset]`.
    // Every byte returned below would be 0xAA if the offset were ignored.
    const buffer = new ArrayBuffer(1000);
    new Uint8Array(buffer).fill(0xaa);
    const view = new Uint8Array(buffer, 300, 400);
    for (let index = 0; index < view.length; index += 1) view[index] = index & 0xff;

    const source = byteSource(view);

    expect(source.byteLength).toBe(400);
    expect(Array.from(await source.read(0, 4))).toEqual([0, 1, 2, 3]);
    // 396..399 & 0xff. If the byteOffset were dropped these would be 0xAA, the buffer's filler.
    expect(Array.from(await source.read(396, 4))).toEqual([140, 141, 142, 143]);
    // And the range check is against the VIEW's length, not the buffer's.
    await expect(source.read(399, 2)).rejects.toMatchObject({ name: 'EdfSourceError' });
  });

  it('is zero-copy: a read is a subarray view over the caller’s own buffer', async () => {
    // Documented in `io/bytes.ts`: safe precisely because it is the caller's buffer. The
    // "returned array is owned by the caller" rule exists to stop an adapter handing out a view
    // into state IT retains, and this adapter retains nothing the caller does not already hold.
    const buffer = new ArrayBuffer(64);
    const view = new Uint8Array(buffer, 16, 32);

    const got = await byteSource(view).read(8, 4);

    expect(got.buffer).toBe(buffer);
    expect(got.byteOffset).toBe(24);
    expect(got.byteLength).toBe(4);
  });

  it('wraps a bare ArrayBuffer as its whole contents', async () => {
    const buffer = new ArrayBuffer(16);
    new Uint8Array(buffer).fill(7);

    const source = byteSource(buffer);

    expect(source.byteLength).toBe(16);
    expect(Array.from(await source.read(14, 2))).toEqual([7, 7]);
  });

  it('parses a real header through a view with a non-zero byteOffset', async () => {
    // End to end, because an off-by-`byteOffset` adapter still produces plausible-looking
    // garbage at the byte level and only shows up when something interprets the bytes.
    const file = minimalEdf();
    const padded = new Uint8Array(file.length + 137);
    padded.set(file, 137);

    const header = await readHeader(byteSource(padded.subarray(137)));

    expect(header.variant).toBe('EDF');
    expect(header.signals.map((signal) => signal.label)).toEqual(['Fp1']);
  });
});

// ---------------------------------------------------------------------------
// blobSource
// ---------------------------------------------------------------------------

describe('blobSource works against a hand-written BlobLike, with no DOM in sight', () => {
  it('opens and reads a whole recording through the structural shim', async () => {
    const bytes = minimalEdfPlus({ recordCount: 4 });
    const calls: SliceCall[] = [];

    const recording = await openEdf(blobSource(fakeBlob(bytes, calls)));
    const chunk = await readRecords(recording, {
      records: { start: 1, count: 2 },
      signalIndices: [0],
    });
    const annotations = await readAnnotations(recording, { start: 0, count: 4 });

    expect(recording.header.variant).toBe('EDF+C');
    expect(chunk.records).toEqual({ start: 1, count: 2 });
    expect(annotations.recordOnsetTicks).toHaveLength(4);
  });

  it('slices with an EXCLUSIVE end, unlike an HTTP byte range', async () => {
    const bytes = minimalEdf();
    const calls: SliceCall[] = [];
    const source = blobSource(fakeBlob(bytes, calls));

    await source.read(0, 256);
    await source.read(256, 256);

    // `bytes=0-255` on the wire is `slice(0, 256)` here; an inclusive end would drop a byte.
    expect(calls).toEqual([
      { start: 0, end: 256 },
      { start: 256, end: 512 },
    ]);
  });

  it('answers a zero-length read without slicing at all', async () => {
    const calls: SliceCall[] = [];
    const source = blobSource(fakeBlob(minimalEdf(), calls));

    const empty = await source.read(100, 0);

    expect(empty.length).toBe(0);
    expect(calls).toEqual([]);
  });

  it('raises EdfSourceError when the blob hands back fewer bytes than its size promised', async () => {
    // A `File` whose backing file changed on disk since the picker ran is the real-world case:
    // the one place the platform can legitimately return short.
    const bytes = minimalEdf();
    const source = blobSource(fakeBlob(bytes, [], 4));

    await expect(source.read(0, 256)).rejects.toMatchObject({
      name: 'EdfSourceError',
      offset: 0,
      requestedLength: 256,
      receivedLength: 252,
    });
  });

  it('takes its byteLength from `size` and refuses a range past it', async () => {
    const source = blobSource(fakeBlob(minimalEdf()));

    expect(source.byteLength).toBe(minimalEdf().length);
    await expect(source.read(source.byteLength - 1, 5)).rejects.toMatchObject({
      name: 'EdfSourceError',
      offset: source.byteLength - 1,
      requestedLength: 5,
    });
  });
});

// ---------------------------------------------------------------------------
// Out-of-range requests
// ---------------------------------------------------------------------------

describe('an out-of-range request is EdfSourceError carrying the real numbers', () => {
  const FILE_BYTES = 552; // minimalEdf(): 512-byte header + 2 records of 20 bytes

  const adapters: Array<{ name: string; build: (bytes: Uint8Array) => ByteSource }> = [
    { name: 'byteSource', build: (bytes) => byteSource(bytes) },
    { name: 'blobSource', build: (bytes) => blobSource(fakeBlob(bytes)) },
    { name: 'cachedSource', build: (bytes) => cachedSource(byteSource(bytes)) },
  ];

  const cases = [
    { name: 'a negative offset', offset: -1, length: 10 },
    { name: 'a negative length', offset: 0, length: -1 },
    { name: 'a fractional offset', offset: 1.5, length: 10 },
    { name: 'a fractional length', offset: 0, length: 10.5 },
    { name: 'a range ending one byte past the end', offset: FILE_BYTES - 1, length: 2 },
    { name: 'an offset past the end', offset: FILE_BYTES + 1000, length: 1 },
    // Offsets are plain JS numbers, exact to 2^53, and are never truncated with `| 0` — which
    // is what silently wraps a multi-gigabyte BDF offset negative.
    { name: 'an offset above Number.MAX_SAFE_INTEGER', offset: 2 ** 53 + 2, length: 1 },
  ];

  for (const adapter of adapters) {
    for (const testCase of cases) {
      it(`${adapter.name} rejects ${testCase.name}`, async () => {
        const bytes = minimalEdf();
        expect(bytes.length).toBe(FILE_BYTES);
        const source = adapter.build(bytes);

        await expect(source.read(testCase.offset, testCase.length)).rejects.toMatchObject({
          name: 'EdfSourceError',
          edfErrorKind: 'source',
          offset: testCase.offset,
          requestedLength: testCase.length,
        });
      });
    }
  }

  it('accepts the exact final byte and the empty range at the very end', async () => {
    // The boundary that must NOT throw, so the range check is exclusive-end and not off by one.
    const bytes = minimalEdf();
    const source = byteSource(bytes);

    expect(Array.from(await source.read(FILE_BYTES - 1, 1))).toEqual([bytes[FILE_BYTES - 1] ?? -1]);
    expect((await source.read(FILE_BYTES, 0)).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

describe('an aborted signal stops the read', () => {
  it('rejects with an AbortError-named error rather than a DOMException we cannot name', async () => {
    // `DOMException` cannot be named without the DOM lib, and what consumers branch on is
    // `error.name === 'AbortError'` — so that is what edfcore produces.
    const error = await byteSource(minimalEdf())
      .read(0, 16, { signal: { aborted: true } })
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );

    expect((error as Error).name).toBe('AbortError');
    expect(isEdfError(error)).toBe(false);
  });

  it('does no work at all: blobSource never slices, cachedSource never reads', async () => {
    const calls: SliceCall[] = [];
    const aborted = { aborted: true };

    await expect(
      blobSource(fakeBlob(minimalEdf(), calls)).read(0, 16, { signal: aborted }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toEqual([]);

    const spy = spySource(byteSource(minimalEdf()));
    await expect(cachedSource(spy).read(0, 16, { signal: aborted })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(spy.reads).toEqual([]);
  });

  it('stops a multi-read operation at the first read issued after the abort', async () => {
    // readHeader normally issues two reads; with the signal already aborted, the first is
    // refused and the second never happens.
    const spy = spySource(byteSource(minimalEdfPlus()));

    await expect(readHeader(spy, { signal: { aborted: true } })).rejects.toMatchObject({
      name: 'AbortError',
    });

    expect(spy.reads).toHaveLength(1);
    expect(spy.bytesRead).toBe(256);
  });

  it('carries the signal through openEdf into the record probes', async () => {
    // openEdf on an EDF+ issues 4 reads: 2 for the header, then record 0 and the last record.
    // Aborting once the header is in hand must stop the probes, which can only happen if the
    // signal actually reached them through buildTimeline -> readRecordBytes -> source.read.
    const bytes = minimalEdfPlus({ recordCount: 8 });
    const signal = { aborted: false };
    const inner = byteSource(bytes);
    let reads = 0;
    const flipping: ByteSource = {
      byteLength: inner.byteLength,
      read(offset: number, length: number, options?: { signal?: { aborted: boolean } }) {
        reads += 1;
        // Give up just before the first probe is issued.
        if (reads === 3) signal.aborted = true;
        return inner.read(offset, length, options);
      },
    };

    await expect(openEdf(flipping, { signal })).rejects.toMatchObject({ name: 'AbortError' });

    // Two header reads delivered, the first probe refused, the second never issued.
    expect(reads).toBe(3);
  });

  it('threads the SAME signal object into every source read it issues', async () => {
    // Worth pinning explicitly, because this is where abort is enforced: `throwIfAborted` lives
    // in the adapters (`io/bytes|blob|cached|http`, `node.ts`), NOT in `io/read.ts`,
    // `record-index.ts` or `recording.ts`. Those layers thread `options` through and rely on the
    // source to honour it, so a user-supplied ByteSource that ignores `options.signal` makes
    // abort a no-op — unlike the exact-length contract, which is re-checked centrally.
    const bytes = minimalEdfPlus({ recordCount: 8 });
    const signal = { aborted: false };
    const inner = byteSource(bytes);
    const seen: Array<unknown> = [];
    const observing: ByteSource = {
      byteLength: inner.byteLength,
      read(offset: number, length: number, options?: { signal?: { aborted: boolean } }) {
        seen.push(options?.signal);
        return inner.read(offset, length, options);
      },
    };

    const recording = await openEdf(observing, { signal });
    await readRecords(
      recording,
      { records: { start: 0, count: 2 }, signalIndices: [0] },
      { signal },
    );

    expect(seen).toHaveLength(5); // 2 header + 2 probes + 1 record read
    for (const observed of seen) expect(observed).toBe(signal);
  });

  it('aborts a blob read that was already in flight when the signal flipped', async () => {
    // `blobSource` checks again AFTER `arrayBuffer()` resolves, which is the only moment a long
    // read can learn it is no longer wanted.
    const bytes = minimalEdf();
    const signal = { aborted: false };
    const slowBlob: BlobLike = {
      size: bytes.byteLength,
      slice(start?: number, end?: number): BlobLike {
        const slice = bytes.subarray(start ?? 0, end ?? bytes.byteLength);
        return {
          size: slice.byteLength,
          slice: () => slowBlob,
          async arrayBuffer(): Promise<ArrayBuffer> {
            signal.aborted = true; // the caller gave up while the platform was fetching
            return slice.slice().buffer;
          },
        };
      },
      async arrayBuffer(): Promise<ArrayBuffer> {
        return bytes.slice().buffer;
      },
    };

    await expect(blobSource(slowBlob).read(0, 16, { signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('reads normally when the signal is present but not aborted', async () => {
    const signal = { aborted: false };

    const header = await readHeader(byteSource(minimalEdf()), { signal });

    expect(header.signals).toHaveLength(1);
  });
});
