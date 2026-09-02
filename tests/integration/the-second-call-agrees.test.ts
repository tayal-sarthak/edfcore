/**
 * Calling twice gives the same answer, and not the same object.
 *
 * Every function in the reading API is documented as a question about a file, and a question about
 * a file has one answer. Nothing checked that. The suite calls each of them once per test, which is
 * exactly the shape that cannot see state left behind by the first call — a memo filled with the
 * wrong key, a cursor advanced and not reset, an array handed out and then written into by the next
 * caller, a `Map` iterated in an order that depends on what was inserted before it.
 *
 * The failure is quiet in the way that matters most here. A viewer redraws on every scroll and a
 * batch job loops over one recording per file; both call these functions over and over on the same
 * open recording, and a second answer that differs from the first is a rendering that flickers or a
 * report that depends on what ran before it.
 *
 * Two axes, because they catch different things. The same recording asked twice catches state on
 * the recording; two recordings over the same bytes catch state shared beneath them — a module
 * cache, a memo keyed on something that is not the file.
 *
 * `buildRecordIndex` returns methods as well as data — `locate` and `onsetTicks` are functions, as
 * `what-crosses-a-worker.test.ts` records — and two calls necessarily build two closures. Comparing
 * the whole object would be asking whether they are the same function, which is not the question.
 * So results are compared through a projection that drops function-valued properties, and `locate`
 * is exercised separately at every record: what has to agree is the answers, not the identities.
 *
 * And the arrays must be equal without being the same array. `nothing-points-at-your-buffer` says a
 * result never points into the caller's bytes; this says a second result never points into the
 * first one's, which is what lets a caller keep one and go on reading. `out` is the documented
 * exception and is not exercised here — `out-contract.test.ts` owns that.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope } from '../../src/envelope.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { AWKWARD } from '../support/awkward-files.js';

interface Call {
  readonly what: string;
  readonly run: (recording: EdfRecording) => Promise<unknown>;
  /** True when the result holds a typed array a caller would keep. */
  readonly ownsArrays?: boolean;
}

function callsFor(recording: EdfRecording): readonly Call[] {
  const signalIndices = [...recording.header.dataSignalIndices];
  const records = { start: 0, count: recording.header.recordCount };
  const readable =
    signalIndices.length > 0 &&
    recording.header.recordCount > 0 &&
    recording.header.recordDurationSeconds > 0;

  return [
    { what: 'buildRecordIndex', run: (one) => buildRecordIndex(one) },
    { what: 'readAnnotations', run: (one) => readAnnotations(one, records), ownsArrays: true },
    {
      what: 'validateRecording',
      run: (one) => validateRecording(one, { scanSamples: true }),
    },
    ...(readable
      ? [
          {
            what: 'readRecords',
            run: (one: EdfRecording) =>
              readRecords(one, { records: { start: 0, count: 1 }, signalIndices }),
            ownsArrays: true,
          },
          {
            what: 'readWindow',
            run: async (one: EdfRecording) =>
              readWindow(
                { ...one, index: await buildRecordIndex(one) },
                { startSeconds: 0, durationSeconds: 20, signalIndices },
              ),
            ownsArrays: true,
          },
          {
            what: 'readEnvelope',
            run: async (one: EdfRecording) =>
              readEnvelope(
                { ...one, index: await buildRecordIndex(one) },
                { startSeconds: 0, durationSeconds: 3, buckets: 4, signalIndices },
              ),
            ownsArrays: true,
          },
        ]
      : []),
  ];
}

/**
 * The same graph with every function-valued property dropped, so `toEqual` compares answers rather
 * than closure identities. Typed arrays are passed through untouched — they compare by value.
 */
function comparable(value: unknown, seen = new Map<object, unknown>()): unknown {
  if (typeof value === 'function') return '[function]';
  if (typeof value !== 'object' || value === null) return value;
  const existing = seen.get(value);
  if (existing !== undefined) return existing;
  if (ArrayBuffer.isView(value)) return value;
  const copy: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  for (const [key, entry] of Object.entries(value)) {
    (copy as Record<string, unknown>)[key] = comparable(entry, seen);
  }
  return copy;
}

/** Every typed array in a returned graph, in traversal order. */
function views(
  value: unknown,
  found: ArrayBufferView[] = [],
  seen = new Set<unknown>(),
): readonly ArrayBufferView[] {
  if (typeof value !== 'object' || value === null || seen.has(value)) return found;
  seen.add(value);
  if (ArrayBuffer.isView(value)) {
    found.push(value);
    return found;
  }
  for (const entry of Object.values(value)) views(entry, found, seen);
  return found;
}

describe('the matrix this file sweeps', () => {
  it('is the fifteen shapes it was written against', () => {
    expect(AWKWARD).toHaveLength(15);
  });
});

describe.each(AWKWARD)('$name', ({ bytes }) => {
  it('answers the same on the second call, on the same recording', async () => {
    const recording = await openEdf(byteSource(bytes));
    for (const { what, run } of callsFor(recording)) {
      const first = comparable(await run(recording));
      const second = comparable(await run(recording));
      expect(second, `${what} answered differently the second time`).toEqual(first);
    }
  });

  it('answers the same through a second recording over the same bytes', async () => {
    const a = await openEdf(byteSource(bytes));
    const b = await openEdf(byteSource(bytes));
    expect(b.header).toEqual(a.header);
    expect(b.timeline).toEqual(a.timeline);
    for (const { what, run } of callsFor(a)) {
      expect(comparable(await run(b)), `${what} depends on which recording asked`).toEqual(
        comparable(await run(a)),
      );
    }
    expect(comparable(await inspectEdf(byteSource(bytes)))).toEqual(
      comparable(await inspectEdf(byteSource(bytes))),
    );
  });

  it('hands the second caller arrays of its own, sharing none with the first', async () => {
    const recording = await openEdf(byteSource(bytes));
    for (const call of callsFor(recording)) {
      if (call.ownsArrays !== true) continue;
      const first = views(await call.run(recording));
      const second = views(await call.run(recording));
      expect(second).toHaveLength(first.length);
      for (const [index, view] of second.entries()) {
        // Equal contents, different objects and different buffers. A shared buffer would make one
        // caller's `set()` visible to the other, and both are reading the same file.
        expect({ what: call.what, index, same: view === first[index] }).toEqual({
          what: call.what,
          index,
          same: false,
        });
        expect({ what: call.what, index, shared: view.buffer === first[index]?.buffer }).toEqual({
          what: call.what,
          index,
          shared: false,
        });
      }
    }
  });
});

describe.each(AWKWARD)('$name, the methods an index carries', ({ bytes }) => {
  it('locates the same record from two indexes over the same file', async () => {
    // The half `comparable` drops. Two closures are never equal; two answers must be.
    const a = await buildRecordIndex(await openEdf(byteSource(bytes)));
    const b = await buildRecordIndex(await openEdf(byteSource(bytes)));
    expect(b.recordCount).toBe(a.recordCount);
    for (let record = 0; record < a.recordCount; record += 1) {
      expect(await b.onsetTicks(record)).toBe(await a.onsetTicks(record));
    }
    for (const seconds of [0, 0.5, 1, 2.5, 7]) {
      expect(await b.locate(seconds)).toEqual(await a.locate(seconds));
    }
  });
});

describe('the sweep reaches arrays at all', () => {
  it('finds several in a plain file, so the third check is not vacuous', async () => {
    const plain = AWKWARD.find((file) => file.name === 'plain EDF, one signal');
    if (plain === undefined) throw new Error('the matrix lost its plain file');
    const recording = await openEdf(byteSource(plain.bytes));
    const chunk = await readWindow(recording, {
      startSeconds: 0,
      durationSeconds: 20,
      signalIndices: [0],
    });
    expect(views(chunk).length).toBeGreaterThan(0);
  });
});
