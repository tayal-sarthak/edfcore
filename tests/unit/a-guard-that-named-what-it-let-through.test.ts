/**
 * `trimToWindow` given the chunk both of its first two arguments came off.
 *
 * The call is `trimToWindow(header, chunkSignal, startSeconds, durationSeconds)`, and the second
 * argument is spelled `chunk.signals[i]` at every call site — so the chunk is what a reader has in
 * hand, and `trimToWindow(chunk, chunk.signals[i], …)` is the pair that gets written.
 *
 * The guard on the first argument tests `Array.isArray(header.signals)`, and its own message says
 * this call "needs the samples-per-record the chunk signal does not carry". A chunk's `signals`
 * array holds exactly those chunk signals. So the guard named the shape it was about to let
 * through: `chunk.signals[signalIndex]` was defined, the lookup succeeded, and a CHUNK signal came
 * back typed as an `EdfSignal`. Its `samplesPerRecord` is `undefined`, and the trim arithmetic
 * reached `BigInt(undefined)` — V8's `Cannot convert undefined to a BigInt`, with no `Next:` clause
 * and nothing about the argument.
 *
 * 0.6.183 made the same fix for the three lookups in `header/lookup.ts`, on the same rule: being an
 * array is not the test, being an array of the right signals is.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { trimToWindow } from '../../src/time/window.js';
import type { EdfChunk, EdfChunkSignal, EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 16 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function opened(): Promise<{
  recording: EdfRecording;
  chunk: EdfChunk;
  chunkSignal: EdfChunkSignal;
}> {
  const recording = await openEdf(byteSource(FILE));
  const chunks = await readWindow(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 3,
  });
  const chunk = chunks[0] as EdfChunk;
  return { recording, chunk, chunkSignal: chunk.signals[0] as EdfChunkSignal };
}

describe('the chunk both arguments came off', () => {
  it('holds, in its signals array, exactly what the old message named', async () => {
    const { chunk, chunkSignal } = await opened();
    expect(chunk.signals[0]).toBe(chunkSignal);
    expect((chunkSignal as unknown as Record<string, unknown>).samplesPerRecord).toBeUndefined();
  });

  it('is refused as a chunk rather than dying on the trim arithmetic', async () => {
    const { chunk, chunkSignal } = await opened();
    let thrown: Error | undefined;
    try {
      trimToWindow(chunk as never, chunkSignal, 0, 1);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect(thrown?.message).not.toContain('BigInt');
    expect(thrown?.message).toContain('that is a chunk, not a header');
    expect(thrown?.message).toContain('Next:');
  });

  it('says to keep the second argument where it is', async () => {
    const { chunk, chunkSignal } = await opened();
    expect(() => trimToWindow(chunk as never, chunkSignal, 0, 1)).toThrow(
      /keep chunk\.signals\[i\] as the second argument/,
    );
  });
});

describe('the header itself', () => {
  it('still trims to the window on the signal’s own grid', async () => {
    const { recording, chunkSignal } = await opened();
    const trimmed = trimToWindow(recording.header, chunkSignal, 1, 1);
    expect(trimmed.sampleCount).toBe(16);
    expect(trimmed.firstSampleIndex).toBe(16);
  });

  it('keeps the older refusal for something with no signals at all', async () => {
    const { recording, chunkSignal } = await opened();
    expect(() => trimToWindow(recording as never, chunkSignal, 0, 1)).toThrow(/it has no signals/);
  });

  it('keeps naming a header signal passed where the chunk signal belongs', async () => {
    const { recording } = await opened();
    expect(() =>
      trimToWindow(recording.header, recording.header.signals[0] as never, 0, 1),
    ).toThrow(/a header signal, which carries no samples to trim/);
  });
});
