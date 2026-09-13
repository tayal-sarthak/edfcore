/**
 * The header argument of `trimToWindow`.
 *
 * Its other argument is a chunk signal, and on what a reader actually holds the two live one field
 * apart: `recording.header` and `chunk.signals[i]`. So `trimToWindow(recording, chunkSignal, ...)`
 * is the call that gets written, and it went straight into `header.signals[signalIndex]` and threw
 * V8's `Cannot read properties of undefined (reading '0')`.
 *
 * That message names the SIGNAL INDEX — which `trimToWindow` read off the chunk signal itself, so
 * it is the one value in the call nobody could have got wrong. `the-wrong-signal-shape.test.ts`
 * already holds the other half of this function's argument pair to the same standard.
 *
 * 0.6.127 swept this out of `header/lookup.ts`'s three entry points; this was the last function in
 * the package that took a header and never looked at it.
 */

import { describe, expect, it } from 'vitest';
import { isEdfError } from '../../../src/errors.js';
import { byteSource } from '../../../src/io/bytes.js';
import { openEdf, readRecords } from '../../../src/recording.js';
import { trimToWindow } from '../../../src/time/window.js';
import type { EdfChunkSignal, EdfHeader, EdfRecording } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'A1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function read(): Promise<{ recording: EdfRecording; chunkSignal: EdfChunkSignal }> {
  const recording = await openEdf(byteSource(FILE));
  const chunk = await readRecords(recording, {
    signalIndices: [0],
    records: { start: 0, count: 4 },
  });
  return { recording, chunkSignal: chunk.signals[0] as EdfChunkSignal };
}

const trim = (header: unknown, chunkSignal: EdfChunkSignal): unknown =>
  (trimToWindow as unknown as (h: unknown, c: EdfChunkSignal, s: number, d: number) => unknown)(
    header,
    chunkSignal,
    0,
    1,
  );

describe('trimToWindow given the recording', () => {
  it('throws a RangeError rather than a TypeError', async () => {
    const { recording, chunkSignal } = await read();
    expect(() => trim(recording, chunkSignal)).toThrow(RangeError);
    expect(() => trim(recording, chunkSignal)).not.toThrow(TypeError);
  });

  it('is a caller mistake, so isEdfError says false', async () => {
    const { recording, chunkSignal } = await read();
    let thrown: unknown;
    try {
      trim(recording, chunkSignal);
    } catch (error) {
      thrown = error;
    }
    expect(isEdfError(thrown)).toBe(false);
  });

  it('names the call, says what a header is needed for, and points at it', async () => {
    const { recording, chunkSignal } = await read();
    expect(() => trim(recording, chunkSignal)).toThrow(
      /^trimToWindow\(\): that is not a header — it has no signals/,
    );
    expect(() => trim(recording, chunkSignal)).toThrow(/Next: pass recording\.header\.$/);
  });

  it('does not blame the signal index, which it read off the chunk signal itself', async () => {
    const { recording, chunkSignal } = await read();
    expect(() => trim(recording, chunkSignal)).not.toThrow(/Cannot read properties|reading '0'/);
  });

  it('names an absent header the same way', async () => {
    const { chunkSignal } = await read();
    expect(() => trim(undefined, chunkSignal)).toThrow(/that is not a header — it has no signals/);
  });

  it('still trims with the header the chunk was read with', async () => {
    const { recording, chunkSignal } = await read();
    const trimmed = trimToWindow(recording.header as EdfHeader, chunkSignal, 0, 1);
    expect(trimmed.sampleCount).toBe(8);
  });
});
