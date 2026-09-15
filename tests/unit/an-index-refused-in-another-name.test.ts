/**
 * Two arguments of one call, described by two different functions.
 *
 * `gridSampleStartSeconds` is a one-line wrapper over `gridSampleStartTicks`, and it already
 * carried its own `assertGrid` for that reason — the comment above it cites 0.6.101: "a reader who
 * wrote this call should not be told about `gridSampleStartTicks`". That is why `assertGrid` takes
 * a `call` at all.
 *
 * The INDEX guard did not take one. It sat inside `gridSampleStartTicks`, hard-coding that name, so
 * one call to `gridSampleStartSeconds` produced a message naming `gridSampleStartSeconds` when the
 * signal was wrong and one naming `gridSampleStartTicks` when the index was — the two arguments of
 * the same call, answered by two different functions, on a module whose top docblock spends four
 * paragraphs on the fact that these names are load-bearing.
 *
 * "THE `grid` PREFIX IS LOAD-BEARING," that docblock says, because "you cannot call
 * `gridSampleStartSeconds` while believing you asked for elapsed recording time". A refusal that
 * hands the reader the other name undoes exactly that: they go looking for a call they did not make,
 * in a family where the neighbouring one measures a different quantity.
 *
 * A fractional index is the ordinary way in. `sampleRateHz` is a float on any record duration that
 * is not a power of ten — the module opens by saying so — and `Math.round` left off a derived index
 * is all it takes.
 */

import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../src/header/parse.js';
import {
  gridSampleIndexAt,
  gridSampleStartSeconds,
  gridSampleStartTicks,
} from '../../src/sample-grid.js';
import type { EdfHeader, EdfSignal } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const BYTES = buildEdf({
  recordCount: 2,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});
const header: EdfHeader = parseHeader(BYTES, BYTES.length);
const signal = header.signals[0] as EdfSignal;
const duration = header.recordDurationTicks;

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the value was accepted');
}

describe('a fractional index handed to the seconds form', () => {
  it('is refused in the name of the call that was written', () => {
    const message = refusal(() => gridSampleStartSeconds(signal, 1.5, duration));
    expect(message).toContain('gridSampleStartSeconds():');
    expect(message).not.toContain('gridSampleStartTicks');
  });

  it('describes the value and keeps the advice the family shares', () => {
    const message = refusal(() => gridSampleStartSeconds(signal, 1.5, duration));
    expect(message).toContain('received 1.5');
    expect(message).toContain("this family measures the signal's own grid");
  });
});

describe('the two arguments of one call', () => {
  it('are now answered by the same name', () => {
    // The signal has always been answered by the call the reader wrote; the index was not.
    const badSignal = refusal(() =>
      (gridSampleStartSeconds as unknown as (s: unknown, i: number, d: bigint) => number)(
        {},
        0,
        duration,
      ),
    );
    const badIndex = refusal(() => gridSampleStartSeconds(signal, 0.5, duration));
    expect(badSignal).toContain('gridSampleStartSeconds():');
    expect(badIndex).toContain('gridSampleStartSeconds():');
  });
});

describe('the rest of the family is unchanged', () => {
  it('still names itself when it is the call that was written', () => {
    expect(refusal(() => gridSampleStartTicks(signal, 1.5, duration))).toContain(
      'gridSampleStartTicks():',
    );
  });

  it('still resolves a whole index, in both units', () => {
    expect(gridSampleStartTicks(signal, 8, duration)).toBe(10_000_000n);
    expect(gridSampleStartSeconds(signal, 8, duration)).toBe(1);
    expect(gridSampleIndexAt(signal, 1, duration).sampleIndex).toBe(8);
  });
});
