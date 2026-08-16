/**
 * The real corpus, compared with pyEDFlib rather than with a plausibility argument.
 *
 * `corpus.test.ts` reads the same files and checks that what comes out is BELIEVABLE: an 8.5 Hz
 * channel oscillates at 8.5 Hz, a rectal temperature lands near 37 degrees. That is a real
 * cross-check and it is not an exact one — it would pass for a reader that was slightly wrong
 * everywhere, which is precisely the failure mode a pinned scaling expression exists to prevent.
 *
 * `golden-values.test.ts` is exact, but on files this project caused to exist. These files were
 * written by other people's software and hardware, years ago, and one of them is a 22-hour clinical
 * polysomnogram. Exactness on those is the strongest evidence available short of a conformance
 * suite that does not exist for this format.
 *
 * A BOUNDED WINDOW per signal — start, middle and end. The PSG is 48 MB; a golden holding every
 * sample would be larger than the repository. The end window is the one that matters most: a
 * reader whose record arithmetic drifts does so with distance from the start, and a sample near
 * record 0 cannot show it.
 *
 * SKIPS when the corpus is absent, like every other test in this directory, so a fresh clone stays
 * green and offline:
 *     npm run corpus:fetch
 *     .venv/bin/python scripts/golden/generate-corpus.py   # only to regenerate the goldens
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toPhysical } from '../../src/decode/physical.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations, readRecords } from '../../src/recording.js';
import { validateRecording } from '../../src/validate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILES = join(HERE, 'files');
const GOLDEN = join(HERE, 'golden');

interface Window {
  readonly window: string;
  readonly firstSampleIndex: number;
  readonly digital: readonly number[];
  readonly physicalBits: readonly string[];
}

interface Signal {
  readonly index: number;
  readonly label: string;
  readonly dimension: string;
  readonly sampleCount: number;
  /** Over the WHOLE signal, not the sampled windows. */
  readonly observedDigitalMin: number;
  readonly observedDigitalMax: number;
  readonly windows: readonly Window[];
}

interface GoldenAnnotation {
  readonly onsetSeconds: number;
  readonly onsetBits: string;
  /** pyEDFlib writes -1 for "no duration"; EDF+ omits the field entirely. */
  readonly durationSeconds: number;
  readonly text: string;
}

interface Golden {
  readonly file: string;
  readonly producer: string;
  readonly recordCount: number;
  readonly recordDurationSeconds: number;
  readonly samplesPerWindow: number;
  readonly startDate: {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hour: number;
    readonly minute: number;
    readonly second: number;
  };
  readonly annotations: readonly GoldenAnnotation[];
  readonly signals: readonly Signal[];
}

const CASES = [
  // 154 sleep stages on a file whose record duration is legally ZERO.
  'SC4001EC-Hypnogram.edf',
  'SC4001E0-PSG.edf',
  'test_generator.edf',
  'test_generator_2.edf',
  'test_generator_2.bdf',
  // A second real clinical recording, from another institution and decade.
  'chb01_01.edf',
  // The EDF author's own calibration file.
  'calib.rec',
] as const;

function fromBits(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${hex}`));
  return view.getFloat64(0);
}

function available(name: string): boolean {
  return existsSync(join(FILES, name)) && existsSync(join(GOLDEN, `corpus-${name}.json`));
}

function load(name: string): { golden: Golden; bytes: Uint8Array } {
  return {
    golden: JSON.parse(readFileSync(join(GOLDEN, `corpus-${name}.json`), 'utf8')) as Golden,
    bytes: new Uint8Array(readFileSync(join(FILES, name))),
  };
}

/**
 * The samples of one signal over the records covering a window, read the way a consumer would.
 *
 * Every signal has its own sample grid, so the record range is derived from THIS signal's
 * samplesPerRecord rather than from a shared rate.
 */
async function samplesAt(
  bytes: Uint8Array,
  signalIndex: number,
  firstSampleIndex: number,
  count: number,
) {
  const recording = await openEdf(byteSource(bytes));
  const signal = recording.header.signals[signalIndex];
  if (signal === undefined) throw new Error(`no signal ${signalIndex}`);
  const perRecord = signal.samplesPerRecord;

  const firstRecord = Math.floor(firstSampleIndex / perRecord);
  const lastRecord = Math.floor((firstSampleIndex + count - 1) / perRecord);
  const chunk = await readRecords(recording, {
    signalIndices: [signalIndex],
    records: { start: firstRecord, count: lastRecord - firstRecord + 1 },
  });

  const offset = firstSampleIndex - firstRecord * perRecord;
  const digital = (chunk.signals[0]?.digital ?? new Int32Array(0)).subarray(offset, offset + count);
  return { signal, digital, physical: toPhysical(signal, digital) };
}

describe('the case list covers the committed goldens', () => {
  it('has a case for every corpus golden on disk', () => {
    // Deliberately NOT gated on `available()`. Everything else in this file skips without
    // `npm run corpus:fetch`, and CI never fetches — so a gated version of this check would be
    // the one thing here that never runs anywhere. The goldens are committed, which is all this
    // needs: a `corpus-*.json` with no entry in CASES is compared by nothing, on a run that
    // reports skips rather than failures and so looks the same either way.
    const onDisk = readdirSync(GOLDEN)
      .filter((entry) => entry.startsWith('corpus-') && entry.endsWith('.json'))
      .map((entry) => entry.slice('corpus-'.length, -'.json'.length));

    expect(onDisk.length).toBeGreaterThan(1);
    expect([...onDisk].sort()).toEqual([...CASES].sort());
  });
});

describe.each(CASES)('%s', (name) => {
  const enabled = available(name);
  const maybe = enabled ? it : it.skip;

  maybe('the golden is pyEDFlib output for this exact file', () => {
    const { golden } = load(name);
    expect(golden.file).toBe(name);
    expect(golden.producer).toMatch(/^pyedflib \d/);
    // A scoring file carries no signals at all — the hypnogram is 154 annotations and nothing
    // else — so "has samples OR has events" is the real precondition, not "has samples".
    expect(golden.signals.length + golden.annotations.length).toBeGreaterThan(0);

    if (golden.signals.length > 0) {
      // A window at the END is the one that catches record arithmetic drifting with distance.
      const labels = new Set(golden.signals.flatMap((s) => s.windows.map((w) => w.window)));
      expect(labels.has('start')).toBe(true);
      if ((golden.signals[0]?.sampleCount ?? 0) > golden.samplesPerWindow) {
        expect(labels.has('end')).toBe(true);
      }
    }
  });

  maybe('edfcore agrees with pyEDFlib about the file geometry', async () => {
    const { golden, bytes } = load(name);
    const recording = await openEdf(byteSource(bytes));
    expect(recording.header.recordCount).toBe(golden.recordCount);
    expect(recording.header.recordDurationSeconds).toBe(golden.recordDurationSeconds);
    for (const expected of golden.signals) {
      const signal = recording.header.signals[expected.index];
      expect(signal?.label, `signal ${expected.index}`).toBe(expected.label);
      expect(signal?.physicalDimension.trim()).toBe(expected.dimension);
      expect(signal?.sampleCount).toBe(expected.sampleCount);
    }
  });

  maybe('reads the same digital samples, at the start, the middle and the end', async () => {
    const { golden, bytes } = load(name);
    for (const expected of golden.signals) {
      for (const window of expected.windows) {
        const { digital } = await samplesAt(
          bytes,
          expected.index,
          window.firstSampleIndex,
          window.digital.length,
        );
        expect(
          Array.from(digital),
          `${expected.label} @ ${window.window} (sample ${window.firstSampleIndex})`,
        ).toEqual([...window.digital]);
      }
    }
  });

  maybe('reproduces the same physical values, bit for bit', async () => {
    // Object.is per sample. On a 22-hour recording written by hardware nobody involved here
    // controls — which is the whole point of using it.
    const { golden, bytes } = load(name);
    for (const expected of golden.signals) {
      for (const window of expected.windows) {
        const { physical } = await samplesAt(
          bytes,
          expected.index,
          window.firstSampleIndex,
          window.physicalBits.length,
        );

        let mismatches = 0;
        let first = '';
        for (let i = 0; i < window.physicalBits.length; i += 1) {
          const want = fromBits(window.physicalBits[i] as string);
          const got = physical[i] as number;
          if (!Object.is(got, want)) {
            mismatches += 1;
            if (first === '') {
              first = `sample ${window.firstSampleIndex + i}: digital ${window.digital[i]}, edfcore ${got}, pyEDFlib ${want}`;
            }
          }
        }
        expect(mismatches, `${expected.label} @ ${window.window}: ${first}`).toBe(0);
      }
    }
  });
});

describe('the corpus comparison is exact where the plausibility one is not', () => {
  const enabled = available('SC4001E0-PSG.edf');
  const maybe = enabled ? it : it.skip;

  maybe('the textbook expression would pass a plausibility check and fail this one', async () => {
    // `corpus.test.ts` asserts a rectal temperature lands between 36 and 38 degrees. The textbook
    // expression satisfies that comfortably — it is wrong by roughly 1e-14 — so the older check
    // could not have distinguished the two. This one can, which is the reason it exists.
    const { golden, bytes } = load('SC4001E0-PSG.edf');
    const expected = golden.signals.find((s) => s.label.startsWith('Temp'));
    const window = expected?.windows[0];
    if (expected === undefined || window === undefined) throw new Error('fixture missing');

    const recording = await openEdf(byteSource(bytes));
    const signal = recording.header.signals[expected.index];
    if (signal === undefined) throw new Error('no signal');

    const gain =
      (signal.physicalMaximum - signal.physicalMinimum) /
      (signal.digitalMaximum - signal.digitalMinimum);

    let plausible = 0;
    let differing = 0;
    for (let i = 0; i < window.digital.length; i += 1) {
      const textbook =
        signal.physicalMinimum + ((window.digital[i] as number) - signal.digitalMinimum) * gain;
      if (textbook > 30 && textbook < 40) plausible += 1;
      if (!Object.is(textbook, fromBits(window.physicalBits[i] as string))) differing += 1;
    }

    // Every textbook value is a believable body temperature...
    expect(plausible).toBe(window.digital.length);
    // ...and a large share of them are not the number pyEDFlib produced.
    expect(differing).toBeGreaterThan(0);
  });
});

describe.each(CASES)('%s — the header and the events', (name) => {
  const enabled = available(name);
  const maybe = enabled ? it : it.skip;

  maybe('resolves the same start date, through the 1985-2084 rule', async () => {
    // The sleep-edfx files were recorded in 1989 and carry a two-digit year, so resolving them
    // exercises the pivot rule against a reader that implements it independently.
    const { golden, bytes } = load(name);
    const recording = await openEdf(byteSource(bytes));
    const start = recording.header.startTime;

    expect(start.resolvedDate).toEqual({
      year: golden.startDate.year,
      month: golden.startDate.month,
      day: golden.startDate.day,
    });
    expect(start.clock).toEqual({
      hour: golden.startDate.hour,
      minute: golden.startDate.minute,
      second: golden.startDate.second,
    });
  });

  maybe('finds the same annotations, with the same onsets and durations', async () => {
    const { golden, bytes } = load(name);
    const recording = await openEdf(byteSource(bytes));
    const { annotations } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });

    expect(annotations.map((a) => a.text)).toEqual(golden.annotations.map((a) => a.text));

    for (const [index, expected] of golden.annotations.entries()) {
      const actual = annotations[index];
      expect(actual?.onsetSecondsFromFirstRecord, expected.text).toBe(fromBits(expected.onsetBits));
      if (expected.durationSeconds < 0) {
        expect(actual?.durationSeconds, expected.text).toBeUndefined();
      } else {
        expect(actual?.durationSeconds, expected.text).toBe(expected.durationSeconds);
      }
    }
  });
});

describe('the hypnogram is the hard case, and is checked as one', () => {
  const enabled = available('SC4001EC-Hypnogram.edf');
  const maybe = enabled ? it : it.skip;

  maybe('reads 154 sleep stages from a file whose record duration is zero', async () => {
    // A zero record duration is legal EDF and a real scoring file relies on it. It is also where
    // `sampleRateHz` becomes undefined and every rate-derived expression yields NaN — so a reader
    // that indexes by rate rather than by record cannot read this file at all.
    const { golden, bytes } = load('SC4001EC-Hypnogram.edf');
    const recording = await openEdf(byteSource(bytes));

    expect(recording.header.recordDurationSeconds).toBe(0);
    expect(golden.annotations.length).toBe(154);

    const { annotations } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });
    expect(annotations).toHaveLength(154);

    // The staging really is staging, and the epochs tile the night without a gap: each stage
    // begins where the previous one ended. That is a property of the FILE, checked against
    // pyEDFlib's own onsets rather than against edfcore's.
    let expectedNext = 0;
    for (const stage of golden.annotations) {
      expect(stage.onsetSeconds, stage.text).toBe(expectedNext);
      expectedNext = stage.onsetSeconds + stage.durationSeconds;
    }
    expect(new Set(golden.annotations.map((a) => a.text)).size).toBeGreaterThan(3);
  });
});

describe.each(CASES)('%s — the full validation sweep', (name) => {
  const enabled = available(name);
  const maybe = enabled ? it : it.skip;

  maybe(
    'observes the same digital extremes pyEDFlib does, over every sample',
    async () => {
      // `validateRecording({ scanSamples: true })` reads every sample of the file and reports what
      // it saw. That is the one number in the report derived from all the data rather than from the
      // header, so it is the one worth checking against another reader — and a sampled window
      // cannot check it, because the extremes of a 22-hour recording are very unlikely to fall in
      // the 256 samples the goldens happened to record.
      const { golden, bytes } = load(name);
      if (golden.signals.length === 0) return; // a scoring file has no samples to scan

      const recording = await openEdf(byteSource(bytes));
      const report = await validateRecording(recording, { scanSamples: true });

      expect(report.recordsScanned).toBe(golden.recordCount);
      for (const expected of golden.signals) {
        const stats = report.signalStats.find((s) => s.signalIndex === expected.index);
        expect(stats, `${expected.label} was not scanned`).toBeDefined();
        expect(stats?.observedDigitalMin, `${expected.label} min`).toBe(
          expected.observedDigitalMin,
        );
        expect(stats?.observedDigitalMax, `${expected.label} max`).toBe(
          expected.observedDigitalMax,
        );
        expect(stats?.sampleCount, `${expected.label} count`).toBe(expected.sampleCount);
      }
    },
    60_000,
  );

  maybe(
    'counts as out-of-range exactly the samples outside the declared bounds',
    async () => {
      // `outOfDigitalRangeCount` is a claim about the declaration, not about the samples: a non-zero
      // count means the header's digital range is wrong, and edfcore never clamps. Recomputing it
      // from pyEDFlib's own observed extremes is the independent check.
      const { golden, bytes } = load(name);
      if (golden.signals.length === 0) return;

      const recording = await openEdf(byteSource(bytes));
      const report = await validateRecording(recording, { scanSamples: true });

      for (const expected of golden.signals) {
        const signal = recording.header.signals[expected.index];
        const stats = report.signalStats.find((s) => s.signalIndex === expected.index);
        if (signal === undefined || stats === undefined) throw new Error('missing signal');

        const low = Math.min(signal.digitalMinimum, signal.digitalMaximum);
        const high = Math.max(signal.digitalMinimum, signal.digitalMaximum);
        const couldBeOutside =
          expected.observedDigitalMin < low || expected.observedDigitalMax > high;

        if (!couldBeOutside) {
          expect(stats.outOfDigitalRangeCount, `${expected.label} is entirely in range`).toBe(0);
        } else {
          expect(
            stats.outOfDigitalRangeCount,
            `${expected.label} exceeds its declaration`,
          ).toBeGreaterThan(0);
        }
      }
    },
    60_000,
  );
});
