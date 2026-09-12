/**
 * The sample-grid family's two arguments, neither of which was checked.
 *
 * `gridSample*` takes the header's signal and the record duration in TICKS. A chunk signal — the
 * per-signal shape a reader holds after a read, and the one whose samples they are indexing — has no
 * `kind`, so the whole family answered V8's `Cannot read properties of undefined (reading 'kind')`.
 *
 * The ticks are the sharper of the two. `recordDurationSeconds` sits beside `recordDurationTicks` on
 * the same header, is a float, and reads as the obvious thing to pass. It reached
 * `recordDurationTicks <= 0n` and threw "Cannot mix BigInt and other types, use explicit
 * conversions" — which names neither the argument, nor the call, nor which of the two fields to use
 * (fixed in 0.6.112).
 *
 * This is `sample-locate.ts`'s fix from 0.6.101, on the pure half of the pair.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readRecords } from '../../src/recording.js';
import {
  gridSampleIndexAt,
  gridSampleStartSeconds,
  gridSampleStartTicks,
} from '../../src/sample-grid.js';
import type { EdfSignal } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const BYTES = buildEdf({
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

/** The cast a JavaScript caller does not need to write. */
const loosely = <T>(value: unknown) => value as T;

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the argument was accepted');
}

async function parts() {
  const recording = await openEdf(byteSource(BYTES));
  const chunk = await readRecords(recording, {
    records: { start: 0, count: 1 },
    signalIndices: [0],
  });
  const signal = recording.header.signals[0];
  const chunkSignal = chunk.signals[0];
  if (signal === undefined || chunkSignal === undefined) throw new Error('fixture is incomplete');
  return { header: recording.header, signal, chunkSignal };
}

const CALLS: ReadonlyArray<readonly [string, (signal: EdfSignal, ticks: bigint) => unknown]> = [
  ['gridSampleIndexAt', (signal, ticks) => gridSampleIndexAt(signal, 0.5, ticks)],
  ['gridSampleStartTicks', (signal, ticks) => gridSampleStartTicks(signal, 4, ticks)],
  ['gridSampleStartSeconds', (signal, ticks) => gridSampleStartSeconds(signal, 4, ticks)],
];

describe.each(CALLS)('%s', (name, call) => {
  it('names the chunk signal as what it is', async () => {
    const { header, chunkSignal } = await parts();
    const message = refusal(() =>
      call(loosely<EdfSignal>(chunkSignal), header.recordDurationTicks),
    );
    expect(message).toContain(`${name}(): the signal is an object, not one of header.signals`);
    expect(message).toContain('carries the samples rather than the grid they sit on');
  });

  it('names the seconds field handed where the ticks belong', async () => {
    const { header, signal } = await parts();
    const message = refusal(() => call(signal, loosely<bigint>(header.recordDurationSeconds)));
    expect(message).toContain(`${name}(): recordDurationTicks is 1, not a BigInt`);
    expect(message).toContain('Next: pass header.recordDurationTicks');
    expect(message).toContain('the seconds beside it on the same header are a float');
  });

  it('says nothing about mixing BigInt, which names no argument', async () => {
    const { header, signal } = await parts();
    expect(
      refusal(() => call(signal, loosely<bigint>(header.recordDurationSeconds))),
    ).not.toContain('Cannot mix BigInt');
  });

  it('reports its own name rather than the one it delegates to', async () => {
    const { header, chunkSignal } = await parts();
    const message = refusal(() =>
      call(loosely<EdfSignal>(chunkSignal), header.recordDurationTicks),
    );
    expect(message.startsWith(`${name}()`)).toBe(true);
  });

  it('still answers for the header signal and the ticks', async () => {
    const { header, signal } = await parts();
    expect(() => call(signal, header.recordDurationTicks)).not.toThrow();
  });
});

describe('the refusals the family already had', () => {
  it('still names an annotations channel, which is about the file rather than the call', async () => {
    const recording = await openEdf(
      byteSource(
        buildEdf({
          plus: 'C',
          recordCount: 2,
          recordDurationSeconds: 1,
          signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
          annotationSignals: [{ samplesPerRecord: 40 }],
        }),
      ),
    );
    const annotations = recording.header.signals[1];
    if (annotations === undefined) throw new Error('fixture has no annotations channel');
    expect(refusal(() => gridSampleStartTicks(annotations, 0, 10_000_000n))).toContain(
      'is an annotations channel',
    );
  });
});
