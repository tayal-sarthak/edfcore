/**
 * A time window handed to the one read in this family that takes no seconds.
 *
 * 0.6.87 closed this route in one direction. `readRecords` takes `{ records }` and `streamRecords`
 * takes a window despite being called streamRECORDS, so a records range where a window belongs got
 * its own sentence, ending "or call readRecords(), which is the one that takes records".
 *
 * The mirror was left open, and it is the easier of the two to write. `readWindow` and `readRecords`
 * sit beside each other in the barrel, in the docs and in `recording.ts`; every other read in the
 * package is bounded in seconds; and `readRecords` is the single exception. So
 * `readRecords(recording, { signalIndices, startSeconds, durationSeconds })` is a selection a reader
 * believes as they write it.
 *
 * It reached `assertRecordRange` with nothing to check and was refused as
 *
 *     records { start: undefined, count: undefined } is not inside the 6 data records this file
 *     contains. Next: clamp the range against header.recordCount, or call index.locate(seconds) to
 *     find a record index for a time.
 *
 * — advice about clamping bounds, to a caller whose bounds were fine and already in seconds, and
 * which never names the call one line over that accepts exactly what they passed.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords, readWindow } from '../../src/recording.js';
import { streamRecords } from '../../src/stream.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

const WINDOW = { signalIndices: [0], startSeconds: 1, durationSeconds: 2 } as const;

describe('readRecords, given a time window', () => {
  it('is refused as a window rather than as a range with no bounds', async () => {
    const recording = await opened();
    const thrown = await readRecords(recording, WINDOW as never).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown, 'the window was read as a records range').toBeDefined();
    expect(thrown?.message).toContain('readRecords(): the selection is a time window');
    expect(thrown?.message).not.toContain('start: undefined');
  });

  it('names the sibling that takes seconds, as 0.6.87 named the one that takes records', async () => {
    const recording = await opened();
    const thrown = await readRecords(recording, WINDOW as never).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown?.message).toContain('readWindow()');
    // Not the clamping advice: nothing about these bounds needs clamping.
    expect(thrown?.message).not.toContain('clamp the range');
  });

  it('spells out the selection it does take', async () => {
    const recording = await opened();
    const thrown = await readRecords(recording, WINDOW as never).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown?.message).toContain('{ records, signalIndices }');
  });

  it('still reads when the same window is resolved to records first', async () => {
    const recording = await opened();
    const chunk = await readRecords(recording, {
      signalIndices: [0],
      records: { start: 1, count: 2 },
    });
    expect(chunk.records).toEqual({ start: 1, count: 2 });
  });

  it('is not disturbed by a selection carrying both', async () => {
    const recording = await opened();
    // `records` wins: it is the field this call reads, and the guard only fires when there is none.
    const chunk = await readRecords(recording, {
      ...WINDOW,
      records: { start: 0, count: 1 },
    } as never);
    expect(chunk.records).toEqual({ start: 0, count: 1 });
  });
});

describe('the calls that do take seconds', () => {
  it('are untouched by the new branch', async () => {
    const recording = await opened();
    await expect(readWindow(recording, WINDOW)).resolves.toBeDefined();
    const first = await (async () => {
      for await (const chunk of streamRecords(recording, WINDOW)) return chunk;
      return undefined;
    })();
    expect(first).toBeDefined();
  });

  it('still say the opposite thing for a records range, which 0.6.87 added', async () => {
    const recording = await opened();
    await expect(
      readWindow(recording, { signalIndices: [0], records: { start: 0, count: 2 } } as never),
    ).rejects.toThrow(/the selection has a `records` range, and this call takes a time window/);
  });
});
