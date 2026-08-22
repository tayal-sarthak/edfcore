/**
 * A file with no annotations signal has no onsets to read.
 *
 * Plain EDF and plain BDF carry no timekeeping TALs, so record `r` starts at
 * `r * recordDuration` by definition — there is nothing in the data to consult, and reading it
 * would answer a question the bytes do not contain. `record-index.ts` says exactly that, twice:
 * once for the search, which falls back to the nominal grid rather than probing, and once for the
 * full scan, which fills the array arithmetically and returns without a read.
 *
 * The consequence is a cost, and cost is the whole reason the index is shaped the way it is.
 * `locate-cost.test.ts` pins the EDF+ numbers the page prints — `O(log recordCount)` reads,
 * memoised — for a file whose onsets have to be read. For the majority of files in the world,
 * which are plain EDF, the number is zero, and nothing said so. A refactor that probed
 * unconditionally would be invisible in every result: the answers are identical, because the
 * probe would find the arithmetic value written nowhere and derive it anyway. Only the request
 * count changes, and on a remote recording that is the difference between opening a file and
 * paying for one range request per step of a binary search.
 *
 * `buildRecordIndex` is the sharper case. On an EDF+ file it is a full traversal, which is why the
 * page tells you to gate it on the two-probe verdict. On a plain EDF it must be free — and it
 * still has to call `onProgress` once, with the traversal complete, so a caller's progress bar
 * finishes rather than hanging at zero on the fastest possible file.
 *
 * What this does NOT check: that the arithmetic onsets are RIGHT for a file that has timekeeping
 * and disagrees with them. That is the whole subject of `discontinuous.test.ts` and of the
 * timeline layer; the claim here is only that a file with nothing to read is not read.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { type SpySource, spySource } from '../support/spy-source.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const RECORDS = 32;

/** Plain EDF: one data signal, no annotations signal, so no timekeeping anywhere in the file. */
const PLAIN = buildEdf({
  recordCount: RECORDS,
  recordDurationSeconds: 1,
  signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
});

/** The same geometry as EDF+C, where every onset is written in the file and has to be read. */
const PLUS = minimalEdfPlus({ recordCount: RECORDS, recordDurationSeconds: 1 });

async function opened(bytes: Uint8Array): Promise<{ spy: SpySource; recording: EdfRecording }> {
  const spy = spySource(byteSource(bytes));
  return { spy, recording: await openEdf(spy) };
}

describe('the search over a file with no timekeeping', () => {
  it('costs nothing, wherever it lands', async () => {
    const { spy, recording } = await opened(PLAIN);
    const before = spy.reads.length;
    for (const seconds of [0.5, 7.5, 15.5, 23.5, 31.5]) {
      expect(await recording.index.locate(seconds), `locate(${seconds})`).toMatchObject({
        recordIndex: Math.floor(seconds),
      });
    }
    expect(spy.reads.length - before).toBe(0);
  });

  it('is the contrast that makes the zero mean something', async () => {
    // The same five questions of a file whose onsets are written down, which does read.
    const { spy, recording } = await opened(PLUS);
    const before = spy.reads.length;
    for (const seconds of [0.5, 7.5, 15.5, 23.5, 31.5]) await recording.index.locate(seconds);
    expect(spy.reads.length - before).toBeGreaterThan(0);
  });

  it('answers every record from arithmetic, not from the file', async () => {
    const { spy, recording } = await opened(PLAIN);
    const before = spy.reads.length;
    for (let at = 0; at < RECORDS; at += 1) {
      expect(await recording.index.onsetTicks(at), `record ${at}`).toBe(BigInt(at) * 10_000_000n);
    }
    expect(spy.reads.length - before).toBe(0);
  });
});

describe('the full scan of one', () => {
  it('reads nothing, which is what "not scanned" has to mean', async () => {
    const { spy, recording } = await opened(PLAIN);
    const before = spy.reads.length;
    const index = await buildRecordIndex(recording);
    expect(spy.reads.length - before).toBe(0);
    expect(index.coverage).toBe('complete');
  });

  it('finishes the progress bar rather than leaving it at zero', async () => {
    const { recording } = await opened(PLAIN);
    const calls: Array<readonly [number, number]> = [];
    await buildRecordIndex(recording, {
      onProgress: (done, total) => {
        calls.push([done, total]);
      },
    });
    // Once, complete: the fastest possible file must not be the one whose bar never moves.
    expect(calls).toEqual([[RECORDS, RECORDS]]);
  });

  it('reports the file as one contiguous run, because arithmetic onsets cannot gap', async () => {
    const { recording } = await opened(PLAIN);
    const index = await buildRecordIndex(recording);
    expect(index.segments).toHaveLength(1);
    expect(index.segments?.[0]?.records).toEqual({ start: 0, count: RECORDS });
    expect(index.gaps).toEqual([]);
  });

  it('agrees with the probed index it replaces, question for question', async () => {
    const { recording } = await opened(PLAIN);
    const complete = await buildRecordIndex(recording);
    for (const seconds of [0, 0.5, 7.5, 31.999, 32, -1]) {
      expect(await complete.locate(seconds), `locate(${seconds})`).toEqual(
        await recording.index.locate(seconds),
      );
    }
  });
});
