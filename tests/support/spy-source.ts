/**
 * A `ByteSource` wrapper that records every read.
 *
 * "Does not load the whole file" is edfcore's central claim, and it is not something a unit
 * test on a small fixture can demonstrate — a 4 KB file loads entirely no matter how careless
 * the code is. The only way to test the claim is to assert the *read pattern*: how many
 * requests were issued, which ranges, and how many bytes in total against how many the caller
 * actually asked for.
 *
 * Test-only. Never exported from the package.
 */

import type { ByteSource, ReadOptions } from '../../src/types.js';

export interface RecordedRead {
  readonly offset: number;
  readonly length: number;
  /** Read index, so a test can assert ordering as well as extent. */
  readonly sequence: number;
}

export interface SpySource extends ByteSource {
  readonly reads: readonly RecordedRead[];
  /** Total bytes handed back across every read. Overread shows up here. */
  readonly bytesRead: number;
  /** Highest offset touched, for asserting a read never reached the end of a large file. */
  readonly maxOffsetTouched: number;
  readonly closed: boolean;
  reset(): void;
}

export function spySource(inner: ByteSource): SpySource {
  const reads: RecordedRead[] = [];
  let bytesRead = 0;
  let maxOffsetTouched = -1;
  let closed = false;

  return {
    get byteLength(): number {
      return inner.byteLength;
    },
    get reads(): readonly RecordedRead[] {
      return reads;
    },
    get bytesRead(): number {
      return bytesRead;
    },
    get maxOffsetTouched(): number {
      return maxOffsetTouched;
    },
    get closed(): boolean {
      return closed;
    },
    reset(): void {
      reads.length = 0;
      bytesRead = 0;
      maxOffsetTouched = -1;
    },
    async read(offset: number, length: number, options?: ReadOptions): Promise<Uint8Array> {
      reads.push({ offset, length, sequence: reads.length });
      bytesRead += length;
      maxOffsetTouched = Math.max(maxOffsetTouched, offset + length - 1);
      return inner.read(offset, length, options);
    },
    async close(): Promise<void> {
      closed = true;
      await inner.close?.();
    },
  };
}

/**
 * A source that returns fewer bytes than asked, to prove the contract guard fires.
 *
 * The `ByteSource` contract is "exactly `length` bytes or reject". A source that silently
 * short-reads is the failure mode that produces plausible-looking wrong numbers, so edfcore
 * verifies the length on every call — including on sources the user supplied.
 */
export function shortReadingSource(inner: ByteSource, shortBy: number): ByteSource {
  return {
    byteLength: inner.byteLength,
    async read(offset: number, length: number, options?: ReadOptions): Promise<Uint8Array> {
      const full = await inner.read(offset, length, options);
      return full.subarray(0, Math.max(0, full.length - shortBy));
    },
  };
}

/** A source that rejects, to prove I/O failures are not swallowed into diagnostics. */
export function failingSource(byteLength: number, message = 'simulated I/O failure'): ByteSource {
  return {
    byteLength,
    read(): Promise<Uint8Array> {
      return Promise.reject(new Error(message));
    },
  };
}
