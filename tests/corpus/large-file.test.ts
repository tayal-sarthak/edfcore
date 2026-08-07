/**
 * The claims that only a real, large recording can test.
 *
 * `SC4001E0-PSG.edf` is 48 MB and 22 hours of clinical polysomnography: 2,650 records of 30 s,
 * with a 100 Hz EEG channel and a 1 Hz temperature channel in the same file. Synthetic fixtures
 * elsewhere in this suite are hundreds of bytes, and several properties edfcore advertises are
 * invisible at that size.
 *
 * What is checked here, and why each one needs this file:
 *
 * - **Envelope decimation is faithful.** `readEnvelope` exists so a viewer can draw eleven million
 *   samples into a thousand pixels, and the claim is that it keeps every extreme. That is checked
 *   against an EXHAUSTIVE reduction of the same samples — which means decoding all 7.95 million of
 *   them, something no small fixture can demonstrate.
 * - **The bucket grid does not move with the read chunk size.** A chunked fold that computed its
 *   bucket on the chunk's grid rather than the run's would give different answers at different
 *   chunk sizes, and on a 265-chunk file the difference is large. On a two-record fixture it is
 *   often zero.
 * - **Memory stays bounded by the chunk, not by the window.** An envelope over 22 hours must not
 *   materialise 22 hours, and the only honest way to show that is to bound the allocation and
 *   watch the read succeed anyway.
 *
 * Skips without the corpus, like everything else here. `npm run corpus:fetch`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readEnvelope } from '../../src/envelope.js';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { httpSource } from '../../src/io/http.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { ByteSource, FetchLike } from '../../src/types.js';

const PSG = join(dirname(fileURLToPath(import.meta.url)), 'files', 'SC4001E0-PSG.edf');
const enabled = existsSync(PSG);
const maybe = enabled ? it : it.skip;

async function psg() {
  return openEdf(byteSource(new Uint8Array(readFileSync(PSG))));
}

/** The reduction done exhaustively, with no reference to the implementation under test. */
function reduceByHand(samples: ArrayLike<number>, buckets: number) {
  const total = samples.length;
  const min = new Array<number>(buckets).fill(Number.POSITIVE_INFINITY);
  const max = new Array<number>(buckets).fill(Number.NEGATIVE_INFINITY);
  const counts = new Array<number>(buckets).fill(0);
  for (let i = 0; i < total; i += 1) {
    const bucket = Math.min(buckets - 1, Math.floor((i * buckets) / total));
    const value = samples[i] as number;
    min[bucket] = Math.min(min[bucket] as number, value);
    max[bucket] = Math.max(max[bucket] as number, value);
    counts[bucket] = (counts[bucket] as number) + 1;
  }
  return { min, max, counts };
}

describe('a 22-hour clinical recording', () => {
  maybe('is what this file claims it is', async () => {
    // Without this the assertions below could pass against some other, smaller file.
    const recording = await psg();
    expect(recording.header.recordCount).toBe(2650);
    expect(recording.header.recordDurationSeconds).toBe(30);
    expect(recording.timeline.spanSeconds).toBe(79_500);
    const eeg = getSignal(recording.header, 'EEG Fpz-Cz');
    expect(eeg.sampleRateHz).toBe(100);
    expect(eeg.sampleCount).toBe(7_950_000);
  });

  maybe(
    'decimates the whole recording exactly as an exhaustive reduction would',
    async () => {
      // 7.95 million samples reduced to 1000 buckets — the actual thing the feature exists for,
      // checked against every sample rather than against a spot value.
      const recording = await psg();
      const eeg = getSignal(recording.header, 'EEG Fpz-Cz');
      const buckets = 1000;

      const [chunk] = await readWindow(recording, {
        signalIndices: [eeg.index],
        startSeconds: 0,
        durationSeconds: recording.timeline.spanSeconds,
      });
      const samples = chunk?.signals[0]?.digital;
      if (samples === undefined) throw new Error('no samples');
      expect(samples.length).toBe(eeg.sampleCount);

      const [envelope] = await readEnvelope(recording, {
        signalIndices: [eeg.index],
        startSeconds: 0,
        durationSeconds: recording.timeline.spanSeconds,
        buckets,
      });
      const actual = envelope?.signals[0];
      if (actual === undefined) throw new Error('no envelope');

      const expected = reduceByHand(samples, envelope?.bucketCount ?? buckets);
      expect([...actual.min]).toEqual(expected.min);
      expect([...actual.max]).toEqual(expected.max);
      expect([...actual.counts]).toEqual(expected.counts);
      expect(actual.sampleCount).toBe(samples.length);
    },
    60_000,
  );

  maybe(
    'gives the same envelope at every read chunk size',
    async () => {
      // 265 chunks versus a handful. A fold that computed its bucket on the CHUNK's grid rather than
      // the run's would diverge here and agree on a two-record fixture.
      const recording = await psg();
      const eeg = getSignal(recording.header, 'EEG Fpz-Cz');
      const selection = {
        signalIndices: [eeg.index],
        startSeconds: 0,
        durationSeconds: recording.timeline.spanSeconds,
        buckets: 997,
      };

      const [wide] = await readEnvelope(recording, selection);
      const [narrow] = await readEnvelope(recording, selection, {
        maxMaterializeBytes: 256 * 1024,
      });

      expect([...(narrow?.signals[0]?.min ?? [])]).toEqual([...(wide?.signals[0]?.min ?? [])]);
      expect([...(narrow?.signals[0]?.max ?? [])]).toEqual([...(wide?.signals[0]?.max ?? [])]);
      expect(narrow?.signals[0]?.sampleCount).toBe(wide?.signals[0]?.sampleCount);
    },
    60_000,
  );

  maybe(
    'envelopes 22 hours under a budget far smaller than the recording',
    async () => {
      // The memory claim, made falsifiable: 22 hours of 100 Hz samples is ~32 MB as Int32. If the
      // window were materialised, a 512 KiB budget would refuse the read.
      const recording = await psg();
      const eeg = getSignal(recording.header, 'EEG Fpz-Cz');

      const [envelope] = await readEnvelope(
        recording,
        {
          signalIndices: [eeg.index],
          startSeconds: 0,
          durationSeconds: recording.timeline.spanSeconds,
          buckets: 1000,
        },
        { maxMaterializeBytes: 512 * 1024 },
      );

      expect(envelope?.bucketCount).toBe(1000);
      expect(envelope?.signals[0]?.sampleCount).toBe(eeg.sampleCount);
    },
    60_000,
  );

  maybe('keeps two channels on their own grids across the whole file', async () => {
    // 100 Hz and 1 Hz in one file. A reader that shared one grid would be wrong by a factor of a
    // hundred at the far end, and only at the far end.
    const recording = await psg();
    const eeg = getSignal(recording.header, 'EEG Fpz-Cz');
    const temp = getSignal(recording.header, 'Temp rectal');

    expect(eeg.sampleRateHz).toBe(100);
    expect(temp.sampleRateHz).toBe(1);

    // The last 30 s of the recording, where a shared-grid error is largest.
    const startSeconds = recording.timeline.spanSeconds - 30;
    const [chunk] = await readWindow(recording, {
      signalIndices: [eeg.index, temp.index],
      startSeconds,
      durationSeconds: 30,
    });

    expect(chunk?.signals[0]?.sampleCount).toBe(3000);
    expect(chunk?.signals[1]?.sampleCount).toBe(30);
    expect(chunk?.signals[0]?.firstSampleIndex).toBe(eeg.sampleCount - 3000);
    expect(chunk?.signals[1]?.firstSampleIndex).toBe(temp.sampleCount - 30);
  });
});

describe('streaming 22 hours', () => {
  maybe(
    'yields exactly the samples readWindow does, in the same order',
    async () => {
      // The documented claim is that a streamed chunk and a read chunk are the same object in every
      // respect. On a 40-record fixture a chunking mistake often cancels out; over 2,650 records it
      // cannot. Concatenating 22 hours and comparing element by element is the strongest form.
      const recording = await psg();
      const eeg = getSignal(recording.header, 'EEG Fpz-Cz');

      const [whole] = await readWindow(recording, {
        signalIndices: [eeg.index],
        startSeconds: 0,
        durationSeconds: recording.timeline.spanSeconds,
      });
      const expected = whole?.signals[0]?.digital;
      if (expected === undefined) throw new Error('no samples');

      const streamed = new Int32Array(expected.length);
      let written = 0;
      let chunks = 0;
      let widest = 0;
      for await (const chunk of streamRecords(recording, {
        signalIndices: [eeg.index],
        startSeconds: 0,
        durationSeconds: recording.timeline.spanSeconds,
        chunkRecords: 64,
      })) {
        const samples = chunk.signals[0]?.digital;
        if (samples === undefined) throw new Error('a streamed chunk carried no samples');
        streamed.set(samples.subarray(0, chunk.signals[0]?.sampleCount ?? 0), written);
        written += chunk.signals[0]?.sampleCount ?? 0;
        widest = Math.max(widest, samples.length);
        chunks += 1;
      }

      expect(written).toBe(expected.length);

      // A loop rather than `toEqual`: a deep-equality assertion over two 7.95-million-element typed
      // arrays takes about forty seconds and, when it fails, prints a diff nobody can read. This
      // names the first differing sample, which is the only part anyone would look at.
      let firstDifference = -1;
      for (let i = 0; i < expected.length; i += 1) {
        if (streamed[i] !== expected[i]) {
          firstDifference = i;
          break;
        }
      }
      expect(
        firstDifference,
        firstDifference < 0
          ? ''
          : `sample ${firstDifference}: streamed ${streamed[firstDifference]}, read ${expected[firstDifference]}`,
      ).toBe(-1);

      // And it really did arrive in pieces: 2,650 records at 64 per chunk.
      expect(chunks).toBe(Math.ceil(2650 / 64));
      // No chunk ever held more than its own records — the bounded-memory claim, as a number.
      expect(widest).toBeLessThanOrEqual(64 * eeg.samplesPerRecord);
      expect(widest).toBeLessThan(expected.length / 10);
    },
    60_000,
  );

  maybe('streams the first chunk without reading the whole file', async () => {
    // Bounded memory is only half of it; the other half is that streaming does not have to read
    // 48 MB before yielding anything. The byte counter is the evidence.
    const bytes = new Uint8Array(readFileSync(PSG));
    let bytesRead = 0;
    const counting: ByteSource = {
      byteLength: bytes.byteLength,
      async read(offset, length) {
        bytesRead += length;
        return bytes.subarray(offset, offset + length);
      },
    };

    const recording = await openEdf(counting);
    const eeg = getSignal(recording.header, 'EEG Fpz-Cz');
    const afterOpen = bytesRead;

    for await (const chunk of streamRecords(recording, {
      signalIndices: [eeg.index],
      startSeconds: 0,
      durationSeconds: recording.timeline.spanSeconds,
      chunkRecords: 8,
    })) {
      expect(chunk.records.count).toBe(8);
      break;
    }

    // Eight records of a 2,650-record file: well under one percent of it.
    const forFirstChunk = bytesRead - afterOpen;
    expect(forFirstChunk).toBeGreaterThan(0);
    expect(forFirstChunk).toBeLessThan(bytes.byteLength / 100);
  });
});

describe('random access over HTTP, on a real 48 MB recording', () => {
  /**
   * A `fetch` that serves byte ranges out of the real file and counts what it hands over.
   *
   * Conformant on purpose: it answers 206 with a correct `Content-Range`, which is what
   * `httpSource` has verified since 0.2.23. The point here is not the guard but the ACCESS
   * PATTERN — how many bytes a window costs when the file is behind a network.
   */
  function ranged(bytes: Uint8Array) {
    let served = 0;
    let requests = 0;
    const fetchImpl = (async (_url: string, init?: { method?: string; headers?: unknown }) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if ((init?.method ?? 'GET') === 'HEAD') {
        return {
          status: 200,
          headers: {
            get: (n: string) =>
              n.toLowerCase() === 'content-length' ? String(bytes.byteLength) : null,
          },
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
      const match = /^bytes=(\d+)-(\d+)$/.exec(headers.Range ?? '');
      if (match === null) throw new Error(`unexpected Range: ${headers.Range}`);
      const first = Number(match[1]);
      const last = Number(match[2]);
      const slice = bytes.slice(first, last + 1);
      served += slice.byteLength;
      requests += 1;
      return {
        status: 206,
        headers: {
          get: (n: string) =>
            n.toLowerCase() === 'content-range'
              ? `bytes ${first}-${last}/${bytes.byteLength}`
              : null,
        },
        arrayBuffer: async () => slice.buffer,
      };
    }) as unknown as FetchLike;
    return { fetch: fetchImpl, served: () => served, requests: () => requests };
  }

  maybe('reads a 30-second window twelve hours in for kilobytes, not megabytes', async () => {
    // This is the claim the whole package is built around, over the transport that makes it
    // matter. A reader that has to download the file first cannot do this at all.
    const bytes = new Uint8Array(readFileSync(PSG));
    const { fetch, served, requests } = ranged(bytes);

    const source = await httpSource('https://example.invalid/psg.edf', { fetch });
    const recording = await openEdf(source);
    const eeg = getSignal(recording.header, 'EEG Fpz-Cz');
    const afterOpen = served();

    const [chunk] = await readWindow(recording, {
      signalIndices: [eeg.index],
      startSeconds: 12 * 3600,
      durationSeconds: 30,
    });

    expect(chunk?.records.count).toBe(1);
    expect(chunk?.signals[0]?.sampleCount).toBe(3000);

    const forWindow = served() - afterOpen;
    // One 30-second record of this file is under 30 KB. The file is 48 MB.
    expect(forWindow).toBeLessThan(64 * 1024);
    expect(forWindow).toBeLessThan(bytes.byteLength / 1000);
    expect(requests()).toBeGreaterThan(0);
  });

  maybe('opens the file without reading its data at all', async () => {
    // `openEdf` probes the header and two records. On a 48 MB file that has to stay tiny, or
    // "open then seek" is not a usable pattern over a network.
    const bytes = new Uint8Array(readFileSync(PSG));
    const { fetch, served } = ranged(bytes);

    const recording = await openEdf(await httpSource('https://example.invalid/psg.edf', { fetch }));
    expect(recording.header.recordCount).toBe(2650);
    // Header is 2 KB; two probed records add a little. Anything near the file size is a failure.
    expect(served()).toBeLessThan(bytes.byteLength / 500);
  });
});
