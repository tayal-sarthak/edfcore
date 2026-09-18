/**
 * `physicalRangeOf` asked for the annotations channel's bounds.
 *
 * The package is unusually explicit about those two fields. `parseSignalHeaders` deliberately does
 * not build a scale for an annotations channel, and `describeScalingFailure` records why: its
 * physical fields "describe nothing a caller may use", and checking them "would report a defect
 * about a number nobody may use". `toPhysical` therefore refuses such a signal with an
 * `EdfScalingError` that says exactly that.
 *
 * `physicalRangeOf` never reads `scale`, so it never met that refusal. It read the two fields
 * directly and returned `{ low: -1, high: 1 }` — the conventional pair a writer puts in an
 * annotation signal's header — as if it were a measurement range.
 *
 * Its own docblock is what makes that cost something: the result "is what a fixed axis or a gain
 * control should be built from". So a viewer built a y-axis, in units that do not exist, for a
 * channel that holds text.
 */

import { describe, expect, it } from 'vitest';
import { physicalRangeOf, toPhysical } from '../../../src/decode/physical.js';
import { EdfScalingError } from '../../../src/errors.js';
import { byteSource } from '../../../src/io/bytes.js';
import { openEdf } from '../../../src/recording.js';
import type { EdfHeader, EdfSignal } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function signals(): Promise<{ header: EdfHeader; data: EdfSignal; annotations: EdfSignal }> {
  const header = (await openEdf(byteSource(FILE))).header;
  const annotationsIndex = header.annotationSignalIndices[0] as number;
  return {
    header,
    data: header.signals[0] as EdfSignal,
    annotations: header.signals[annotationsIndex] as EdfSignal,
  };
}

describe('the annotations channel', () => {
  it('declares a physical pair, which is what made the answer look like one', async () => {
    const { annotations } = await signals();
    expect(annotations.kind).toBe('annotations');
    expect(Number.isFinite(annotations.physicalMinimum)).toBe(true);
    expect(Number.isFinite(annotations.physicalMaximum)).toBe(true);
    // And no scale was ever built from them, which is the whole point.
    expect(annotations.scale).toBeUndefined();
  });

  it('is refused rather than answered with a range', async () => {
    const { annotations } = await signals();
    let thrown: Error | undefined;
    try {
      physicalRangeOf(annotations);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown, 'an axis was returned for a channel holding text').toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain("is this file's annotations channel");
    expect(thrown?.message).toContain('Next:');
  });

  it('says why the pair is not a range, not merely that it was refused', async () => {
    const { annotations } = await signals();
    expect(() => physicalRangeOf(annotations)).toThrow(/describe nothing/);
    expect(() => physicalRangeOf(annotations)).toThrow(/header\.dataSignalIndices/);
  });

  it('agrees with toPhysical, which has always refused the same signal', async () => {
    const { annotations } = await signals();
    expect(() => toPhysical(annotations, [1, 2, 3])).toThrow(EdfScalingError);
    expect(() => physicalRangeOf(annotations)).toThrow(/annotations channel/);
  });
});

describe('a data signal', () => {
  it('still reports its declared bounds in ascending order', async () => {
    const { data } = await signals();
    const range = physicalRangeOf(data);
    expect(range.low).toBeLessThanOrEqual(range.high);
    expect(Number.isFinite(range.low)).toBe(true);
    expect(Number.isFinite(range.high)).toBe(true);
  });

  it('still refuses a chunk signal, which 0.6.104 added', async () => {
    expect(() => physicalRangeOf({ signalIndex: 0 } as never)).toThrow(
      /the signal is a chunk signal/,
    );
  });
});
