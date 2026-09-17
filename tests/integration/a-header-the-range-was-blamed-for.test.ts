/**
 * `readRecordBytes` given something other than the header, and blaming the range for it.
 *
 * It is the lowest published read in the package and it takes `(source, header, records)`. The
 * source almost always comes off a recording — `readRecordBytes(recording.source, …)` is how every
 * example in this repo spells it — so the recording is the object already in hand, and
 * `readRecordBytes(recording.source, recording, records)` is one field short.
 *
 * Nothing checked it. `assertRecordRange` reads `header.recordCount` and prints it, so the refusal
 * was
 *
 *     records { start: 0, count: 1 } is not inside the undefined data records this file contains.
 *     Next: clamp the range against header.recordCount, or call index.locate(seconds) …
 *
 * — a complaint about the range, which was right and inside the file, and a next step no clamp can
 * satisfy. A chunk produced the same sentence.
 *
 * The TIMELINE is worse, because it has a `recordCount`. The range check passed, and
 * `records.count * header.recordByteLength` was `NaN`, reported as
 * `Reading records { start: 0, count: 1 } needs a NaN-byte buffer, above the 268435456-byte
 * maxMaterializeBytes budget`, advising a smaller read. That one is an `EdfBudgetError`, so
 * `isEdfError` answered `true` and a caller's file-or-budget branch handled what is a caller
 * mistake — the one distinction `errors.ts` exists to keep.
 *
 * 0.6.127 swept this shape out of `header/lookup.ts`, 0.6.120 out of `biosemi.ts`, and
 * `decode/digital.ts` names `recordByteLength` for exactly the reason this one now does: it is the
 * field the call multiplies by.
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const RECORDS = { start: 0, count: 1 } as const;

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

describe.each([
  ['the recording', (recording: EdfRecording): unknown => recording],
  ['its timeline', (recording: EdfRecording): unknown => recording.timeline],
  ['its index', (recording: EdfRecording): unknown => recording.index],
])('given %s where the header belongs', (_name, pick) => {
  it('names the header rather than the range', async () => {
    const recording = await opened();
    const thrown = await readRecordBytes(recording.source, pick(recording) as never, RECORDS).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown, 'the read went ahead').toBeDefined();
    expect(thrown?.message).toContain('that is not a header');
    expect(thrown?.message).toContain('recordByteLength');
    expect(thrown?.message).toContain('Next:');
  });

  it('does not describe the range, which was inside the file', async () => {
    const recording = await opened();
    const thrown = await readRecordBytes(recording.source, pick(recording) as never, RECORDS).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown?.message).not.toContain('start: 0, count: 1');
    expect(thrown?.message).not.toContain('clamp the range');
    expect(thrown?.message).not.toContain('NaN-byte buffer');
  });

  it('is a caller mistake, not an edfcore error about the file', async () => {
    const recording = await opened();
    const thrown = await readRecordBytes(recording.source, pick(recording) as never, RECORDS).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown).toBeInstanceOf(RangeError);
    expect(isEdfError(thrown)).toBe(false);
  });
});

describe('given the chunk a read resolved to', () => {
  it('is refused too, for the field a chunk does not carry', async () => {
    const recording = await opened();
    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 2,
    });
    await expect(readRecordBytes(recording.source, chunks[0] as never, RECORDS)).rejects.toThrow(
      /that is not a header/,
    );
  });
});

describe('the header itself', () => {
  it('still reads exactly one record of bytes', async () => {
    const recording = await opened();
    const bytes = await readRecordBytes(recording.source, recording.header, RECORDS);
    expect(bytes.byteLength).toBe(recording.header.recordByteLength);
  });

  it('still refuses a range that really is outside the file, in its own words', async () => {
    const recording = await opened();
    await expect(
      readRecordBytes(recording.source, recording.header, { start: 5, count: 4 }),
    ).rejects.toThrow(/is not inside the 6 data records/);
  });

  it('still names a chunk passed where the range belongs, which 0.6.153 added', async () => {
    const recording = await opened();
    const chunks = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 2,
    });
    await expect(
      readRecordBytes(recording.source, recording.header, chunks[0] as never),
    ).rejects.toThrow(/that is a chunk, not a record range/);
  });
});
