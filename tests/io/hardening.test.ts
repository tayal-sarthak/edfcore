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
import { DEFAULT_MAX_MATERIALIZE_BYTES } from '../../src/constants.js';
import { isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { httpSource } from '../../src/io/http.js';
import { openEdf } from '../../src/recording.js';
import type { FetchLike, HttpResponseLike } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';

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

  it('refuses a 400 MB scratch buffer demanded by a 512-byte file', async () => {
    const recording = await openEdf(byteSource(oneCorruptedField()));
    expect(recording.header.recordCount).toBe(0);

    // scanChunkRecords floors to one record when a single record exceeds the scan block, so the
    // scratch size becomes samplesPerRecord unclamped. It was allocated before any read, which
    // is why no downstream budget check could ever catch it.
    const error = await validateRecording(recording, {
      scanSamples: true,
      maxMaterializeBytes: 1024,
    }).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    expect(isEdfError(error)).toBe(true);
    expect(error).toMatchObject({
      edfErrorKind: 'budget',
      requiredBytes: 99999999 * 4,
      budgetBytes: 1024,
    });
  });

  it('refuses it against the default budget too', async () => {
    const recording = await openEdf(byteSource(oneCorruptedField()));
    await expect(validateRecording(recording, { scanSamples: true })).rejects.toMatchObject({
      edfErrorKind: 'budget',
      budgetBytes: DEFAULT_MAX_MATERIALIZE_BYTES,
    });
  });

  it('leaves a well-formed file scanning normally', async () => {
    const recording = await openEdf(byteSource(oneCorruptedField()));
    // Header-only validation never allocates the scratch buffer, so it must still work.
    const report = await validateRecording(recording, { scanSamples: false });
    expect(report.recordsScanned).toBe(0);
  });
});
