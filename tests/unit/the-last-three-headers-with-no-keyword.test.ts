/**
 * The three remaining calls that take a header and never named the keyword.
 *
 * `decodeDigital` and `decodeAnnotations` share one guard, and `trimToWindow` has its own — whose
 * comment calls it "the last entry point in the package that took a header without checking one".
 * All three said only that the argument lacked a field, which is true of a pending Promise and of
 * almost everything else.
 *
 * The decoders are where the two arguments differ in exactly that keyword. `api-primitives.md`
 * writes `decodeDigital(header, recordBytes, records, signalIndex)` beside
 * `readRecordBytes(source, header, records)`: the bytes come from a call the reader has already
 * awaited, the header from `readHeader(source)`, which is async — so one of the two `await`s is the
 * easy one to drop.
 *
 * `trimToWindow` names `recording.header`, which a reader who called `readHeader(source)` does not
 * have.
 *
 * 0.6.217 made the argument for the three lookups, 0.6.229 for `validateHeader`, 0.6.235 for
 * `buildTimeline` and 0.6.236 for the guards whose advice named `parseHeader`. With these, every
 * published call that takes a header names it.
 */

import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../src/decode/digital.js';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader, readRecordBytes } from '../../src/io/read.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { decodeAnnotations } from '../../src/tal/annotations.js';
import { trimToWindow } from '../../src/time/window.js';
import type { EdfChunkSignal, RecordRange } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const RANGE: RecordRange = { start: 0, count: 2 };

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

async function fixture(): Promise<{ bytes: Uint8Array; chunkSignal: EdfChunkSignal }> {
  const recording = await openEdf(byteSource(FILE));
  const chunks = await readWindow(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 2,
  });
  return {
    bytes: await readRecordBytes(recording.source, recording.header, RANGE),
    chunkSignal: chunks[0]?.signals[0] as EdfChunkSignal,
  };
}

interface Guard {
  readonly call: (header: unknown, fix: Awaited<ReturnType<typeof fixture>>) => unknown;
  /** What this one says when the argument is simply not a header. */
  readonly field: string;
}

const GUARDS: ReadonlyArray<readonly [string, Guard]> = [
  [
    'decodeDigital',
    {
      call: (header, fix) => decodeDigital(header as never, fix.bytes, RANGE, 0),
      field: 'no recordByteLength',
    },
  ],
  [
    'decodeAnnotations',
    {
      call: (header, fix) => decodeAnnotations(header as never, fix.bytes, RANGE),
      field: 'no recordByteLength',
    },
  ],
  [
    'trimToWindow',
    {
      call: (header, fix) => trimToWindow(header as never, fix.chunkSignal, 0, 1),
      field: 'no signals',
    },
  ],
];

describe.each(GUARDS)('%s, given readHeader(source) unawaited', (_name, guard) => {
  it('names the keyword rather than the missing field', async () => {
    const fix = await fixture();
    const pending = readHeader(byteSource(FILE));
    const thrown = await refusal(() => guard.call(pending, fix));
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown.message).toContain('that is a pending Promise, not a header');
    expect(thrown.message).not.toContain(guard.field);
    await pending;
  });

  it('names the call to await and what it resolves to', async () => {
    const fix = await fixture();
    const pending = readHeader(byteSource(FILE));
    const thrown = await refusal(() => guard.call(pending, fix));
    expect(thrown.message).toContain('await readHeader(source)');
    expect(thrown.message).toContain('it resolves to the header this takes');
    await pending;
  });

  it('still answers once it has arrived', async () => {
    const fix = await fixture();
    const header = await readHeader(byteSource(FILE));
    expect(await guard.call(header, fix)).toBeDefined();
  });

  it('keeps its own refusal for something that is simply not a header', async () => {
    const fix = await fixture();
    const thrown = await refusal(() => guard.call({}, fix));
    expect(thrown.message).toContain('that is not a header — it has');
    expect(thrown.message).toContain(guard.field);
    expect(thrown.message).toContain('Next: pass recording.header');
  });
});

describe('the two decoders still share one sentence', () => {
  it('word for word, as the guard they share requires', async () => {
    const fix = await fixture();
    const pending = readHeader(byteSource(FILE));
    const fromDigital = await refusal(() => decodeDigital(pending as never, fix.bytes, RANGE, 0));
    const fromAnnotations = await refusal(() =>
      decodeAnnotations(pending as never, fix.bytes, RANGE),
    );
    expect(fromDigital.message.replace('decodeDigital', 'X')).toBe(
      fromAnnotations.message.replace('decodeAnnotations', 'X'),
    );
    await pending;
  });
});

describe('trimToWindow keeps the rest of its own guard', () => {
  it('still says what it needs the header for', async () => {
    const fix = await fixture();
    const thrown = await refusal(() => trimToWindow({} as never, fix.chunkSignal, 0, 1));
    expect(thrown.message).toContain('the samples-per-record the chunk signal does not carry');
  });

  it('still names a chunk as one', async () => {
    const fix = await fixture();
    const recording = await openEdf(byteSource(FILE));
    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 2,
    });
    const thrown = await refusal(() => trimToWindow(chunks[0] as never, fix.chunkSignal, 0, 1));
    expect(thrown.message).toContain('that is a chunk');
  });
});
