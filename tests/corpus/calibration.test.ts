/**
 * The calibration file from the format's own author.
 *
 * `calib.rec` was written by Bob Kemp — who wrote the EDF specification — and published on
 * edfplus.info expressly to "help check the calibration of amplitude (including polarity) and time
 * of your EDF viewer". It is the closest thing this format has to a conformance test, and it is
 * the only fixture in this suite whose expected values come from neither edfcore nor another
 * library, but from the file's own design.
 *
 * The design is what makes it usable that way. The declared range is ±100 µV over ±4096 digital
 * units, so the gain is 200/8192 = 25/1024 = 25 × 2^-10 — a small integer over a power of two,
 * which is exactly representable in binary — and the offset works out to exactly zero. Every
 * physical value is therefore exact in float64 and lands on a round number a human can check by
 * hand: digital -2048 is -50 µV, and nothing about that depends on which expression a reader uses.
 *
 * POLARITY is the point the file exists to make. A reader that swapped the physical bounds would
 * still produce plausible microvolts of the right magnitude — and the wrong sign, which in clinical
 * neurophysiology inverts the interpretation of the trace. That is why the assertions below are on
 * signed values at named sample positions rather than on amplitude alone.
 *
 * Skips without the corpus. `npm run corpus:fetch`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../src/decode/physical.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';

const FILE = join(dirname(fileURLToPath(import.meta.url)), 'files', 'calib.rec');
const maybe = existsSync(FILE) ? it : it.skip;

async function calibration() {
  const recording = await openEdf(byteSource(new Uint8Array(readFileSync(FILE))));
  const signal = recording.header.signals[0];
  if (signal === undefined) throw new Error('the calibration file has no signal');
  const [chunk] = await readWindow(recording, {
    signalIndices: [0],
    startSeconds: 0,
    durationSeconds: recording.timeline.spanSeconds,
  });
  const digital = chunk?.signals[0]?.digital;
  if (digital === undefined) throw new Error('no samples');
  return { recording, signal, digital, physical: toPhysical(signal, digital) };
}

describe('the calibration file', () => {
  maybe('declares the geometry its readme describes', async () => {
    // Stated from the file so the assertions below cannot pass against something else.
    const { recording, signal } = await calibration();
    expect(recording.header.recordCount).toBe(2);
    expect(recording.header.recordDurationSeconds).toBe(10);
    expect(signal.label).toBe('Calibration');
    expect(signal.physicalDimension.trim()).toBe('uV');
    expect(signal.physicalMinimum).toBe(-100);
    expect(signal.physicalMaximum).toBe(100);
    expect(signal.digitalMinimum).toBe(-4096);
    expect(signal.digitalMaximum).toBe(4096);
    expect(signal.sampleRateHz).toBe(100);
  });

  maybe('derives a gain that is exact in binary, so every value is exact', async () => {
    // 200/8192 = 25/1024 = 25 * 2^-10. NOT a power of two — that was the first guess and it is
    // wrong, log2 of it is -5.356... — but a small integer over a power of two, which is exactly
    // representable in float64. That is the property letting the rest of this file assert round
    // numbers rather than tolerances, and it is a property of this FILE rather than of EDF.
    const { signal } = await calibration();
    const bitValue = signal.scale?.bitValue ?? 0;
    expect(bitValue).toBe(0.0244140625);
    expect(signal.scale?.offset).toBe(0);

    // Exactly representable: scaling by 2^10 lands on an integer, with no rounding.
    expect(bitValue * 1024).toBe(25);
    expect(Number.isInteger(bitValue * 1024)).toBe(true);
    // And it is genuinely not a power of two, which is worth pinning so nobody "simplifies" the
    // comment above back into the wrong claim.
    expect(Number.isInteger(Math.log2(bitValue))).toBe(false);
  });

  maybe('converts the calibration levels to the exact microvolts they encode', async () => {
    // The numbers a human can verify from the header alone: -2048 units is a quarter of the
    // 8192-unit range below zero, and the range is 200 uV, so it is exactly -50 uV.
    const { physical, digital } = await calibration();
    expect(digital[0]).toBe(-2048);
    expect(physical[0]).toBe(-50);

    // Every distinct level in the file, checked against digital * bitValue with no tolerance.
    const seen = new Map<number, number>();
    for (let i = 0; i < digital.length; i += 1) {
      seen.set(digital[i] as number, physical[i] as number);
    }
    for (const [code, value] of seen) {
      expect(value, `digital ${code}`).toBe(code * 0.0244140625);
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  maybe('keeps the polarity the file exists to check', async () => {
    // A reader that swapped the physical bounds would return the right magnitudes with the wrong
    // sign — plausible microvolts that invert the clinical reading of the trace. The extremes are
    // ±75 uV, and which end is which is the assertion.
    const { physical, digital } = await calibration();

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let digitalAtMin = 0;
    let digitalAtMax = 0;
    for (let i = 0; i < physical.length; i += 1) {
      const value = physical[i] as number;
      if (value < min) {
        min = value;
        digitalAtMin = digital[i] as number;
      }
      if (value > max) {
        max = value;
        digitalAtMax = digital[i] as number;
      }
    }

    expect(min).toBe(-75);
    expect(max).toBe(75);
    // The negative extreme comes from the negative digital code, not the positive one. That is
    // the whole claim: a positive gain preserves sign.
    expect(digitalAtMin).toBeLessThan(0);
    expect(digitalAtMax).toBeGreaterThan(0);
    expect(digitalAtMin).toBe(-3072);
    expect(digitalAtMax).toBe(3072);
  });

  maybe('places the samples on the time axis the header declares', async () => {
    // The other half of what the file checks: time. 100 Hz over two ten-second records.
    const { recording, digital } = await calibration();
    expect(digital.length).toBe(2000);
    expect(recording.timeline.spanSeconds).toBe(20);

    const [second] = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 10,
      durationSeconds: 10,
    });
    expect(second?.records).toEqual({ start: 1, count: 1 });
    expect(second?.startSeconds).toBe(10);
    expect(second?.signals[0]?.firstSampleIndex).toBe(1000);
  });
});
