/**
 * The Node adapters — importable only as `edfcore/node`, and NOT reachable from the universal
 * entry, which is the point.
 *
 * Layer 7. Keeping this module out of everything `edfcore` can reach is what lets the universal
 * entry be bundled for a browser without a polyfill and without a resolution alias, and a
 * `public-api.test.ts` walks the module graph from `src/index.ts` for `node:` to prove exactly
 * that.
 *
 * Two wordings have been wrong here. It said "the ONLY module in edfcore that imports anything
 * from `node:`" until 0.3.84 — `src/cli.ts` imports `node:fs/promises` and `node:process` and
 * ships as the `bin` entry, a Node program by definition that no import path reaches. The fix then
 * said "the only module REACHABLE FROM THE UNIVERSAL ENTRY that imports anything from `node:`",
 * which asserts the opposite of the invariant and contradicts the paragraph directly below it
 * (fixed in 0.3.103). Both shipped in `dist/node.d.ts` as this subpath's hover text.
 *
 * Two decisions are load-bearing.
 *
 * 1. Reads are POSITIONAL and LOOP. `FileHandle.read` is allowed to return fewer bytes than asked
 *    — a signal interrupted the syscall, the file lives on a network mount — and a `ByteSource`
 *    that passed a short buffer on would be indistinguishable from a truncated file. The loop
 *    runs until `length` bytes have arrived; a genuine end of file falls out as an
 *    `EdfSourceError` naming both counts.
 * 2. `fs.openAsBlob` is NEVER used, however tempting `blobSource(await openAsBlob(path))` looks.
 *    It reports `size` modulo 2**32 and yields zeros above 4 GiB, which turns a 13 GB BDF into a
 *    file that reads as silence with no error anywhere.
 *
 * TYPING. `src/` compiles with `types: []`, so `@types/node` is not available and must never be:
 * the published `.d.ts` may not reference it, or every consumer inherits a dependency on it. The
 * import below is therefore UNTYPED, and the minimal structural shape edfcore needs is declared
 * here instead — `FileHandleLike` and `NodeFsPromises`. A standing CI job compiles a consumer
 * against the real `@types/node` and asserts `fs.promises.FileHandle` is still assignable, which
 * is what stops the two drifting.
 *
 * The suppression on the import is the unconditional `ts-ignore` directive rather than
 * `@ts-expect-error`, and that is not laziness. Whether the specifier resolves depends on whether
 * a `@types/node` happens to be reachable at all: `config/tsconfig.build.json` compiles `src/`
 * alone and it is not, while `tsconfig.json` also pulls in a dev tool carrying a triple-slash
 * reference to it and it may be. `@ts-expect-error` errors for being UNUSED in the second case, so
 * it would break whichever of the two configurations the machine happens to disagree with.
 */

// biome-ignore lint/suspicious/noTsIgnore: @ts-expect-error errors when unused — see above.
// @ts-ignore 'node:fs/promises' has no declarations under `types: []`; its shape is below.
import * as nodeFsPromises from 'node:fs/promises';
import { EdfSourceError } from './errors.js';
import { assertExactRead, assertReadRange, throwIfAborted } from './io/source.js';
import type { ByteSource, ReadOptions } from './types.js';

/**
 * The RETURN type of both functions below, and the option bag their `read` takes.
 *
 * Re-exported because a consumer importing only `edfcore/node` could otherwise not name what
 * `fileSource` hands back — the subpath's whole output — and had to reach into the root entry to
 * write a single annotation (added in 0.3.44).
 */
export type { ByteSource, ReadOptions } from './types.js';

/**
 * A positional reader with a lifetime. A real `fs.promises.FileHandle` satisfies this.
 *
 * Structural on purpose, so `@types/node` never enters the published `.d.ts` and so a test double
 * — or a handle from another runtime with the same API — is usable without a cast.
 */
export interface FileHandleLike {
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

/** The one member of `node:fs/promises` this module uses, and nothing else. */
interface NodeFsPromises {
  open(
    path: string,
    flags: string,
  ): Promise<FileHandleLike & { stat(): Promise<{ size: number; isFile(): boolean }> }>;
}

const fs: NodeFsPromises = nodeFsPromises as unknown as NodeFsPromises;

/**
 * A `ByteSource` over an open file handle.
 *
 * `byteLength` is supplied by the caller rather than read from the handle, because the two ways
 * of learning it differ in what they promise: `fileSource` takes it from the handle it just
 * opened, while a caller wrapping a handle it already had may know something better (a range it
 * intends to expose, a size it verified). Neither is guessed here.
 *
 * `close()` closes the handle. edfcore has no other lifetime mechanism yet —
 * `Symbol.asyncDispose` is not Baseline yet — so a caller that opened a file is the one that
 * closes it.
 */
export function fileHandleSource(handle: FileHandleLike, byteLength: number): ByteSource {
  return {
    byteLength,
    async read(offset: number, length: number, options?: ReadOptions): Promise<Uint8Array> {
      throwIfAborted(options);
      assertReadRange(offset, length, byteLength);
      if (length === 0) return new Uint8Array(0);

      const buffer = new Uint8Array(length);
      let filled = 0;
      while (filled < length) {
        throwIfAborted(options);
        // Positional: the handle's own file position is never used, so concurrent reads through
        // one handle cannot interleave into each other's buffers.
        const { bytesRead } = await handle.read(buffer, filled, length - filled, offset + filled);
        // Zero bytes means end of file. Looping again would spin forever on a file that is
        // shorter than `byteLength` claimed, so the short read is reported instead.
        if (bytesRead <= 0) break;
        filled += bytesRead;
      }
      // Checked again AFTER the syscalls, not only before each one. The common case is a single
      // read that returns everything, so the loop's check ran once, before it — and a signal that
      // flipped while the syscall was in flight was ignored and the data returned anyway.
      // `blobSource` has always rejected in that situation, and one adapter honouring a signal
      // that another quietly ignores is worse than either rule on its own.
      throwIfAborted(options);
      /*
       * Diagnosed HERE rather than left to `assertExactRead`. That guard exists for a `ByteSource`
       * the CALLER wrote — its message ends "make read() loop until `length` bytes have arrived" —
       * and the loop it asks for is the one twelve lines above, which already reads until EOF. No
       * amount of looping produces bytes the file does not contain.
       *
       * The real cause is that this source was built for more bytes than the file holds:
       * `fileSource` stats the file and the file was then truncated or rotated, or a caller passed
       * a `byteLength` larger than the file, or a picked `File`'s backing file shrank. Same shape
       * as the HTTP buffered-body path, fixed in 0.3.75 (fixed here in 0.3.93).
       */
      if (filled < length) {
        throw new EdfSourceError(
          `Reading bytes ${offset}..${offset + length - 1}: the file ended after ${filled} of ` +
            `them. This source was built for ${byteLength} bytes, so the range asked for is past ` +
            'the end of the file as it is now. Next: the file was truncated or replaced after it ' +
            'was opened, or options.byteLength is larger than the file — re-open it, or pass the ' +
            'size the file actually has.',
          { offset, requestedLength: length, receivedLength: filled },
        );
      }
      return assertExactRead(buffer.subarray(0, filled), offset, length);
    },
    async close(): Promise<void> {
      await handle.close();
    },
  };
}

/**
 * Open a file for reading and expose it as a `ByteSource`.
 *
 * The size comes from the handle rather than from a separate `stat(path)` call, so the size and
 * the bytes describe the same file even if the path is replaced between the two — on a rotating
 * log or a rsync target that is not hypothetical.
 *
 * The handle is closed if anything goes wrong before it has an owner; after that, closing is the
 * caller's job through `source.close()`.
 */
export async function fileSource(path: string): Promise<ByteSource> {
  const handle = await fs.open(path, 'r');
  try {
    const stats = await handle.stat();
    const byteLength = stats.size;
    /*
     * The regular-file check is a CHECK, not advice.
     *
     * The size guard below used to carry it as a "Next:" — "check that the path names a regular
     * file rather than a directory, a pipe or a device" — and none of the three can reach it. A
     * directory's `st_size` is its allocation (64 on macOS) and a FIFO's and a character device's
     * is 0: all ordinary safe integers. So `fileSource(dir)` returned a working-looking
     * `ByteSource` with `byteLength: 64`, and the first read failed with a raw `EISDIR` from Node
     * rather than with anything edfcore said (fixed in 0.3.98).
     */
    if (!stats.isFile()) {
      throw new EdfSourceError(
        `fileSource(): ${JSON.stringify(path)} is not a regular file. A directory, a pipe and a ` +
          'device all report a size the operating system will not let edfcore read from, so the ' +
          'first read would fail with a raw errno instead. Next: name the file itself.',
        { offset: 0, requestedLength: 0 },
      );
    }
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new EdfSourceError(
        `fileSource(): the operating system reported a size of ${byteLength} bytes for ` +
          `${JSON.stringify(path)}, which is not a byte count edfcore can address. Next: this is a ` +
          'regular file, so the size is the surprise — check the filesystem.',
        { offset: 0, requestedLength: 0 },
      );
    }
    return fileHandleSource(handle, byteLength);
  } catch (error) {
    // A failure to close is not what the caller needs to hear about: the reason the file is
    // unusable is `error`, and letting close() replace it would hide the diagnosis behind the
    // cleanup. The descriptor is leaked in that case, which is the lesser of the two.
    await handle.close().catch(() => undefined);
    throw error;
  }
}
