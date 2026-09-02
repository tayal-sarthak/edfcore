/**
 * Every `…Ticks` edfcore publishes, against the `…Seconds` beside it.
 *
 * The package's central arithmetic decision is that time is a `bigint` count of 100 ns ticks and
 * the seconds are a convenience derived from it. Twenty field pairs in `types.ts` are written that
 * way — on the header, the timeline, a segment, a gap, a location, a chunk, a chunk signal, an
 * envelope chunk, an envelope signal and an annotation — and each is produced by different code.
 *
 * One of them was checked. `timebase.test.ts` asserts "an exact tick counterpart for every second
 * on a chunk", on chunks. The other nine kinds were each computed somewhere and never compared, and
 * the failure they would produce is the quiet kind: the two fields sit next to each other in an
 * autocomplete list, a caller picks whichever the surrounding code already uses, and a disagreement
 * shows up as a plot drawn a fraction of a second from where the arithmetic says it is.
 *
 * So the pairs are enumerated out of `types.ts` and every object every entry point returns is
 * walked, over the eleven `AWKWARD` shapes plus a file with a gap and a file with an overlap — 270
 * pairs in all, compared with `Object.is` against `ticksToSeconds`. `toBeCloseTo` would pass on a
 * pair that had drifted by exactly the thing this arithmetic exists to prevent.
 *
 * `EdfAnnotation` is the one that cannot be paired by name, and it is the reason the pairing is
 * spelled out rather than inferred. Its four onset fields are two axes, not one pair:
 * `onsetTicks` goes with `onsetSecondsFromHeaderStart` and `onsetTicksFromFirstRecord` with
 * `onsetSecondsFromFirstRecord`. Crossing them passes on every file with no sub-second start
 * offset, which is most of them — so the last block builds one that has an offset and shows the
 * crossed pairing failing by exactly that offset. That is the trap `annotations.md` warns about in
 * as many words, and it is what makes the rule here a rule rather than a coincidence.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { ticksToSeconds } from '../../src/tal/ticks.js';
import { AWKWARD } from '../support/awkward-files.js';
import { buildEdf } from '../support/writer.js';

// ---------------------------------------------------------------------------
// The pairs, read out of types.ts
// ---------------------------------------------------------------------------

const TYPES = readFileSync(new URL('../../src/types.ts', import.meta.url), 'utf8');

/** `xTicks` with an `xSeconds` in the same interface. */
function pairsInTypes(): ReadonlyArray<readonly [string, string, string]> {
  const found: Array<readonly [string, string, string]> = [];
  for (const match of TYPES.matchAll(
    /export interface (\w+)\s*(?:extends [^{]+)?\{([\s\S]*?)\n\}/g,
  )) {
    const name = match[1] ?? '';
    const fields = new Set(
      [...(match[2] ?? '').matchAll(/readonly (\w+)\??:/g)].map((field) => field[1] ?? ''),
    );
    for (const field of [...fields].sort()) {
      if (!field.endsWith('Ticks')) continue;
      const twin = `${field.slice(0, -'Ticks'.length)}Seconds`;
      if (fields.has(twin)) found.push([name, field, twin]);
    }
  }
  return found;
}

const NAMED_PAIRS = pairsInTypes();

/**
 * The pairing rule, as field names. Everything is `xTicks`/`xSeconds` except the annotation
 * onsets, which are two axes rather than one pair and are spelled out for that reason.
 */
const TWIN: ReadonlyMap<string, string> = new Map([
  ...NAMED_PAIRS.map(([, ticks, seconds]) => [ticks, seconds] as const),
  ['onsetTicks', 'onsetSecondsFromHeaderStart'],
  ['onsetTicksFromFirstRecord', 'onsetSecondsFromFirstRecord'],
]);

// ---------------------------------------------------------------------------
// Walking everything the API returns
// ---------------------------------------------------------------------------

interface Visit {
  readonly path: string;
  readonly pair: string;
  readonly ticks: bigint;
  readonly seconds: number;
}

function walk(value: unknown, path: string, into: Visit[], depth = 0): void {
  if (depth > 8 || value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      walk(item, `${path}[${index}]`, into, depth + 1);
    }
    return;
  }
  const object = value as Record<string, unknown>;
  for (const [key, member] of Object.entries(object)) {
    const twin = TWIN.get(key);
    if (twin !== undefined && typeof member === 'bigint' && typeof object[twin] === 'number') {
      into.push({
        path: `${path}.${key}`,
        pair: `${key}/${twin}`,
        ticks: member,
        seconds: object[twin] as number,
      });
    }
    walk(member, `${path}.${key}`, into, depth + 1);
  }
}

const GAPPED = buildEdf({
  plus: 'D',
  recordCount: 6,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (record) => (record < 3 ? record : record + 10),
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [
    {
      samplesPerRecord: 40,
      tals: (record) => (record === 0 ? [{ onset: '+0.5', duration: 30, texts: ['e'] }] : []),
    },
  ],
});

/** An overlap, so a negative duration is in the set too. */
const OVERLAPPING = buildEdf({
  plus: 'D',
  recordCount: 5,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (record) => (record < 3 ? record : record - 0.2),
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 24 }],
});

async function visitEverything(): Promise<readonly Visit[]> {
  const visits: Visit[] = [];
  const files: ReadonlyArray<readonly [string, Uint8Array]> = [
    ...AWKWARD.map((file) => [file.name, file.bytes] as const),
    ['a file with a gap', GAPPED],
    ['a file with an overlap', OVERLAPPING],
  ];

  for (const [name, bytes] of files) {
    const recording = await openEdf(byteSource(bytes));
    const index = await buildRecordIndex(recording);
    const located = { ...recording, index };
    const signalIndices = [...recording.header.dataSignalIndices];

    walk(recording.header, `${name} header`, visits);
    walk(recording.timeline, `${name} timeline`, visits);
    walk(index.segments, `${name} index.segments`, visits);
    walk(index.gaps, `${name} index.gaps`, visits);
    walk(await index.locate(0.5), `${name} index.locate(0.5)`, visits);
    walk(
      await readAnnotations(recording, { start: 0, count: recording.header.recordCount }),
      `${name} readAnnotations`,
      visits,
    );

    const readable =
      signalIndices.length > 0 &&
      recording.header.recordCount > 0 &&
      recording.header.recordDurationSeconds > 0;
    if (!readable) continue;

    walk(
      await readRecords(located, { records: { start: 0, count: 1 }, signalIndices }),
      `${name} readRecords`,
      visits,
    );
    walk(
      await readWindow(located, { startSeconds: 0, durationSeconds: 3, signalIndices }),
      `${name} readWindow`,
      visits,
    );
    walk(
      await readEnvelope(located, {
        startSeconds: 0,
        durationSeconds: 3,
        buckets: 4,
        signalIndices,
      }),
      `${name} readEnvelope`,
      visits,
    );
    walk(
      await readEnvelopeAtResolution(located, {
        startSeconds: 0,
        durationSeconds: 3,
        secondsPerBucket: 1,
        signalIndices,
      }),
      `${name} readEnvelopeAtResolution`,
      visits,
    );
  }
  return visits;
}

const VISITS = await visitEverything();

describe('the pairs', () => {
  it('are the twenty types.ts declares, plus the two annotation axes', () => {
    expect(NAMED_PAIRS).toHaveLength(20);
    // Twenty pairs over nine distinct field names — `startTicks` alone is on four interfaces —
    // plus the two annotation axes, which is what the map keys on.
    expect(TWIN.size).toBe(11);
    // The interfaces they live on, so a new one has to be produced below before it may be added.
    expect([...new Set(NAMED_PAIRS.map(([type]) => type))].sort()).toEqual([
      'EdfAnnotation',
      'EdfChunk',
      'EdfChunkSignal',
      'EdfEnvelopeChunk',
      'EdfEnvelopeSignal',
      'EdfGap',
      'EdfHeader',
      'EdfLocation',
      'EdfSegment',
      'EdfTimeline',
    ]);
  });

  it('were all reached by the sweep, so none is asserted about in absentia', () => {
    const reached = new Set(VISITS.map((visit) => visit.pair.split('/')[0] ?? ''));
    for (const [ticks] of TWIN) {
      expect(reached.has(ticks), `${ticks} was never produced by any call above`).toBe(true);
    }
  });

  it('were visited often enough that a passing run is not a vacuous one', () => {
    expect(VISITS.length).toBeGreaterThan(200);
    // Including a negative one, from the overlapping file.
    expect(VISITS.some((visit) => visit.ticks < 0n)).toBe(true);
    // And a non-zero one, so this is not 270 comparisons of 0 against 0.
    expect(VISITS.filter((visit) => visit.ticks !== 0n).length).toBeGreaterThan(100);
  });
});

describe('every one of them', () => {
  it('has seconds that are exactly ticksToSeconds of its ticks', () => {
    const wrong = VISITS.filter(
      (visit) => !Object.is(ticksToSeconds(visit.ticks), visit.seconds),
    ).map(
      (visit) =>
        `${visit.path}: ${visit.ticks} ticks is ${ticksToSeconds(visit.ticks)} s, published as ${visit.seconds}`,
    );
    expect(wrong).toEqual([]);
  });
});

describe('the annotation onsets, which are two axes rather than one pair', () => {
  /** A quarter-second start offset in record 0's timekeeping TAL, which is what separates them. */
  const OFFSET = buildEdf({
    plus: 'C',
    recordCount: 4,
    recordDurationSeconds: 1,
    startOffsetSeconds: 0.25,
    signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
    annotationSignals: [
      {
        samplesPerRecord: 40,
        tals: (record) => (record === 0 ? [{ onset: '+1.25', texts: ['stim'] }] : []),
      },
    ],
  });

  it('pair up the way this file says, and not the other way', async () => {
    const recording = await openEdf(byteSource(OFFSET));
    const { annotations } = await readAnnotations(recording, { start: 0, count: 4 });
    const event = annotations[0];
    expect(event).toBeDefined();
    if (event === undefined) return;

    expect(ticksToSeconds(event.onsetTicks)).toBe(event.onsetSecondsFromHeaderStart);
    expect(ticksToSeconds(event.onsetTicksFromFirstRecord)).toBe(event.onsetSecondsFromFirstRecord);

    // Crossed, they disagree — by exactly the start offset, which is the whole of the difference.
    expect(ticksToSeconds(event.onsetTicks)).not.toBe(event.onsetSecondsFromFirstRecord);
    expect(event.onsetSecondsFromHeaderStart - event.onsetSecondsFromFirstRecord).toBe(
      recording.timeline.startOffsetSeconds,
    );
    expect(recording.timeline.startOffsetSeconds).toBe(0.25);
  });

  it('coincide on a file with no offset, which is why the crossed pairing is easy to miss', async () => {
    const recording = await openEdf(byteSource(GAPPED));
    const { annotations } = await readAnnotations(recording, { start: 0, count: 6 });
    const event = annotations[0];
    expect(event).toBeDefined();
    if (event === undefined) return;
    expect(recording.timeline.startOffsetTicks).toBe(0n);
    expect(event.onsetSecondsFromHeaderStart).toBe(event.onsetSecondsFromFirstRecord);
  });
});

describe('the matrix this file sweeps', () => {
  it('is the sixteen shapes it was written against', () => {
    // `awkward-files.ts` asks every consumer for this: without it, a shape removed from the matrix
    // quietly removes cases from here instead of failing anything.
    expect(AWKWARD).toHaveLength(16);
  });
});
