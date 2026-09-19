/**
 * A BDF whose `Status` channel declares no samples, read for triggers.
 *
 * `samplesPerRecord` of zero makes the inner scan loop run zero times, so `readTriggers` completed
 * and returned `[]` — and `[]` is one of this function's real answers. An experimenter reads it as
 * "no stimulus in this window", on the path whose own docblocks say twice that a missing event is
 * indistinguishable from no events.
 *
 * That is the outcome `getStatusSignal` was given a guard for, twice: 0.6.120 for a recording passed
 * where the header belongs, and 0.6.179 for a chunk. Both stopped a wrong ARGUMENT producing the
 * silent answer. This is the FILE producing it, one call later.
 *
 * And it is a defect the parser already names. `ZERO_SAMPLES_PER_RECORD` is in the vocabulary, the
 * header reports it, and `sample-grid.ts` and `sample-locate.ts` both refuse such a signal in these
 * words — "declares N samples per record, so it has no sample grid to index". This was the third
 * place a signal with no grid is read from, and the only one that answered.
 */

import { describe, expect, it } from 'vitest';
import { getStatusSignal, readTriggers } from '../../src/biosemi.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { buildEdf } from '../support/writer.js';

const common = {
  format: 'BDF',
  plus: 'C',
  recordCount: 4,
  recordDurationSeconds: 1,
  annotationSignals: [{ samplesPerRecord: 40 }],
} as const;

/** Declared, and carrying nothing. */
const EMPTY_STATUS = buildEdf({
  ...common,
  signals: [
    { label: 'A1', samplesPerRecord: 8 },
    { label: 'Status', samplesPerRecord: 0 },
  ],
});

/** The same file with a Status channel that has samples. */
const REAL_STATUS = buildEdf({
  ...common,
  signals: [
    { label: 'A1', samplesPerRecord: 8 },
    { label: 'Status', samplesPerRecord: 8 },
  ],
});

const opened = (bytes: Uint8Array): Promise<EdfRecording> => openEdf(byteSource(bytes));

const WINDOW = { startSeconds: 0, durationSeconds: 4 } as const;

describe('a Status channel that carries nothing', () => {
  it('is still found, which is why the scan reached it', async () => {
    const recording = await opened(EMPTY_STATUS);
    const status = getStatusSignal(recording.header);
    expect(status?.label).toBe('Status');
    expect(status?.samplesPerRecord).toBe(0);
  });

  it('is reported by the parser, which is the defect this names', async () => {
    const recording = await opened(EMPTY_STATUS);
    expect(recording.header.diagnostics.map((one) => one.code)).toContain(
      'ZERO_SAMPLES_PER_RECORD',
    );
  });

  it('is refused rather than answered with no triggers', async () => {
    const recording = await opened(EMPTY_STATUS);
    const thrown = await readTriggers(recording, WINDOW).then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(
      thrown,
      'a file with a declared Status channel read as having no stimulus',
    ).toBeDefined();
    expect(thrown).toBeInstanceOf(RangeError);
    expect(thrown?.message).toContain('declares 0 samples per record');
    expect(thrown?.message).toContain('Next:');
  });

  it('says why an empty answer would be worse than a failure', async () => {
    const recording = await opened(EMPTY_STATUS);
    await expect(readTriggers(recording, WINDOW)).rejects.toThrow(
      /reads as a recording with no stimulus in it/,
    );
    await expect(readTriggers(recording, WINDOW)).rejects.toThrow(/ZERO_SAMPLES_PER_RECORD/);
  });

  it('is refused for a window with no records in it too', async () => {
    // Not left to the scan loop, which a window past the end never enters.
    const recording = await opened(EMPTY_STATUS);
    await expect(
      readTriggers(recording, { startSeconds: 100, durationSeconds: 4 }),
    ).rejects.toThrow(/declares 0 samples per record/);
  });
});

describe('a Status channel with samples', () => {
  it('still reports its triggers', async () => {
    const recording = await opened(REAL_STATUS);
    const events = await readTriggers(recording, WINDOW);
    expect(events.length).toBeGreaterThan(0);
    expect(typeof events[0]?.trigger).toBe('number');
  });

  it('still answers [] for a window that really holds none', async () => {
    const recording = await opened(REAL_STATUS);
    await expect(
      readTriggers(recording, { startSeconds: 100, durationSeconds: 4 }),
    ).resolves.toEqual([]);
  });

  it('still refuses a file with no Status channel in its own words', async () => {
    const plain = buildEdf({
      format: 'EDF',
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
    });
    await expect(readTriggers(await opened(plain), WINDOW)).rejects.toThrow(
      /no BioSemi Status channel/,
    );
  });
});
