/**
 * `locate` at the edges of a file, where `undefined` has to mean the right thing.
 *
 * `discontinuous.md` states the contract in one sentence: "`undefined` means the instant is in a
 * gap or outside the recording, never that the lookup failed." The gap half is well covered —
 * `segment-at.test.ts`, `discontinuous.test.ts` and the page's own worked example all land in one.
 * The other half, and the degenerate files, were not.
 *
 * They matter because a caller cannot distinguish them. A viewer scrubbing to a timestamp gets
 * `undefined` and draws nothing; if that came from a search that quietly ran off the end of an
 * array, it would draw nothing for a time that does exist, and the recording would appear to be
 * missing data it holds. The refusals are the API here.
 *
 * Four shapes, each a different branch of the search:
 *
 *  - **Before the first record.** The binary search reads onset 0 first and returns before it
 *    reads anything else, which is also the only place a negative time can end up.
 *  - **A file with one record.** There is no interval to bisect: the search has to answer from
 *    the single onset it already holds.
 *  - **A file with no records.** There is nothing to search, and every instant is outside.
 *  - **Records of zero duration.** They occupy no time, so only the instant itself is inside one,
 *    and `locate` at that instant answers with the LAST record sharing it — which is where the
 *    search converges, and the only defensible answer when several records claim one moment.
 *
 * `onsetTicks` is the other refusal on this object, and the one a caller reaches by arithmetic:
 * an index computed from a duration and a rate is exactly where a fractional or out-of-range
 * number comes from.
 *
 * What this does NOT distinguish: the `high === low` shortcut inside the search. Removing it
 * leaves the answer and the read count unchanged, because `openEdf` has already memoised record
 * 0 and the second endpoint is then the same memoised onset. It is a shortcut past comparing a
 * record with itself, not a behaviour, and pinning it would mean asserting on internals.
 */

import { describe, expect, it } from 'vitest';
import { EdfRangeError } from '../../src/errors.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import type { EdfRecording } from '../../src/types.js';
import { spySource } from '../support/spy-source.js';
import { buildEdf, type EdfSpec, minimalEdfPlus } from '../support/writer.js';

/** Plain EDF, one signal, no annotations: the degenerate files below are not EDF+ questions. */
const plain = (overrides: Omit<EdfSpec, 'signals'>): Uint8Array =>
  buildEdf({ ...overrides, signals: [{ label: 'Fp1', samplesPerRecord: 4 }] });

const open = (bytes: Uint8Array): Promise<EdfRecording> => openEdf(byteSource(bytes));

describe('a time before the recording starts', () => {
  it('is outside it, not the first record', async () => {
    const recording = await open(minimalEdfPlus({ recordCount: 4, recordDurationSeconds: 1 }));
    expect(await recording.index.locate(-1)).toBeUndefined();
    // Not a rounding matter: the instant one tick before zero is already outside.
    expect(await recording.index.locate(-1e-7)).toBeUndefined();
    // And zero itself is inside record 0, so the boundary is where it is claimed to be.
    expect(await recording.index.locate(0)).toMatchObject({ recordIndex: 0 });
  });

  it('is refused before the search reads a second onset', async () => {
    const spy = spySource(
      byteSource(minimalEdfPlus({ recordCount: 64, recordDurationSeconds: 1 })),
    );
    const recording = await openEdf(spy);
    const before = spy.reads.length;
    expect(await recording.index.locate(-5)).toBeUndefined();
    // openEdf already memoised records 0 and 63 for its timekeeping probes, so a search that
    // returned on the first comparison issues nothing at all.
    expect(spy.reads.length).toBe(before);
  });
});

describe('a file with one record', () => {
  it('answers from the one onset it has, and costs no read to do it', async () => {
    const spy = spySource(byteSource(minimalEdfPlus({ recordCount: 1, recordDurationSeconds: 1 })));
    const recording = await openEdf(spy);
    const before = spy.reads.length;
    expect(await recording.index.locate(0.5)).toMatchObject({
      recordIndex: 0,
      recordStartSeconds: 0,
      offsetInRecordSeconds: 0.5,
    });
    expect(spy.reads.length).toBe(before);
  });

  it('still refuses the time after the end of it', async () => {
    const recording = await open(minimalEdfPlus({ recordCount: 1, recordDurationSeconds: 1 }));
    expect(await recording.index.locate(1)).toBeUndefined();
    expect(await recording.index.locate(1.5)).toBeUndefined();
    expect(await recording.index.locate(-1)).toBeUndefined();
  });
});

describe('a file with no records at all', () => {
  it('has no instant inside it', async () => {
    const recording = await open(plain({ recordCount: 0, recordDurationSeconds: 1 }));
    expect(recording.header.recordCount).toBe(0);
    expect(await recording.index.locate(0)).toBeUndefined();
    expect(await recording.index.locate(1)).toBeUndefined();
    // Not a throw. A header with no data records is a real file, and this is a question about
    // its contents rather than a mistake by the caller.
    expect(await recording.index.locate(-1)).toBeUndefined();
  });
});

describe('records that occupy no time', () => {
  it('contain the instant they start on and nothing else', async () => {
    const recording = await open(plain({ recordCount: 3, recordDurationSeconds: 0 }));
    // The file is diagnosed rather than refused: `strict` is off by default.
    expect(recording.header.diagnostics.map((one) => one.code)).toContain('ZERO_RECORD_DURATION');

    // Every record shares t = 0, and the last one is the answer: with no duration there is no
    // interval to prefer an earlier one by, and the search converges on the last of the equals.
    expect(await recording.index.locate(0)).toMatchObject({
      recordIndex: 2,
      offsetInRecordSeconds: 0,
      offsetInRecordTicks: 0n,
    });
    // Anything else is outside every one of them.
    expect(await recording.index.locate(0.5)).toBeUndefined();
    expect(await recording.index.locate(1)).toBeUndefined();
  });
});

describe('onsetTicks, which is a question about a record rather than a time', () => {
  it.each([-1, 2, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    'refuses record %p with the range it could have asked for',
    async (bad) => {
      const recording = await open(minimalEdfPlus({ recordCount: 2 }));
      const failure = await recording.index.onsetTicks(bad).then(
        () => undefined,
        (thrown: unknown) => thrown as EdfRangeError,
      );
      expect(failure).toBeInstanceOf(EdfRangeError);
      expect(failure?.message).toContain(`record ${bad}`);
      expect(failure?.message).toContain('0..1');
      // The fields a handler branches on, rather than the message it prints.
      expect(failure?.requested).toEqual({ start: bad, count: 1 });
      expect(failure?.available).toEqual({ start: 0, count: 2 });
      // And the way out that does not require the caller to know the count.
      expect(failure?.message).toContain('locate(seconds)');
    },
  );

  it('answers the indices that are records', async () => {
    const recording = await open(minimalEdfPlus({ recordCount: 2 }));
    expect(await recording.index.onsetTicks(0)).toBe(0n);
    expect(await recording.index.onsetTicks(1)).toBe(10_000_000n);
  });
});
