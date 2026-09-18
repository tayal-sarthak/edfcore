/**
 * A `File` whose backing file shrank after the picker ran.
 *
 * `blob.ts` opens by naming this as the one legitimate short read there is: "a `File` whose backing
 * file changed on disk since the picker ran, so the exact-length contract is verified rather than
 * assumed". It verified it by handing the result to `assertExactRead`, and that guard exists for a
 * `ByteSource` the CALLER wrote — its message says a source "must resolve with exactly the requested
 * number of bytes or reject", and ends by asking for a `read()` that loops.
 *
 * So the browser was accused of breaking a contract it kept. The platform answered correctly for a
 * file that is now shorter than the one the picker measured, and the advice — loop until the bytes
 * arrive — asks for bytes that no longer exist.
 *
 * `node.ts` diagnoses exactly this in its own reader, and its comment names this very case: "a
 * picked `File`'s backing file shrank". The HTTP buffered-body path got it in 0.3.75 and the file
 * handle in 0.3.93. `blobSource` was the third of three.
 */

import { describe, expect, it } from 'vitest';
import { EdfSourceError, isEdfError } from '../../src/errors.js';
import { blobSource } from '../../src/io/blob.js';
import type { BlobLike } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

/**
 * A blob that reports the size the picker saw and holds `actualBytes` of it — which is what a
 * `File` becomes when the file behind it is truncated or replaced.
 */
function pickedThenTruncated(declaredSize: number, actualBytes: number): BlobLike {
  const held = FILE.subarray(0, actualBytes);
  const over = (start: number, end: number): BlobLike => {
    const from = Math.min(Math.max(start, 0), held.byteLength);
    const to = Math.min(Math.max(end, from), held.byteLength);
    return {
      size: to - from,
      slice: (s2 = 0, e2 = to - from) => over(from + s2, from + e2),
      arrayBuffer: async () => held.slice(from, to).buffer as ArrayBuffer,
    };
  };
  return {
    size: declaredSize,
    slice: (start = 0, end = declaredSize) => over(start, end),
    arrayBuffer: async () => held.slice().buffer as ArrayBuffer,
  };
}

describe('a blob that is shorter than its size says', () => {
  it('is reported as the blob ending, not as a source breaking its contract', async () => {
    const source = blobSource(pickedThenTruncated(FILE.byteLength, 100));
    const thrown = await source.read(0, 256).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown, 'a short read was passed on').toBeDefined();
    expect(thrown?.message).toContain('the blob ended after 100 of them');
    expect(thrown?.message).toContain('Next:');
    // The old sentence asked for a read() that loops, for bytes that no longer exist.
    expect(thrown?.message).not.toContain('must resolve with exactly');
    expect(thrown?.message).not.toContain('loop until');
  });

  it('names the size the source was built for, and why it can be stale', async () => {
    const source = blobSource(pickedThenTruncated(FILE.byteLength, 100));
    const thrown = await source.read(0, 256).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown?.message).toContain(`built for ${FILE.byteLength} bytes`);
    expect(thrown?.message).toContain('truncated or replaced');
  });

  it('stays an EdfSourceError carrying what was asked for and what came back', async () => {
    const source = blobSource(pickedThenTruncated(FILE.byteLength, 100));
    const thrown = (await source.read(0, 256).then(
      () => undefined,
      (error: unknown) => error,
    )) as EdfSourceError;
    expect(thrown).toBeInstanceOf(EdfSourceError);
    expect(isEdfError(thrown)).toBe(true);
    expect(thrown.requestedLength).toBe(256);
    expect(thrown.receivedLength).toBe(100);
    expect(thrown.offset).toBe(0);
  });

  it('is reported for a read that starts inside the file and runs off its end', async () => {
    const source = blobSource(pickedThenTruncated(FILE.byteLength, 300));
    await expect(source.read(256, 256)).rejects.toThrow(/the blob ended after 44 of them/);
  });
});

describe('a blob that holds what it says', () => {
  it('still reads exactly', async () => {
    const source = blobSource(pickedThenTruncated(FILE.byteLength, FILE.byteLength));
    const bytes = await source.read(0, 256);
    expect(bytes.byteLength).toBe(256);
    expect(Array.from(bytes.subarray(0, 8))).toEqual(Array.from(FILE.subarray(0, 8)));
  });

  it('still answers a zero-length read without touching the blob', async () => {
    const source = blobSource(pickedThenTruncated(FILE.byteLength, 0));
    expect((await source.read(0, 0)).byteLength).toBe(0);
  });

  it('still refuses a range past the size it declares, before slicing', async () => {
    const source = blobSource(pickedThenTruncated(FILE.byteLength, FILE.byteLength));
    await expect(source.read(FILE.byteLength - 4, 64)).rejects.toThrow(
      /past the end of a \d+-byte source/,
    );
  });

  it('still refuses a size that is not a byte count, which 0.6.157 added', () => {
    expect(() => blobSource(pickedThenTruncated(Number.NaN, 10))).toThrow(
      /not a byte count edfcore can address/,
    );
  });
});
