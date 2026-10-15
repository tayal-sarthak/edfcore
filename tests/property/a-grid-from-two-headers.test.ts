/**
 * The grid family's two arguments, checked against each other — and the tolerance measured rather
 * than guessed.
 *
 * `gridSampleIndexAt(signal, seconds, recordDurationTicks)` takes the signal and the record duration
 * separately, and only the caller pairs them. Mix them and the answer is silently wrong by the ratio
 * of the two durations: a 10 Hz signal asked with another file's 2 s ticks answers `sampleIndex: 5`
 * at t = 1 s where the truth is 10. No throw, no diagnostic, half the index. `decodeDigital` refuses
 * the analogous bytes-against-records mismatch and says why — it "cannot tell which record a
 * differently sized buffer begins at, so it will not guess".
 *
 * This was found in the twelfth batch and deliberately NOT shipped then, because the only bridge
 * between the two arguments is `sampleRateHz`, a float — the header parses `recordDurationSeconds`
 * from the field independently of `recordDurationTicks`. The reasoning recorded at the time was that
 * for a field of at most seven decimals both sides round the same exact rational and so an EXACT
 * check would be safe.
 *
 * That reasoning was wrong, and this file is what disproved it. `ticksToSeconds` rebuilds the double
 * as `whole + remainder / 1e7` — two roundings, not one correctly-rounded division — so for a
 * legitimate file the two need not agree. An exact check refused about one header in a hundred.
 *
 * So the two populations are measured here instead, and the tolerance has to sit between them:
 *
 *   - the NOISE floor: the worst disagreement a MATCHED pair produces. Observed 3.2e-16 relative.
 *   - the SIGNAL floor: the closest two genuinely DIFFERENT headers come. Observed 1.1e-7, and
 *     forced — eight ASCII bytes carry at most seven significant digits, so two distinct durations
 *     differ by at least about one part in 10^7.
 *
 * `1e-11` sits roughly 31,000x above the first and 11,000x below the second. The repository's
 * distrust of epsilons — "a float tolerance is how a one-sample overlap becomes invisible" — is about
 * TICK comparisons, where exactness is available. Here it is not (0.6.310).
 */

import { describe, expect, it } from 'vitest';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { readHeader } from '../../src/io/read.js';
import {
  gridSampleIndexAt,
  gridSampleStartSeconds,
  gridSampleStartTicks,
} from '../../src/sample-grid.js';
import { ticksToSeconds } from '../../src/tal/ticks.js';
import type { EdfHeader, EdfSignal } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

/** Deterministic, so a counterexample is reproducible from the seed alone. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const SAMPLES_PER_RECORD = [1, 2, 8, 10, 25, 128, 256, 1000, 4096, 9999] as const;

async function headerFor(duration: string, samplesPerRecord: number): Promise<EdfHeader> {
  return readHeader(
    byteSource(
      buildEdf({
        plus: 'C',
        recordCount: 2,
        signals: [{ label: 'Fp1', samplesPerRecord }],
        annotationSignals: [{ samplesPerRecord: 24 }],
        raw: { recordDuration: duration.padEnd(8) },
      } as never),
    ),
  );
}

/** Every duration spelling an 8-byte field can hold, drawn deterministically. */
function spellings(count: number, seed: number): readonly { duration: string; spr: number }[] {
  const random = lcg(seed);
  const drawn: { duration: string; spr: number }[] = [];
  while (drawn.length < count) {
    const places = Math.floor(random() * 8);
    const digits = 1 + Math.floor(random() * 7);
    let mantissa = '';
    for (let d = 0; d < digits; d += 1) mantissa += String(Math.floor(random() * 10));
    const whole = mantissa.slice(0, Math.max(1, mantissa.length - places)) || '0';
    const duration =
      places === 0 ? mantissa : `${whole}.${mantissa.slice(-places).padStart(places, '0')}`;
    if (duration.length > 8 || !(Number(duration) > 0)) continue;
    drawn.push({
      duration,
      spr: SAMPLES_PER_RECORD[Math.floor(random() * SAMPLES_PER_RECORD.length)] as number,
    });
  }
  return drawn;
}

describe('a grid from two headers', () => {
  it('accepts every matched pair an 8-byte duration field can express', async () => {
    let checked = 0;
    let worst = 0;
    let worstCase = '';
    for (const { duration, spr } of spellings(900, 0xbeef)) {
      const header = await headerFor(duration, spr);
      const signal = getSignal(header, 0);
      if (signal.sampleRateHz === undefined || header.recordDurationTicks <= 0n) continue;
      checked += 1;
      // The whole family, on its own header: none of them may refuse.
      expect(() => gridSampleIndexAt(signal, 0, header.recordDurationTicks)).not.toThrow();
      expect(() => gridSampleStartTicks(signal, 1, header.recordDurationTicks)).not.toThrow();
      expect(() => gridSampleStartSeconds(signal, 1, header.recordDurationTicks)).not.toThrow();

      const implied = signal.samplesPerRecord / ticksToSeconds(header.recordDurationTicks);
      const relative = Math.abs(implied - signal.sampleRateHz) / signal.sampleRateHz;
      if (relative > worst) {
        worst = relative;
        worstCase = `${duration} at ${spr} samples per record`;
      }
    }
    expect(checked, 'the sweep produced no usable headers').toBeGreaterThan(500);
    // The noise floor. An EXACT check would have refused these, which is why the guard is not one.
    expect(worst, `worst matched pair: ${worstCase}`).toBeGreaterThan(0);
    expect(worst, `worst matched pair: ${worstCase}`).toBeLessThan(1e-13);
  });

  it('refuses the mix, on every call in the family', async () => {
    const a = await headerFor('1', 10);
    const b = await headerFor('2', 10);
    const signalA = getSignal(a, 0);
    expect(signalA.sampleRateHz).toBe(10);
    // The silent answer this closes: sample 5 at t = 1 s, where its own grid says 10.
    expect(gridSampleIndexAt(signalA, 1, a.recordDurationTicks).sampleIndex).toBe(10);
    for (const [name, drive] of [
      ['gridSampleIndexAt', () => gridSampleIndexAt(signalA, 1, b.recordDurationTicks)],
      ['gridSampleStartTicks', () => gridSampleStartTicks(signalA, 5, b.recordDurationTicks)],
      ['gridSampleStartSeconds', () => gridSampleStartSeconds(signalA, 5, b.recordDurationTicks)],
    ] as const) {
      expect(drive, name).toThrow(/came from different headers/);
      expect(drive, name).toThrow(/samples at 10 Hz/);
      expect(drive, name).toThrow(/Next: pass header\.recordDurationTicks from the same header/);
    }
  });

  it('fires at the closest two different headers come, which is forced by the field width', async () => {
    // Seven significant digits is the most eight ASCII bytes carry, so two distinct durations
    // differ by at least about one part in 10^7 — far above the tolerance.
    const near = await headerFor('9.00095', 9999);
    const nearer = await headerFor('9.000951', 9999);
    const signal = getSignal(near, 0);
    const implied = signal.samplesPerRecord / ticksToSeconds(nearer.recordDurationTicks);
    const relative =
      Math.abs(implied - (signal.sampleRateHz as number)) / (signal.sampleRateHz as number);
    expect(relative).toBeGreaterThan(1e-8);
    expect(() => gridSampleIndexAt(signal, 1, nearer.recordDurationTicks)).toThrow(
      /came from different headers/,
    );
  });

  it('leaves the refusals that come before it unchanged', async () => {
    const header = await headerFor('1', 10);
    const annotations = header.signals.find((s) => s.kind === 'annotations') as EdfSignal;
    expect(() => gridSampleIndexAt(annotations, 0, header.recordDurationTicks)).toThrow(
      /is an annotations channel/,
    );
    expect(() => gridSampleIndexAt(getSignal(header, 0), 0, 0n)).toThrow(/record duration of zero/);
    expect(() => gridSampleIndexAt(undefined as never, 0, header.recordDurationTicks)).toThrow(
      /not one of header\.signals/,
    );
  });

  it('says nothing about a signal whose rate is undefined, which is the zero-duration file', async () => {
    // `sampleRateHz` is undefined exactly when `recordDurationSeconds` is 0, and that file is
    // already refused one check earlier. The guard must not depend on a rate that is not there.
    const header = await headerFor('0', 10);
    expect(getSignal(header, 0).sampleRateHz).toBeUndefined();
    expect(() => gridSampleIndexAt(getSignal(header, 0), 0, header.recordDurationTicks)).toThrow(
      /record duration of zero/,
    );
  });
});
