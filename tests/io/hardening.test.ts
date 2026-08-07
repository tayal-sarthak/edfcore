/**
 * Regressions for defects found by an adversarial sweep of the I/O and validation layers.
 *
 * Every case here was a real, reproducible failure: each one either fabricated data, hung
 * forever, or allocated hundreds of megabytes from a file that asked for none of it. They share
 * a shape worth naming — a guard that looks total but is not. `if (blockBytes < 1)` does not
 * fire for NaN, `Math.max(1, NaN)` is NaN, and a bound derived from a chunk size stops bounding
 * anything once one record is larger than the chunk.
 */

import { describe, expect, it } from 'vitest';
import { EdfSourceError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { httpSource } from '../../src/io/http.js';
import { assertExactRead } from '../../src/io/source.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readWindow } from '../../src/recording.js';
import type { FetchLike, HttpResponseLike } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { minimalEdfPlus } from '../support/writer.js';

// ---------------------------------------------------------------------------
// Non-finite numeric options
// ---------------------------------------------------------------------------

describe('numeric source options reject NaN instead of silently misbehaving', () => {
  const truth = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

  // NaN reaches these trivially: Number() of an absent env var, query parameter or config key.
  // The options are typed `number`, so TypeScript does not stop it.
  for (const option of ['maxBytes', 'blockBytes'] as const) {
    it(`cachedSource refuses a NaN ${option} rather than serving zeroed bytes`, () => {
      expect(() => cachedSource(byteSource(truth), { [option]: Number.NaN })).toThrow(RangeError);
    });
  }

  it('cachedSource still caches normally when the options are finite', async () => {
    const source = cachedSource(byteSource(truth), { blockBytes: 4, maxBytes: 1024 });
    expect([...(await source.read(0, 8))]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('httpSource refuses a NaN maxConcurrency rather than hanging on the first read', async () => {
    // Math.max(1, NaN) is NaN, `0 < NaN` is false, so the first caller waited on a promise that
    // only a completed request could resolve. No error, no timeout: the read never settled.
    await expect(
      httpSource('https://example.invalid/f.edf', {
        fetch: (() => {
          throw new Error('the request must never be issued');
        }) as unknown as FetchLike,
        byteLength: 64,
        maxConcurrency: Number.NaN,
      }),
    ).rejects.toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// A server that advertises byte ranges and then ignores them
// ---------------------------------------------------------------------------

describe('httpSource downloads a Range-ignoring resource at most once', () => {
  const SIZE = 4096;
  const body = new Uint8Array(SIZE).map((_, i) => i & 0xff);

  function rangeIgnoringServer(): { fetch: FetchLike; fullSends: () => number } {
    let fullSends = 0;
    const fetchImpl = (async (_href: string, init?: { method?: string }) => {
      if ((init?.method ?? 'GET') === 'HEAD') {
        return {
          status: 200,
          headers: {
            get: (name: string) =>
              name.toLowerCase() === 'content-length'
                ? String(SIZE)
                : name.toLowerCase() === 'accept-ranges'
                  ? 'bytes'
                  : null,
          },
          arrayBuffer: async () => new ArrayBuffer(0),
        } satisfies HttpResponseLike;
      }
      fullSends += 1;
      return {
        status: 200,
        headers: { get: () => null },
        // A tick of latency, so concurrent reads genuinely overlap.
        arrayBuffer: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return body.buffer.slice(0);
        },
      } satisfies HttpResponseLike;
    }) as unknown as FetchLike;
    return { fetch: fetchImpl, fullSends: () => fullSends };
  }

  for (const readers of [8, 32]) {
    it(`serves ${readers} concurrent reads from one transfer`, async () => {
      const server = rangeIgnoringServer();
      const source = await httpSource('https://example.invalid/f.edf', {
        fetch: server.fetch,
        allowFullDownload: true,
      });

      const chunks = await Promise.all(
        Array.from({ length: readers }, (_, i) => source.read(i * 32, 32)),
      );

      // Previously every read that had already entered fetchRange issued its own GET and
      // buffered the whole resource, so N concurrent reads cost N downloads and N copies.
      expect(server.fullSends()).toBe(1);
      chunks.forEach((chunk, i) => {
        expect(chunk).toHaveLength(32);
        expect(chunk[0]).toBe((i * 32) & 0xff);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// A source-level signal is documented as the default for every request
// ---------------------------------------------------------------------------

describe('httpSource honours a source-level AbortSignalLike shim', () => {
  function server(): { fetch: FetchLike; gets: () => number } {
    let gets = 0;
    const fetchImpl = (async (_href: string, init?: { method?: string }) => {
      if ((init?.method ?? 'GET') === 'HEAD') {
        return {
          status: 200,
          headers: {
            get: (name: string) => (name.toLowerCase() === 'content-length' ? '64' : null),
          },
          arrayBuffer: async () => new ArrayBuffer(0),
        } satisfies HttpResponseLike;
      }
      gets += 1;
      return {
        status: 206,
        headers: {
          get: (name: string) => (name.toLowerCase() === 'content-range' ? 'bytes 0-7/64' : null),
        },
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer,
      } satisfies HttpResponseLike;
    }) as unknown as FetchLike;
    return { fetch: fetchImpl, gets: () => gets };
  }

  it('rejects after the shim flips, instead of issuing the request anyway', async () => {
    // The published shim type is `{ readonly aborted: boolean }` with no addEventListener, so it
    // can never be handed to fetch. It has to be polled, and the source-level one was not.
    const signal = { aborted: false };
    const { fetch, gets } = server();
    const source = await httpSource('https://example.invalid/f.edf', { fetch, signal });

    expect(await source.read(0, 8)).toHaveLength(8);

    signal.aborted = true;
    await expect(source.read(8, 8)).rejects.toThrow(
      expect.objectContaining({ name: 'AbortError' }) as Error,
    );
    expect(gets()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The one allocation that skipped the budget every other allocation site honours
// ---------------------------------------------------------------------------

describe('validateRecording honours maxMaterializeBytes for its scan scratch buffer', () => {
  /** A 512-byte EDF declaring an enormous samplesPerRecord and zero data records. */
  function oneCorruptedField(): Uint8Array {
    const bytes = new Uint8Array(512).fill(0x20);
    const put = (text: string, at: number): void => {
      for (let i = 0; i < text.length; i += 1) bytes[at + i] = text.charCodeAt(i);
    };
    put('0', 0);
    put('X X X X', 8);
    put('Startdate X X X X', 88);
    put('01.01.20', 168);
    put('10.00.00', 176);
    put('512', 184);
    put('0', 236); // zero data records: nothing is readable at all
    put('1', 244);
    put('1', 252);
    put('Fp1', 256);
    put('AgAgCl', 272);
    put('uV', 352);
    put('-500', 360);
    put('500', 368);
    put('-32768', 376);
    put('32767', 384);
    put('HP:0.1Hz', 392);
    put('99999999', 472); // the largest an 8-byte EDF field can hold
    return bytes;
  }

  it('allocates nothing at all for it, which is stronger than refusing (0.2.29)', async () => {
    // 0.1.3 fixed this by REFUSING: the scratch size was `samplesPerRecord` unclamped, up to the
    // 99,999,999 an 8-byte field holds, allocated before any read so no downstream check could
    // catch it. 0.2.29 clamps the buffer to the records that exist, and this file declares none —
    // so the 400 MB is never demanded in the first place and there is nothing to refuse.
    //
    // The invariant 0.1.3 established is unchanged and stated here directly: a 512-byte file
    // never causes a large allocation. What changed is that it is now enforced by not allocating
    // rather than by throwing, which is why this test asserts success where it once asserted a
    // budget error. The refusal itself is still live — see the oversized-scan case below.
    const recording = await openEdf(byteSource(oneCorruptedField()));
    expect(recording.header.recordCount).toBe(0);

    for (const options of [{ maxMaterializeBytes: 1024 }, {}]) {
      const report = await validateRecording(recording, { scanSamples: true, ...options });
      expect(report.recordsScanned).toBe(0);
    }
  });

  it('still refuses when the records really do exist and really are too big', async () => {
    // The guard has to keep biting, or the clamp above would have traded one defect for another.
    const wide = minimalEdfPlus({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 50_000 }],
    });
    const recording = await openEdf(byteSource(wide));
    expect(recording.header.recordCount).toBe(2);
    await expect(
      validateRecording(recording, { scanSamples: true, maxMaterializeBytes: 4096 }),
    ).rejects.toMatchObject({ edfErrorKind: 'budget', budgetBytes: 4096 });
  });

  it('leaves a well-formed file scanning normally', async () => {
    const recording = await openEdf(byteSource(oneCorruptedField()));
    // Header-only validation never allocates the scratch buffer, so it must still work.
    const report = await validateRecording(recording, { scanSamples: false });
    expect(report.recordsScanned).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A 206 that carries the wrong bytes (0.2.23)
// ---------------------------------------------------------------------------

describe('a partial response is checked for WHICH bytes it carries', () => {
  const CONTENT = Uint8Array.from({ length: 16 }, (_, i) => i);

  /**
   * A server whose 206 always answers with `served` regardless of the Range asked for, and
   * announces `contentRange` — the shape a cache keyed on the URL alone produces.
   */
  function misbehaving(contentRange: string | null, served: Uint8Array) {
    const requested: string[] = [];
    const fetchImpl = (async (_href: string, init?: { method?: string; headers?: unknown }) => {
      if ((init?.method ?? 'GET') === 'HEAD') {
        return {
          status: 200,
          headers: { get: (n: string) => (n.toLowerCase() === 'content-length' ? '16' : null) },
          arrayBuffer: async () => new ArrayBuffer(0),
        } satisfies HttpResponseLike;
      }
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers.Range !== undefined) requested.push(headers.Range);
      return {
        status: 206,
        headers: {
          get: (n: string) => (n.toLowerCase() === 'content-range' ? contentRange : null),
        },
        arrayBuffer: async () => served.slice().buffer,
      } satisfies HttpResponseLike;
    }) as unknown as FetchLike;
    return { fetch: fetchImpl, requested };
  }

  it('refuses a right-sized body taken from the wrong offset', async () => {
    // The exact failure: `bytes=8-11` goes out, the first four bytes come back, and the length
    // guard cannot tell — it only ever compared 4 against 4. Before 0.2.23 this resolved with
    // bytes 0..3 and the caller had the wrong seconds of the recording at the right timestamps.
    const { fetch, requested } = misbehaving('bytes 0-3/16', CONTENT.subarray(0, 4));
    const source = await httpSource('https://example.invalid/f.edf', { fetch });

    await expect(source.read(8, 4)).rejects.toThrow(EdfSourceError);
    await expect(source.read(8, 4)).rejects.toThrow(/sent bytes 0\.\.3/);
    // The request really did ask for the right range; the server is the one at fault.
    expect(requested).toContain('bytes=8-11');
  });

  it('accepts a 206 that carries the range it was asked for', async () => {
    const { fetch } = misbehaving('bytes 8-11/16', CONTENT.subarray(8, 12));
    const source = await httpSource('https://example.invalid/f.edf', { fetch });
    expect(Array.from(await source.read(8, 4))).toEqual([8, 9, 10, 11]);
  });

  it('still accepts a 206 from a double that reports no headers at all', async () => {
    // A caller-written FetchLike is a documented extension point and may answer `null` for every
    // header. Treating that as corruption would break doubles rather than catch servers; a real
    // 206 always carries Content-Range, so a misbehaving cache is still caught above.
    const { fetch } = misbehaving(null, CONTENT.subarray(8, 12));
    const source = await httpSource('https://example.invalid/f.edf', { fetch });
    expect(Array.from(await source.read(8, 4))).toEqual([8, 9, 10, 11]);
  });
});

// ---------------------------------------------------------------------------
// The contract guard admits only real byte arrays (0.2.23)
// ---------------------------------------------------------------------------

describe('assertExactRead', () => {
  it('refuses a one-byte view of the wrong signedness', async () => {
    // The dangerous case, and the quiet one. `Int8Array` has one byte per element so it passed a
    // length check, and `decodeInt16` then sign-extended already-signed elements a second time:
    // a file holding [-32768, -1, 200, 32767] decoded as [-98304, -65537, -65592, -65537] with no
    // error anywhere. A plain-JavaScript caller reaches this by typing Int8Array for Uint8Array.
    const wrong = new Int8Array(8) as unknown as Uint8Array;
    expect(() => assertExactRead(wrong, 0, 8)).toThrow(EdfSourceError);
    expect(() => assertExactRead(wrong, 0, 8)).toThrow(/not a byte array/);
  });

  it('refuses the duck-typed values the old length check let through', async () => {
    for (const value of [
      'abcd',
      [1, 2, 3, 4],
      { length: 4 },
      new Int32Array(4),
      new DataView(new ArrayBuffer(4)),
    ]) {
      expect(() => assertExactRead(value as unknown as Uint8Array, 0, 4)).toThrow(EdfSourceError);
    }
  });

  it('accepts every legitimate byte array, cross-realm ones included', async () => {
    // ArrayBuffer.isView rather than instanceof: a Uint8Array from a worker or an iframe is a
    // perfectly good byte array and `instanceof` is false for it.
    for (const value of [new Uint8Array(4), new Uint8ClampedArray(4), Buffer.alloc(4)]) {
      expect(assertExactRead(value as unknown as Uint8Array, 0, 4)).toBe(value);
    }
  });

  it('still reports the real length of a genuine short read', async () => {
    const short = new Uint8Array(3);
    expect(() => assertExactRead(short, 8, 4)).toThrow(/resolved with 3 bytes/);
  });
});

// ---------------------------------------------------------------------------
// The scan budget is sized from the file, not from the chunk (0.2.29)
// ---------------------------------------------------------------------------

describe('validateRecording sizes its scan buffer from the records that exist', () => {
  it('does not refuse a tiny file for a buffer it could never fill', async () => {
    // `chunkRecords` is a chunk size chosen from the record geometry, not from the file's length.
    // On a four-record file it is far larger than the whole recording, so the budget check was
    // made against a buffer that can never be filled and a small file was refused outright —
    // the opposite of the failure this guard exists for.
    const tiny = minimalEdfPlus({
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
    });
    const recording = await openEdf(byteSource(tiny));

    // 4 records x 30 samples x 4 bytes is well under a kilobyte; 64 KiB is generous for it.
    const report = await validateRecording(recording, {
      scanSamples: true,
      maxMaterializeBytes: 64 * 1024,
    });
    expect(report.recordsScanned).toBe(4);
    expect(report.signalStats.length).toBeGreaterThan(0);
  });

  it('still refuses a scan that genuinely does not fit', async () => {
    // The guard must keep biting for a file whose records really are too big for the budget.
    const wide = minimalEdfPlus({
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 20000 }],
    });
    const recording = await openEdf(byteSource(wide));
    await expect(
      validateRecording(recording, { scanSamples: true, maxMaterializeBytes: 1024 }),
    ).rejects.toThrow(/maxMaterializeBytes budget/);
  });
});

describe('a maxMaterializeBytes that is not a number names itself', () => {
  /**
   * `Number(process.env.EDF_BUDGET)` on an unset variable is `NaN`, and `ReadOptions` types the
   * field as `number`. Every comparison against `NaN` is false, so the guards did not fire and the
   * failure surfaced somewhere else, twice over and in two different ways:
   *
   * - `readWindow` and `readAnnotations` refused every read with an `EdfBudgetError` reporting a
   *   "NaN-byte maxMaterializeBytes budget" and advising "read fewer records per call" — advice no
   *   record count can satisfy.
   * - `validateRecording` and `buildRecordIndex` sized their scan chunks from it, so the failure
   *   arrived as an `EdfRangeError` about `records { start: 0, count: NaN }`, telling the caller to
   *   "clamp the range against header.recordCount" — a range neither function takes.
   *
   * One bad argument, two wrong diagnoses, neither naming the argument (fixed in 0.3.21).
   * `requireFiniteOption` was written for this class in 0.1.3 and never applied to this option.
   */
  async function recording() {
    return openEdf(byteSource(minimalEdfPlus({ recordCount: 8, recordDurationSeconds: 1 })));
  }

  const NOT_A_NUMBER = [
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ] as const;

  it.each(NOT_A_NUMBER)('is refused by readWindow for %s', async (_name, maxMaterializeBytes) => {
    const edf = await recording();
    await expect(
      readWindow(
        edf,
        { signalIndices: [0], startSeconds: 0, durationSeconds: 2 },
        { maxMaterializeBytes },
      ),
    ).rejects.toThrow(/options\.maxMaterializeBytes must be a finite number/);
  });

  it.each(NOT_A_NUMBER)('is refused by the scanning paths for %s', async (_name, budget) => {
    const edf = await recording();
    await expect(validateRecording(edf, { maxMaterializeBytes: budget })).rejects.toThrow(
      /options\.maxMaterializeBytes must be a finite number/,
    );
    await expect(buildRecordIndex(edf, { maxMaterializeBytes: budget })).rejects.toThrow(
      /options\.maxMaterializeBytes must be a finite number/,
    );
    await expect(
      readAnnotations(edf, { start: 0, count: 8 }, { maxMaterializeBytes: budget }),
    ).rejects.toThrow(/options\.maxMaterializeBytes must be a finite number/);
  });

  it('refuses a negative budget by name rather than refusing every read', async () => {
    const edf = await recording();
    await expect(
      readWindow(
        edf,
        { signalIndices: [0], startSeconds: 0, durationSeconds: 2 },
        { maxMaterializeBytes: -1 },
      ),
    ).rejects.toThrow(/must not be negative/);
  });

  it('still honours a real budget, in both directions', async () => {
    // The guard must not have swallowed the behaviour it protects.
    const edf = await recording();
    const selection = { signalIndices: [0], startSeconds: 0, durationSeconds: 2 } as const;
    await expect(readWindow(edf, selection, { maxMaterializeBytes: 8 })).rejects.toThrow(
      /maxMaterializeBytes budget/,
    );
    expect(await readWindow(edf, selection, { maxMaterializeBytes: 1_000_000 })).toHaveLength(1);
    // And omitting it still means the 256 MiB default.
    expect(await readWindow(edf, selection)).toHaveLength(1);
  });
});
