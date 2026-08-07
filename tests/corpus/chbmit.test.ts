/**
 * CHB-MIT scalp EEG — a second real clinical recording, deliberately unlike the first.
 *
 * sleep-edfx is 7 channels at mixed rates in 30-second records, recorded in 1989. This is 23
 * channels at a uniform 256 Hz in one-second records, recorded in 2010 at a different institution
 * on different equipment. A reader that happens to suit one geometry does not automatically suit
 * the other, and until 0.2.58 every real file in this suite came from the same dataset.
 *
 * It also carries something no synthetic fixture in this project has: a **duplicate channel
 * label**. `T8-P8` appears twice, which is a real montage naming a derivation twice rather than a
 * defect anyone introduced — and it is exactly the situation `EdfAmbiguousChannelError` exists
 * for. Until now that error was only ever raised against a fixture written to raise it.
 *
 * Skips without the corpus. `npm run corpus:fetch`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EdfAmbiguousChannelError, isEdfError } from '../../src/errors.js';
import { findSignals, getSignal, matchSignals } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';

const FILE = join(dirname(fileURLToPath(import.meta.url)), 'files', 'chb01_01.edf');
const maybe = existsSync(FILE) ? it : it.skip;

async function chb() {
  return openEdf(byteSource(new Uint8Array(readFileSync(FILE))));
}

describe('a 23-channel 256 Hz clinical EEG', () => {
  maybe('is the geometry sleep-edfx is not', async () => {
    const recording = await chb();
    expect(recording.header.signals).toHaveLength(23);
    expect(recording.header.recordCount).toBe(3600);
    // One-second records, against sleep-edfx's thirty.
    expect(recording.header.recordDurationSeconds).toBe(1);
    expect(recording.timeline.spanSeconds).toBe(3600);
    for (const signal of recording.header.signals) {
      expect(signal.sampleRateHz, signal.label).toBe(256);
      expect(signal.samplesPerRecord, signal.label).toBe(256);
    }
  });

  maybe(
    'validates clean',
    async () => {
      const report = await validateRecording(await chb(), { scanSamples: true });
      expect(report.ok).toBe(true);
      expect(report.recordsScanned).toBe(3600);
    },
    120_000,
  );
});

describe('a montage that names one derivation twice', () => {
  maybe('really does declare the same label on two signals', async () => {
    // Stated from the file, so the assertions below cannot pass for the wrong reason.
    const recording = await chb();
    const duplicates = recording.header.signals.filter((s) => s.label === 'T8-P8');
    expect(duplicates).toHaveLength(2);
    expect(duplicates[0]?.index).not.toBe(duplicates[1]?.index);
  });

  maybe('refuses to guess which one getSignal meant', async () => {
    // The whole reason this error class exists, raised by a real recording rather than by a
    // fixture written to raise it. Guessing here would put one derivation in a paper under
    // another's name.
    const recording = await chb();
    let thrown: unknown;
    try {
      getSignal(recording.header, 'T8-P8');
      expect.unreachable('a duplicated label has no single answer');
    } catch (error) {
      thrown = error;
    }

    expect(isEdfError(thrown)).toBe(true);
    expect(thrown).toBeInstanceOf(EdfAmbiguousChannelError);
    // The message has to name the indices, or the caller cannot act on it.
    expect((thrown as Error).message).toContain('T8-P8');
  });

  maybe('returns both from the functions that are allowed to return several', async () => {
    // `findSignals` and `matchSignals` answer a different question and must not throw for it.
    const recording = await chb();
    expect(findSignals(recording.header, 'T8-P8')).toHaveLength(2);
    expect(matchSignals(recording.header, /^T8-P8$/)).toHaveLength(2);
  });

  maybe('keeps the two as separate signals, at their own indices', async () => {
    // The two are at index 14 and index 22 and carry IDENTICAL samples — verified against
    // pyEDFlib over the whole hour, not assumed. This recording really does write the same
    // derivation twice.
    //
    // That makes the refusal above matter more rather than less. If `getSignal` picked one
    // arbitrarily, no comparison of the returned numbers could ever reveal which it picked, so a
    // caller would never learn that the question had two answers. The error is the only signal
    // there is.
    const recording = await chb();
    const both = findSignals(recording.header, 'T8-P8');
    const [first, second] = both;
    if (first === undefined || second === undefined) throw new Error('setup failed');
    expect([first.index, second.index]).toEqual([14, 22]);

    const [chunk] = await readWindow(recording, {
      signalIndices: [first.index, second.index],
      startSeconds: 0,
      durationSeconds: 10,
    });

    // Two entries, not one deduplicated by label, and each reporting its own signal index.
    expect(chunk?.signals).toHaveLength(2);
    expect(chunk?.signals[0]?.signalIndex).toBe(14);
    expect(chunk?.signals[1]?.signalIndex).toBe(22);
    expect(chunk?.signals[0]?.sampleCount).toBe(2560);
    expect(chunk?.signals[1]?.sampleCount).toBe(2560);

    // Read from different byte offsets in each record, which is what makes them separate reads
    // rather than one result handed back twice.
    expect(first.recordByteOffset).not.toBe(second.recordByteOffset);
  });
});
