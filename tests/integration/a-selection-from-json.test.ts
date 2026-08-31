/**
 * A selection that came from JSON.
 *
 * `io/read.ts` says why this is not a type-system question: "`records` is typed, and the type is
 * not the only way in: a selection built from JSON, from a config file or from a JavaScript call
 * site arrives at run time." The docblock then records what used to happen — every wrong SHAPE
 * reached a refusal with a next step, "while `undefined` and `null` threw
 * `TypeError: Cannot read properties of undefined (reading 'start')` from the two lines under this
 * one, which names neither the option nor anything to do about it" (fixed in 0.4.443).
 *
 * That is the whole class, and it had one test. A saved view, a URL parameter, a job description on
 * a queue: all of them arrive as `JSON.parse` output, where a number that was written as a string
 * stays a string and a field that was omitted is simply absent. `record-range-contract.test.ts`
 * covers ranges that are well formed and out of bounds; this covers ranges that are not ranges.
 *
 * Both selections are swept. Every malformed `records` — absent, null, empty, half-filled, an
 * array, a string, string-valued fields, a null field — is an `EdfRangeError` at all three entry
 * points that take one, carrying the same next step. Every malformed `signalIndices` — absent,
 * null, a string, an object with a numeric key — is a plain `RangeError`, because a selection that
 * is not an array is a caller's mistake and not a file's.
 *
 * One shape is accepted, and it is worth naming rather than leaving to be discovered: an array
 * holding the canonical decimal string for an index — `['0']`, which is what
 * `JSON.parse('["0"]')` from a query string gives — resolves to that signal. It is ordinary
 * JavaScript array-index coercion and it is tight: `'00'`, `' 0'`, `'0.0'`, `'+0'` and a label are
 * every one of them an `EdfChannelNotFoundError` naming the selector verbatim, and the chunk that
 * comes back reports `signalIndex` as a number, so nothing downstream carries the string.
 */

import { describe, expect, it } from 'vitest';
import { EdfChannelNotFoundError, EdfRangeError, isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf, readAnnotations, readRecords, readWindow } from '../../src/recording.js';
import type { EdfRecording, RecordRange } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const BYTES = buildEdf({
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [
    { label: 'Fp1', samplesPerRecord: 8 },
    { label: 'Fp2', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 20 }],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(BYTES));

async function thrownBy(call: () => unknown): Promise<unknown> {
  return Promise.resolve()
    .then(call)
    .then(
      () => undefined,
      (error: unknown) => error,
    );
}

/** Shapes a `RecordRange` arrives in when nobody wrote it by hand. */
const NOT_A_RANGE: ReadonlyArray<readonly [string, unknown]> = [
  ['absent', undefined],
  ['null', null],
  ['an empty object', {}],
  ['only a start', { start: 0 }],
  ['only a count', { count: 1 }],
  ['an array', []],
  ['a string', '0,1'],
  ['string-valued fields', { start: '0', count: '1' }],
  ['a null field', { start: null, count: 1 }],
];

describe('a records range that is not a range', () => {
  it.each(NOT_A_RANGE)('is refused at every entry point when it is %s', async (_name, records) => {
    const recording = await opened();
    const calls: ReadonlyArray<readonly [string, () => unknown]> = [
      [
        'readRecordBytes',
        () => readRecordBytes(recording.source, recording.header, records as RecordRange),
      ],
      [
        'readRecords',
        () => readRecords(recording, { records: records as RecordRange, signalIndices: [0] }),
      ],
      ['readAnnotations', () => readAnnotations(recording, records as RecordRange)],
    ];
    for (const [where, call] of calls) {
      const thrown = await thrownBy(call);
      expect(thrown, where).toBeInstanceOf(EdfRangeError);
      expect(isEdfError(thrown), where).toBe(true);
      expect((thrown as Error).message, where).toContain('is not inside the 6 data records');
      expect((thrown as Error).message, where).toMatch(/Next:/);
    }
  });

  it('rather than the TypeError that absent and null used to raise', async () => {
    const recording = await opened();
    for (const records of [undefined, null]) {
      const thrown = await thrownBy(() =>
        readRecordBytes(recording.source, recording.header, records as unknown as RecordRange),
      );
      expect(thrown).not.toBeInstanceOf(TypeError);
      expect((thrown as Error).message).not.toContain('Cannot read properties');
    }
  });
});

describe('a records range that survives the trip', () => {
  it('is read, extra properties and all', async () => {
    const recording = await opened();
    const fromJson = JSON.parse('{"start":1,"count":2}') as RecordRange;
    const chunk = await readRecords(recording, { records: fromJson, signalIndices: [0] });
    expect(chunk.records).toEqual({ start: 1, count: 2 });

    const withExtras = { start: 1, count: 2, note: 'from a saved view' } as unknown as RecordRange;
    const again = await readRecords(recording, { records: withExtras, signalIndices: [0] });
    expect([...(again.signals[0]?.digital ?? [])]).toEqual([...(chunk.signals[0]?.digital ?? [])]);
  });
});

describe('a signalIndices that is not an array', () => {
  it.each([
    ['absent', undefined],
    ['null', null],
    ['a string', '0'],
    ['an object with a numeric key', { 0: 0 }],
  ] as const)('is a plain RangeError when it is %s', async (_name, signalIndices) => {
    const recording = await opened();
    for (const [where, call] of [
      [
        'readRecords',
        () =>
          readRecords(recording, {
            records: { start: 0, count: 1 },
            signalIndices: signalIndices as never,
          }),
      ],
      [
        'readWindow',
        () =>
          readWindow(recording, {
            startSeconds: 0,
            durationSeconds: 1,
            signalIndices: signalIndices as never,
          }),
      ],
    ] as const) {
      const thrown = await thrownBy(call);
      expect(thrown, where).toBeInstanceOf(RangeError);
      // A caller's mistake, not a file's.
      expect(isEdfError(thrown), where).toBe(false);
      expect((thrown as Error).message, where).toContain('signalIndices');
      expect((thrown as Error).message, where).toMatch(/Next:/);
    }
  });
});

describe('the one shape that is accepted by coercion', () => {
  it('is the canonical decimal string for an index', async () => {
    const recording = await opened();
    for (const [text, index] of [
      ['0', 0],
      ['1', 1],
    ] as const) {
      const chunk = await readRecords(recording, {
        records: { start: 0, count: 1 },
        signalIndices: [text as unknown as number],
      });
      expect(chunk.signals[0]?.signalIndex, text).toBe(index);
      // A number on the way out, so nothing downstream carries the string.
      expect(typeof chunk.signals[0]?.signalIndex, text).toBe('number');
    }
  });

  it('and nothing else, which is what keeps it from being a hole', async () => {
    const recording = await opened();
    for (const text of ['00', ' 0', '1e0', '0x0', '-0', '0.0', '+0', 'Fp1']) {
      const thrown = await thrownBy(() =>
        readRecords(recording, {
          records: { start: 0, count: 1 },
          signalIndices: [text as unknown as number],
        }),
      );
      expect(thrown, text).toBeInstanceOf(EdfChannelNotFoundError);
      // The selector is reported verbatim, so the message shows what was actually passed.
      expect((thrown as EdfChannelNotFoundError).selector, text).toBe(text);
      expect((thrown as Error).message, text).toContain(text);
    }
  });

  it('leaves a null entry to the same not-found refusal', async () => {
    const recording = await opened();
    const thrown = await thrownBy(() =>
      readRecords(recording, {
        records: { start: 0, count: 1 },
        signalIndices: [null as unknown as number],
      }),
    );
    expect(thrown).toBeInstanceOf(EdfChannelNotFoundError);
  });
});
