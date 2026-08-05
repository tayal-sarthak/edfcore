/**
 * Time to sample index, and back.
 *
 * Layer 7, and pure. Every viewer needs this and the obvious spelling is wrong:
 * `Math.round(seconds * signal.sampleRateHz)`.
 *
 * Three things break it. `sampleRateHz` is `samplesPerRecord / recordDurationSeconds`, so for a
 * record duration that is not a power of ten it is a float with no exact representation —
 * 128 samples over 0.3 s is 426.666..., and multiplying by a large `seconds` accumulates the
 * error until the index is off by one. `sampleRateHz` is also `undefined` when the record
 * duration is zero, which is legal EDF and which a real sleep-staging file relies on, so the
 * expression silently yields `NaN`. And a recording does not start at zero: onsets are relative
 * to record 0's own start, which is what every other time in edfcore is measured from.
 *
 * These do the arithmetic in integers on `(record, sampleWithinRecord)` instead, which is the
 * same rule `trimToWindow` follows.
 */

import { TICKS_PER_SECOND } from './constants.js';
import { secondsToTicks } from './tal/ticks.js';
import type { EdfSampleLocation, EdfSignal } from './types.js';

function assertGrid(signal: EdfSignal, recordDurationTicks: bigint): void {
  if (signal.kind === 'annotations') {
    throw new RangeError(
      `signal ${signal.index} (${JSON.stringify(signal.label)}) is an annotations channel, ` +
        'whose region holds TAL text rather than samples, so it has no sample grid. Next: use ' +
        'onsetTicks on the annotations themselves.',
    );
  }
  if (signal.samplesPerRecord <= 0) {
    throw new RangeError(
      `signal ${signal.index} (${JSON.stringify(signal.label)}) declares ` +
        `${signal.samplesPerRecord} samples per record, so it has no sample grid to index. ` +
        'Next: check header.diagnostics for ZERO_SAMPLES_PER_RECORD.',
    );
  }
  if (recordDurationTicks <= 0n) {
    throw new RangeError(
      'this file declares a record duration of zero, so records do not advance in time and no ' +
        'elapsed time maps to a sample. This is legal EDF and a scoring file relies on it. ' +
        'Next: index by record with readRecords().',
    );
  }
}

/**
 * The sample covering `seconds` elapsed from the start of the recording.
 *
 * Floor, not round: a sample covers the half-open interval from its own start to the next one's,
 * so the sample "at" a time is the one whose interval contains it. Rounding would return the
 * NEXT sample for anything past the halfway point, which puts a window boundary one sample late.
 */
export function sampleIndexAt(
  signal: EdfSignal,
  seconds: number,
  recordDurationTicks: bigint,
): EdfSampleLocation {
  assertGrid(signal, recordDurationTicks);

  const ticks = secondsToTicks(seconds);
  const perRecord = BigInt(signal.samplesPerRecord);
  // Exact integer arithmetic throughout: ticks * samplesPerRecord / recordDurationTicks, floored
  // toward negative infinity so a time before the start yields a negative index rather than
  // truncating toward zero and colliding with sample 0.
  const numerator = ticks * perRecord;
  let index = numerator / recordDurationTicks;
  if (numerator % recordDurationTicks !== 0n && numerator < 0n) index -= 1n;

  const recordIndex = index >= 0n ? index / perRecord : (index - perRecord + 1n) / perRecord;
  const sampleWithinRecord = index - recordIndex * perRecord;

  return {
    sampleIndex: Number(index),
    recordIndex: Number(recordIndex),
    sampleWithinRecord: Number(sampleWithinRecord),
  };
}

/**
 * The exact start time of a sample, in 100 ns ticks, elapsed from the start of the recording.
 *
 * Ticks rather than seconds because this is the value worth comparing: a float64 second loses
 * precision past about 28.5 years, and more importantly two times that should be equal can fail
 * to be once both have been divided by ten million.
 *
 * Rounded UP to a whole tick, which matters more than it looks. A sample boundary need not fall
 * on one: 128 samples over 0.3 s puts sample 1 at 23,437.5 ticks, and 100 ns is the finest unit
 * edfcore has. Truncating would return 23,437 — a tick that lies inside sample 0 — so
 * `sampleIndexAt` would send it straight back to the previous sample. Taking the first whole
 * tick at or after the exact start keeps the two functions inverse for every index.
 */
export function sampleStartTicks(
  signal: EdfSignal,
  sampleIndex: number,
  recordDurationTicks: bigint,
): bigint {
  assertGrid(signal, recordDurationTicks);
  if (!Number.isSafeInteger(sampleIndex)) {
    throw new RangeError(
      `sampleStartTicks(): sampleIndex must be a whole number, received ${sampleIndex}.`,
    );
  }
  const perRecord = BigInt(signal.samplesPerRecord);
  const numerator = BigInt(sampleIndex) * recordDurationTicks;
  const quotient = numerator / perRecord;
  // Ceiling for an exact division is the quotient itself; otherwise step to the next tick, and
  // only in the direction away from zero for a negative index.
  if (numerator % perRecord === 0n) return quotient;
  return numerator > 0n ? quotient + 1n : quotient;
}

/** `sampleStartTicks` in seconds, for display. Compare ticks, not this. */
export function sampleStartSeconds(
  signal: EdfSignal,
  sampleIndex: number,
  recordDurationTicks: bigint,
): number {
  const ticks = sampleStartTicks(signal, sampleIndex, recordDurationTicks);
  const whole = ticks / TICKS_PER_SECOND;
  const remainder = ticks % TICKS_PER_SECOND;
  return Number(whole) + Number(remainder) / Number(TICKS_PER_SECOND);
}
