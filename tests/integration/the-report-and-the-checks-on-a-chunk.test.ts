/**
 * `formatHeader` and `validateHeader` given a chunk.
 *
 * Both were given a guard for a wrong first argument — 0.6.110 and 0.6.113 — and both guards test
 * `Array.isArray(header.signals)`. `EdfChunk` carries a `signals` array, so both let a chunk through
 * and failed the way each was written to stop failing:
 *
 * - `formatHeader(chunk)` reached `header.startTime.clockSource` and threw V8's `Cannot read
 *   properties of undefined`, which is verbatim the failure 0.6.110 names;
 * - `validateHeader(chunk)` walked `header.dataSignalIndices` and answered
 *   `header.dataSignalIndices is not iterable`, which is verbatim the failure 0.6.113 names —
 *   a leaked internal field, from the module whose subject is saying precisely what is wrong.
 *
 * A chunk is also the likeliest wrong argument for these two in particular: it is what a reader
 * holds after a read, and "print what I just read" and "check what I just read" are what the two
 * names offer.
 *
 * Being an array is not the test; being an array of the right signals is — the rule 0.6.183 settled
 * for the three lookups and 0.6.186 for `trimToWindow`.
 */

import { describe, expect, it } from 'vitest';
import { formatHeader } from '../../src/format-header.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { EdfChunk, EdfRecording } from '../../src/types.js';
import { validateHeader } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    { label: 'EEG Fpz-Cz', samplesPerRecord: 16 },
    { label: 'EMG Chin', samplesPerRecord: 8 },
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

const CALLS: ReadonlyArray<readonly [string, (header: unknown) => unknown]> = [
  ['formatHeader', (header) => formatHeader(header as never)],
  ['validateHeader', (header) => validateHeader(header as never)],
];

describe.each(CALLS)('%s, given the chunk a read resolved to', (_name, call) => {
  it('is refused as a chunk rather than failing on an internal field', async () => {
    const { chunk } = await opened();
    let thrown: Error | undefined;
    try {
      call(chunk);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect(thrown?.message).toContain('that is a chunk, not a header');
    expect(thrown?.message).toContain('Next: pass recording.header');
  });

  it('names neither of the internal fields the two used to leak', async () => {
    const { chunk } = await opened();
    const thrown = ((): Error | undefined => {
      try {
        call(chunk);
        return undefined;
      } catch (error) {
        return error as Error;
      }
    })();
    expect(thrown?.message).not.toContain('startTime');
    expect(thrown?.message).not.toContain('dataSignalIndices');
    expect(thrown?.message).not.toContain('Cannot read properties');
  });

  it('keeps the older refusal for a recording, which has no signals array', async () => {
    const { recording } = await opened();
    expect(() => call(recording)).toThrow(/it has no signals/);
  });

  it('still answers for the header itself', async () => {
    const { recording } = await opened();
    expect(call(recording.header)).toBeDefined();
  });
});

describe('the header itself', () => {
  it('still prints the signals it declares', async () => {
    const { recording } = await opened();
    const text = formatHeader(recording.header);
    expect(text).toContain('EEG Fpz-Cz');
    expect(text).toContain('EMG Chin');
  });

  it('still returns a diagnostics list rather than throwing', async () => {
    const { recording } = await opened();
    expect(Array.isArray(validateHeader(recording.header))).toBe(true);
  });
});
