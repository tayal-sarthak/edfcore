/**
 * What actually crosses a worker boundary.
 *
 * Six pages tell a reader that edfcore's values travel between realms. `api-errors.md`,
 * `diagnostics.md`, `concepts.md`, `api-reading.md`, `api-primitives.md` and `data-sources.md` all
 * say some version of "an error thrown inside a worker or an iframe and passed out fails
 * `instanceof`", and send the reader to `edfErrorKind` instead. `cross-realm-errors.test.ts`
 * executes that for the case it names — two copies of the module in one dependency tree — where the
 * object is passed by REFERENCE and only its constructor identity differs.
 *
 * A worker is not that case. Nothing is passed by reference out of a worker: everything goes
 * through `postMessage`, which runs the structured clone algorithm, and what arrives is a new
 * object built from a serialisation. Whether a value survives that is a different question from
 * whether `instanceof` matches, and no test asked it.
 *
 * The answers are not uniform, which is the reason to write them down:
 *
 * - Every DATA result survives intact. Headers, chunks, annotations, envelopes, reports — the
 *   whole graph clones and compares equal, `Int32Array` samples and `bigint` ticks included.
 * - The record index does NOT survive. `onsetTicks` and `locate` are methods, and the algorithm
 *   refuses a function outright, so `postMessage(index)` throws in the sending realm.
 * - `Object.freeze` does not survive. The arrays `every-array-is-frozen.test.ts` pins arrive
 *   mutable, so that guarantee is a within-realm one.
 * - An ERROR does not survive as an edfcore error. The algorithm keeps `name`, `message`, `stack`
 *   and `cause` and drops every own property, so `code`, `field`, `byteOffset`, `diagnostic` — and
 *   `edfErrorKind` itself — are gone, and `isEdfError` says false on the far side.
 *
 * That last one is the one the pages do not cover. `edfErrorKind` beats `instanceof` for a second
 * copy in the tree; across a `postMessage` neither one works, and the fix is to send what you want
 * to branch on rather than the error.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope } from '../../src/envelope.js';
import { isEdfError } from '../../src/errors.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';
import { AWKWARD } from '../support/awkward-files.js';
import { buildEdf } from '../support/writer.js';

const GAPPED = buildEdf({
  plus: 'D',
  recordCount: 6,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (record) => (record < 3 ? record : record + 10),
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    {
      samplesPerRecord: 40,
      tals: (record) => (record === 0 ? [{ onset: '+0.5', duration: 2, texts: ['seizure'] }] : []),
    },
  ],
});

interface Posted {
  readonly what: string;
  readonly value: unknown;
}

/** Every value a worker would realistically hand back, over every shape in the matrix. */
async function everythingPostable(): Promise<readonly Posted[]> {
  const posted: Posted[] = [];
  const files: ReadonlyArray<readonly [string, Uint8Array]> = [
    ...AWKWARD.map((file) => [file.name, file.bytes] as const),
    ['a file with a gap', GAPPED],
  ];

  for (const [name, bytes] of files) {
    const recording = await openEdf(byteSource(bytes));
    const index = await buildRecordIndex(recording);
    const located = { ...recording, index };
    const signalIndices = [...recording.header.dataSignalIndices];

    posted.push({ what: `${name}: header`, value: recording.header });
    posted.push({ what: `${name}: timeline`, value: recording.timeline });
    posted.push({ what: `${name}: index.segments`, value: index.segments });
    posted.push({ what: `${name}: index.gaps`, value: index.gaps });
    posted.push({ what: `${name}: inspectEdf`, value: await inspectEdf(byteSource(bytes)) });
    posted.push({
      what: `${name}: validateRecording`,
      value: await validateRecording(recording, { scanSamples: true }),
    });
    posted.push({
      what: `${name}: readAnnotations`,
      value: await readAnnotations(recording, { start: 0, count: recording.header.recordCount }),
    });

    const readable =
      signalIndices.length > 0 &&
      recording.header.recordCount > 0 &&
      recording.header.recordDurationSeconds > 0;
    if (!readable) continue;

    posted.push({
      what: `${name}: readRecords`,
      value: await readRecords(located, { records: { start: 0, count: 1 }, signalIndices }),
    });
    posted.push({
      what: `${name}: readWindow`,
      value: await readWindow(located, { startSeconds: 0, durationSeconds: 20, signalIndices }),
    });
    posted.push({
      what: `${name}: readEnvelope`,
      value: await readEnvelope(located, {
        startSeconds: 0,
        durationSeconds: 3,
        buckets: 4,
        signalIndices,
      }),
    });
  }
  return posted;
}

const POSTED = await everythingPostable();

/** Whether the graph below `value` contains a member of the given kind, to a depth of nine. */
function contains(value: unknown, kind: (candidate: unknown) => boolean, depth = 0): boolean {
  if (depth > 9) return false;
  if (kind(value)) return true;
  if (value === null || typeof value !== 'object') return false;
  if (ArrayBuffer.isView(value)) return false;
  const members = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return members.some((member) => contains(member, kind, depth + 1));
}

describe('the sweep really posts something', () => {
  it('covers every shape in the matrix, not one file', () => {
    expect(AWKWARD).toHaveLength(14);
    // Eleven shapes and the gapped file. Seven values each for a file nothing can be read from,
    // ten for the rest, so the exact total is not worth pinning — that it is large is.
    expect(POSTED.length).toBeGreaterThanOrEqual(70);
    expect(new Set(POSTED.map((entry) => entry.what)).size).toBe(POSTED.length);
  });

  it('posts values that carry the two members a naive serialiser loses', () => {
    // A JSON round trip would fail on either of these, so a passing run below is not the same
    // test written twice.
    expect(POSTED.some((entry) => contains(entry.value, (v) => typeof v === 'bigint'))).toBe(true);
    expect(POSTED.some((entry) => contains(entry.value, ArrayBuffer.isView))).toBe(true);
  });
});

describe('every data result survives postMessage', () => {
  for (const { what, value } of POSTED) {
    it(`clones ${what} to an equal value`, () => {
      expect(structuredClone(value)).toEqual(value);
    });
  }
});

describe('what does not survive', () => {
  it('refuses the record index, because locate() is a function', async () => {
    const recording = await openEdf(byteSource(GAPPED));
    const index = await buildRecordIndex(recording);
    expect(typeof index.locate).toBe('function');
    expect(() => structuredClone(index)).toThrow();
    // The parts a viewer actually wants do survive, which is the workaround worth naming.
    expect(structuredClone(index.segments)).toEqual(index.segments);
    expect(structuredClone(index.gaps)).toEqual(index.gaps);
  });

  it('refuses the recording, because a ByteSource has a read()', async () => {
    const recording = await openEdf(byteSource(GAPPED));
    expect(() => structuredClone(recording)).toThrow();
    // The header is what crosses instead, and it is enough to describe the file.
    expect(structuredClone(recording.header)).toEqual(recording.header);
  });

  it('drops the freezing, so that guarantee is a within-realm one', async () => {
    const recording = await openEdf(byteSource(GAPPED));
    expect(Object.isFrozen(recording.header.diagnostics)).toBe(true);
    expect(Object.isFrozen(structuredClone(recording.header).diagnostics)).toBe(false);
  });
});

describe('an EdfError does not cross as an EdfError', () => {
  /** A real fatal, with every field the pages tell a caller to branch on. */
  const thrown = async (): Promise<unknown> => {
    try {
      await openEdf(byteSource(new Uint8Array(512)));
      return undefined;
    } catch (error) {
      return error;
    }
  };

  it('arrives as a plain Error with the message and nothing else', async () => {
    const error = await thrown();
    expect(isEdfError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('NOT_AN_EDF_FILE');

    const received = structuredClone(error) as Record<string, unknown>;
    expect(received).toBeInstanceOf(Error);
    expect(received.message).toBe((error as Error).message);
    expect(received.code).toBeUndefined();
    expect(received.field).toBeUndefined();
    expect(received.byteOffset).toBeUndefined();
    expect(received.diagnostic).toBeUndefined();
  });

  it('loses edfErrorKind too, so isEdfError says false on the far side', async () => {
    const error = await thrown();
    const received = structuredClone(error);
    expect((error as { edfErrorKind: string }).edfErrorKind).toBe('format');
    expect((received as { edfErrorKind?: unknown }).edfErrorKind).toBeUndefined();
    expect(isEdfError(received)).toBe(false);
  });

  it('carries the kind fine when the sender posts the kind rather than the error', async () => {
    // What a worker has to do instead, and the reason this file exists: the discriminator is a
    // string, and a string clones. It is the ERROR that does not.
    const error = await thrown();
    const message = { kind: (error as { edfErrorKind: string }).edfErrorKind, text: String(error) };
    expect(structuredClone(message)).toEqual(message);
  });
});
