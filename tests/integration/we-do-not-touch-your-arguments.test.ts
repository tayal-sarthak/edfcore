/**
 * The arguments you pass in are yours, and they come back the way you sent them.
 *
 * This is the third thing a caller hands edfcore that edfcore does not own. The buffer is checked
 * twice over — `nothing-points-at-your-buffer.test.ts` for what comes back pointing at it,
 * `we-never-write-your-bytes.test.ts` for what gets written into it. The arguments were not checked
 * at all, and they are the ones a caller is most likely to reuse: a `signalIndices` array built
 * once and passed to every read in a loop, an options object shared across a session, a
 * `RecordRange` walked forward by a scheduler.
 *
 * A function that sorted `signalIndices` in place, or normalised `records.start`, or filled a
 * default into the options object it was given, would work perfectly and change the caller's next
 * call. That is a defect with no failing test anywhere near it.
 *
 * `Object.freeze` is what makes it checkable without inspecting anything. Every one of these
 * modules is an ES module and therefore strict, so an assignment to a frozen object throws rather
 * than being ignored. Deep-freeze the arguments, make the call, and a call that RESOLVES has
 * proved it wrote to none of them — there is nothing left to assert afterwards.
 *
 * The functions are derived rather than listed: every exported function in `src/` whose parameters
 * mention `Options`, `Selection` or `RecordRange` is one that takes something structured from the
 * caller, and each must appear below or in `EXEMPT` with a reason.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readTriggers } from '../../src/biosemi.js';
import { decodeDigital } from '../../src/decode/digital.js';
import { clampToDigitalRange, toPhysical } from '../../src/decode/physical.js';
import { formatDiagnostics } from '../../src/diagnostics/format.js';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { formatAnnotations } from '../../src/format-annotations.js';
import { formatHeader } from '../../src/format-header.js';
import { parseHeader } from '../../src/header/parse.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { cachedSource } from '../../src/io/cached.js';
import { readHeader, readRecordBytes } from '../../src/io/read.js';
import { buildRecordIndex, buildTimeline } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import { decodeAnnotations } from '../../src/tal/annotations.js';
import { formatValidationReport, validateRecording } from '../../src/validate.js';
import { codeOnly } from '../support/code-only.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const SRC = new URL('../../src/', import.meta.url);

/** Every exported function in `src/` that takes something structured from the caller. */
function takesCallerStructure(): ReadonlySet<string> {
  const found = new Set<string>();
  const walk = (directory: URL): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, directory));
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      const source = codeOnly(readFileSync(new URL(entry.name, directory), 'utf8'));
      for (const match of source.matchAll(
        /export\s+(?:async\s+)?function\s*\*?\s*(\w+)\s*\(([\s\S]*?)\)\s*:/g,
      )) {
        const parameters = match[2] ?? '';
        if (/Options|Selection|RecordRange/.test(parameters)) found.add(match[1] as string);
      }
    }
  };
  walk(SRC);
  return found;
}

/**
 * Not exercised here, each for a reason that is about the call and not about the property.
 */
const EXEMPT: ReadonlyMap<string, string> = new Map([
  ['httpSource', 'needs a fetch double; `http-construction.test.ts` owns its argument handling'],
  ['throwIfAborted', 'takes only the options bag and reads one field off it'],
  ['buildTimelineFromProbes', 'internal; `buildTimeline` is the exported path through it'],
  ['decodeDigitalCounted', 'internal; `decodeDigital` is the exported path through it'],
  ['parsePatientId', 'internal to header parsing, reached through `parseHeader`'],
  ['parseRecordingId', 'internal to header parsing, reached through `parseHeader`'],
]);

/** Freezes an object graph, so any write to it anywhere throws. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return value;
  for (const member of Object.values(value as Record<string, unknown>)) deepFreeze(member);
  return Object.freeze(value);
}

const PLUS = minimalEdfPlus({ recordCount: 4, recordDurationSeconds: 1 });
const BDF = buildEdf({
  format: 'BDF',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'A1', samplesPerRecord: 8 },
    { label: 'Status', samplesPerRecord: 8 },
  ],
});

const recording = await openEdf(byteSource(PLUS));
const index = await buildRecordIndex(recording);
const located = { ...recording, index };
const signalIndices = recording.header.dataSignalIndices;
const chunk = await readRecords(located, {
  records: { start: 0, count: 2 },
  signalIndices: [...signalIndices],
});
const firstSignal = chunk.signals[0];
const headerSignal = recording.header.signals[firstSignal?.signalIndex ?? 0];
const annotations = await readAnnotations(recording, { start: 0, count: 4 });
const bdfRecording = await openEdf(byteSource(BDF));

const WINDOW = deepFreeze({
  startSeconds: 0,
  durationSeconds: 3,
  signalIndices: [...signalIndices],
});
const RECORDS = deepFreeze({ records: { start: 0, count: 2 }, signalIndices: [...signalIndices] });
const RANGE = deepFreeze({ start: 0, count: 2 });
const NO_OPTIONS = deepFreeze({});

/** Every call, with every argument the caller supplied frozen solid. */
const CALLS: ReadonlyArray<readonly [string, () => unknown]> = [
  ['openEdf', () => openEdf(byteSource(PLUS), NO_OPTIONS)],
  ['inspectEdf', () => inspectEdf(byteSource(PLUS), NO_OPTIONS)],
  ['buildRecordIndex', () => buildRecordIndex(recording, NO_OPTIONS)],
  ['buildTimeline', () => buildTimeline(byteSource(PLUS), recording.header, NO_OPTIONS)],
  ['validateRecording', () => validateRecording(recording, deepFreeze({ scanSamples: true }))],
  ['readRecords', () => readRecords(located, RECORDS, NO_OPTIONS)],
  ['readWindow', () => readWindow(located, WINDOW, NO_OPTIONS)],
  ['readAnnotations', () => readAnnotations(recording, RANGE, NO_OPTIONS)],
  ['readEnvelope', () => readEnvelope(located, deepFreeze({ ...WINDOW, buckets: 4 }), NO_OPTIONS)],
  [
    'readEnvelopeAtResolution',
    () =>
      readEnvelopeAtResolution(
        located,
        deepFreeze({ ...WINDOW, secondsPerBucket: 0.5 }),
        NO_OPTIONS,
      ),
  ],
  [
    'streamRecords',
    async () => {
      const pieces = [];
      for await (const piece of streamRecords(
        located,
        deepFreeze({ ...WINDOW, chunkRecords: 1 }),
        NO_OPTIONS,
      )) {
        pieces.push(piece);
      }
      return pieces;
    },
  ],
  [
    'readTriggers',
    () =>
      readTriggers(bdfRecording, deepFreeze({ startSeconds: 0, durationSeconds: 3 }), NO_OPTIONS),
  ],
  ['readHeader', () => readHeader(byteSource(PLUS), NO_OPTIONS)],
  ['readRecordBytes', () => readRecordBytes(byteSource(PLUS), recording.header, RANGE, NO_OPTIONS)],
  ['parseHeader', () => parseHeader(PLUS, PLUS.byteLength, NO_OPTIONS)],
  ['cachedSource', () => cachedSource(byteSource(PLUS), deepFreeze({ maxBytes: 1 << 20 }))],
  [
    'decodeAnnotations',
    async () =>
      decodeAnnotations(
        recording.header,
        await readRecordBytes(byteSource(PLUS), recording.header, RANGE),
        RANGE,
        NO_OPTIONS,
      ),
  ],
  [
    'decodeDigital',
    async () =>
      decodeDigital(
        recording.header,
        await readRecordBytes(byteSource(PLUS), recording.header, RANGE),
        RANGE,
        signalIndices[0] ?? 0,
        undefined,
        NO_OPTIONS,
      ),
  ],
  [
    'toPhysical',
    () => toPhysical(headerSignal as never, firstSignal?.digital as never, undefined, NO_OPTIONS),
  ],
  [
    'clampToDigitalRange',
    () =>
      clampToDigitalRange(
        headerSignal as never,
        firstSignal?.digital as never,
        undefined,
        NO_OPTIONS,
      ),
  ],
  ['formatHeader', () => formatHeader(recording.header, NO_OPTIONS)],
  ['formatAnnotations', () => formatAnnotations(annotations.annotations, NO_OPTIONS)],
  ['formatDiagnostics', () => formatDiagnostics(recording.header.diagnostics, NO_OPTIONS)],
  [
    'formatValidationReport',
    async () => formatValidationReport(await validateRecording(recording), NO_OPTIONS),
  ],
];

describe('the list below is every function that takes something structured from you', () => {
  it('accounts for each one, either by calling it or by exempting it with a reason', () => {
    const covered = new Set(CALLS.map(([name]) => name));
    const unaccounted = [...takesCallerStructure()]
      .filter((name) => !covered.has(name) && !EXEMPT.has(name))
      .sort();
    expect(unaccounted).toEqual([]);
  });

  it('exempts nothing it also calls, and nothing that no longer exists', () => {
    const derived = takesCallerStructure();
    expect(derived.size).toBeGreaterThan(20);
    for (const [name, reason] of EXEMPT) {
      expect(derived.has(name), `${name} is exempt but no longer takes one`).toBe(true);
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});

describe('every one of them accepts arguments frozen solid', () => {
  for (const [name, call] of CALLS) {
    it(`${name} writes to nothing the caller passed`, async () => {
      // Modules are strict, so a write to a frozen argument throws. Resolving IS the assertion.
      await expect(Promise.resolve().then(call)).resolves.toBeDefined();
    });
  }
});

describe('and it does not keep them either', () => {
  it('reads the signalIndices array once, so emptying it afterwards changes nothing returned', async () => {
    const mine = [...signalIndices];
    const before = await readRecords(located, {
      records: { start: 0, count: 2 },
      signalIndices: mine,
    });
    const count = before.signals.length;
    expect(count).toBeGreaterThan(0);

    mine.length = 0;

    expect(before.signals).toHaveLength(count);
    // And the next call reads the array as it is NOW, rather than from anything held over.
    await expect(
      readRecords(located, { records: { start: 0, count: 2 }, signalIndices: mine }),
    ).resolves.toMatchObject({ signals: [] });
  });
});
