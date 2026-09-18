/**
 * `scanSamples` given as text, and the sweep skipping the samples anyway.
 *
 * `validateRecording` already refuses a bare value where its options belong, and its message says
 * what a dropped `scanSamples` costs: "this sweep would have skipped the samples and still reported
 * a verdict". The field inside the object was never checked, so the same failure was reachable
 * through the guard rather than past it.
 *
 * `scanSamples` is resolved as `options?.scanSamples === true`, which never coerces — the right way
 * to read a boolean, and what makes the mistake silent. `'true'`, `'1'` and `1` are each not-`true`,
 * so the sweep took the cheap path: `signalStats` came back empty, `ok` came back true, and nothing
 * said the expensive half had not run. `types.ts` calls that half "what turns declared digital
 * ranges into observed ones".
 *
 * Text is how it arrives: this is the option a CI flag or a config key sets.
 *
 * 0.6.182 made the same fix for `strict`, in the same words. `requireBooleanOption` is now where the
 * rule lives, beside `requireFiniteOption` and `requireItemLimit` — the module whose subject is
 * options "refused rather than silently coerced".
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { buildEdf } from '../support/writer.js';

const FILE = buildEdf({
  format: 'EDF',
  plus: 'C',
  recordCount: 6,
  recordDurationSeconds: 1,
  signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 16 }],
  annotationSignals: [{ samplesPerRecord: 40 }],
});

const opened = (): Promise<EdfRecording> => openEdf(byteSource(FILE));

const AS_TEXT: ReadonlyArray<readonly [string, unknown]> = [
  ['the string "true"', 'true'],
  ['the string "1"', '1'],
  ['the number 1', 1],
  ['the string "false"', 'false'],
];

describe.each(AS_TEXT)('scanSamples given as %s', (_name, scanSamples) => {
  it('is refused rather than skipping the samples', async () => {
    const recording = await opened();
    const thrown = await validateRecording(recording, { scanSamples } as never).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown, 'the sweep reported a verdict over samples it never read').toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain('options.scanSamples must be true or false');
    expect(thrown?.message).toContain('Next:');
  });

  it('says what the off reading actually did', async () => {
    const recording = await opened();
    const thrown = await validateRecording(recording, { scanSamples } as never).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(thrown?.message).toContain('skipped the samples and reported a verdict anyway');
    expect(thrown?.message).toContain('arrive as text');
  });
});

describe('the boolean itself', () => {
  it('still observes the sample ranges when true', async () => {
    const report = await validateRecording(await opened(), { scanSamples: true });
    expect(report.signalStats.length).toBe(1);
    expect(report.recordsScanned).toBe(6);
  });

  it('still skips them when false, and when omitted', async () => {
    expect((await validateRecording(await opened(), { scanSamples: false })).signalStats).toEqual(
      [],
    );
    expect((await validateRecording(await opened())).signalStats).toEqual([]);
  });

  it('still skips them when scanSamples is explicitly undefined', async () => {
    const report = await validateRecording(await opened(), { scanSamples: undefined } as never);
    expect(report.signalStats).toEqual([]);
  });

  it('leaves the bare-options refusal saying its own thing', async () => {
    await expect(validateRecording(await opened(), true as never)).rejects.toThrow(
      /the options are a boolean, not an object/,
    );
  });

  it('leaves the other options alone', async () => {
    const report = await validateRecording(await opened(), {
      scanSamples: true,
      maxMaterializeBytes: 1024 * 1024,
    });
    expect(report.recordsScanned).toBe(6);
  });
});
