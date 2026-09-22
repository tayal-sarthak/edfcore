/**
 * An envelope signal, told it carries samples it does not have.
 *
 * `assertSignal` guards the header signal for `toPhysical`, `physicalRangeOf`,
 * `clampToDigitalRange` and `toPhysicalEnvelope`, and it names a wrong one by testing
 * `signalIndex`. `EdfEnvelopeSignal` and `EdfChunkSignal` both carry that field — the ambiguity
 * `time/window.ts` names in full, where the two "share eight of their nine fields" — so an envelope
 * signal was called a chunk signal and told it "carries the samples rather than the declaration
 * they are scaled by".
 *
 * It carries no samples. An envelope holds the smallest and largest of each bucket, which is
 * exactly what `envelopeOfSamples` says when it refuses one: "an envelope carries the smallest and
 * largest sample of each bucket rather than the samples, so there is none here to fold."
 *
 * `toPhysicalEnvelope(signal, envelope)` is why an envelope signal reaches this guard at all. It is
 * the one call in the package whose two arguments are a header signal and an envelope signal, so
 * passing them the other way round is the slip it invites — and the reply then described the wrong
 * argument as a third thing the caller does not have either.
 *
 * `min` is what separates them, the same test `toPhysicalEnvelope` applies one line later to its
 * own second argument. A chunk signal keeps the sentence written for it.
 */

import { describe, expect, it } from 'vitest';
import { clampToDigitalRange, physicalRangeOf, toPhysical } from '../../src/decode/physical.js';
import { readEnvelope, toPhysicalEnvelope } from '../../src/envelope.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import type { EdfChunkSignal, EdfEnvelopeSignal, EdfSignal } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 16 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function shapes(): Promise<{
  signal: EdfSignal;
  chunkSignal: EdfChunkSignal;
  envelopeSignal: EdfEnvelopeSignal;
}> {
  const recording = await openEdf(byteSource(FILE));
  const window = { signalIndices: [0], startSeconds: 0, durationSeconds: 3 };
  const chunks = await readWindow(recording, window);
  const envelopes = await readEnvelope(recording, { ...window, buckets: 4 });
  return {
    signal: recording.header.signals[0] as EdfSignal,
    chunkSignal: chunks[0]?.signals[0] as EdfChunkSignal,
    envelopeSignal: envelopes[0]?.signals[0] as EdfEnvelopeSignal,
  };
}

const refusal = (call: () => unknown): Error => {
  let thrown: Error | undefined;
  try {
    call();
  } catch (error) {
    thrown = error as Error;
  }
  expect(thrown, 'nothing was refused').toBeDefined();
  return thrown as Error;
};

const CALLS: ReadonlyArray<
  readonly [string, (signal: unknown, all: Awaited<ReturnType<typeof shapes>>) => unknown]
> = [
  ['toPhysical', (signal) => toPhysical(signal as never, new Int32Array(4))],
  ['physicalRangeOf', (signal) => physicalRangeOf(signal as never)],
  ['clampToDigitalRange', (signal) => clampToDigitalRange(signal as never, new Int32Array(4))],
  ['toPhysicalEnvelope', (signal, all) => toPhysicalEnvelope(signal as never, all.envelopeSignal)],
];

describe.each(CALLS)('%s, given an envelope signal', (_name, call) => {
  it('no longer calls it a chunk signal', async () => {
    const all = await shapes();
    const thrown = refusal(() => call(all.envelopeSignal, all));
    expect(thrown.message).not.toContain('is a chunk signal');
    expect(thrown.message).toContain('the signal is an envelope signal');
  });

  it('says what an envelope actually carries', async () => {
    const all = await shapes();
    const thrown = refusal(() => call(all.envelopeSignal, all));
    expect(thrown.message).toContain('the smallest and largest sample of each bucket');
    expect(thrown.message).not.toContain('carries the samples rather than');
  });

  it('names the field that resolves it', async () => {
    const all = await shapes();
    const thrown = refusal(() => call(all.envelopeSignal, all));
    expect(thrown.message).toContain('header.signals[envelopeSignal.signalIndex]');
    expect(thrown).toBeInstanceOf(RangeError);
  });

  it('keeps the chunk sentence for a chunk signal', async () => {
    const all = await shapes();
    const thrown = refusal(() => call(all.chunkSignal, all));
    expect(thrown.message).toContain('is a chunk signal');
    expect(thrown.message).toContain('carries the samples rather than the declaration');
  });

  it('still answers for a header signal', async () => {
    const all = await shapes();
    expect(call(all.signal, all)).toBeDefined();
  });
});

describe('the slip that brings an envelope signal here', () => {
  it('is the two arguments of toPhysicalEnvelope, the other way round', async () => {
    const all = await shapes();
    const thrown = refusal(() =>
      toPhysicalEnvelope(all.envelopeSignal as never, all.signal as never),
    );
    expect(thrown.message).toContain('the envelope is the second argument, not the first');
  });

  it('still converts when they are the right way round', async () => {
    const all = await shapes();
    const physical = toPhysicalEnvelope(all.signal, all.envelopeSignal);
    expect(physical.min).toHaveLength(all.envelopeSignal.min.length);
  });
});

describe('the two shapes really are this close', () => {
  it('both carry signalIndex, which is why the old test could not tell them apart', async () => {
    const all = await shapes();
    expect(typeof all.chunkSignal.signalIndex).toBe('number');
    expect(typeof all.envelopeSignal.signalIndex).toBe('number');
  });

  it('and min is what separates them', async () => {
    const all = await shapes();
    expect(ArrayBuffer.isView(all.envelopeSignal.min)).toBe(true);
    expect(ArrayBuffer.isView((all.chunkSignal as { min?: unknown }).min)).toBe(false);
  });
});
