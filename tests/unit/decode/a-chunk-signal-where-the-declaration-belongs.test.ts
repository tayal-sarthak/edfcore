/**
 * The scaling family handed a chunk signal instead of the header's.
 *
 * `toPhysical(chunk.signals[0], chunk.signals[0].digital)` is the call the argument list suggests: a
 * reader who has just read a window has the chunk signal in hand, and its `digital` is the second
 * argument. It is the wrong first one — the scale lives on the header's declaration — and the two
 * shapes have no field in common that would say so.
 *
 * `toPhysical` took its no-gain branch, because a chunk signal has no `scale`, and `scalingError`
 * then read `signal.raw.digitalMinimum` off it: V8's `Cannot read properties of undefined`, thrown
 * from inside the builder of the error meant to explain the problem.
 *
 * `physicalRangeOf` got further and worse. It reported `signal undefined "undefined" declares
 * physical minimum "undefined" … Next: read header.diagnostics for this signal` — a complaint about
 * the FILE for a mistake in the argument, pointing at a signal that is not there (fixed in 0.6.104).
 */

import { describe, expect, it } from 'vitest';
import { clampToDigitalRange, physicalRangeOf, toPhysical } from '../../../src/decode/physical.js';
import { envelopeOfSamples, toPhysicalEnvelope } from '../../../src/envelope.js';
import { byteSource } from '../../../src/io/bytes.js';
import { openEdf, readRecords } from '../../../src/recording.js';
import type { EdfChunkSignal, EdfSignal } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

const BYTES = buildEdf({
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

async function parts(): Promise<{
  readonly signal: EdfSignal;
  readonly chunkSignal: EdfChunkSignal;
}> {
  const recording = await openEdf(byteSource(BYTES));
  const chunk = await readRecords(recording, {
    records: { start: 0, count: 1 },
    signalIndices: [0],
  });
  const signal = recording.header.signals[0];
  const chunkSignal = chunk.signals[0];
  if (signal === undefined || chunkSignal === undefined) throw new Error('fixture is incomplete');
  return { signal, chunkSignal };
}

/** The cast a JavaScript caller does not need to write. */
const asSignal = (value: unknown) => value as EdfSignal;

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the argument was accepted');
}

const CALLS: ReadonlyArray<readonly [string, (signal: EdfSignal) => unknown]> = [
  ['toPhysical', (signal) => toPhysical(signal, Int32Array.of(1, 2))],
  ['physicalRangeOf', (signal) => physicalRangeOf(signal)],
  ['clampToDigitalRange', (signal) => clampToDigitalRange(signal, Int32Array.of(1, 2))],
];

describe.each(CALLS)('%s', (name, call) => {
  it('names the chunk signal as what it is', async () => {
    const { chunkSignal } = await parts();
    const message = refusal(() => call(asSignal(chunkSignal)));
    expect(message).toContain(`${name}(): the signal is a chunk signal`);
    expect(message).toContain('rather than the declaration they are scaled by');
  });

  it('says nothing about the file, which is not what is wrong', async () => {
    const { chunkSignal } = await parts();
    const message = refusal(() => call(asSignal(chunkSignal)));
    expect(message).not.toContain('Cannot read properties');
    expect(message).not.toContain('read header.diagnostics for this signal');
    expect(message).not.toContain('signal undefined');
  });

  it('names where the declaration is', async () => {
    const { chunkSignal } = await parts();
    const message = refusal(() => call(asSignal(chunkSignal)));
    expect(message).toContain('Next: pass header.signals[chunkSignal.signalIndex]');
    expect(message).toContain('getSignal(header, label)');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['the whole chunk', 'chunk'],
  ])('refuses %s', async (_described, given) => {
    const { chunkSignal } = await parts();
    const value = given === 'chunk' ? { signals: [chunkSignal] } : given;
    expect(refusal(() => call(asSignal(value)))).toContain('not one of header.signals');
  });

  it('still works on the header signal', async () => {
    const { signal, chunkSignal } = await parts();
    expect(() => call(signal)).not.toThrow();
    expect(chunkSignal.signalIndex).toBe(signal.index);
  });
});

describe('the scaling refusal a real signal with no gain still gets', () => {
  it('is the EdfScalingError, not the new guard', async () => {
    const { signal } = await parts();
    const noGain: EdfSignal = { ...signal, scale: undefined };
    const message = refusal(() => toPhysical(noGain, Int32Array.of(1)));
    expect(message).toContain('Raw fields: digital minimum');
    expect(message).not.toContain('the signal is');
  });
});

describe('toPhysicalEnvelope, the fourth function that starts from signal.scale', () => {
  it('gives the same refusal the other three do', async () => {
    const { chunkSignal } = await parts();
    const envelope = { min: Float64Array.of(0), max: Float64Array.of(1), counts: Int32Array.of(1) };
    const message = refusal(() => toPhysicalEnvelope(asSignal(chunkSignal), envelope as never));
    expect(message).toContain('toPhysicalEnvelope(): the signal is a chunk signal');
    expect(message).not.toContain('Cannot read properties');
  });

  it('was the one 0.6.104 missed, so the family now answers as a family', async () => {
    const { signal, chunkSignal } = await parts();
    const envelope = { min: Float64Array.of(0), max: Float64Array.of(1), counts: Int32Array.of(1) };
    expect(() => toPhysicalEnvelope(signal, envelope as never)).not.toThrow();
    expect(refusal(() => toPhysicalEnvelope(asSignal(chunkSignal), envelope as never))).toBe(
      refusal(() => toPhysical(asSignal(chunkSignal), Int32Array.of(1))).replace(
        'toPhysical(',
        'toPhysicalEnvelope(',
      ),
    );
  });
});

describe('envelopeOfSamples, the mirror of the same mistake', () => {
  it('refuses the header signal, which carries no samples to fold', async () => {
    const { signal } = await parts();
    const message = refusal(() => envelopeOfSamples(signal as never, 4));
    expect(message).toContain('envelopeOfSamples(): the signal is a header signal');
    expect(message).toContain('carries no samples to fold');
    expect(message).toContain('Next: pass one element of chunk.signals');
  });

  it('still folds a real chunk signal', async () => {
    const { chunkSignal } = await parts();
    expect(envelopeOfSamples(chunkSignal, 4).min).toHaveLength(4);
  });
});
