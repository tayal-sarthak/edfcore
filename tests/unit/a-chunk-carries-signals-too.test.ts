/**
 * `getStatusSignal` given a chunk, which has a `signals` array of its own.
 *
 * 0.6.120 gave this function a guard and stated exactly why it needs one: `undefined` is its own
 * answer for a file with no Status channel, so "a wrong argument must not be able to produce it".
 * The guard tests `Array.isArray(header.signals)`.
 *
 * `EdfChunk` carries `signals` too — the per-signal samples a read fills — so it walks straight
 * through and reaches the next line, `header.bytesPerSample !== 3`. A chunk has no
 * `bytesPerSample`, so the not-a-BDF branch was taken and the call answered `undefined`: no Status
 * channel, for a BDF+ file that has one. The guard written to make that unreachable was defeated by
 * the one object a reader is most likely to hold beside the header.
 *
 * Every trigger in the recording then reads as absent, on the one path in this package where a
 * missing event is indistinguishable from no events — which is what `readTriggers` and this
 * function's own docblock each say twice.
 *
 * The fix tests the field the call actually READS FIRST. `signals` is not touched until three lines
 * later; `bytesPerSample` is what decides everything above it.
 */

import { describe, expect, it } from 'vitest';
import { getStatusSignal, readTriggers } from '../../src/biosemi.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { EdfChunk, EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

/** A BDF+ that really does carry a Status channel, which is what makes the silence cost. */
const WITH_STATUS = buildEdf({
  format: 'BDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'A1', samplesPerRecord: 8 },
    { label: 'Status', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

/** A plain EDF, where `undefined` is the true answer and has to stay one. */
const WITHOUT_STATUS = buildEdf({
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

async function chunkOf(bytes: Uint8Array): Promise<{ recording: EdfRecording; chunk: EdfChunk }> {
  const recording = await openEdf(byteSource(bytes));
  const chunks = await readWindow(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 2,
  });
  return { recording, chunk: chunks[0] as EdfChunk };
}

describe('the chunk a read resolved to', () => {
  it('carries the signals array the 0.6.120 guard looks for', async () => {
    const { chunk } = await chunkOf(WITH_STATUS);
    expect(Array.isArray(chunk.signals)).toBe(true);
    // And not the field this call reads first.
    expect((chunk as unknown as Record<string, unknown>).bytesPerSample).toBeUndefined();
  });

  it('is refused rather than answered with undefined', async () => {
    const { chunk } = await chunkOf(WITH_STATUS);
    let thrown: Error | undefined;
    try {
      getStatusSignal(chunk as never);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown, 'a BDF+ with a Status channel was reported as having none').toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain('that is a chunk, not a header');
    expect(thrown?.message).toContain('Next:');
  });

  it('is refused on a plain EDF too, where undefined would have been right by luck', async () => {
    const { chunk } = await chunkOf(WITHOUT_STATUS);
    expect(() => getStatusSignal(chunk as never)).toThrow(/that is a chunk, not a header/);
  });
});

describe('the header itself', () => {
  it('still finds the Status channel', async () => {
    const { recording } = await chunkOf(WITH_STATUS);
    expect(getStatusSignal(recording.header)?.label).toBe('Status');
  });

  it('still answers undefined for a file that really has none', async () => {
    const { recording } = await chunkOf(WITHOUT_STATUS);
    expect(getStatusSignal(recording.header)).toBeUndefined();
  });

  it('keeps the 0.6.120 refusal for a recording, which has no signals array', async () => {
    const { recording } = await chunkOf(WITH_STATUS);
    expect(() => getStatusSignal(recording as never)).toThrow(/it has no signals/);
  });

  it('still lets readTriggers reach the channel through it', async () => {
    const { recording } = await chunkOf(WITH_STATUS);
    const events = await readTriggers(recording, { startSeconds: 0, durationSeconds: 4 });
    expect(events.length).toBeGreaterThan(0);
  });
});
