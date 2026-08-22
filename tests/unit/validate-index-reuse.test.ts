/**
 * The index `validateRecording` was handed, and whether it is allowed to answer for this file.
 *
 * `api-validate.md` describes the option as "a **complete** index whose onsets the sweep reuses
 * instead of reading them again", and the saving is the whole point: on a discontinuous file the
 * sweep otherwise reads every record a second time. A caller who already built one for `readWindow`
 * hands it over and pays once.
 *
 * Nothing checked what happens when the index does not fit. It is an ordinary mistake to make —
 * a viewer holding indices for several open recordings, a helper that caches one per session, a
 * loop that forgets to rebuild — and the consequence is not a wrong number but a wrong FILE:
 * the segments and gaps of recording A reported as the structure of recording B, in a report
 * whose entire purpose is to say whether this file conforms. A validator that trusted the
 * mismatch would announce gaps that do not exist and stay silent about the ones that do.
 *
 * So the rejection is checked by observation rather than by reading the guard: a rejected index
 * makes the sweep read the onsets itself, and a spy counts that. Three ways an index can fail to
 * fit are covered — the wrong record count, coverage that is only `probed`, and no index at all —
 * against the one that does.
 *
 * What this does NOT distinguish: which of `usableIndex`'s two guards refuses a probed index.
 * `coverage !== 'complete'` and `segments === undefined` are true together for everything this
 * package builds, so removing either one alone changes no answer. What is pinned is that a probed
 * index does not get to speak for the file — the property, not the line that enforces it.
 *
 * The other half is `DISCONTINUITY_IN_CONTINUOUS_FILE` when a file both skips and repeats time.
 * Gaps travel in one array partitioned by sign: an overlap is an entry with a NEGATIVE duration
 * (0.2.69), and counting the array told a reader that a file missing no data had a gap (0.3.3).
 * A file with one of each is the case where the message has to say both, and it was the branch no
 * fixture produced.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf } from '../../src/recording.js';
import type { EdfDiagnostic } from '../../src/types.js';
import { validateRecording } from '../../src/validate.js';
import { spySource } from '../support/spy-source.js';
import { minimalEdfPlus } from '../support/writer.js';

/** Six one-second records, contiguous, EDF+D so the onsets are read rather than derived. */
const CONTIGUOUS = minimalEdfPlus({ plus: 'D', recordCount: 6, recordDurationSeconds: 1 });

/** Four records, so an index built from it has a record count this file does not share. */
const SHORTER = minimalEdfPlus({ plus: 'D', recordCount: 4, recordDurationSeconds: 1 });

/** Reads issued by the validation alone, with everything `openEdf` cost already discounted. */
async function sweepReads(
  bytes: Uint8Array,
  index: (recording: Awaited<ReturnType<typeof openEdf>>) => Promise<unknown> | unknown,
): Promise<number> {
  const spy = spySource(byteSource(bytes));
  const recording = await openEdf(spy);
  const supplied = await index(recording);
  const before = spy.reads.length;
  await validateRecording(recording, { index: supplied as never });
  return spy.reads.length - before;
}

describe('an index that fits the file', () => {
  it('spares the sweep from reading the onsets again', async () => {
    const reads = await sweepReads(CONTIGUOUS, (recording) => buildRecordIndex(recording));
    expect(reads).toBe(0);
  });
});

describe('an index that does not fit it', () => {
  it('is ignored when it was built from a file with a different record count', async () => {
    const other = await openEdf(byteSource(SHORTER));
    const foreign = await buildRecordIndex(other);
    expect(foreign.coverage).toBe('complete');
    expect(foreign.recordCount).not.toBe(6);

    const reads = await sweepReads(CONTIGUOUS, () => foreign);
    // Read them itself rather than answer from a structure belonging to another recording.
    expect(reads).toBeGreaterThan(0);
  });

  it('is ignored when it only probed the file', async () => {
    // What `openEdf` leaves on every recording: two onsets, and no claim about the middle.
    const reads = await sweepReads(CONTIGUOUS, (recording) => recording.index);
    expect(reads).toBeGreaterThan(0);
  });

  it('costs the same as passing none, which is what "ignored" has to mean', async () => {
    const other = await openEdf(byteSource(SHORTER));
    const foreign = await buildRecordIndex(other);
    const withForeign = await sweepReads(CONTIGUOUS, () => foreign);
    const withNone = await sweepReads(CONTIGUOUS, () => undefined);
    expect(withForeign).toBe(withNone);
  });

  it('reaches the same verdict either way', async () => {
    const spy = spySource(byteSource(CONTIGUOUS));
    const recording = await openEdf(spy);
    const good = await validateRecording(recording, { index: await buildRecordIndex(recording) });
    const blind = await validateRecording(recording);
    expect(blind.diagnostics.map((one) => one.code)).toEqual(
      good.diagnostics.map((one) => one.code),
    );
  });
});

/**
 * The structural report, not the drift probe.
 *
 * `DISCONTINUITY_IN_CONTINUOUS_FILE` has two producers: the two-probe check that sees a net
 * drift, and this one, which sees the segmentation. They say different things about the same
 * file and both are correct — `expected` is what tells them apart.
 */
const structural = (diagnostics: readonly EdfDiagnostic[]): EdfDiagnostic | undefined =>
  diagnostics.find(
    (one) =>
      one.code === 'DISCONTINUITY_IN_CONTINUOUS_FILE' && one.expected === '1 contiguous segment',
  );

describe('a continuous file that both skips and repeats time', () => {
  it('counts the gaps and the overlaps apart, and names both', async () => {
    // Marked continuous, then: 0,1,2 contiguous; a two-second hole before 5; and 5.5, which
    // starts before the record at 5 has finished. Monotonic throughout, so the timeline builds.
    const recording = await openEdf(
      byteSource(
        minimalEdfPlus({
          plus: 'C',
          recordCount: 5,
          recordDurationSeconds: 1,
          recordOnsetSeconds: (at: number) => [0, 1, 2, 5, 5.5][at] as number,
        }),
      ),
    );
    const report = await validateRecording(recording, {
      index: await buildRecordIndex(recording),
    });
    const found = structural(report.diagnostics);
    expect(found, 'the file was not reported as discontinuous').toBeDefined();
    expect(found?.message).toContain('1 gap(s) and 1 overlap(s) between them');
  });

  it('says only "gap" when there is no overlap', async () => {
    const recording = await openEdf(
      byteSource(
        minimalEdfPlus({
          plus: 'C',
          recordCount: 4,
          recordDurationSeconds: 1,
          recordOnsetSeconds: (at: number) => (at < 2 ? at : at + 3),
        }),
      ),
    );
    const report = await validateRecording(recording, {
      index: await buildRecordIndex(recording),
    });
    const found = structural(report.diagnostics);
    expect(found?.message).toContain('gap(s) between them');
    expect(found?.message).not.toContain('overlap(s)');
  });
});
