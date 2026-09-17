/**
 * The three lookups given a chunk, whose `signals` array holds the other per-signal shape.
 *
 * 0.6.127 gave `getSignal`, `findSignals` and `matchSignals` a shared guard and made the argument
 * for it: without one they "reached `header.signals` and threw V8's `Cannot read properties of
 * undefined (reading 'filter')`". The guard tests `Array.isArray(header.signals)`.
 *
 * `EdfChunk` has a `signals` array too. It is the only other one in the package, and it holds
 * `EdfChunkSignal`s — the samples of each channel, not the declarations. So being an array was the
 * whole test, and a chunk passed it:
 *
 * - `findSignals(chunk, 'EEG Fpz-Cz')` and `matchSignals(chunk, /EEG/)` returned `[]`, which is a
 *   real answer from these two and means "this file has no such channel" — said of a file that has
 *   one, because a chunk signal carries no `label` to match;
 * - `getSignal(chunk, 0)` returned the chunk signal itself, typed `EdfSignal`, so the wrong object
 *   travelled on under the right type;
 * - `getSignal(chunk, 'EEG Fpz-Cz')` reached `quoteLabels` and threw V8's `Cannot read properties
 *   of undefined (reading 'length')` — the exact failure 0.6.127 removed.
 *
 * Being an array of the right signals is the test. `index` is on a header signal and `signalIndex`
 * on a chunk one, which is the distinction `assertChunkSignal` has drawn from the other side since
 * 0.6.97.
 */

import { describe, expect, it } from 'vitest';
import { findSignals, getSignal, matchSignals } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { EdfChunk, EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fpz-Cz', samplesPerRecord: 8 },
    { label: 'EEG Pz-Oz', samplesPerRecord: 8 },
  ],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function opened(): Promise<{ recording: EdfRecording; chunk: EdfChunk }> {
  const recording = await openEdf(byteSource(FILE));
  const chunks = await readWindow(recording, {
    signalIndices: [0, 1],
    startSeconds: 0,
    durationSeconds: 2,
  });
  return { recording, chunk: chunks[0] as EdfChunk };
}

const LOOKUPS: ReadonlyArray<readonly [string, (header: unknown) => unknown]> = [
  ['findSignals', (header) => findSignals(header as never, 'EEG Fpz-Cz')],
  ['matchSignals', (header) => matchSignals(header as never, /EEG/)],
  ['getSignal by index', (header) => getSignal(header as never, 0)],
  ['getSignal by label', (header) => getSignal(header as never, 'EEG Fpz-Cz')],
];

describe('the chunk a read resolved to', () => {
  it('carries the signals array the 0.6.127 guard looks for, holding the other shape', async () => {
    const { chunk } = await opened();
    expect(Array.isArray(chunk.signals)).toBe(true);
    expect(typeof chunk.signals[0]?.signalIndex).toBe('number');
    expect((chunk.signals[0] as unknown as Record<string, unknown>).index).toBeUndefined();
    expect((chunk.signals[0] as unknown as Record<string, unknown>).label).toBeUndefined();
  });

  describe.each(LOOKUPS)('%s', (_name, call) => {
    it('is refused as a chunk rather than answered about the samples', async () => {
      const { chunk } = await opened();
      let thrown: Error | undefined;
      try {
        call(chunk);
      } catch (error) {
        thrown = error as Error;
      }
      expect(thrown, 'the lookup answered from the samples').toBeDefined();
      expect(thrown).toBeInstanceOf(RangeError);
      expect(thrown?.message).toContain('that is a chunk, not a header');
      expect(thrown?.message).toContain('Next:');
    });

    it('names the way back from a chunk to a declaration', async () => {
      const { chunk } = await opened();
      expect(() => call(chunk)).toThrow(/header\.signals\[chunkSignal\.signalIndex\]/);
    });
  });
});

describe('the header itself', () => {
  it('still finds a channel by label', async () => {
    const { recording } = await opened();
    expect(findSignals(recording.header, 'EEG Fpz-Cz').length).toBe(1);
    expect(matchSignals(recording.header, /EEG/).length).toBe(2);
    expect(getSignal(recording.header, 'EEG Pz-Oz').index).toBe(1);
    expect(getSignal(recording.header, 0).label).toBe('EEG Fpz-Cz');
  });

  it('still answers [] for a channel this file really does not have', async () => {
    const { recording } = await opened();
    expect(findSignals(recording.header, 'ECG').length).toBe(0);
    expect(matchSignals(recording.header, /ECG/).length).toBe(0);
  });

  it('keeps the 0.6.127 refusal for a recording, which has no signals array', async () => {
    const { recording } = await opened();
    expect(() => getSignal(recording as never, 0)).toThrow(/it has no signals/);
    expect(() => findSignals(recording as never, 'EEG Fpz-Cz')).toThrow(/it has no signals/);
    expect(() => matchSignals(recording as never, /EEG/)).toThrow(/it has no signals/);
  });
});
