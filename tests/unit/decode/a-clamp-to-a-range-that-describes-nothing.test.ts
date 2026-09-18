/**
 * `clampToDigitalRange` given the annotations channel.
 *
 * This function exists "to reproduce a clamping consumer (EDFlib clamps silently on read; edfcore
 * does not) when cross-validating against one", and the consumer it reproduces clamps SAMPLES. An
 * annotations region holds EDF+ TAL text, so the only way to have values to hand it is to have
 * decoded that text as samples — which every reader in the package refuses, and which
 * `decodeDigital` itself refuses as of 0.6.191.
 *
 * It read the digital pair anyway and clamped to it. That pair is the conventional one a writer puts
 * in an annotation signal's header: `parseSignalHeaders` never built a scale from it, and
 * `describeScalingFailure` says checking those fields "would report a defect about a number nobody
 * may use".
 *
 * 0.6.194 closed the same hole in `physicalRangeOf`, which reads the other pair on the same signal.
 * This is the second of the two, and it completes the set — `toPhysical` has refused an annotations
 * channel since it started from `scale`.
 */

import { describe, expect, it } from 'vitest';
import { clampToDigitalRange, physicalRangeOf, toPhysical } from '../../../src/decode/physical.js';
import { byteSource } from '../../../src/io/bytes.js';
import { openEdf } from '../../../src/recording.js';
import type { EdfSignal } from '../../../src/types.js';
import { buildEdf } from '../../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 8 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

async function signals(): Promise<{ data: EdfSignal; annotations: EdfSignal }> {
  const header = (await openEdf(byteSource(FILE))).header;
  const annotationsIndex = header.annotationSignalIndices[0] as number;
  return {
    data: header.signals[0] as EdfSignal,
    annotations: header.signals[annotationsIndex] as EdfSignal,
  };
}

const SAMPLES = Int32Array.from([-40000, -1, 0, 1, 40000]);

describe('the annotations channel', () => {
  it('declares a digital pair, which is what it used to clamp to', async () => {
    const { annotations } = await signals();
    expect(annotations.kind).toBe('annotations');
    expect(Number.isFinite(annotations.digitalMinimum)).toBe(true);
    expect(Number.isFinite(annotations.digitalMaximum)).toBe(true);
  });

  it('is refused rather than used as a range', async () => {
    const { annotations } = await signals();
    let thrown: Error | undefined;
    try {
      clampToDigitalRange(annotations, SAMPLES);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown, 'the samples were clamped to a pair that describes nothing').toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain("is this file's annotations channel");
    expect(thrown?.message).toContain('Next:');
  });

  it('says there are no samples to clamp, and names the reader for that channel', async () => {
    const { annotations } = await signals();
    expect(() => clampToDigitalRange(annotations, SAMPLES)).toThrow(/no samples to clamp/);
    expect(() => clampToDigitalRange(annotations, SAMPLES)).toThrow(/readAnnotations\(\)/);
  });

  it('now agrees with the other two functions in this module', async () => {
    const { annotations } = await signals();
    expect(() => toPhysical(annotations, SAMPLES)).toThrow(/annotations channel/);
    expect(() => physicalRangeOf(annotations)).toThrow(/annotations channel/);
    expect(() => clampToDigitalRange(annotations, SAMPLES)).toThrow(/annotations channel/);
  });
});

describe('a data signal', () => {
  it('still clamps to its declared range', async () => {
    const { data } = await signals();
    const clamped = clampToDigitalRange(data, SAMPLES);
    const low = Math.min(data.digitalMinimum, data.digitalMaximum);
    const high = Math.max(data.digitalMinimum, data.digitalMaximum);
    expect(clamped[0]).toBe(low);
    expect(clamped[4]).toBe(high);
    expect(clamped[2]).toBe(0);
  });

  it('still fills a reused out array', async () => {
    const { data } = await signals();
    const out = new Int32Array(SAMPLES.length);
    expect(clampToDigitalRange(data, SAMPLES, out)).toBe(out);
  });

  it('still refuses a chunk signal, which 0.6.104 added', () => {
    expect(() => clampToDigitalRange({ signalIndex: 0 } as never, SAMPLES)).toThrow(
      /the signal is a chunk signal/,
    );
  });
});
