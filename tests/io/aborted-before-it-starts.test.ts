/**
 * An already-aborted signal, at every entry point that takes one.
 *
 * `api-sources.md`: "edfcore polls `.aborted` before and after each read and throws an `Error`
 * whose `name` is `'AbortError'`." `data-sources.md` adds the reach: "Every bundled adapter checks
 * `options.signal` before it starts, and again at each point where it resumes after an await ...
 * The rejection is a plain `Error` with `name === 'AbortError'`, not an `EdfError`. `isEdfError`
 * returns false for it, so a `catch` that re-throws aborts stays simple."
 *
 * `http-abort-signal.test.ts` covers the adapter with the most to go wrong. What nothing covered is
 * the sentence's scope: the guard lives in the SOURCES, and every reading function in the package
 * reaches it only by issuing a read. Whether each of them actually does — before allocating,
 * before scanning, before decoding — is a property of fourteen call paths, not of the four
 * adapters, and a function that resolved its window or sized its buffer first would do that work
 * for a caller who had already cancelled.
 *
 * So every entry point is driven with a signal aborted before the call, and each must reject with
 * `name === 'AbortError'` and `isEdfError` false — the discriminator the page says consumers branch
 * on, chosen because `DOMException` cannot be named without the DOM lib.
 *
 * The one place it does not fire is checked with them, because it is documented rather than
 * accidental: `api-reading.md` says a record range with `count: 0` "issues no read at all", and a
 * call that reads nothing has nothing to abort.
 *
 * The last block is the other half of the contract, from `ReadOptions`' own docblock: "Both fields
 * bound a cost rather than change an answer: cancelling a read and capping an allocation never
 * alter what a completed call returns." A signal that is never aborted must leave every result
 * identical to one passed no options at all.
 */

import { describe, expect, it } from 'vitest';
import { readTriggers } from '../../src/biosemi.js';
import { readEnvelope } from '../../src/envelope.js';
import { isEdfError } from '../../src/errors.js';
import { inspectEdf } from '../../src/inspect.js';
import { blobSource } from '../../src/io/blob.js';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { readHeader, readRecordBytes } from '../../src/io/read.js';
import { type FileHandleLike, fileHandleSource } from '../../src/node.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { BlobLike, ByteSource, EdfRecording } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const DATA_SOURCES = (DOCS_PAGES.get('data-sources.md') ?? '').replace(/\s+/g, ' ');
const API_SOURCES = (DOCS_PAGES.get('api-sources.md') ?? '').replace(/\s+/g, ' ');

const BYTES = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 24 }],
});

const BDF = buildEdf({
  format: 'BDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 8 },
    { label: 'Status', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 24 }],
});

function abortedSignal(): { readonly signal: AbortSignal } {
  const controller = new AbortController();
  controller.abort();
  return { signal: controller.signal };
}

/** Asserts the shape both pages promise, rather than only that something was thrown. */
function assertAbortError(thrown: unknown, label: string): void {
  expect(thrown, label).toBeInstanceOf(Error);
  const error = thrown as Error;
  expect(error.name, label).toBe('AbortError');
  // Not an EdfError: nothing about the FILE went wrong.
  expect(isEdfError(error), label).toBe(false);
  expect(error.message, label).toContain('options.signal');
}

async function rejects(call: () => unknown): Promise<unknown> {
  return Promise.resolve()
    .then(call)
    .then(
      () => undefined,
      (error: unknown) => error,
    );
}

describe('the sentence both pages state', () => {
  it('is on both of them, so a passing run is not a vacuous one', () => {
    expect(API_SOURCES).toContain("throws an `Error` whose `name` is `'AbortError'`");
    expect(DATA_SOURCES).toContain(
      'Every bundled adapter checks `options.signal` before it starts',
    );
    expect(DATA_SOURCES).toContain('`isEdfError` returns false for it');
  });

  it('names four adapters, which is the list checked below', () => {
    for (const adapter of ['fileHandleSource', 'blobSource', 'httpSource', 'cachedSource']) {
      expect(DATA_SOURCES).toContain(adapter);
    }
  });
});

describe('the adapters', () => {
  const handle: FileHandleLike = {
    async read(buffer: Uint8Array, offset: number, length: number, position: number) {
      buffer.set(BYTES.subarray(position, position + length), offset);
      return { bytesRead: length };
    },
    async close() {
      // Never called here; `never-closes-your-source.test.ts` owns that claim.
    },
  };

  /** The structural shape `blobSource` takes, which a real `File` also satisfies. */
  function blobOf(bytes: Uint8Array): BlobLike {
    return {
      size: bytes.byteLength,
      slice: (start?: number, end?: number): BlobLike =>
        blobOf(bytes.subarray(start ?? 0, end ?? bytes.byteLength)),
      arrayBuffer: async (): Promise<ArrayBuffer> => {
        const kept = bytes.slice();
        return kept.buffer.slice(kept.byteOffset, kept.byteOffset + kept.byteLength);
      },
    };
  }

  const ADAPTERS: ReadonlyArray<readonly [string, () => ByteSource]> = [
    ['byteSource', () => byteSource(BYTES)],
    ['fileHandleSource', () => fileHandleSource(handle, BYTES.byteLength)],
    ['blobSource', () => blobSource(blobOf(BYTES))],
    ['cachedSource', () => cachedSource(byteSource(BYTES))],
  ];

  it.each(ADAPTERS)(
    '%s refuses a read that was cancelled before it started',
    async (name, make) => {
      assertAbortError(await rejects(() => make().read(0, 16, abortedSignal())), name);
    },
  );

  it.each(ADAPTERS)('%s reads normally when the signal is not aborted', async (name, make) => {
    const controller = new AbortController();
    const bytes = await make().read(0, 16, { signal: controller.signal });
    expect(bytes, name).toEqual(BYTES.subarray(0, 16));
  });
});

describe('every entry point that reads', () => {
  async function drivers(): Promise<ReadonlyArray<readonly [string, (o: object) => unknown]>> {
    const recording = await openEdf(byteSource(BYTES));
    const bdf = await openEdf(byteSource(BDF));
    return [
      ['readHeader', (o) => readHeader(byteSource(BYTES), o)],
      ['openEdf', (o) => openEdf(byteSource(BYTES), o)],
      ['inspectEdf', (o) => inspectEdf(byteSource(BYTES), o)],
      [
        'readRecordBytes',
        (o) => readRecordBytes(recording.source, recording.header, { start: 0, count: 1 }, o),
      ],
      [
        'readRecords',
        (o) => readRecords(recording, { records: { start: 0, count: 1 }, signalIndices: [0] }, o),
      ],
      [
        'readWindow',
        (o) =>
          readWindow(recording, { startSeconds: 0, durationSeconds: 2, signalIndices: [0] }, o),
      ],
      ['readAnnotations', (o) => readAnnotations(recording, { start: 0, count: 4 }, o)],
      ['buildRecordIndex', (o) => buildRecordIndex(recording, o)],
      ['validateRecording', (o) => validateRecording(recording, o)],
      [
        'validateRecording (scanSamples)',
        (o) => validateRecording(recording, { scanSamples: true, ...o }),
      ],
      [
        'readEnvelope',
        (o) =>
          readEnvelope(
            recording,
            { startSeconds: 0, durationSeconds: 4, buckets: 4, signalIndices: [0] },
            o,
          ),
      ],
      ['readTriggers', (o) => readTriggers(bdf, { startSeconds: 0, durationSeconds: 4 }, o)],
      [
        'streamRecords',
        async (o) => {
          for await (const chunk of streamRecords(
            recording,
            { startSeconds: 0, durationSeconds: 4, signalIndices: [0] },
            o,
          ))
            void chunk;
        },
      ],
    ];
  }

  it('is a list long enough to be worth sweeping', async () => {
    expect(await drivers()).toHaveLength(13);
  });

  it('rejects when the signal was already aborted', async () => {
    for (const [label, drive] of await drivers()) {
      assertAbortError(await rejects(() => drive(abortedSignal())), label);
    }
  });
});

describe('the one place it does not fire', () => {
  it('is a record range of zero, which issues no read at all', async () => {
    const recording = await openEdf(byteSource(BYTES));
    const chunk = await readRecords(
      recording,
      { records: { start: 0, count: 0 }, signalIndices: [0] },
      abortedSignal(),
    );
    expect(chunk.records).toEqual({ start: 0, count: 0 });
    expect(chunk.byteLength).toBe(0);
    expect((DOCS_PAGES.get('api-reading.md') ?? '').replace(/\s+/g, ' ')).toContain(
      'A range with `count: 0` issues no read at all',
    );
  });
});

describe('a signal that is never aborted changes no answer', () => {
  /** Comparable renderings, since chunks carry typed arrays and `bigint`s. */
  function render(value: unknown, depth = 0): string {
    if (depth > 10) return '…';
    if (typeof value === 'bigint') return `${value}n`;
    if (ArrayBuffer.isView(value)) {
      const view = value as unknown as { length: number; [index: number]: number | bigint };
      const parts: string[] = [];
      for (let i = 0; i < view.length; i += 1) parts.push(String(view[i]));
      return parts.join(',');
    }
    if (Array.isArray(value)) return `[${value.map((item) => render(item, depth + 1)).join(',')}]`;
    if (value !== null && typeof value === 'object') {
      return `{${Object.entries(value as Record<string, unknown>)
        .filter(([, member]) => typeof member !== 'function')
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, member]) => `${key}:${render(member, depth + 1)}`)
        .join(',')}}`;
    }
    return String(value);
  }

  async function answers(recording: EdfRecording, options?: object): Promise<string> {
    return render([
      await readRecords(
        recording,
        { records: { start: 0, count: 2 }, signalIndices: [0] },
        options,
      ),
      await readWindow(
        recording,
        { startSeconds: 0, durationSeconds: 2, signalIndices: [0] },
        options,
      ),
      await readAnnotations(recording, { start: 0, count: 4 }, options),
      await validateRecording(recording, { scanSamples: true, ...options }),
    ]);
  }

  it('gives the same results as passing no options at all', async () => {
    const recording = await openEdf(byteSource(BYTES));
    const controller = new AbortController();
    const withSignal = await answers(recording, { signal: controller.signal });
    const without = await answers(recording);
    expect(withSignal).toBe(without);
    expect(without.length).toBeGreaterThan(400);
  });
});
