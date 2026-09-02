/**
 * What actually survives `JSON.stringify`.
 *
 * `what-crosses-a-worker.test.ts` asks this of the structured clone algorithm, where the answer is
 * "everything but the index, the freeze and the error class". JSON is the boundary people reach
 * for far more often — a cache entry, a log line, a POST body, a snapshot in someone else's test
 * suite — and it answers differently, in both directions at once.
 *
 * `design-decisions.md` states the `bigint` half: ticks "do not survive `JSON.stringify` without a
 * replacer". That sentence is true and it is half the story, because it describes the failure that
 * is loud. A `bigint` throws `TypeError` in the caller's own stack frame, before anything is
 * written, and the caller adds a replacer. What the replacer does not fix is the other half: a
 * typed array is not an array to `JSON.stringify`. `Int32Array` samples, `BigInt64Array` onsets and
 * the `Uint8Array` on a diagnostic's `rawBytes` all serialise as plain objects keyed by numeric
 * strings, so a round trip returns `{"0":0,"1":1}` where a caller expects something with a
 * `.length` — and `toPhysical` will not take it.
 *
 * So the two halves fail in opposite ways. The value that throws tells you at the call site; the
 * value that succeeds tells you nothing until something downstream indexes into it. This file
 * writes down which is which for every value edfcore hands back, over every shape in the matrix,
 * so the advice in the docs can be read for what it does and does not cover.
 *
 * A third difference belongs to JSON alone: a property whose value is `undefined` is dropped
 * rather than preserved. `durationSeconds` and `channelLabel` are declared on `EdfAnnotation` and
 * are `undefined` for an instantaneous event with no channel, so the round trip removes the keys —
 * `'durationSeconds' in annotation` is true before and false after. A structured clone keeps them.
 *
 * The shape that does work is the one `edfcore json` already uses: name the primitive fields you
 * want. That command is a worked example of this whole file, and it is checked here as one.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { readEnvelope } from '../../src/envelope.js';
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

interface Returned {
  readonly what: string;
  readonly value: unknown;
}

/** Every value a caller would realistically try to serialise, over every shape in the matrix. */
async function everythingReturned(): Promise<readonly Returned[]> {
  const values: Returned[] = [];
  const files: ReadonlyArray<readonly [string, Uint8Array]> = [
    ...AWKWARD.map((file) => [file.name, file.bytes] as const),
    ['a file with a gap', GAPPED],
  ];

  for (const [name, bytes] of files) {
    const recording = await openEdf(byteSource(bytes));
    const index = await buildRecordIndex(recording);
    const located = { ...recording, index };
    const signalIndices = [...recording.header.dataSignalIndices];

    values.push({ what: `${name}: header`, value: recording.header });
    values.push({ what: `${name}: timeline`, value: recording.timeline });
    values.push({ what: `${name}: index.segments`, value: index.segments });
    values.push({ what: `${name}: inspectEdf`, value: await inspectEdf(byteSource(bytes)) });
    values.push({
      what: `${name}: validateRecording`,
      value: await validateRecording(recording, { scanSamples: true }),
    });
    values.push({
      what: `${name}: readAnnotations`,
      value: await readAnnotations(recording, { start: 0, count: recording.header.recordCount }),
    });

    const readable =
      signalIndices.length > 0 &&
      recording.header.recordCount > 0 &&
      recording.header.recordDurationSeconds > 0;
    if (!readable) continue;

    values.push({
      what: `${name}: readRecords`,
      value: await readRecords(located, { records: { start: 0, count: 1 }, signalIndices }),
    });
    values.push({
      what: `${name}: readWindow`,
      value: await readWindow(located, { startSeconds: 0, durationSeconds: 20, signalIndices }),
    });
    values.push({
      what: `${name}: readEnvelope`,
      value: await readEnvelope(located, {
        startSeconds: 0,
        durationSeconds: 3,
        buckets: 4,
        signalIndices,
      }),
    });
  }
  return values;
}

/** `undefined` when it serialises; the thrown error's constructor name when it does not. */
function stringifies(value: unknown): string | undefined {
  try {
    JSON.stringify(value);
    return undefined;
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

/** Does this graph hold a `bigint` anywhere JSON would reach? */
function holdsBigInt(value: unknown, seen = new Set<unknown>()): boolean {
  if (typeof value === 'bigint') return true;
  if (typeof value !== 'object' || value === null || seen.has(value)) return false;
  seen.add(value);
  // An EMPTY BigInt64Array serialises as `{}` — there is no element for JSON to refuse — so the
  // length is part of the question, not a detail. `no records at all` is the shape that shows it.
  if (value instanceof BigInt64Array || value instanceof BigUint64Array) return value.length > 0;
  if (ArrayBuffer.isView(value)) return false;
  return Object.values(value).some((entry) => holdsBigInt(entry, seen));
}

describe('the matrix this file sweeps', () => {
  it('is the seventeen shapes it was written against', () => {
    expect(AWKWARD).toHaveLength(17);
  });
});

describe('every value edfcore hands back', () => {
  it('either throws on a bigint or holds none, and never anything else', async () => {
    // The claim is exactly this narrow. A `TypeError` is the only way JSON refuses one of these
    // graphs, and it refuses precisely the ones with an exact number in them.
    for (const { what, value } of await everythingReturned()) {
      expect({ what, threw: stringifies(value) }).toEqual({
        what,
        threw: holdsBigInt(value) ? 'TypeError' : undefined,
      });
    }
  });

  it('splits into both kinds, so a passing run is not a vacuous one', async () => {
    const all = await everythingReturned();
    expect(all.length).toBeGreaterThan(50);
    expect(all.filter(({ value }) => stringifies(value) !== undefined).length).toBeGreaterThan(20);
    expect(all.filter(({ value }) => stringifies(value) === undefined).length).toBeGreaterThan(5);
  });

  it('names the ones a caller is most likely to try', async () => {
    const bytes = AWKWARD[1]?.bytes;
    if (bytes === undefined) throw new Error('the matrix lost the annotated file');
    const recording = await openEdf(byteSource(bytes));
    // A header is the obvious thing to log, and it is the obvious thing that throws.
    expect(stringifies(recording.header)).toBe('TypeError');
    expect(stringifies(recording.timeline)).toBe('TypeError');
    // A validation report is the obvious thing to write to a CI artefact, and it survives.
    expect(stringifies(await validateRecording(recording))).toBeUndefined();
  });
});

describe('the replacer the docs recommend', () => {
  const replacer = (_key: string, value: unknown): unknown =>
    typeof value === 'bigint' ? value.toString() : value;

  it('stops the throw', async () => {
    const recording = await openEdf(byteSource(GAPPED));
    expect(() => JSON.stringify(recording.header, replacer)).not.toThrow();
  });

  it('does not make a typed array come back as one', async () => {
    const recording = await openEdf(byteSource(GAPPED));
    const index = await buildRecordIndex(recording);
    const [chunk] = await readWindow(
      { ...recording, index },
      {
        startSeconds: 0,
        durationSeconds: 3,
        signalIndices: [0],
      },
    );
    const digital = chunk?.signals[0]?.digital;
    expect(digital).toBeInstanceOf(Int32Array);
    expect(digital?.length).toBeGreaterThan(0);

    const back = JSON.parse(JSON.stringify(chunk, replacer)) as {
      signals: Array<{ digital: unknown }>;
    };
    const round = back.signals[0]?.digital as { length?: number; 0?: number };
    // An object keyed by numeric strings. Not an array, not a view, and no length to iterate.
    expect(Array.isArray(round)).toBe(false);
    expect(ArrayBuffer.isView(round)).toBe(false);
    expect(round?.length).toBeUndefined();
    expect(round?.[0]).toBe(digital?.[0]);
  });

  it('does not make the ticks come back as ticks either', async () => {
    // The replacer turns them into strings, which is what makes the document valid. Nothing turns
    // them back: a caller who compares `onsetTicks` after a round trip is comparing strings.
    const recording = await openEdf(byteSource(GAPPED));
    const { annotations } = await readAnnotations(recording, { start: 0, count: 6 });
    expect(annotations.length).toBeGreaterThan(0);
    const back = JSON.parse(JSON.stringify(annotations, replacer)) as Array<{
      onsetTicks: unknown;
    }>;
    expect(typeof annotations[0]?.onsetTicks).toBe('bigint');
    expect(typeof back[0]?.onsetTicks).toBe('string');
  });
});

describe('a property that is undefined', () => {
  it('is dropped by JSON where a structured clone keeps it', async () => {
    const recording = await openEdf(byteSource(GAPPED));
    const { annotations } = await readAnnotations(recording, { start: 0, count: 6 });
    const event = annotations.find((one) => one.channelLabel === undefined);
    if (event === undefined) throw new Error('the fixture lost its unchannelled event');

    expect('channelLabel' in event).toBe(true);
    expect('channelLabel' in structuredClone(event)).toBe(true);

    const back = JSON.parse(
      JSON.stringify(event, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
    ) as object;
    expect('channelLabel' in back).toBe(false);
  });
});

describe('the shape that does work', () => {
  it('is what `edfcore json` already emits: named primitive fields', async () => {
    const out: string[] = [];
    const io: CliIo = {
      out: (text) => out.push(text),
      err: () => {},
      readFile: async () => GAPPED,
    };
    expect(await runCli(parseArgs(['json', 'gapped.edf']), io)).toBe(0);
    const document = out.join('');
    // It parses, and it round-trips to the same document — which is the property the values above
    // do not have, and the reason that command hand-picks its fields.
    const parsed: unknown = JSON.parse(document);
    expect(JSON.stringify(parsed, null, 2)).toBe(document.trimEnd());
    expect(stringifies(parsed)).toBeUndefined();
  });
});
