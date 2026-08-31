/**
 * The `ByteSource` `data-sources.md` tells you to write, written and read through.
 *
 * "Writing your own ByteSource" is the section that makes the interface a promise rather than an
 * implementation detail: "If your bytes live somewhere edfcore has no adapter for, implement the
 * interface. The whole job is: know the length, return exactly the bytes asked for, and reject
 * otherwise." It then shows a complete adapter over a range-returning object store — the shape most
 * of them have — and lists four rules "in order of how badly they bite".
 *
 * None of it was run. `source-contract.test.ts` covers the contract from edfcore's side, with
 * sources written for the test; `documented-defaults.test.ts` and `source-interface.test.ts` cover
 * the tables. The adapter a reader would copy is forty lines of stream handling, and the four rules
 * under it are each a way of getting it wrong that produces plausible data rather than an error.
 *
 * So the page's adapter is transcribed and used: a recording is opened over it, a window is read,
 * and the samples are compared against the same file through `byteSource`. The store streams in
 * irregular chunks, which is the whole reason the adapter has a loop — a `ReadableStream` "delivers
 * chunks of whatever size it likes, so the read isn't done until `length` bytes have arrived".
 *
 * Then each of the four rules is broken on purpose, in an adapter of its own, to show what it costs:
 * a short return, a padded one, a reused buffer, and one that ignores `options.signal`. The last is
 * the page's own Warning, and it is the one worth having under test: "edfcore itself does not poll
 * the signal between reads. A custom `ByteSource` that ignores `options.signal` makes cancellation a
 * complete no-op, including for a long `validateRecording` sweep that issues hundreds of reads."
 * That is a stated limitation, and a limitation nobody checks is indistinguishable from a bug.
 */

import { describe, expect, it } from 'vitest';
import { EdfSourceError, isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import type { AbortSignalLike, ByteSource, ReadOptions } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = (DOCS_PAGES.get('data-sources.md') ?? '').replace(/\s+/g, ' ');

const BYTES = buildEdf({
  plus: 'C',
  recordCount: 40,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fpz-Cz', samplesPerRecord: 32, sample: (r, i) => ((r * 31 + i) % 601) - 300 },
  ],
  annotationSignals: [{ samplesPerRecord: 24 }],
});

/** The same geometry with no annotations channel, for the one rule that is about the samples. */
const PLAIN = buildEdf({
  recordCount: 40,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fpz-Cz', samplesPerRecord: 32, sample: (r, i) => ((r * 31 + i) % 601) - 300 },
  ],
});

const KEY = 'recordings/night.edf';

// ---------------------------------------------------------------------------
// The store, and the adapter the page writes over it
// ---------------------------------------------------------------------------

interface RangeStore {
  size(key: string): Promise<number>;
  /** Inclusive at both ends, like an HTTP byte range. */
  openRange(key: string, start: number, end: number): Promise<ReadableStream<Uint8Array>>;
}

/**
 * A store whose streams deliver irregular pieces. 7, 1, 4096, 3 … — anything but the whole range in
 * one go, which is the case the adapter's loop exists for and the one a test that returned it all
 * at once would never reach.
 */
function irregularStore(
  bytes: Uint8Array,
  pieces: readonly number[] = [7, 1, 4096, 3, 64],
): RangeStore {
  return {
    size: async () => bytes.byteLength,
    openRange: async (_key, start, end) => {
      const slice = bytes.subarray(start, end + 1);
      let at = 0;
      let piece = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (at >= slice.length) {
            controller.close();
            return;
          }
          const size = pieces[piece % pieces.length] ?? 1;
          piece += 1;
          const take = Math.min(size, slice.length - at);
          // A copy, because a real store hands back its own buffer and may reuse it.
          controller.enqueue(Uint8Array.from(slice.subarray(at, at + take)));
          at += take;
        },
      });
    },
  };
}

/** The page's own helper, transcribed. `DOMException` cannot be named without the DOM library. */
function throwIfAborted(signal: AbortSignalLike | undefined): void {
  if (signal?.aborted !== true) return;
  const error = new Error('The read was aborted through options.signal.');
  error.name = 'AbortError';
  throw error;
}

/** The adapter `data-sources.md` prints, transcribed. */
function rangeStoreSource(store: RangeStore, key: string, byteLength: number): ByteSource {
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

const overTheStore = (): ByteSource =>
  rangeStoreSource(irregularStore(BYTES), KEY, BYTES.byteLength);

async function thrownBy(call: () => unknown): Promise<unknown> {
  return Promise.resolve()
    .then(call)
    .then(
      () => undefined,
      (error: unknown) => error,
    );
}

// ---------------------------------------------------------------------------
// It works
// ---------------------------------------------------------------------------

describe('the adapter the page prints', () => {
  it('is the section the page still carries', () => {
    expect(PAGE).toContain('If your bytes live somewhere edfcore has no adapter for');
    expect(PAGE).toContain(
      'know the length, return exactly the bytes asked for, and reject otherwise',
    );
  });

  it('opens a recording, exactly as the page says it would', async () => {
    // "Using it is the same as any other source."
    const recording = await openEdf(overTheStore());
    expect(recording.header.recordCount).toBe(40);
    expect(recording.header.signals).toHaveLength(2);
  });

  it('gives the same samples the bundled adapter gives, byte for byte', async () => {
    const mine = await readWindow(await openEdf(overTheStore()), {
      startSeconds: 5,
      durationSeconds: 10,
      signalIndices: [0],
    });
    const theirs = await readWindow(await openEdf(byteSource(BYTES)), {
      startSeconds: 5,
      durationSeconds: 10,
      signalIndices: [0],
    });

    expect(mine).toHaveLength(theirs.length);
    for (const [index, chunk] of mine.entries()) {
      const other = theirs[index];
      expect(chunk.byteLength).toBe(other?.byteLength);
      expect([...(chunk.signals[0]?.digital ?? [])]).toEqual([
        ...(other?.signals[0]?.digital ?? []),
      ]);
    }
    // And the samples are a real waveform, so an equality between two flat arrays is not the pass.
    expect(new Set(mine[0]?.signals[0]?.digital ?? []).size).toBeGreaterThan(50);
  });

  it('needed its loop: no single piece the store hands back is a whole read', async () => {
    let largestPiece = 0;
    const store = irregularStore(BYTES);
    const counting: RangeStore = {
      size: store.size,
      openRange: async (key, start, end) => {
        const inner = (await store.openRange(key, start, end)).getReader();
        return new ReadableStream<Uint8Array>({
          async pull(controller) {
            const { value, done } = await inner.read();
            if (done || value === undefined) {
              controller.close();
              return;
            }
            largestPiece = Math.max(largestPiece, value.length);
            controller.enqueue(value);
          },
        });
      },
    };

    const recording = await openEdf(rangeStoreSource(counting, KEY, BYTES.byteLength));
    const chunk = await readRecords(recording, {
      records: { start: 0, count: 20 },
      signalIndices: [0],
    });
    expect(chunk.byteLength).toBe(20 * recording.header.recordByteLength);
    expect(largestPiece).toBeLessThan(chunk.byteLength);
  });

  it('refuses a range outside the object, naming the key the way the page does', async () => {
    const source = overTheStore();
    const error = await thrownBy(() => source.read(BYTES.byteLength - 4, 16));
    expect(error).toBeInstanceOf(EdfSourceError);
    expect((error as Error).message).toContain(KEY);
    expect((error as EdfSourceError).requestedLength).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// The four rules, broken one at a time
// ---------------------------------------------------------------------------

describe('rule 1: never return a short buffer', () => {
  /** The adapter, over a store whose stream stops early. Its own check is what fires. */
  it('is caught by the adapter, which can name the key and the range', async () => {
    const truncated: RangeStore = {
      size: async () => BYTES.byteLength,
      openRange: async (_key, start, end) => {
        const half = Math.max(1, Math.floor((end - start + 1) / 2));
        const slice = Uint8Array.from(BYTES.subarray(start, start + half));
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(slice);
            controller.close();
          },
        });
      },
    };
    const source = rangeStoreSource(truncated, KEY, BYTES.byteLength);
    const error = await thrownBy(() => source.read(0, 256));
    expect(error).toBeInstanceOf(EdfSourceError);
    expect((error as Error).message).toContain('ended after 128 bytes');
    expect((error as EdfSourceError).receivedLength).toBe(128);
  });

  it('and by edfcore anyway, for a source that does not check', async () => {
    // "edfcore checks anyway and raises EdfSourceError on your behalf."
    const careless: ByteSource = {
      byteLength: BYTES.byteLength,
      read: async (offset, length) => BYTES.subarray(offset, offset + Math.floor(length / 2)),
    };
    const error = await thrownBy(() => openEdf(careless));
    expect(error).toBeInstanceOf(EdfSourceError);
    expect(isEdfError(error)).toBe(true);
    expect((error as EdfSourceError).receivedLength).toBeLessThan(
      (error as EdfSourceError).requestedLength,
    );
  });
});

describe('rule 2: never pad', () => {
  it('is why zeros are the dangerous answer: they decode as a valid, flat signal', async () => {
    // A plain EDF, because this rule is about the SAMPLES. On an EDF+ the padded annotation region
    // gives the padding away with a TAL diagnostic — see the test below — and on a file with no
    // annotations channel there is nothing at all to notice it.
    const padded: ByteSource = {
      byteLength: PLAIN.byteLength,
      read: async (offset, length) => {
        const out = new Uint8Array(length);
        // Only the header is real; every data record comes back as zeros.
        if (offset < 512) out.set(PLAIN.subarray(offset, offset + length));
        return out;
      },
    };

    const recording = await openEdf(padded);
    const chunk = await readRecords(recording, {
      records: { start: 5, count: 1 },
      signalIndices: [0],
    });
    const digital = chunk.signals[0]?.digital ?? new Int32Array(0);

    // Nothing threw, nothing was diagnosed, and every sample is a legal value.
    expect(chunk.diagnostics).toEqual([]);
    expect(digital).toHaveLength(32);
    expect([...digital].every((value) => value === 0)).toBe(true);

    // Which is not what the file holds.
    const honest = await readRecords(await openEdf(byteSource(PLAIN)), {
      records: { start: 5, count: 1 },
      signalIndices: [0],
    });
    expect([...(honest.signals[0]?.digital ?? [])]).not.toEqual([...digital]);
  });

  it('is noticed on an EDF+, where the padding lands in an annotation region too', async () => {
    // Not a contradiction of the rule — a consolation. The samples are still silently zero; it is
    // the TAL grammar next to them that refuses, and only a file with an annotations channel has
    // one. A padding source on a plain EDF is undetectable.
    const padded: ByteSource = {
      byteLength: BYTES.byteLength,
      read: async (offset, length) => {
        const out = new Uint8Array(length);
        if (offset < 1024) out.set(BYTES.subarray(offset, offset + length));
        return out;
      },
    };
    const recording = await openEdf(padded);
    const chunk = await readRecords(recording, {
      records: { start: 5, count: 1 },
      signalIndices: [0],
    });
    expect(chunk.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'TIMEKEEPING_TAL_MISSING',
    );
    expect([...(chunk.signals[0]?.digital ?? [])].every((value) => value === 0)).toBe(true);
  });
});

describe('rule 3: return bytes the caller can keep', () => {
  it('is why the page allocates per read rather than reusing one buffer', async () => {
    const scratch = new Uint8Array(BYTES.byteLength);
    const reusing: ByteSource = {
      byteLength: BYTES.byteLength,
      read: async (offset, length) => {
        const view = scratch.subarray(0, length);
        view.set(BYTES.subarray(offset, offset + length));
        return view;
      },
    };

    const first = await reusing.read(0, 64);
    const snapshot = Uint8Array.from(first);
    await reusing.read(1024, 64);
    // The array the first read handed back now holds the second read's bytes.
    expect(first).not.toEqual(snapshot);

    // The page's adapter does not do that: each read owns its own `out`.
    const source = overTheStore();
    const a = await source.read(0, 64);
    const kept = Uint8Array.from(a);
    await source.read(1024, 64);
    expect(a).toEqual(kept);
  });
});

describe('rule 4: honour options.signal', () => {
  it('is honoured by the page’s adapter, at the top of read and inside its loop', async () => {
    const before = new AbortController();
    before.abort();
    const source = overTheStore();
    const atTheTop = await thrownBy(() => source.read(0, 256, { signal: before.signal }));
    expect((atTheTop as Error).name).toBe('AbortError');

    // And once the loop has started: the store yields one piece, then the signal fires.
    const during = new AbortController();
    const slow: RangeStore = {
      size: async () => BYTES.byteLength,
      openRange: async (_key, start, end) => {
        const slice = BYTES.subarray(start, end + 1);
        let at = 0;
        return new ReadableStream<Uint8Array>({
          pull(controller) {
            if (at >= slice.length) {
              controller.close();
              return;
            }
            controller.enqueue(Uint8Array.from(slice.subarray(at, at + 8)));
            at += 8;
            during.abort();
          },
        });
      },
    };
    const inTheLoop = await thrownBy(() =>
      rangeStoreSource(slow, KEY, BYTES.byteLength).read(0, 256, { signal: during.signal }),
    );
    expect((inTheLoop as Error).name).toBe('AbortError');
    expect(isEdfError(inTheLoop)).toBe(false);
  });

  it('and is a complete no-op for a source that ignores it, which is the page’s Warning', async () => {
    expect(PAGE).toContain('edfcore itself does not poll the signal between reads');
    expect(PAGE).toContain('makes cancellation a complete no-op');

    let reads = 0;
    const deaf: ByteSource = {
      byteLength: BYTES.byteLength,
      read: async (offset, length) => {
        reads += 1;
        return BYTES.subarray(offset, offset + length);
      },
    };

    const controller = new AbortController();
    controller.abort();
    const recording = await openEdf(deaf, { signal: controller.signal });

    // The whole-file sweep the Warning names, with the signal already aborted: it completes.
    const report = await validateRecording(recording, {
      scanSamples: true,
      signal: controller.signal,
    });
    expect(report.recordsScanned).toBe(40);

    // And the traversal that really does issue a read per chunk, sized down so there are many of
    // them: twenty reads after the abort, every one of them served.
    const readsBefore = reads;
    const index = await buildRecordIndex(recording, {
      maxMaterializeBytes: 2 * recording.header.recordByteLength,
      signal: controller.signal,
    });
    expect(index.coverage).toBe('complete');
    expect(reads - readsBefore).toBeGreaterThan(10);
  });
});
