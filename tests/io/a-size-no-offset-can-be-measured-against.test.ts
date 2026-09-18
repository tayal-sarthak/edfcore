/**
 * A `ByteSource` the caller wrote, advertising a `byteLength` that is not a byte count.
 *
 * `api-sources.md` documents writing one, and `assertByteSource` is checked structurally for exactly
 * that reason — "a `read` function and a numeric `byteLength`". Numeric is not the same as usable:
 * `NaN`, `-1` and `1.5` are all numbers.
 *
 * 0.6.85 made this argument for `fileHandleSource` and recorded what a bad one costs: "a `NaN` or an
 * absent `byteLength` disabled the range guard rather than failing: `assertReadRange` compares
 * against it, every comparison against `NaN` is false", and "the failure then surfaced in
 * `parseHeader` — which does guard it — blaming a caller who passed it the right arguments".
 *
 * That fix went into one adapter. This is the boundary every source crosses, and a caller's own is
 * the one shape no adapter can cover — a `NaN` out of a missing `Content-Length`, a `-1` out of a
 * stat that failed, a fraction out of a division. Each built a source, and the first read answered
 *
 *     ByteSource.read(offset 0, length NaN) resolved with 0 bytes. A ByteSource must resolve with
 *     exactly the requested number of bytes or reject …
 *
 * which accuses the caller's `read()` of breaking its contract, when it answered correctly for the
 * length edfcore computed from the number it was given and handed to it.
 */

import { describe, expect, it } from 'vitest';
import { EdfSourceError, isEdfError } from '../../src/errors.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { readHeader } from '../../src/io/read.js';
import { openEdf } from '../../src/recording.js';
import type { ByteSource } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

/** A source of the kind `api-sources.md` tells a caller to write. */
const ownSource = (byteLength: unknown): ByteSource => ({
  byteLength: byteLength as number,
  read: async (offset: number, length: number) => FILE.subarray(offset, offset + length),
});

const NOT_A_BYTE_COUNT: ReadonlyArray<readonly [string, number]> = [
  ['NaN, as a missing Content-Length gives', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['-1, as a failed stat gives', -1],
  ['a fraction', 1.5],
];

const ENTRY_POINTS: ReadonlyArray<readonly [string, (source: ByteSource) => Promise<unknown>]> = [
  ['openEdf', (source) => openEdf(source)],
  ['readHeader', (source) => readHeader(source)],
  ['inspectEdf', (source) => inspectEdf(source)],
];

describe.each(NOT_A_BYTE_COUNT)('a byteLength of %s', (_name, byteLength) => {
  describe.each(ENTRY_POINTS)('%s', (_call, call) => {
    it('names the source rather than blaming its read()', async () => {
      const thrown = await call(ownSource(byteLength)).then(
        () => undefined,
        (error: unknown) => error as Error,
      );
      expect(thrown, 'a read was issued against it').toBeDefined();
      expect(thrown?.message).toContain('this ByteSource advertises');
      expect(thrown?.message).toContain('Next:');
      // The old sentence accused the caller's read() of breaking the exact-length contract.
      expect(thrown?.message).not.toContain('resolved with');
      expect(thrown?.message).not.toContain('must resolve with exactly');
    });

    it('stays outside the EdfError family, so triage cannot absorb it', async () => {
      // `inspectEdf` turns an EdfError into a diagnostic about the FILE, and the bytes here are a
      // perfectly good recording. `inspect-rethrows-caller-bugs.test.ts` pins the same rule.
      const thrown = await call(ownSource(byteLength)).then(
        () => undefined,
        (error: unknown) => error as Error,
      );
      expect(thrown).toBeInstanceOf(RangeError);
      expect(thrown).not.toBeInstanceOf(EdfSourceError);
      expect(isEdfError(thrown)).toBe(false);
    });
  });

  it('is refused by the cache wrapper too, before it is built over one', () => {
    expect(() => cachedSource(ownSource(byteLength))).toThrow(/this ByteSource advertises/);
  });
});

describe('a source whose size really is a byte count', () => {
  it('still opens', async () => {
    const recording = await openEdf(ownSource(FILE.byteLength));
    expect(recording.header.recordCount).toBe(4);
  });

  it('still allows a zero-length source, which is reported as a file defect', async () => {
    const empty: ByteSource = { byteLength: 0, read: async () => new Uint8Array(0) };
    const inspection = await inspectEdf(empty);
    expect(inspection.ok).toBe(false);
    expect(inspection.diagnostics[0]?.code).toBe('SOURCE_TOO_SMALL');
  });

  it('leaves the 0.4.444 refusal for the bytes themselves saying its own thing', async () => {
    await expect(openEdf(FILE as never)).rejects.toThrow(/a ByteSource is needed/);
  });

  it('still refuses a byteLength that is not a number at all', async () => {
    await expect(openEdf(ownSource('1344'))).rejects.toThrow(/a ByteSource is needed/);
  });

  it('is what the bundled adapters have always supplied', async () => {
    expect(byteSource(FILE).byteLength).toBe(FILE.byteLength);
  });
});
