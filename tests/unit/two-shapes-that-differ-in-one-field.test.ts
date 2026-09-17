/**
 * An envelope signal handed to the two calls that take a chunk signal.
 *
 * `EdfEnvelopeSignal` and `EdfChunkSignal` share eight of their nine fields — `signalIndex`,
 * `sampleCount`, `firstSampleIndex`, `startSeconds`, `startTicks` and `outOfDigitalRangeCount` among
 * them — and differ only in the one that holds the data: `digital` against `min`/`max`/`counts`.
 *
 * They are also reached identically. `readWindow` and `readEnvelope` both resolve to one chunk per
 * contiguous run with a `signals` array on it, so `chunk.signals[0]` is the expression either way,
 * and which of the two shapes it names depends on which read produced it — nothing at the call site.
 *
 * `assertChunkSignal` tests `signalIndex`, which they share. So an envelope signal walked through
 * and both callers read `.digital`, getting V8's `Cannot read properties of undefined (reading
 * 'length')` — an internal field, no `Next:` clause, nothing about the argument: the failure 0.6.97
 * added this guard to remove, arriving through it.
 *
 * `digital` is the field both callers read, so it is the field the guard now tests.
 */

import { describe, expect, it } from 'vitest';
import { envelopeOfSamples, readEnvelope } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { trimToWindow } from '../../src/time/window.js';
import type { EdfChunkSignal, EdfEnvelopeSignal, EdfHeader } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 16 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const WINDOW = { signalIndices: [0], startSeconds: 0, durationSeconds: 3 } as const;

async function bothShapes(): Promise<{
  header: EdfHeader;
  chunkSignal: EdfChunkSignal;
  envelopeSignal: EdfEnvelopeSignal;
}> {
  const recording = await openEdf(byteSource(FILE));
  const chunks = await readWindow(recording, WINDOW);
  const envelopes = await readEnvelope(recording, { ...WINDOW, buckets: 8 });
  return {
    header: recording.header,
    chunkSignal: chunks[0]?.signals[0] as EdfChunkSignal,
    envelopeSignal: envelopes[0]?.signals[0] as EdfEnvelopeSignal,
  };
}

const CALLS: ReadonlyArray<readonly [string, (header: EdfHeader, signal: unknown) => unknown]> = [
  ['envelopeOfSamples', (_header, signal) => envelopeOfSamples(signal as never, 4)],
  ['trimToWindow', (header, signal) => trimToWindow(header, signal as never, 0, 1)],
];

describe('the two per-signal shapes', () => {
  it('agree on every field but the one holding the data', async () => {
    const { chunkSignal, envelopeSignal } = await bothShapes();
    for (const field of [
      'signalIndex',
      'sampleCount',
      'firstSampleIndex',
      'startSeconds',
      'startTicks',
      'outOfDigitalRangeCount',
    ]) {
      expect(chunkSignal, field).toHaveProperty(field);
      expect(envelopeSignal, field).toHaveProperty(field);
    }
    expect(ArrayBuffer.isView(chunkSignal.digital)).toBe(true);
    expect((envelopeSignal as unknown as Record<string, unknown>).digital).toBeUndefined();
  });
});

describe.each(CALLS)('%s, given the envelope signal', (_name, call) => {
  it('is refused as an envelope rather than dying on .digital', async () => {
    const { header, envelopeSignal } = await bothShapes();
    let thrown: Error | undefined;
    try {
      call(header, envelopeSignal);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect(thrown?.message).toContain('that is an envelope signal, not a chunk signal');
    expect(thrown?.message).toContain('Next:');
  });

  it('names the reads whose signals it does take', async () => {
    const { header, envelopeSignal } = await bothShapes();
    expect(() => call(header, envelopeSignal)).toThrow(/readWindow\(\) or readRecords\(\)/);
  });

  it('still works on the chunk signal, which is the shape it wants', async () => {
    const { header, chunkSignal } = await bothShapes();
    expect(call(header, chunkSignal)).toBeDefined();
  });

  it('keeps the 0.6.97 refusal for a header signal', async () => {
    const { header } = await bothShapes();
    expect(() => call(header, header.signals[0])).toThrow(/a header signal, which carries no/);
  });
});
