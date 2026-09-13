/**
 * The second argument of `toPhysicalEnvelope`.
 *
 * The first one has been swept twice. 0.6.104 guarded the signal argument of `toPhysical`,
 * `physicalRangeOf` and `clampToDigitalRange`; 0.6.117 guarded `envelopeOfSamples`; and
 * `toPhysicalEnvelope`'s own guard carries the note "the sibling 0.6.104 missed". None of that
 * touched the envelope itself.
 *
 * `readEnvelope` resolves to one `EdfEnvelopeChunk` per contiguous run, and the envelopes hang off
 * each chunk as `.signals`. So the value a caller has in hand is the chunk, the value this takes
 * is one element of its `.signals`, and `toPhysicalEnvelope(signal, chunk)` is the call that gets
 * written. It reached `envelope.min.length` and answered V8's `Cannot read properties of undefined
 * (reading 'length')` — which names `length`, a field on neither argument.
 *
 * `envelopeOfSamples` returns the right shape directly, so the two producers disagree about what
 * a caller holds, which is what makes the mistake worth naming rather than guessing at.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelope, toPhysicalEnvelope } from '../../src/envelope.js';
import { isEdfError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfEnvelopeChunk, EdfSignal } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'A1', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function read(): Promise<{ signal: EdfSignal; chunk: EdfEnvelopeChunk }> {
  const recording = await openEdf(byteSource(FILE));
  const chunks = await readEnvelope(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: 4,
    buckets: 4,
  });
  return {
    signal: recording.header.signals[0] as EdfSignal,
    chunk: chunks[0] as EdfEnvelopeChunk,
  };
}

const convert = (signal: EdfSignal, envelope: unknown): unknown =>
  (toPhysicalEnvelope as unknown as (s: EdfSignal, e: unknown) => unknown)(signal, envelope);

describe('toPhysicalEnvelope given the envelope chunk', () => {
  it('throws a RangeError rather than a TypeError', async () => {
    const { signal, chunk } = await read();
    expect(() => convert(signal, chunk)).toThrow(RangeError);
    expect(() => convert(signal, chunk)).not.toThrow(TypeError);
  });

  it('is a caller mistake, so isEdfError says false', async () => {
    const { signal, chunk } = await read();
    let thrown: unknown;
    try {
      convert(signal, chunk);
    } catch (error) {
      thrown = error;
    }
    expect(isEdfError(thrown)).toBe(false);
  });

  it('names the call, what it was handed, and the field that carries the envelopes', async () => {
    const { signal, chunk } = await read();
    expect(() => convert(signal, chunk)).toThrow(
      /^toPhysicalEnvelope\(\): the envelope is an envelope chunk, which carries one envelope per signal on \.signals/,
    );
    expect(() => convert(signal, chunk)).toThrow(
      /Next: pass one element of chunk\.signals — the array readEnvelope\(\) fills\.$/,
    );
  });

  it('says nothing about the field it happened to read first', async () => {
    const { signal, chunk } = await read();
    expect(() => convert(signal, chunk)).not.toThrow(/Cannot read properties|reading 'length'/);
  });

  it('names an absent envelope as itself rather than as a chunk', async () => {
    const { signal } = await read();
    expect(() => convert(signal, undefined)).toThrow(/the envelope is undefined with no min on it/);
    expect(() => convert(signal, undefined)).not.toThrow(/envelope chunk/);
  });

  it('still converts the envelope the chunk carries', async () => {
    const { signal, chunk } = await read();
    const physical = toPhysicalEnvelope(signal, chunk.signals[0] as never);
    expect(physical.min).toHaveLength(4);
    expect(physical.max).toHaveLength(4);
  });
});
