/**
 * The claims that only a real, large recording can test.
 *
 * `SC4001E0-PSG.edf` is 48 MB and 22 hours of clinical polysomnography: 2,650 records of 30 s,
 * with a 100 Hz EEG channel and a 1 Hz temperature channel in the same file. Synthetic fixtures
 * elsewhere in this suite are hundreds of bytes, and several properties edfcore advertises are
 * invisible at that size.
 *
 * What is checked here, and why each one needs this file:
 *
 * - **Envelope decimation is faithful.** `readEnvelope` exists so a viewer can draw eleven million
 *   samples into a thousand pixels, and the claim is that it keeps every extreme. That is checked
 *   against an EXHAUSTIVE reduction of the same samples — which means decoding all 7.95 million of
 *   them, something no small fixture can demonstrate.
 * - **The bucket grid does not move with the read chunk size.** A chunked fold that computed its
 *   bucket on the chunk's grid rather than the run's would give different answers at different
 *   chunk sizes, and on a 265-chunk file the difference is large. On a two-record fixture it is
 *   often zero.
 * - **Memory stays bounded by the chunk, not by the window.** An envelope over 22 hours must not
 *   materialise 22 hours, and the only honest way to show that is to bound the allocation and
 *   watch the read succeed anyway.
 *
 * Skips without the corpus, like everything else here. `npm run corpus:fetch`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readEnvelope } from '../../src/envelope.js';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';

const PSG = join(dirname(fileURLToPath(import.meta.url)), 'files', 'SC4001E0-PSG.edf');
const enabled = existsSync(PSG);
const maybe = enabled ? it : it.skip;

async function psg() {
  return openEdf(byteSource(new Uint8Array(readFileSync(PSG))));
}

/** The reduction done exhaustively, with no reference to the implementation under test. */
function reduceByHand(samples: ArrayLike<number>, buckets: number) {
  const total = samples.length;
  const min = new Array<number>(buckets).fill(Number.POSITIVE_INFINITY);
  const max = new Array<number>(buckets).fill(Number.NEGATIVE_INFINITY);
  const counts = new Array<number>(buckets).fill(0);
  for (let i = 0; i < total; i += 1) {
    const bucket = Math.min(buckets - 1, Math.floor((i * buckets) / total));
    const value = samples[i] as number;
    min[bucket] = Math.min(min[bucket] as number, value);
    max[bucket] = Math.max(max[bucket] as number, value);
    counts[bucket] = (counts[bucket] as number) + 1;
  }
  return { min, max, counts };
}

describe('a 22-hour clinical recording', () => {
  maybe('is what this file claims it is', async () => {
    // Without this the assertions below could pass against some other, smaller file.
    const recording = await psg();
    expect(recording.header.recordCount).toBe(2650);
    expect(recording.header.recordDurationSeconds).toBe(30);
    expect(recording.timeline.spanSeconds).toBe(79_500);
    const eeg = getSignal(recording.header, 'EEG Fpz-Cz');
    expect(eeg.sampleRateHz).toBe(100);
    expect(eeg.sampleCount).toBe(7_950_000);
  });

  maybe(
    'decimates the whole recording exactly as an exhaustive reduction would',
    async () => {
      // 7.95 million samples reduced to 1000 buckets — the actual thing the feature exists for,
      // checked against every sample rather than against a spot value.
      const recording = await psg();
      const eeg = getSignal(recording.header, 'EEG Fpz-Cz');
      const buckets = 1000;

      const [chunk] = await readWindow(recording, {
        signalIndices: [eeg.index],
        startSeconds: 0,
        durationSeconds: recording.timeline.spanSeconds,
      });
      const samples = chunk?.signals[0]?.digital;
      if (samples === undefined) throw new Error('no samples');
      expect(samples.length).toBe(eeg.sampleCount);

      const [envelope] = await readEnvelope(recording, {
        signalIndices: [eeg.index],
        startSeconds: 0,
        durationSeconds: recording.timeline.spanSeconds,
        buckets,
      });
      const actual = envelope?.signals[0];
      if (actual === undefined) throw new Error('no envelope');

      const expected = reduceByHand(samples, envelope?.bucketCount ?? buckets);
      expect([...actual.min]).toEqual(expected.min);
      expect([...actual.max]).toEqual(expected.max);
      expect([...actual.counts]).toEqual(expected.counts);
      expect(actual.sampleCount).toBe(samples.length);
    },
    60_000,
  );

  maybe(
    'gives the same envelope at every read chunk size',
    async () => {
      // 265 chunks versus a handful. A fold that computed its bucket on the CHUNK's grid rather than
      // the run's would diverge here and agree on a two-record fixture.
      const recording = await psg();
      const eeg = getSignal(recording.header, 'EEG Fpz-Cz');
      const selection = {
        signalIndices: [eeg.index],
        startSeconds: 0,
        durationSeconds: recording.timeline.spanSeconds,
        buckets: 997,
      };

      const [wide] = await readEnvelope(recording, selection);
      const [narrow] = await readEnvelope(recording, selection, {
        maxMaterializeBytes: 256 * 1024,
      });

      expect([...(narrow?.signals[0]?.min ?? [])]).toEqual([...(wide?.signals[0]?.min ?? [])]);
      expect([...(narrow?.signals[0]?.max ?? [])]).toEqual([...(wide?.signals[0]?.max ?? [])]);
      expect(narrow?.signals[0]?.sampleCount).toBe(wide?.signals[0]?.sampleCount);
    },
    60_000,
  );

  maybe(
    'envelopes 22 hours under a budget far smaller than the recording',
    async () => {
      // The memory claim, made falsifiable: 22 hours of 100 Hz samples is ~32 MB as Int32. If the
      // window were materialised, a 512 KiB budget would refuse the read.
      const recording = await psg();
      const eeg = getSignal(recording.header, 'EEG Fpz-Cz');

      const [envelope] = await readEnvelope(
        recording,
        {
          signalIndices: [eeg.index],
          startSeconds: 0,
          durationSeconds: recording.timeline.spanSeconds,
          buckets: 1000,
        },
        { maxMaterializeBytes: 512 * 1024 },
      );

      expect(envelope?.bucketCount).toBe(1000);
      expect(envelope?.signals[0]?.sampleCount).toBe(eeg.sampleCount);
    },
    60_000,
  );

  maybe('keeps two channels on their own grids across the whole file', async () => {
    // 100 Hz and 1 Hz in one file. A reader that shared one grid would be wrong by a factor of a
    // hundred at the far end, and only at the far end.
    const recording = await psg();
    const eeg = getSignal(recording.header, 'EEG Fpz-Cz');
    const temp = getSignal(recording.header, 'Temp rectal');

    expect(eeg.sampleRateHz).toBe(100);
    expect(temp.sampleRateHz).toBe(1);

    // The last 30 s of the recording, where a shared-grid error is largest.
    const startSeconds = recording.timeline.spanSeconds - 30;
    const [chunk] = await readWindow(recording, {
      signalIndices: [eeg.index, temp.index],
      startSeconds,
      durationSeconds: 30,
    });

    expect(chunk?.signals[0]?.sampleCount).toBe(3000);
    expect(chunk?.signals[1]?.sampleCount).toBe(30);
    expect(chunk?.signals[0]?.firstSampleIndex).toBe(eeg.sampleCount - 3000);
    expect(chunk?.signals[1]?.firstSampleIndex).toBe(temp.sampleCount - 30);
  });
});
