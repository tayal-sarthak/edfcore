/**
 * The record index: two probes at open, one targeted probe on demand, a full scan only if asked.
 *
 * Layer 6. This module owns the I/O STRATEGY for record onsets and nothing else — what a valid
 * timeline is belongs to `time/timeline.ts`, what a timekeeping TAL is belongs to
 * `tal/annotations.ts`, and segmentation belongs to `time/segments.ts`. Every onset that reaches
 * those modules from here came out of `decodeAnnotations`, so the "first TAL of the first
 * annotation signal" rule has exactly one implementation.
 *
 * Cost is the design constraint. Opening a million-record EDF+D over HTTP must not read the file,
 * so:
 *
 * - a file with no annotation signal is probed ZERO times: without a timekeeping TAL there is no
 *   per-record onset on disk, and record `r` starts at `r * recordDuration` by definition;
 * - otherwise `buildTimeline` probes exactly two records, the first and the last, which detects
 *   any NET drift of the timeline for two reads. It is not a proof of contiguity, and
 *   `time/timeline.ts` says so in the diagnostic it emits;
 * - `onsetTicks(r)` reads that ONE record and memoises the answer, so `locate()` costs
 *   O(log recordCount) reads and a second `locate()` nearby costs almost none;
 * - `buildRecordIndex()` is the only function here that touches every record, it is chunked so
 *   memory stays bounded whatever the file size, and it is never called implicitly.
 *
 * A probe reads a whole data record rather than just the annotation signal's region. That is
 * decision 7 of the design — the unit of I/O is the record range, never the channel range — and
 * it is also what lets `decodeAnnotations` own the timekeeping rule: it requires the record's
 * full bytes, and reading less would mean reimplementing that rule here.
 */

import { DEFAULT_MAX_MATERIALIZE_BYTES } from './constants.js';
import { EdfRangeError } from './errors.js';
import { readRecordBytes } from './io/read.js';
import { decodeAnnotations } from './tal/annotations.js';
import { secondsToTicks, ticksToSeconds } from './tal/ticks.js';
import { buildSegmentation } from './time/segments.js';
import {
  assertMonotonicOnsetArray,
  assertMonotonicOnsets,
  buildTimelineFromProbes,
  type RecordOnsetProbe,
} from './time/timeline.js';
import type {
  BuildIndexOptions,
  ByteSource,
  DecodeAnnotationsOptions,
  EdfDiagnostic,
  EdfGap,
  EdfHeader,
  EdfLocation,
  EdfRecordIndex,
  EdfRecording,
  EdfSegment,
  EdfTimeline,
  OpenOptions,
  ReadOptions,
  RecordRange,
} from './types.js';

/**
 * How much a full scan is allowed to hold at once, independently of `maxMaterializeBytes`.
 *
 * The materialisation budget is a ceiling on what one call may allocate; this is the working set
 * of a traversal that could otherwise read a 13 GB BDF into a single buffer just because the
 * budget permitted it. A scan is sequential, so a bigger block buys nothing.
 */
const SCAN_BLOCK_TARGET_BYTES = 4 * 1024 * 1024;

/** Records per chunk of a full traversal: bounded memory, and never fewer than one record. */
export function scanChunkRecords(header: EdfHeader, maxMaterializeBytes?: number): number {
  const budget = Math.min(
    SCAN_BLOCK_TARGET_BYTES,
    maxMaterializeBytes ?? DEFAULT_MAX_MATERIALIZE_BYTES,
  );
  if (header.recordByteLength <= 0) return 1;
  return Math.max(1, Math.floor(budget / header.recordByteLength));
}

/**
 * The onset a record has when the file carries no timekeeping TAL to read.
 *
 * Not a fallback for a missing TAL — `decodeAnnotations` owns that case and reports it — but the
 * definition for a plain EDF or BDF file, where record onsets are not stored at all.
 */
function nominalOnsetTicks(header: EdfHeader, recordIndex: number): bigint {
  return BigInt(recordIndex) * header.recordDurationTicks;
}

/** True when the file stores per-record onsets, i.e. when probing can learn anything. */
function hasTimekeeping(header: EdfHeader): boolean {
  return header.annotationSignalIndices.length > 0;
}

interface OnsetProbe {
  readonly ticks: bigint;
  readonly diagnostics: readonly EdfDiagnostic[];
}

async function probeOnset(
  source: ByteSource,
  header: EdfHeader,
  recordIndex: number,
  options?: DecodeAnnotationsOptions & ReadOptions,
): Promise<OnsetProbe> {
  const records: RecordRange = { start: recordIndex, count: 1 };
  const bytes = await readRecordBytes(source, header, records, options);
  const decoded = decodeAnnotations(header, bytes, records, options);
  // decodeAnnotations fills one entry per record in the range, always; the range is one record.
  const ticks = decoded.recordOnsetTicks[0] ?? nominalOnsetTicks(header, recordIndex);
  return { ticks, diagnostics: decoded.diagnostics };
}

interface IndexInput {
  readonly coverage: 'probed' | 'complete';
  readonly recordCount: number;
  readonly recordDurationTicks: bigint;
  /** Record 0's own onset. Subtracting it turns a stored onset into elapsed recording time. */
  readonly startOffsetTicks: bigint;
  readonly segments: readonly EdfSegment[] | undefined;
  readonly gaps: readonly EdfGap[] | undefined;
  readonly onsetOf: (recordIndex: number, options?: ReadOptions) => Promise<bigint>;
}

/**
 * The one `EdfRecordIndex` implementation.
 *
 * `locate` is written against `onsetOf` alone, so the probed index and the complete one share it:
 * the first pays one read per probe and memoises, the second answers from an array it already
 * has. The search is the same either way, and so is its behaviour at a gap.
 */
function createIndex(input: IndexInput): EdfRecordIndex {
  const { recordCount, recordDurationTicks, startOffsetTicks, onsetOf } = input;

  function assertRecordIndex(recordIndex: number): void {
    if (Number.isSafeInteger(recordIndex) && recordIndex >= 0 && recordIndex < recordCount) {
      return;
    }
    throw new EdfRangeError(
      `record ${recordIndex} is not one of the ${recordCount} data records this file contains, ` +
        'so it has no onset to read. Next: pass an index in ' +
        `0..${recordCount - 1}, or call locate(seconds) to find one for a time.`,
      { requested: { start: recordIndex, count: 1 }, available: { start: 0, count: recordCount } },
    );
  }

  async function onsetTicks(recordIndex: number, options?: ReadOptions): Promise<bigint> {
    assertRecordIndex(recordIndex);
    return onsetOf(recordIndex, options);
  }

  /**
   * The last record whose onset is at or before `targetTicks`, or `undefined` when every record
   * starts after it.
   *
   * Binary search over a monotonic sequence, and monotonicity is verified at every pair the
   * search actually observes: a violation makes every time-based answer for the file wrong, so
   * `assertMonotonicOnsets` throws rather than letting the search return a plausible record.
   */
  async function findRecordAtOrBefore(
    targetTicks: bigint,
    options?: ReadOptions,
  ): Promise<{ recordIndex: number; onsetTicks: bigint } | undefined> {
    let low = 0;
    let lowTicks = await onsetOf(0, options);
    if (targetTicks < lowTicks) return undefined;

    let high = recordCount - 1;
    if (high === low) return { recordIndex: low, onsetTicks: lowTicks };

    let highTicks = await onsetOf(high, options);
    assertMonotonicOnsets(
      { recordIndex: low, onsetTicks: lowTicks },
      { recordIndex: high, onsetTicks: highTicks },
    );
    if (targetTicks >= highTicks) return { recordIndex: high, onsetTicks: highTicks };

    // Invariant: lowTicks <= target < highTicks, and low < high.
    while (high - low > 1) {
      const middle = low + Math.floor((high - low) / 2);
      const middleTicks = await onsetOf(middle, options);
      assertMonotonicOnsets(
        { recordIndex: low, onsetTicks: lowTicks },
        { recordIndex: middle, onsetTicks: middleTicks },
      );
      assertMonotonicOnsets(
        { recordIndex: middle, onsetTicks: middleTicks },
        { recordIndex: high, onsetTicks: highTicks },
      );
      if (middleTicks <= targetTicks) {
        low = middle;
        lowTicks = middleTicks;
      } else {
        high = middle;
        highTicks = middleTicks;
      }
    }
    return { recordIndex: low, onsetTicks: lowTicks };
  }

  async function locate(seconds: number, options?: ReadOptions): Promise<EdfLocation | undefined> {
    if (recordCount <= 0) return undefined;
    // `seconds` is elapsed recording time; stored onsets are relative to the header start time.
    const targetTicks = secondsToTicks(seconds) + startOffsetTicks;

    const found = await findRecordAtOrBefore(targetTicks, options);
    if (found === undefined) return undefined;

    const recordStartSeconds = ticksToSeconds(found.onsetTicks - startOffsetTicks);
    if (recordDurationTicks === 0n) {
      // Zero-duration records occupy no time, so only the instant itself is inside one. The last
      // record sharing that instant is the one returned, which is what the search converges on.
      if (targetTicks !== found.onsetTicks) return undefined;
      return {
        recordIndex: found.recordIndex,
        recordStartSeconds,
        offsetInRecordSeconds: 0,
      };
    }

    // Past the end of the record it follows: the time is in a gap, or after the recording.
    if (targetTicks >= found.onsetTicks + recordDurationTicks) return undefined;
    return {
      recordIndex: found.recordIndex,
      recordStartSeconds,
      offsetInRecordSeconds: ticksToSeconds(targetTicks - found.onsetTicks),
    };
  }

  return {
    coverage: input.coverage,
    recordCount,
    segments: input.segments,
    gaps: input.gaps,
    onsetTicks,
    locate,
  };
}

/**
 * The timeline and a lazily probing index, for two reads at most.
 *
 * The probes are records 0 and `recordCount - 1` (one probe for a single-record file, none at all
 * when the file has no annotation signal). Both are memoised into the index, so `onsetTicks(0)`
 * and `onsetTicks(recordCount - 1)` are free after `openEdf`.
 *
 * `index.coverage` stays `'probed'` and `index.segments`/`index.gaps` stay `undefined` until
 * `buildRecordIndex()` promotes them. Nothing on the returned object can be mistaken for a
 * verified statement that the recording is continuous.
 */
export async function buildTimeline(
  source: ByteSource,
  header: EdfHeader,
  options?: OpenOptions,
): Promise<{ timeline: EdfTimeline; index: EdfRecordIndex }> {
  const recordCount = header.recordCount;
  const timekept = hasTimekeeping(header);
  const strict = options?.strict === true;

  const probeOptions = (
    readOptions: ReadOptions | undefined,
    originTicks?: bigint,
  ): DecodeAnnotationsOptions & ReadOptions => {
    const base = readOptions === undefined ? { strict } : { ...readOptions, strict };
    return originTicks === undefined ? base : { ...base, originTicks };
  };

  const memo = new Map<number, bigint>();
  const probes: RecordOnsetProbe[] = [];
  const probeDiagnostics: EdfDiagnostic[] = [];

  const probeIndices = recordCount === 0 ? [] : recordCount === 1 ? [0] : [0, recordCount - 1];
  for (const recordIndex of probeIndices) {
    if (!timekept) {
      const ticks = nominalOnsetTicks(header, recordIndex);
      memo.set(recordIndex, ticks);
      probes.push({ recordIndex, onsetTicks: ticks });
      continue;
    }
    // Record 0 is probed first and defines the origin, so by the time the last record is probed
    // its true onset is in `memo`. Without handing it over, a last record with no timekeeping TAL
    // derived its onset from zero and appeared to sit `startOffset` seconds early — enough to
    // fake a discontinuity in a conforming file and make readWindow refuse every window in it.
    const probe = await probeOnset(source, header, recordIndex, probeOptions(options, memo.get(0)));
    memo.set(recordIndex, probe.ticks);
    probeDiagnostics.push(...probe.diagnostics);
    probes.push({ recordIndex, onsetTicks: probe.ticks });
  }

  const timeline = buildTimelineFromProbes({ header, probes, probeDiagnostics }, options);

  async function onsetOf(recordIndex: number, readOptions?: ReadOptions): Promise<bigint> {
    const cached = memo.get(recordIndex);
    if (cached !== undefined) return cached;
    if (!timekept) {
      const ticks = nominalOnsetTicks(header, recordIndex);
      memo.set(recordIndex, ticks);
      return ticks;
    }
    const probe = await probeOnset(
      source,
      header,
      recordIndex,
      probeOptions(readOptions, timeline.startOffsetTicks),
    );
    memo.set(recordIndex, probe.ticks);
    return probe.ticks;
  }

  const index = createIndex({
    coverage: 'probed',
    recordCount,
    recordDurationTicks: header.recordDurationTicks,
    startOffsetTicks: timeline.startOffsetTicks,
    segments: undefined,
    gaps: undefined,
    onsetOf,
  });

  return { timeline, index };
}

/**
 * Every record's onset, read in bounded chunks.
 *
 * `onProgress` is called once per chunk with the number of records finished, so a caller can show
 * a bar for the one operation in edfcore whose cost is proportional to the file.
 *
 * A file with no annotation signal is not scanned: its record onsets are arithmetic, so reading
 * the data would answer a question the bytes do not contain. `onProgress` is still called once,
 * with the traversal complete, so a caller's bar finishes.
 */
async function scanOnsets(
  recording: EdfRecording,
  options: BuildIndexOptions | undefined,
): Promise<BigInt64Array> {
  const { source, header } = recording;
  const recordCount = header.recordCount;
  const onsets = new BigInt64Array(recordCount);

  if (!hasTimekeeping(header)) {
    for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
      onsets[recordIndex] = nominalOnsetTicks(header, recordIndex);
    }
    options?.onProgress?.(recordCount, recordCount);
    return onsets;
  }

  const chunkRecords = scanChunkRecords(header, options?.maxMaterializeBytes);
  let scanned = 0;
  while (scanned < recordCount) {
    const records: RecordRange = {
      start: scanned,
      count: Math.min(chunkRecords, recordCount - scanned),
    };
    const bytes = await readRecordBytes(source, header, records, options);
    // The origin comes from the recording, not from whatever this chunk happens to contain.
    // Chunking is a memory-bounding detail and must not change the answer: without this, a chunk
    // holding no observed onset derived from zero, so the onsets, the segments, the gaps and
    // even a fatal TIMELINE_NOT_MONOTONIC varied with maxMaterializeBytes.
    const decoded = decodeAnnotations(header, bytes, records, {
      ...options,
      originTicks: recording.timeline.startOffsetTicks,
    });
    onsets.set(decoded.recordOnsetTicks, scanned);
    scanned += records.count;
    options?.onProgress?.(scanned, recordCount);
  }
  return onsets;
}

/**
 * A `'complete'` index: every onset verified, with the segments and gaps they imply.
 *
 * This is one of only two functions that read the whole file, the other being `validateRecording`, and it is never called
 * implicitly. Its diagnostics are deliberately not returned — an `EdfRecordIndex` is a
 * structural answer, and `validateRecording()` is the call that reports on a traversal — but a
 * non-monotonic timeline still throws, because no index over it would mean anything.
 *
 * `EdfRecording` is a plain struct, so the returned index is used by rebuilding one:
 * `readWindow({ ...recording, index }, selection)`.
 */
export async function buildRecordIndex(
  recording: EdfRecording,
  options?: BuildIndexOptions,
): Promise<EdfRecordIndex> {
  const { header, timeline } = recording;
  const onsets = await scanOnsets(recording, options);
  assertMonotonicOnsetArray(onsets);

  const segmentation = buildSegmentation(
    onsets,
    header.recordDurationTicks,
    timeline.startOffsetTicks,
  );

  async function onsetOf(recordIndex: number): Promise<bigint> {
    // Bounds were checked by `createIndex` before this is reached.
    return onsets[recordIndex] ?? nominalOnsetTicks(header, recordIndex);
  }

  return createIndex({
    coverage: 'complete',
    recordCount: header.recordCount,
    recordDurationTicks: header.recordDurationTicks,
    startOffsetTicks: timeline.startOffsetTicks,
    segments: segmentation.segments,
    gaps: segmentation.gaps,
    onsetOf,
  });
}
