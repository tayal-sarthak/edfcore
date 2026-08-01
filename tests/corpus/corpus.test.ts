/**
 * edfcore against real files.
 *
 * Every other test in this suite feeds edfcore bytes that `tests/support/writer.ts` produced.
 * That writer was written independently from `src/`, which makes it a real cross-check — but
 * both are still this project's reading of the specification. These tests use files that
 * other people's software and hardware wrote.
 *
 * The teuniz generator files are unusually valuable because **their channels are labelled
 * with their own expected content** — a channel called `sine 8.5 Hz` really does carry an
 * 8.5 Hz sine at the stated amplitude. That turns "it parsed" into "it produced the right
 * numbers", with an expectation nobody involved in writing edfcore chose.
 *
 * These tests SKIP unless `npm run corpus:fetch` has been run, so a fresh clone stays green
 * and offline. See tests/corpus/manifest.json for provenance and licences.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../src/decode/physical.js';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations, readWindow } from '../../src/recording.js';
import type { ByteSource, EdfSignal } from '../../src/types.js';

const FILES = join(dirname(fileURLToPath(import.meta.url)), 'files');
const has = (name: string) => existsSync(join(FILES, name));
const load = (name: string) => byteSource(readFileSync(join(FILES, name)));

/** Dominant frequency by mean crossings — validates rate, decode and scaling at once. */
function dominantHz(values: ArrayLike<number>, seconds: number): number {
  let mean = 0;
  for (let i = 0; i < values.length; i += 1) mean += values[i] as number;
  mean /= values.length;
  let crossings = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (((values[i - 1] as number) - mean) * ((values[i] as number) - mean) < 0) crossings += 1;
  }
  return crossings / 2 / seconds;
}

async function channelValues(source: ByteSource, label: string, seconds: number) {
  const recording = await openEdf(source);
  const signal: EdfSignal = getSignal(recording.header, label);
  const chunks = await readWindow(recording, {
    signalIndices: [signal.index],
    startSeconds: 0,
    durationSeconds: seconds,
  });
  const part = chunks[0]?.signals[0];
  if (!part) throw new Error(`no samples for ${label}`);
  return { signal, values: toPhysical(signal, part.digital), recording };
}

// ---------------------------------------------------------------------------

describe.skipIf(!has('test_generator_2.edf'))('teuniz EDF+ generator, known signals', () => {
  // The file states these itself, in the channel labels.
  const SINES = [
    ['sine 1 Hz', 1],
    ['sine 8 Hz', 8],
    ['sine 8.5 Hz', 8.5],
    ['sine 15 Hz', 15],
    ['sine 17 Hz', 17],
    ['sine 50 Hz', 50],
  ] as const;

  for (const [label, expected] of SINES) {
    it(`decodes ${label} at the frequency its own label claims`, async () => {
      const { values } = await channelValues(load('test_generator_2.edf'), label, 10);
      // Crossing counting is exact for a clean sine; allow a little for window edges.
      expect(dominantHz(values, 10)).toBeCloseTo(expected, 0);
    });

    it(`decodes ${label} at its declared +/-100 uV amplitude`, async () => {
      const { signal, values } = await channelValues(load('test_generator_2.edf'), label, 10);
      expect(signal.physicalDimension).toBe('uV');
      expect(Math.max(...values)).toBeCloseTo(100, 0);
      expect(Math.min(...values)).toBeCloseTo(-100, 0);
    });
  }

  it('reads the record start and stop annotations', async () => {
    const recording = await openEdf(load('test_generator_2.edf'));
    const { annotations } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });
    expect(annotations.map((a) => a.text)).toEqual(['RECORD START', 'REC STOP']);
    expect(annotations[1]?.onsetSecondsFromFirstRecord).toBe(600);
  });
});

describe.skipIf(!has('test_generator_2.bdf') || !has('test_generator_2.edf'))(
  'teuniz BDF+ generator, 24-bit',
  () => {
    it('is recognised as 24-bit BDF+ from the 0xFF BIOSEMI version block', async () => {
      const recording = await openEdf(load('test_generator_2.bdf'));
      expect(recording.header.variant).toBe('BDF+C');
      expect(recording.header.bytesPerSample).toBe(3);
    });

    // The strongest available check on the 3-byte sign-extension path: the same signals
    // exist in both files, so 24-bit and 16-bit decoding must agree on content.
    for (const label of ['sine 1 Hz', 'sine 8.5 Hz', 'sine 50 Hz']) {
      it(`agrees with the 16-bit EDF file on ${label}`, async () => {
        const bdf = await channelValues(load('test_generator_2.bdf'), label, 10);
        const edf = await channelValues(load('test_generator_2.edf'), label, 10);
        expect(dominantHz(bdf.values, 10)).toBeCloseTo(dominantHz(edf.values, 10), 0);
        expect(Math.max(...bdf.values)).toBeCloseTo(Math.max(...edf.values), 0);
        expect(Math.min(...bdf.values)).toBeCloseTo(Math.min(...edf.values), 0);
      });
    }
  },
);

describe.skipIf(!has('test_generator.edf'))('teuniz plain EDF generator', () => {
  it('keeps four different sample rates apart in one file', async () => {
    const recording = await openEdf(load('test_generator.edf'));
    const rates = new Set(
      recording.header.dataSignalIndices.map((i) => recording.header.signals[i]?.sampleRateHz),
    );
    expect([...rates].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([25, 50, 100, 200]);
  });

  it('reports each channel its own physical dimension rather than a shared one', async () => {
    const recording = await openEdf(load('test_generator.edf'));
    const units = new Set(
      recording.header.dataSignalIndices.map((i) => recording.header.signals[i]?.physicalDimension),
    );
    // The file mixes electrical, percentage, rate and temperature channels.
    expect(units.size).toBeGreaterThan(3);
  });
});

describe.skipIf(!has('SC4001EC-Hypnogram.edf'))('sleep-edfx hypnogram, a real scoring file', () => {
  it('reads a file whose record duration is legally zero', async () => {
    const recording = await openEdf(load('SC4001EC-Hypnogram.edf'));
    expect(recording.header.recordDurationSeconds).toBe(0);
    // Every signal's rate is derived from that duration, so all of them must be undefined
    // rather than Infinity — this is the case that breaks readers which divide by it.
    for (const signal of recording.header.signals) {
      expect(signal.sampleRateHz).toBeUndefined();
    }
    expect(recording.header.diagnostics.map((d) => d.code)).toContain('ZERO_RECORD_DURATION');
  });

  it('reads the full sleep staging', async () => {
    const recording = await openEdf(load('SC4001EC-Hypnogram.edf'));
    const { annotations } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });
    expect(annotations.length).toBeGreaterThan(100);
    expect(annotations[0]?.text).toBe('Sleep stage W');
    // Scored stages are contiguous: each onset is the previous onset plus its duration.
    for (let i = 1; i < annotations.length; i += 1) {
      const previous = annotations[i - 1]!;
      expect(annotations[i]!.onsetSecondsFromFirstRecord).toBeCloseTo(
        previous.onsetSecondsFromFirstRecord + (previous.durationSeconds ?? 0),
        6,
      );
    }
  });
});

describe.skipIf(!has('SC4001E0-PSG.edf'))('sleep-edfx PSG, a real 22-hour recording', () => {
  const psg = () => byteSource(readFileSync(join(FILES, 'SC4001E0-PSG.edf')));

  it('reads a body temperature that is a body temperature', async () => {
    // The most convincing single check in this file: an independent, physical expectation
    // that no amount of plausible-looking arithmetic would satisfy by accident. If the
    // affine scaling were wrong in any way, this would not land near 37 C.
    const { signal, values } = await channelValues(psg(), 'Temp rectal', 60);
    expect(signal.physicalDimension.trim()).toBe('DegC');
    for (const value of values) {
      expect(value).toBeGreaterThan(30);
      expect(value).toBeLessThan(42);
    }
  });

  it('produces physiologically plausible EEG in microvolts', async () => {
    const { signal, values } = await channelValues(psg(), 'EEG Fpz-Cz', 30);
    expect(signal.physicalDimension.trim()).toBe('uV');
    const peak = Math.max(...values.map(Math.abs));
    expect(peak).toBeGreaterThan(10);
    expect(peak).toBeLessThan(1000);
    expect(values.every(Number.isFinite)).toBe(true);
  });

  it('keeps 100 Hz and 1 Hz channels on their own sample grids', async () => {
    const recording = await openEdf(psg());
    expect(getSignal(recording.header, 'EEG Fpz-Cz').sampleRateHz).toBe(100);
    expect(getSignal(recording.header, 'Temp rectal').sampleRateHz).toBe(1);
  });

  it('reads a window twelve hours in without reading the file', async () => {
    // This is the claim the library exists to make, measured on a real 48 MB recording.
    const inner = psg();
    const reads: Array<{ offset: number; length: number }> = [];
    const spy: ByteSource = {
      byteLength: inner.byteLength,
      read: (offset, length, options) => {
        reads.push({ offset, length });
        return inner.read(offset, length, options);
      },
    };

    const recording = await openEdf(spy);
    const eeg = getSignal(recording.header, 'EEG Fpz-Cz');
    reads.length = 0;

    const chunks = await readWindow(recording, {
      signalIndices: [eeg.index],
      startSeconds: 12 * 3600,
      durationSeconds: 30,
    });

    const bytesRead = reads.reduce((total, r) => total + r.length, 0);
    expect(reads).toHaveLength(1);
    expect(bytesRead).toBeLessThan(inner.byteLength / 1000);
    // 30 s at 100 Hz, and the record grid happens to align exactly here.
    expect(chunks[0]?.signals[0]?.digital.length).toBe(3000);
    // The chunk reports the overread honestly rather than hiding it.
    expect(chunks[0]?.byteLength).toBe(bytesRead);
  });
});
