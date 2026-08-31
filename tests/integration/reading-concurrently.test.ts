/**
 * Reading one recording from several places at once.
 *
 * Everything in the suite reads sequentially, and nothing in the API documents an ordering
 * requirement — a recording is a plain struct, `readWindow` takes it and returns a value, and the
 * obvious thing to write in a viewer is `Promise.all` over the channels or the visible range. That
 * is untested territory: the reads share a source, an index whose `onsetTicks` memoises, and a
 * timeline whose `startOffsetTicks` every rebasing path consults.
 *
 * Correctness first, and it holds. Five overlapping windows resolved concurrently give the samples
 * the same five give one at a time; so does the whole API at once — a window, a record range, the
 * annotations, an index build and a full validation sweep, launched together and compared against
 * the same five run in order. And it holds over a source that resolves reads in REVERSE order of
 * arrival, which is the interesting case: a network returns what it returns when it returns it, and
 * a reader that assumed its own issue order would come apart exactly there.
 *
 * Then the one place concurrency costs something, which is worth naming because it is invisible.
 * `record-index.ts` says `onsetTicks(r)` "reads that ONE record and memoises the answer", and
 * `locate-cost.test.ts` checks that a second call is free. It memoises on RESOLUTION rather than on
 * request, so ten calls for the same record launched together issue ten reads. The eleventh, after
 * they have settled, issues none.
 *
 * That is a cost, not a defect, and the package already documents the remedy: `cachedSource` exists
 * so that "concurrent reads wanting the same block issue ONE underlying read". Wrapped in it, the
 * same ten calls issue none at all — the block was already resident from the open, which is the
 * same observation `large-files.md` makes about the reads that come with opening a file not being
 * wasted.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import type { ByteSource } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

const BYTES = buildEdf({
  plus: 'C',
  recordCount: 24,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 16, sample: (record, index) => record * 100 + index },
  ],
  annotationSignals: [
    {
      samplesPerRecord: 40,
      tals: (record) =>
        record % 4 === 0 ? [{ onset: `+${record}.5`, texts: [`e${record}`] }] : [],
    },
  ],
});

/** Comparable text for anything the API returns, typed arrays and `bigint`s included. */
const shape = (value: unknown): string =>
  JSON.stringify(value, (_key, member: unknown) =>
    typeof member === 'bigint'
      ? `${member}n`
      : ArrayBuffer.isView(member)
        ? [...(member as unknown as Int32Array)]
        : member,
  );

interface Counting extends ByteSource {
  reads: number;
}

function counting(inner: ByteSource): Counting {
  const source: Counting = {
    reads: 0,
    byteLength: inner.byteLength,
    read: async (offset, length, options) => {
      source.reads += 1;
      await Promise.resolve();
      return inner.read(offset, length, options);
    },
  };
  return source;
}

/**
 * Resolves reads in reverse order of arrival, in batches. A source that answered in issue order
 * would let a reader get away with assuming one.
 */
function reversingOrder(inner: ByteSource, batch = 4): Counting {
  let queued: Array<() => void> = [];
  const flush = (): void => {
    const pending = queued;
    queued = [];
    for (const resume of pending.reverse()) resume();
  };
  const source: Counting = {
    reads: 0,
    byteLength: inner.byteLength,
    read: (offset, length, options) => {
      source.reads += 1;
      return new Promise<Uint8Array>((resolve) => {
        queued.push(() => {
          void inner.read(offset, length, options).then(resolve);
        });
        if (queued.length >= batch) flush();
        else setTimeout(flush, 0);
      });
    },
  };
  return source;
}

const WINDOWS = [0, 3, 6, 9, 12] as const;

async function windowsSequentially(
  recording: Awaited<ReturnType<typeof openEdf>>,
): Promise<string[]> {
  const out: string[] = [];
  for (const startSeconds of WINDOWS) {
    out.push(
      shape(await readWindow(recording, { startSeconds, durationSeconds: 4, signalIndices: [0] })),
    );
  }
  return out;
}

describe('five windows at once', () => {
  it('are the five one at a time', async () => {
    const recording = await openEdf(byteSource(BYTES));
    const sequential = await windowsSequentially(recording);
    const concurrent = await Promise.all(
      WINDOWS.map((startSeconds) =>
        readWindow(recording, { startSeconds, durationSeconds: 4, signalIndices: [0] }),
      ),
    );
    expect(concurrent.map(shape)).toEqual(sequential);
    // The windows really differ from one another, so five equal answers is not the pass.
    expect(new Set(sequential).size).toBe(WINDOWS.length);
  });

  it('and still are over a source that answers in reverse order of arrival', async () => {
    const ordered = await openEdf(byteSource(BYTES));
    const sequential = await windowsSequentially(ordered);

    const source = reversingOrder(byteSource(BYTES));
    const recording = await openEdf(source);
    const concurrent = await Promise.all(
      WINDOWS.map((startSeconds) =>
        readWindow(recording, { startSeconds, durationSeconds: 4, signalIndices: [0] }),
      ),
    );
    expect(concurrent.map(shape)).toEqual(sequential);
    expect(source.reads).toBeGreaterThan(WINDOWS.length);
  });
});

describe('the whole API at once', () => {
  it('gives what the same calls give in order', async () => {
    const recording = await openEdf(byteSource(BYTES));

    const [window, records, annotations, index, report] = await Promise.all([
      readWindow(recording, { startSeconds: 5, durationSeconds: 3, signalIndices: [0] }),
      readRecords(recording, { records: { start: 5, count: 3 }, signalIndices: [0] }),
      readAnnotations(recording, { start: 0, count: 24 }),
      buildRecordIndex(recording),
      validateRecording(recording, { scanSamples: true }),
    ]);

    const sameWindow = await readWindow(recording, {
      startSeconds: 5,
      durationSeconds: 3,
      signalIndices: [0],
    });
    const sameRecords = await readRecords(recording, {
      records: { start: 5, count: 3 },
      signalIndices: [0],
    });
    const sameAnnotations = await readAnnotations(recording, { start: 0, count: 24 });
    const sameIndex = await buildRecordIndex(recording);
    const sameReport = await validateRecording(recording, { scanSamples: true });

    expect(shape(window)).toBe(shape(sameWindow));
    expect(shape(records)).toBe(shape(sameRecords));
    expect(shape(annotations)).toBe(shape(sameAnnotations));
    // The index carries methods, so it is compared by what it found rather than by identity.
    expect(shape(index.segments)).toBe(shape(sameIndex.segments));
    expect(shape(index.gaps)).toBe(shape(sameIndex.gaps));
    expect(shape(report)).toBe(shape(sameReport));
    expect(shape(annotations).length).toBeGreaterThan(200);
  });
});

describe('the one thing concurrency costs', () => {
  it('is the index memoising on resolution rather than on request', async () => {
    const source = counting(byteSource(BYTES));
    const recording = await openEdf(source);
    const atOpen = source.reads;

    const answers = await Promise.all(
      Array.from({ length: 10 }, () => recording.index.onsetTicks(7)),
    );
    // One answer, ten reads: every caller missed the memo because none had resolved yet.
    expect(new Set(answers.map(String)).size).toBe(1);
    expect(source.reads - atOpen).toBe(10);

    // And the eleventh, once they have settled, costs nothing — which is the memo working.
    const afterward = source.reads;
    await recording.index.onsetTicks(7);
    expect(source.reads).toBe(afterward);
  });

  it('and is what cachedSource exists to collapse', async () => {
    const source = counting(byteSource(BYTES));
    const recording = await openEdf(cachedSource(source, { blockBytes: 4096, maxBytes: 1 << 20 }));
    const atOpen = source.reads;

    const answers = await Promise.all(
      Array.from({ length: 10 }, () => recording.index.onsetTicks(7)),
    );
    expect(new Set(answers.map(String)).size).toBe(1);
    // None at all: the block the record sits in came with the open.
    expect(source.reads - atOpen).toBe(0);
  });

  it('without changing the answer either way', async () => {
    const bare = await openEdf(byteSource(BYTES));
    const cached = await openEdf(cachedSource(byteSource(BYTES)));
    const [a, b] = await Promise.all([bare.index.onsetTicks(7), cached.index.onsetTicks(7)]);
    expect(b).toBe(a);
    expect(a).toBe(70_000_000n);
  });
});
