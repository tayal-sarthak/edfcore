/**
 * Options passed as an array, which is an object, so the guards looking for one let it through.
 *
 * `assertSelection` makes this exact argument one argument along: "An ARRAY, which is an object, so
 * the check above let it through." Both options guards were written against a BARE value —
 * `openEdf(source, true)`, `readRecords(recording, selection, 64 * 1024 * 1024)` — and both state
 * the cost of missing one. The read options guard: the read "took the default budget and no
 * cancellation". The parse options guard: the parse "collected its diagnostics rather than throwing
 * on the first of them", for a caller who asked to receive no such file at all.
 *
 * An array pays both without being seen. Every field is read off the object, so `options[0]` is
 * nothing this package looks at, and `[controller.signal]` — the same wrapping mistake 0.6.155
 * named for the bare signal, one bracket further on — resolved with the cancellation dropped.
 *
 * `null` and `undefined` still mean "no options", and a real options object is untouched.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope, readEnvelopeAtResolution } from '../../src/envelope.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader, readRecordBytes } from '../../src/io/read.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfRecording } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 16 }],
  annotationSignals: [{ samplesPerRecord: 60 }],
});

const WINDOW = { signalIndices: [0], startSeconds: 0, durationSeconds: 2 };
const RANGE = { start: 0, count: 2 };

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

const refusal = async (call: () => unknown): Promise<Error> => {
  const thrown = await Promise.resolve()
    .then(call)
    .then(
      () => undefined,
      (error: unknown) => error as Error,
    );
  expect(thrown, 'nothing was refused').toBeDefined();
  return thrown as Error;
};

/** Every published call that takes options, with the kind of options it takes. */
const CALLS: ReadonlyArray<readonly [string, (r: EdfRecording, o: unknown) => unknown, string]> = [
  ['openEdf', (_r, o) => openEdf(byteSource(FILE), o as never), 'parse'],
  ['readHeader', (_r, o) => readHeader(byteSource(FILE), o as never), 'parse'],
  ['buildRecordIndex', (r, o) => buildRecordIndex(r, o as never), 'parse'],
  ['readRecordBytes', (r, o) => readRecordBytes(r.source, r.header, RANGE, o as never), 'read'],
  ['readWindow', (r, o) => readWindow(r, WINDOW, o as never), 'read'],
  [
    'readRecords',
    (r, o) => readRecords(r, { signalIndices: [0], records: RANGE }, o as never),
    'read',
  ],
  ['readAnnotations', (r, o) => readAnnotations(r, RANGE, o as never), 'read'],
  ['readEnvelope', (r, o) => readEnvelope(r, { ...WINDOW, buckets: 4 }, o as never), 'read'],
  [
    'readEnvelopeAtResolution',
    (r, o) => readEnvelopeAtResolution(r, { ...WINDOW, secondsPerBucket: 0.5 }, o as never),
    'read',
  ],
  [
    'streamRecords',
    async (r, o) => {
      for await (const chunk of streamRecords(r, WINDOW, o as never)) void chunk;
      return 'done';
    },
    'read',
  ],
  ['inspectEdf', (_r, o) => inspectEdf(byteSource(FILE), o as never), 'read'],
  ['validateRecording', (r, o) => validateRecording(r, o as never), 'read'],
];

describe.each(CALLS)('%s, given options as an array', (_name, call, kind) => {
  it('refuses it rather than taking every default', async () => {
    const thrown = await refusal(async () => call(await opened(), []));
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown.message).toContain(`the ${kind} options are an array`);
    expect(thrown.message).toMatch(/Next: pass (them|it) on an object/);
  });

  it('names the fields that belong on the object', async () => {
    const thrown = await refusal(async () => call(await opened(), []));
    expect(thrown.message).toMatch(
      /field(s)? on the options rather than (an entry|entries) in a list/,
    );
  });

  it('refuses a wrapped signal, which is how one arrives', async () => {
    const thrown = await refusal(async () => call(await opened(), [{ aborted: false }]));
    expect(thrown.message).toContain('are an array');
  });

  it('still answers for no options at all', async () => {
    expect(await call(await opened(), undefined)).toBeDefined();
  });

  it('still answers for a real options object', async () => {
    expect(await call(await opened(), {})).toBeDefined();
  });
});

describe('the cost an array used to pay in silence', () => {
  it('was a dropped cancellation, which the object form still honours', async () => {
    const recording = await opened();
    const aborted = await refusal(() =>
      readWindow(recording, WINDOW, { signal: { aborted: true } }),
    );
    expect(aborted.name).toBe('AbortError');
  });

  it('and a dropped budget, which the object form still honours', async () => {
    const recording = await opened();
    const thrown = await refusal(() =>
      readWindow(recording, WINDOW, { maxMaterializeBytes: -1 } as never),
    );
    expect(thrown.message).toContain('options.maxMaterializeBytes must not be negative');
  });
});

describe('the guards an array walked past', () => {
  it('still refuse a bare value', async () => {
    const recording = await opened();
    expect((await refusal(() => readWindow(recording, WINDOW, 5 as never))).message).toContain(
      'the read options are 5, not an object',
    );
    expect((await refusal(() => openEdf(byteSource(FILE), true as never))).message).toContain(
      'the parse options are a boolean, not an object',
    );
  });

  it('still refuse an AbortSignal passed as the options', async () => {
    const recording = await opened();
    const thrown = await refusal(() => readWindow(recording, WINDOW, { aborted: false } as never));
    expect(thrown.message).toContain('the read options are an AbortSignal');
  });
});
