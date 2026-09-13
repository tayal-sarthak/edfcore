/**
 * `validateRecording`'s options, passed as a bare value.
 *
 * 0.6.130, 0.6.140, 0.6.154 and 0.6.163 each refused this shape somewhere else, always on the same
 * argument: every option in this package is a field on an object, so the value a caller means IS
 * the option.
 *
 * The option that goes missing here is `scanSamples`, which `types.ts` calls "the expensive half —
 * it is what turns declared digital ranges into observed ones". `validateRecording(recording, true)`
 * reads as "validate it properly" and is the shortest thing a caller can write for that.
 *
 * It read as `undefined`, so the sweep took the cheap path — and still returned a report. On a
 * plain EDF whose onsets are arithmetic that report says `ok: true`, `signalStats: []` and
 * `recordsScanned: 0`: this call's own account of what it looked at, saying it had looked at
 * nothing while answering the question anyway. `index` and the read budget were dropped with it.
 *
 * A conformance sweep is the one call people gate CI on — `edfcore validate` exits 1 on failure
 * for exactly that — so a verdict reached without reading is the worst kind of quiet.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

/** A sample outside the declared digital range: only a sample scan can see it. */
const FILE = buildEdf({
  recordCount: 4,
  recordDurationSeconds: 1,
  signals: [
    {
      label: 'Fp1',
      samplesPerRecord: 8,
      digitalMinimum: -100,
      digitalMaximum: 100,
      sample: (record, index) => (record === 2 && index === 3 ? 30000 : index),
    },
  ],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

const sweep = async (options: unknown): Promise<unknown> => {
  const recording = await opened();
  return (validateRecording as unknown as (r: EdfRecording, o: unknown) => Promise<unknown>)(
    recording,
    options,
  );
};

describe.each([
  ['true, the flag itself', true],
  ['false', false],
  ['a number, meant as a budget', 1024],
])('options that are %s', (_name, options) => {
  it('are refused rather than taken as no options at all', async () => {
    await expect(sweep(options)).rejects.toThrow(RangeError);
  });

  it('say which field was about to be dropped and what that would have cost', async () => {
    try {
      await sweep(options);
      expect.unreachable('a bare value must not silently skip the sample scan');
    } catch (error) {
      expect((error as Error).message).toContain('validateRecording()');
      expect((error as Error).message).toContain('scanSamples is a field on one');
      expect((error as Error).message).toContain('Next:');
    }
  });
});

describe('what the dropped flag was hiding', () => {
  it('finds the out-of-range sample when scanSamples is set', async () => {
    const report = await validateRecording(await opened(), { scanSamples: true });
    expect(report.signalStats[0]?.outOfDigitalRangeCount).toBeGreaterThan(0);
    expect(report.recordsScanned).toBe(4);
  });

  it('reports having scanned nothing when it is not', async () => {
    // The state a bare `true` used to produce, reachable only on purpose now.
    const report = await validateRecording(await opened(), { scanSamples: false });
    expect(report.signalStats).toEqual([]);
    expect(report.recordsScanned).toBe(0);
  });
});

describe('the options it does take', () => {
  it('still sweeps with no options at all', async () => {
    await expect(sweep(undefined)).resolves.toBeDefined();
  });

  it('still takes null as "no options"', async () => {
    await expect(sweep(null)).resolves.toBeDefined();
  });
});
