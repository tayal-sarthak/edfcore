/**
 * The same bytes through every source produce the same recording.
 *
 * `data-sources.md` says a `ByteSource` is "the whole of what edfcore needs from the outside
 * world" and that the five constructors are interchangeable. Each is tested for the thing it does
 * — `file-source.test.ts` for descriptors and stat, `http-*.test.ts` for Range and 200s and
 * concurrency, `cache-invisible.test.ts` for the block cache — and nothing ran the reading API
 * over all of them and compared the answers.
 *
 * That is the claim a caller actually depends on. Someone develops against `byteSource` in a test,
 * ships `httpSource` in a browser and `fileSource` in a batch job, and the promise is that the
 * three are one recording. The seams are real: `fileSource` reads through a descriptor at an
 * offset, `httpSource` splits a read into Range requests and may be answered with a whole body,
 * and `cachedSource` serves from blocks that never line up with a record. Each has its own path to
 * the same bytes, and each is a place where an off-by-one would be visible only through it.
 *
 * `bytesRead` on the validation report is compared too, and exactly. A block cache reads whole
 * blocks and so moves more bytes than it was asked for — but a full conformance sweep ends up
 * reading the whole file whatever the blocking, and no source may read it twice. The
 * over-reading a partial window provokes is `cache.test.ts`'s subject, and it is not this one.
 *
 * The HTTP source is driven with a stub that honours Range, which is what `http-*.test.ts` shows
 * the real ones do. This file is not about what a server may do; it is about whether five paths to
 * the same bytes agree.
 *
 * Every source is closed. `fileSource` holds a descriptor and `close()` is optional on the
 * interface, so a sweep that opens one per shape per spelling and walks away leaks them — which on
 * Node 26 is not a warning but an uncaught `ERR_INVALID_STATE` when the handle is collected. The
 * `finally` below is the reason this file passes on all three supported versions, and it is the
 * same discipline `after-close.test.ts` is about from the other side.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readEnvelope } from '../../src/envelope.js';
import { blobSource } from '../../src/io/blob.js';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { httpSource } from '../../src/io/http.js';
import { fileSource } from '../../src/node.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import type { ByteSource, FetchLike } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { AWKWARD } from '../support/awkward-files.js';

const DIR = mkdtempSync(join(tmpdir(), 'edfcore-five-sources-'));

/** A server that honours Range, which is the path `httpSource` is built for. */
function rangeServer(bytes: Uint8Array): FetchLike {
  return ((href: string, init?: { method?: string; headers?: Record<string, string> }) => {
    if ((init?.method ?? 'GET') === 'HEAD') {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'content-length' ? String(bytes.length) : null,
        },
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
    }
    const range = /bytes=(\d+)-(\d+)/.exec(init?.headers?.Range ?? init?.headers?.range ?? '');
    if (range === null) throw new Error(`no Range on a GET for ${href}`);
    const from = Number(range[1]);
    const to = Number(range[2]) + 1;
    const slice = bytes.slice(from, Math.min(to, bytes.length));
    return Promise.resolve({
      ok: true,
      status: 206,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-range'
            ? `bytes ${from}-${Math.min(to, bytes.length) - 1}/${bytes.length}`
            : null,
      },
      arrayBuffer: () =>
        Promise.resolve(slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength)),
    });
  }) as unknown as FetchLike;
}

interface Spelling {
  readonly how: string;
  readonly open: (bytes: Uint8Array, name: string) => Promise<ByteSource>;
}

const SPELLINGS: readonly Spelling[] = [
  { how: 'byteSource', open: async (bytes) => byteSource(bytes) },
  { how: 'blobSource', open: async (bytes) => blobSource(new Blob([bytes as BlobPart])) },
  {
    how: 'fileSource',
    open: async (bytes, name) => {
      const path = join(DIR, `${name.replace(/[^a-z0-9]+/gi, '-')}.edf`);
      writeFileSync(path, bytes);
      return fileSource(path);
    },
  },
  {
    how: 'httpSource',
    open: async (bytes) => httpSource('https://x.test/a.edf', { fetch: rangeServer(bytes) }),
  },
  {
    how: 'cachedSource over byteSource',
    open: async (bytes) => cachedSource(byteSource(bytes), { blockBytes: 512 }),
  },
];

/** Everything the reading API answers about one file, as one comparable value. */
async function everything(source: ByteSource): Promise<Record<string, unknown>> {
  try {
    return await readEverything(source);
  } finally {
    await source.close?.();
  }
}

async function readEverything(source: ByteSource): Promise<Record<string, unknown>> {
  const recording = await openEdf(source);
  const index = await buildRecordIndex(recording);
  const located = { ...recording, index };
  const signalIndices = [...recording.header.dataSignalIndices];
  const readable =
    signalIndices.length > 0 &&
    recording.header.recordCount > 0 &&
    recording.header.recordDurationSeconds > 0;

  const report = await validateRecording(recording, { scanSamples: true });
  return {
    byteLength: source.byteLength,
    header: recording.header,
    timeline: recording.timeline,
    segments: index.segments,
    gaps: index.gaps,
    annotations: (
      await readAnnotations(recording, { start: 0, count: recording.header.recordCount })
    ).annotations,
    report: { ...report, bytesRead: undefined },
    records: readable
      ? await readRecords(located, { records: { start: 0, count: 1 }, signalIndices })
      : null,
    window: readable
      ? await readWindow(located, { startSeconds: 0, durationSeconds: 20, signalIndices })
      : null,
    envelope: readable
      ? await readEnvelope(located, {
          startSeconds: 0,
          durationSeconds: 3,
          buckets: 4,
          signalIndices,
        })
      : null,
  };
}

describe('the spellings this compares', () => {
  it('are the five a caller can reach, over the eleven shapes', () => {
    expect(SPELLINGS).toHaveLength(5);
    expect(AWKWARD).toHaveLength(11);
  });
});

describe.each(AWKWARD)('$name', ({ bytes, name }) => {
  it('reads the same recording through every source', async () => {
    const baseline = await everything(byteSource(bytes));
    for (const spelling of SPELLINGS) {
      const through = await everything(await spelling.open(bytes, name));
      expect(through, `${spelling.how} disagreed`).toEqual(baseline);
    }
  });

  it('reads the same number of bytes, the cache included', async () => {
    const bytesRead = async (spelling: Spelling): Promise<number> => {
      const source = await spelling.open(bytes, name);
      try {
        const recording = await openEdf(source);
        return (await validateRecording(recording, { scanSamples: true })).bytesRead;
      } finally {
        await source.close?.();
      }
    };
    const baseline = await bytesRead(SPELLINGS[0] as Spelling);
    for (const spelling of SPELLINGS) {
      expect({ how: spelling.how, read: await bytesRead(spelling) }).toEqual({
        how: spelling.how,
        read: baseline,
      });
    }
  });
});

describe('the comparison has something in it', () => {
  it('reads real data through the sources, not an empty graph', async () => {
    const readable = AWKWARD.find((file) => file.name === 'plain EDF, one signal');
    if (readable === undefined) throw new Error('the matrix lost its plain file');
    const all = await everything(byteSource(readable.bytes));
    expect(all.records).not.toBeNull();
    expect(all.window).not.toBeNull();
    expect(all.envelope).not.toBeNull();
    expect((all.header as { signals: readonly unknown[] }).signals.length).toBeGreaterThan(0);
  });

  it('counts bytes at all, so the equality above is not zero against zero', async () => {
    const file = AWKWARD.find((one) => one.name === 'EDF+C with annotations');
    if (file === undefined) throw new Error('the matrix lost its annotated file');
    const read = async (source: ByteSource): Promise<number> =>
      (await validateRecording(await openEdf(source), { scanSamples: true })).bytesRead;

    const plain = await read(byteSource(file.bytes));
    expect(plain).toBeGreaterThan(0);
    // And a block cache small enough to split every record still reads exactly the file, which is
    // the claim: whole blocks, but no block twice and nothing past the end.
    expect(await read(cachedSource(byteSource(file.bytes), { blockBytes: 64 }))).toBe(plain);
  });
});
