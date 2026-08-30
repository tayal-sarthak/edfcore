/**
 * The `Next:` clause, followed.
 *
 * Every message edfcore throws ends with one, and `next-clause.test.ts` proves that: it enumerates
 * the throws out of `src/` and fails on a message without one. What it cannot check is whether the
 * sentence is any good. A `Next:` clause that names a function that was renamed, or advises
 * something the API no longer allows, still passes — and advice that does not work is worse than
 * none, because the reader spends their time on it before doubting it.
 *
 * The package's own docblocks record two of those. `options.ts`: a `NaN` budget was refused with
 * "read fewer records per call", "advice no record count can satisfy", and elsewhere with "clamp
 * the range against header.recordCount", "a range neither function takes as a parameter" (0.3.21).
 * `validate.ts`: offering "drop scanSamples" on an EDF+ file "sent the reader round a loop — the
 * second refusal is the record-read guard, whose own advice is to read fewer records per call,
 * which is not a lever this caller holds" (0.3.77). Both were caught by reading, not by a test.
 *
 * So this takes the refusals whose advice is a concrete instruction, does what it says, and asserts
 * the call then succeeds. Each case is written as three steps a reader would take: provoke the
 * refusal, read the clause off the message it actually threw, and follow it. The clause is matched
 * against the message rather than restated, so advice that is reworded has to stay true rather than
 * stay identical.
 *
 * What this does NOT check: that every message has a clause, which is `next-clause.test.ts`, or
 * the wording of any of them.
 */

import { describe, expect, it } from 'vitest';
import { mergeChunks } from '../../src/chunks.js';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { decodeDigital } from '../../src/decode/digital.js';
import { toPhysical } from '../../src/decode/physical.js';
import { findSignals, getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { sampleAt } from '../../src/sample-locate.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

/** The clause itself, so each case asserts it followed the advice it was actually given. */
function adviceOf(error: unknown): string {
  const message = (error as Error).message;
  const at = message.indexOf('Next:');
  expect(at, message).toBeGreaterThan(-1);
  return message.slice(at).replace(/\s+/g, ' ');
}

async function refusalFrom(call: () => unknown): Promise<Error> {
  const thrown = await Promise.resolve()
    .then(call)
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  expect(thrown).toBeInstanceOf(Error);
  return thrown as Error;
}

const GAPPED = buildEdf({
  plus: 'D',
  recordCount: 6,
  recordDurationSeconds: 1,
  recordOnsetSeconds: (record) => (record < 3 ? record : record + 10),
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 24 }],
});

const PLAIN = buildEdf({
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 24 }],
});

const DUPLICATE_LABELS = buildEdf({
  plus: 'C',
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [
    { label: 'T8-P8', samplesPerRecord: 8 },
    { label: 'T8-P8', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 24 }],
});

const NO_SCALE = buildEdf({
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fpz-Cz', samplesPerRecord: 4 },
    {
      label: 'Temp rectal',
      samplesPerRecord: 4,
      raw: { digitalMinimum: '0', digitalMaximum: '0' },
    },
  ],
});

const open = (bytes: Uint8Array): Promise<EdfRecording> => openEdf(byteSource(bytes));

describe('"await buildRecordIndex(recording) and pass the index it returns"', () => {
  it('is what a probed index refuses a time window with, and it works', async () => {
    const recording = await open(GAPPED);
    const error = await refusalFrom(() =>
      readWindow(recording, { startSeconds: 0, durationSeconds: 20, signalIndices: [0] }),
    );
    expect(adviceOf(error)).toContain('buildRecordIndex(recording)');

    const index = await buildRecordIndex(recording);
    const chunks = await readWindow(
      { ...recording, index },
      { startSeconds: 0, durationSeconds: 20, signalIndices: [0] },
    );
    expect(chunks).toHaveLength(2);
  });

  it('is also what sampleAt refuses with, and the same step answers it', async () => {
    const recording = await open(GAPPED);
    const error = await refusalFrom(() => sampleAt(recording, 0, 13.5));
    expect(adviceOf(error)).toContain('buildRecordIndex(recording)');

    const index = await buildRecordIndex(recording);
    expect(sampleAt({ ...recording, index }, 0, 13.5)?.recordIndex).toBe(3);
  });
});

describe('"merge each contiguous run separately"', () => {
  it('is what mergeChunks refuses a gap with, and each run then merges', async () => {
    const recording = await open(GAPPED);
    const index = await buildRecordIndex(recording);
    const located = { ...recording, index };
    const chunks = await readWindow(located, {
      startSeconds: 0,
      durationSeconds: 20,
      signalIndices: [0],
    });
    expect(chunks).toHaveLength(2);

    const error = await refusalFrom(() => mergeChunks(chunks));
    expect(adviceOf(error)).toContain('merge each contiguous run separately');

    // Following it: each run on its own, which is what `readWindow` split them into.
    for (const chunk of chunks) {
      expect(mergeChunks([chunk])).toBe(chunk);
    }
  });
});

describe('"read fewer records per call, or raise options.maxMaterializeBytes"', () => {
  it('offers two levers, and both of them work', async () => {
    const recording = await open(PLAIN);
    const { header } = recording;
    const budget = 2 * header.recordByteLength;

    const error = await refusalFrom(() =>
      readRecordBytes(
        recording.source,
        header,
        { start: 0, count: 4 },
        {
          maxMaterializeBytes: budget,
        },
      ),
    );
    const advice = adviceOf(error);
    expect(advice).toContain('read fewer records per call');
    expect(advice).toContain('raise options.maxMaterializeBytes');

    // Lever one: fewer records, sized from the budget the message reported.
    await expect(
      readRecordBytes(
        recording.source,
        header,
        { start: 0, count: 2 },
        {
          maxMaterializeBytes: budget,
        },
      ),
    ).resolves.toHaveLength(budget);

    // Lever two: the same range, with the budget raised to what it needs.
    await expect(
      readRecordBytes(
        recording.source,
        header,
        { start: 0, count: 4 },
        {
          maxMaterializeBytes: 4 * header.recordByteLength,
        },
      ),
    ).resolves.toHaveLength(4 * header.recordByteLength);
  });
});

describe('"call readAnnotations(recording, records) for it, and pass only header.dataSignalIndices here"', () => {
  it('is what an annotations index refuses a read with, and both halves work', async () => {
    const recording = await open(PLAIN);
    const annotationsIndex = recording.header.annotationSignalIndices[0];
    expect(annotationsIndex).toBeDefined();

    const error = await refusalFrom(() =>
      readRecords(recording, {
        records: { start: 0, count: 1 },
        signalIndices: [annotationsIndex ?? -1],
      }),
    );
    const advice = adviceOf(error);
    expect(advice).toContain('readAnnotations(recording, records)');
    expect(advice).toContain('header.dataSignalIndices');

    // Half one: the events really do come out of the other call.
    const { annotations } = await readAnnotations(recording, { start: 0, count: 4 });
    expect(Array.isArray(annotations)).toBe(true);

    // Half two: the selection it points at is accepted.
    const chunk = await readRecords(recording, {
      records: { start: 0, count: 1 },
      signalIndices: [...recording.header.dataSignalIndices],
    });
    expect(chunk.signals).toHaveLength(recording.header.dataSignalIndices.length);
  });
});

describe('"findSignals(...) returns all, or select by index"', () => {
  it('is what an ambiguous label refuses with, and both ways through it work', async () => {
    const recording = await open(DUPLICATE_LABELS);
    const error = await refusalFrom(() => getSignal(recording.header, 'T8-P8'));
    const advice = adviceOf(error);
    expect(advice).toMatch(/findSignals/);

    const all = findSignals(recording.header, 'T8-P8');
    expect(all).toHaveLength(2);
    // And selecting by index, the other half of the same clause.
    expect(getSignal(recording.header, 0).index).toBe(0);
    expect(getSignal(recording.header, 1).index).toBe(1);
  });
});

describe('"decodeDigital() still works on this signal"', () => {
  it('is what an unscalable signal refuses conversion with, and it does', async () => {
    const recording = await open(NO_SCALE);
    const signal = recording.header.signals[1];
    if (signal === undefined) throw new Error('fixture has no second signal');

    const error = await refusalFrom(() => toPhysical(signal, Int32Array.of(1, 2, 3)));
    expect(adviceOf(error)).toContain('decodeDigital() still works on this signal');

    const bytes = await readRecordBytes(recording.source, recording.header, {
      start: 0,
      count: 1,
    });
    const digital = decodeDigital(recording.header, bytes, { start: 0, count: 1 }, signal.index);
    expect(digital).toBeInstanceOf(Int32Array);
    expect(digital).toHaveLength(signal.samplesPerRecord);
  });
});

describe('"pass one of those, or omit signalIndices to read them all"', () => {
  it('is what a data index refuses an annotation read with, and both work', async () => {
    const recording = await open(PLAIN);
    const error = await refusalFrom(() =>
      readAnnotations(recording, { start: 0, count: 4 }, { signalIndices: [0] }),
    );
    const advice = adviceOf(error);
    expect(advice).toContain('pass one of those');
    expect(advice).toContain('omit signalIndices to read them all');

    const named = recording.header.annotationSignalIndices;
    await expect(
      readAnnotations(recording, { start: 0, count: 4 }, { signalIndices: [...named] }),
    ).resolves.toBeDefined();
    await expect(readAnnotations(recording, { start: 0, count: 4 })).resolves.toBeDefined();
  });
});

describe('"omit --limit for the default"', () => {
  it('is what a bad --limit refuses with, and omitting it runs', async () => {
    async function invoke(argv: readonly string[]): Promise<{ code: number; text: string }> {
      let text = '';
      const io: CliIo = {
        readFile: () => Promise.resolve(PLAIN),
        out: (piece) => {
          text += piece;
        },
        err: (piece) => {
          text += piece;
        },
      };
      const code = await runCli(parseArgs(argv), io);
      return { code, text };
    }

    const error = await refusalFrom(() => parseArgs(['header', 'a.edf', '--limit', 'all']));
    expect(adviceOf(error)).toMatch(/omit --limit for the default of \d+/);

    const { code } = await invoke(['header', 'a.edf']);
    expect(code).toBe(0);
  });
});
