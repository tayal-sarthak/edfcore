/**
 * Min/max envelope decimation.
 *
 * Layer 7. A twelve-hour recording at 256 Hz is eleven million samples per channel, and a plot is
 * a thousand pixels wide. Something has to reduce eleven million numbers to a thousand, and which
 * reduction you pick decides whether the picture is true.
 *
 * Taking every 11,000th sample is the obvious choice and the wrong one: a spike, a spindle or an
 * artifact is a handful of samples wide, so subsampling hits it with probability near zero and
 * the trace looks calm exactly where a reader most needs it not to. Keeping the MINIMUM and
 * MAXIMUM of each bucket keeps every extreme, at two numbers per pixel. That is the reduction a
 * waveform viewer wants, and it is why this exists as its own function rather than as an option
 * on `readWindow`: the return type is different, so an option would have to change it.
 *
 * This is decimation for display, not analysis. There is no filtering and no anti-aliasing —
 * an envelope is a faithful summary of the samples that are there, not a resampled signal, and
 * resampling remains a permanent non-goal.
 *
 * Memory is bounded by the record chunk, never by the window: a run of a million records is
 * folded into the buckets a chunk at a time, so an envelope over a whole recording costs the
 * buckets plus one chunk.
 */

import { decodeDigitalCounted } from './decode/digital.js';
import { appendChunkDiagnostics } from './diagnostics/collector.js';
import { EdfBudgetError, EdfChannelNotFoundError, EdfScalingError } from './errors.js';
import { readRecordBytes } from './io/read.js';
import { resolveMaterializeBudget } from './options.js';
import { scanChunkRecords } from './record-index.js';
import { gapBefore } from './recording.js';
import { decodeAnnotations } from './tal/annotations.js';
import { ceilDiv, secondsToTicks, ticksToSeconds } from './tal/ticks.js';
import { resolveTimeWindow } from './time/window.js';
import type {
  EdfChunkSignal,
  EdfDiagnostic,
  EdfEnvelopeChunk,
  EdfEnvelopeSignal,
  EdfHeader,
  EdfPhysicalEnvelope,
  EdfRecording,
  EdfSignal,
  EnvelopeSelection,
  ReadOptions,
  RecordRange,
} from './types.js';

/** `min`, `max` and `counts` are one Int32Array each, so a bucket costs twelve bytes per signal. */
const BYTES_PER_BUCKET = 12;

/**
 * `bucketStartsFor` adds a `Float64Array(bucketCount)` per signal, on the FIXED-WIDTH path only.
 *
 * It is allocated after the budget guard and was not counted by it, so the guard measured 12 bytes
 * per bucket per signal and the call then allocated 20 — 1.67x the budget it had just refused
 * against, on the exact path the budget was added for. A `readEnvelopeAtResolution` call granted
 * the 9,600,000 bytes its own refusal named allocated 16,000,128 (fixed in 0.3.89).
 */
const BYTES_PER_BUCKET_START = 8;

/** Per-signal accumulator, reused across every chunk of one contiguous run. */
interface Accumulator {
  readonly signal: EdfSignal;
  readonly min: Int32Array;
  readonly max: Int32Array;
  readonly counts: Int32Array;
  /** Samples of this signal already folded in, i.e. its position on the run's sample grid. */
  consumed: number;
  outOfRange: number;
  scratch: Int32Array | undefined;
  /**
   * First sample position of each bucket, when the buckets are a fixed WIDTH IN TIME rather than
   * an even division of the run.
   *
   * `undefined` for `readEnvelope`, whose contract is `buckets` — a plot's pixel width — and for
   * which dividing the run evenly is exactly right. Present for `readEnvelopeAtResolution`, whose
   * contract is the width itself. See `bucketStartsFor`.
   */
  bucketStarts: Float64Array | undefined;
  /** Cursor into `bucketStarts`, advanced as samples arrive. Chunk boundaries do not reset it. */
  bucket: number;
}

/**
 * The first sample position of each bucket, for buckets of a fixed width in time.
 *
 * Bucket `b` covers `[b * bucketTicks, (b + 1) * bucketTicks)` of elapsed time within the run, and
 * sample `p` of this signal sits at `p * recordDuration / samplesPerRecord`. So the first sample
 * of bucket `b` is `ceil(b * bucketTicks * samplesPerRecord / recordDuration)`.
 *
 * Computed in bigint, once per signal per run — the array is a plot's worth of entries, not a
 * recording's — so the per-sample loop compares two ordinary numbers. Every boundary is a whole
 * sample index, well inside 2^53.
 */
function bucketStartsFor(
  bucketCount: number,
  bucketTicks: bigint,
  samplesPerRecord: number,
  recordDurationTicks: bigint,
): Float64Array | undefined {
  // Nothing advances in time: every sample of the run is at the same instant, so one bucket holds
  // them all and the even-division rule already says so.
  if (recordDurationTicks <= 0n || samplesPerRecord <= 0) return undefined;
  const starts = new Float64Array(bucketCount);
  const perRecord = BigInt(samplesPerRecord);
  for (let bucket = 1; bucket < bucketCount; bucket += 1) {
    starts[bucket] = Number(ceilDiv(BigInt(bucket) * bucketTicks * perRecord, recordDurationTicks));
  }
  return starts;
}

/**
 * No function name in the message, the way `resolveSignals` on the read path deliberately has
 * none: these helpers are shared by `readEnvelope`, `readEnvelopeAtResolution` and
 * `envelopeOfSamples`, and hard-coding one of the three named the wrong function for the other
 * two (fixed in 0.3.35).
 */
function assertPositiveInteger(value: number, name: string): void {
  if (Number.isSafeInteger(value) && value > 0) return;
  throw new RangeError(
    `${name} must be a positive whole number, received ${value}. ` +
      'Next: pass the pixel width of the plot you are drawing into.',
  );
}

/**
 * Reduces a time window to per-bucket minima and maxima, one chunk per contiguous run.
 *
 * The shape mirrors `readWindow` exactly — an array of chunks, one per run, empty when the window
 * selects nothing — so a caller that already handles gaps handles envelopes for free.
 */
export async function readEnvelope(
  recording: EdfRecording,
  selection: EnvelopeSelection,
  options?: ReadOptions,
): Promise<readonly EdfEnvelopeChunk[]> {
  assertPositiveInteger(selection.buckets, 'buckets');
  // Validated before the window is resolved, for the same reason readWindow does it: a bad
  // signalIndices must not read back as an empty stretch of recording.
  resolveEnvelopeSignals(recording.header, selection.signalIndices);

  const ranges = resolveTimeWindow(
    recording.timeline,
    recording.index,
    selection.startSeconds,
    selection.durationSeconds,
  );

  const chunks: EdfEnvelopeChunk[] = [];
  for (const records of ranges) {
    chunks.push(await reduceRange(recording, records, selection, options));
  }
  return Object.freeze(chunks);
}

function resolveEnvelopeSignals(
  header: EdfHeader,
  signalIndices: readonly number[],
): readonly EdfSignal[] {
  const seen = new Set<number>();
  const signals: EdfSignal[] = [];
  for (const signalIndex of signalIndices) {
    if (seen.has(signalIndex)) continue;
    seen.add(signalIndex);
    const signal = header.signals[signalIndex];
    if (signal === undefined) {
      // `EdfChannelNotFoundError`, matching `resolveSignals` on the read path. The identical
      // mistake — an index outside the file's signals — threw a typed error carrying `selector`
      // and `availableLabels` from `readWindow` and a bare `RangeError` from here, so
      // `isEdfError` answered differently depending on which read the caller had reached for.
      throw new EdfChannelNotFoundError(
        `signalIndex ${signalIndex} is outside the ${header.signals.length} ` +
          'signals this file declares. Next: pass an index from header.dataSignalIndices.',
        { selector: signalIndex, availableLabels: header.signals.map((s) => s.label) },
      );
    }
    if (signal.kind === 'annotations') {
      // A plain `RangeError`, exactly as `resolveSignals` does for this case: handing the
      // annotations channel to a sample read can only ever be a caller's mistake.
      throw new RangeError(
        `signal ${signalIndex} (${JSON.stringify(signal.label)}) is this file's ` +
          'annotations channel; its bytes are TAL text, not samples, so an envelope over them ' +
          'would be an envelope over ASCII. Next: call readAnnotations() instead.',
      );
    }
    signals.push(signal);
  }
  return signals;
}

async function reduceRange(
  recording: EdfRecording,
  records: RecordRange,
  selection: EnvelopeSelection,
  options?: ReadOptions,
  /**
   * Set only by `readEnvelopeAtResolution`: the width every bucket must have, in exact ticks.
   * When absent the run is divided evenly into `selection.buckets`, which is `readEnvelope`'s
   * contract and the right rule for a pixel width.
   */
  bucketTicks?: bigint,
): Promise<EdfEnvelopeChunk> {
  const { source, header, timeline } = recording;
  const signals = resolveEnvelopeSignals(header, selection.signalIndices);
  const diagnostics: EdfDiagnostic[] = [];
  // Across the whole run, not across one scan chunk. See `appendChunkDiagnostics`: this fold makes
  // one `decodeAnnotations` call per chunk, and the chunk size is `maxMaterializeBytes`.
  const cappedSeen = new Set<string>();

  /*
   * The densest-samples clamp belongs to the EVEN-DIVISION rule and to it alone.
   *
   * For `readEnvelope` it is right: the caller asked for a pixel width, more buckets than samples
   * would leave holes that mean nothing, and a smaller count is simply a coarser even division of
   * the same run. For `readEnvelopeAtResolution` it is wrong, because the count is not a free
   * parameter there — it is `ceil(runTicks / bucketTicks)`, and reducing it SHORTENS THE GRID.
   * `bucketStartsFor` was handed the clamped count, so the boundary array covered only
   * `bucketCount * bucketTicks` of elapsed time and `foldChunk`'s cursor pinned every later sample
   * into the final bucket — while `secondsPerBucket` still reported the width that was asked for.
   *
   * A 4 s run of a 2 Hz signal asked at 0.25 s per bucket came back as 8 buckets covering 2 s,
   * with the whole second half of the run in the last one, and nothing in the result said so. A
   * viewer placing bucket b at `startSeconds + b * secondsPerBucket` — the documented way to use
   * this function — drew half the run stacked on one pixel (fixed in 0.3.30).
   *
   * Buckets with no sample are the honest answer for a resolution finer than the data supports:
   * `counts[i]` is 0 and `toPhysicalEnvelope` converts them to NaN (0.3.10), which every plotting
   * library breaks the line at.
   */
  const fixedWidth = bucketTicks !== undefined && bucketTicks > 0n;
  const densestSamples = signals.reduce(
    (most, signal) => Math.max(most, signal.samplesPerRecord * records.count),
    0,
  );
  const bucketCount = fixedWidth
    ? Math.max(1, selection.buckets)
    : Math.max(1, Math.min(selection.buckets, densestSamples));

  // The clamp was also the only thing bounding the allocation. A fixed width fine enough — one
  // microsecond over an hour — asks for billions of buckets, so the ceiling is now stated as a
  // budget and refused before anything is allocated, the way every other allocation in the
  // package is.
  // The fixed-width path allocates the bucket-start array as well; the even-division path does not.
  const perBucketBytes = BYTES_PER_BUCKET + (fixedWidth ? BYTES_PER_BUCKET_START : 0);
  const bucketBytes = bucketCount * perBucketBytes * signals.length;
  const budgetBytes = resolveMaterializeBudget(options?.maxMaterializeBytes);
  if (bucketBytes > budgetBytes) {
    // The hint names the argument the CALLER passed. `reduceRange` is shared, and `fixedWidth` is
    // true only under `readEnvelopeAtResolution`; hard-coding `secondsPerBucket` told a
    // `readEnvelope` caller — whose only knob is `buckets`, a pixel width — to change a parameter
    // its signature does not have, and explained it in terms of a request they never made. That is
    // the mistake the docblock above `resolveEnvelopeSignals` records for the same reason
    // (fixed in 0.3.69).
    const knob = fixedWidth
      ? 'a coarser secondsPerBucket — one finer than the sample interval cannot show more than ' +
        'the samples do'
      : 'fewer buckets — a plot cannot show more of them than it has pixels';
    throw new EdfBudgetError(
      `An envelope of ${bucketCount} buckets over ${signals.length} signal(s) needs a ` +
        `${bucketBytes}-byte accumulator, above the ${budgetBytes}-byte maxMaterializeBytes ` +
        `budget, so it was refused before anything was allocated. Next: ask for ${knob} — or ` +
        'raise options.maxMaterializeBytes.',
      { requiredBytes: bucketBytes, budgetBytes },
    );
  }

  const accumulators: Accumulator[] = signals.map((signal) => ({
    signal,
    // Int32Array zero-fills, so the sentinels have to be written explicitly: a bucket nothing
    // landed in must be distinguishable from a bucket whose samples were all zero.
    min: new Int32Array(bucketCount).fill(0),
    max: new Int32Array(bucketCount).fill(0),
    counts: new Int32Array(bucketCount),
    consumed: 0,
    outOfRange: 0,
    scratch: undefined,
    bucketStarts: !fixedWidth
      ? undefined
      : bucketStartsFor(
          bucketCount,
          bucketTicks as bigint,
          signal.samplesPerRecord,
          header.recordDurationTicks,
        ),
    bucket: 0,
  }));

  const chunkRecords = scanChunkRecords(header, options?.maxMaterializeBytes);
  let byteLength = 0;
  let firstOnsetTicks: bigint | undefined;
  let lastOnsetTicks: bigint | undefined;
  let scanned = 0;

  while (scanned < records.count) {
    const slice: RecordRange = {
      start: records.start + scanned,
      count: Math.min(chunkRecords, records.count - scanned),
    };
    const bytes = await readRecordBytes(source, header, slice, options);
    byteLength += bytes.length;

    // Never strict: a defect in one record must not cost the caller the whole picture.
    const annotations = decodeAnnotations(header, bytes, slice, {
      originTicks: timeline.startOffsetTicks,
    });
    appendChunkDiagnostics(diagnostics, annotations.diagnostics, cappedSeen);
    const onsets = annotations.recordOnsetTicks;
    if (firstOnsetTicks === undefined) firstOnsetTicks = onsets[0];
    const lastInSlice = onsets[slice.count - 1];
    if (lastInSlice !== undefined) lastOnsetTicks = lastInSlice;

    for (const accumulator of accumulators) {
      foldChunk(accumulator, header, bytes, slice, records, bucketCount, options);
    }

    scanned += slice.count;
  }

  const durationTicks = header.recordDurationTicks;
  const startTicks = (firstOnsetTicks ?? timeline.startOffsetTicks) - timeline.startOffsetTicks;
  const spanTicks =
    firstOnsetTicks !== undefined && lastOnsetTicks !== undefined
      ? lastOnsetTicks + durationTicks - firstOnsetTicks
      : durationTicks * BigInt(records.count);
  const startSeconds = ticksToSeconds(startTicks);
  const durationSeconds = ticksToSeconds(spanTicks);

  const envelopeSignals: EdfEnvelopeSignal[] = accumulators.map((accumulator) => ({
    signalIndex: accumulator.signal.index,
    min: accumulator.min,
    max: accumulator.max,
    counts: accumulator.counts,
    sampleCount: accumulator.consumed,
    firstSampleIndex: records.start * accumulator.signal.samplesPerRecord,
    startSeconds,
    startTicks,
    outOfDigitalRangeCount: accumulator.outOfRange,
  }));

  return Object.freeze({
    records,
    startSeconds,
    startTicks,
    durationSeconds,
    durationTicks: spanTicks,
    bucketCount,
    // The width the buckets ACTUALLY have. With a requested width that is the request itself, for
    // every chunk — `durationSeconds / bucketCount` is the width only when the run divides evenly
    // by it, and reporting that made two runs of one call disagree (fixed in 0.3.9). The last
    // bucket of a run is short by whatever the division left over; its `counts` says how short.
    secondsPerBucket:
      bucketTicks !== undefined && bucketTicks > 0n
        ? ticksToSeconds(bucketTicks)
        : bucketCount > 0
          ? durationSeconds / bucketCount
          : 0,
    byteLength,
    signals: Object.freeze(envelopeSignals),
    // The same gap a readWindow chunk would carry. An envelope promises to mirror readWindow,
    // and a viewer that draws envelopes needs the discontinuities just as much as one that
    // draws samples -- more, since at one bucket per pixel a gap is invisible without it.
    precededByGap: gapBefore(recording.index, records.start),
    diagnostics: Object.freeze(diagnostics),
  });
}

/**
 * Folds one chunk of one signal into the buckets.
 *
 * The bucket of a sample is decided by its position on the WHOLE run's grid, not the chunk's, so
 * the chunk size cannot move a sample from one bucket to another. That is the same rule the
 * record scan learned the hard way: chunking bounds memory and must never change the answer.
 */
function foldChunk(
  accumulator: Accumulator,
  header: EdfHeader,
  bytes: Uint8Array,
  slice: RecordRange,
  run: RecordRange,
  bucketCount: number,
  options?: ReadOptions,
): void {
  const totalSamples = accumulator.signal.samplesPerRecord * run.count;
  if (totalSamples === 0) return;

  const decoded = decodeDigitalCounted(
    header,
    bytes,
    slice,
    accumulator.signal.index,
    accumulator.scratch,
    options,
  );
  // decodeDigitalCounted reuses the buffer when it is large enough, so the allocation happens
  // once per signal per run rather than once per chunk.
  accumulator.scratch = decoded.digital;
  accumulator.outOfRange += decoded.outOfDigitalRangeCount;

  const samples = decoded.digital;
  // The buffer is reused across chunks, so it can be LONGER than this slice. The slice's own
  // sample count is what must be folded, or the tail of a previous, larger chunk is counted again.
  const sampleCount = accumulator.signal.samplesPerRecord * slice.count;
  const { min, max, counts } = accumulator;
  let position = accumulator.consumed;

  const starts = accumulator.bucketStarts;
  let cursor = accumulator.bucket;

  for (let i = 0; i < sampleCount; i += 1) {
    const value = samples[i] as number;
    let bucket: number;
    if (starts === undefined) {
      // Integer arithmetic on the run grid: floor(position * buckets / totalSamples). Divides the
      // run evenly, which is `readEnvelope`'s contract — the caller asked for a pixel width.
      bucket = Math.min(bucketCount - 1, Math.floor((position * bucketCount) / totalSamples));
    } else {
      // Buckets of a fixed WIDTH IN TIME. The boundaries are sample positions computed once per
      // run, so this is a cursor advance rather than a division, and it never resets at a chunk
      // boundary — chunking bounds memory and must not change the answer.
      while (cursor + 1 < bucketCount && position >= (starts[cursor + 1] as number)) cursor += 1;
      bucket = cursor;
    }
    const seen = counts[bucket] as number;
    if (seen === 0) {
      min[bucket] = value;
      max[bucket] = value;
    } else {
      if (value < (min[bucket] as number)) min[bucket] = value;
      if (value > (max[bucket] as number)) max[bucket] = value;
    }
    counts[bucket] = seen + 1;
    position += 1;
  }

  accumulator.consumed = position;
  accumulator.bucket = cursor;
}

/**
 * Converts a digital envelope to physical units.
 *
 * Not `toPhysical` applied twice, and the reason is the sign of the gain. The affine transform
 * `bitValue * (offset + digital)` is DECREASING when `bitValue` is negative — a spec-sanctioned
 * arrangement that edfcore reports rather than rejects — and a decreasing map sends the smallest
 * digital value to the largest physical one. Mapping `min` to `min` would then produce an
 * envelope whose lower bound is above its upper bound, and a viewer would draw it inside out.
 */
export function toPhysicalEnvelope(
  signal: EdfSignal,
  envelope: EdfEnvelopeSignal,
  out?: EdfPhysicalEnvelope,
): EdfPhysicalEnvelope {
  const scale = signal.scale;
  if (scale === undefined) {
    throw new EdfScalingError(
      `signal ${signal.index} (${JSON.stringify(signal.label)}) has no usable scale, so its ` +
        'envelope has no physical units. Next: check signal.scale before converting, or plot ' +
        'the digital envelope as it is.',
      { code: 'SCALE_UNAVAILABLE', signalIndex: signal.index, label: signal.label },
    );
  }

  /*
   * `out` reuses the caller's arrays. An envelope is the render-loop path — a viewer redraws on
   * every pan, zoom and resize — so allocating two Float64Arrays per frame is the one allocation
   * here worth letting a caller avoid. `toPhysical` already takes an `out` for the same reason;
   * this is the same contract, including refusing an array that is too short rather than
   * silently writing fewer values than the caller will read.
   */
  const length = envelope.min.length;
  if (out !== undefined && (out.min.length < length || out.max.length < length)) {
    throw new RangeError(
      `out holds ${Math.min(out.min.length, out.max.length)} buckets but this envelope has ` +
        `${length}. Next: size both arrays to envelope.min.length, or omit out and let ` +
        'toPhysicalEnvelope allocate.',
    );
  }
  // A longer `out` is narrowed to a view over its own memory, so reuse allocates nothing while
  // the result length stays equal to the real bucket count.
  const low = out === undefined ? new Float64Array(length) : out.min.subarray(0, length);
  const high = out === undefined ? new Float64Array(length) : out.max.subarray(0, length);
  const decreasing = scale.bitValue < 0;
  const counts = envelope.counts;

  for (let i = 0; i < length; i += 1) {
    /*
     * A bucket no sample landed in is NaN, not a number.
     *
     * `min` and `max` are Int32Arrays, which cannot hold a sentinel outside the sample range, so
     * an empty bucket carries a digital 0 and `counts[i] === 0` is what distinguishes it. In
     * digital units a stray 0 at least looks like nothing. Through the affine transform it stops
     * looking like nothing: `bitValue * (offset + 0)` is `bitValue * offset`, which for a channel
     * declared 0..1000 over a full signed 16-bit range is 500.008 — dead centre of the scale, and
     * indistinguishable from a real reading. A viewer that plots min/max without consulting
     * `counts` therefore drew a flat trace at mid-scale across a hole in the recording.
     *
     * NaN is the one value that cannot be mistaken for a measurement, and every plotting library
     * treats it as a break in the line. `counts` is unchanged and is still the authoritative
     * answer to how many samples a bucket holds (fixed in 0.3.10).
     */
    if (counts[i] === 0) {
      low[i] = Number.NaN;
      high[i] = Number.NaN;
      continue;
    }
    const a = scale.bitValue * (scale.offset + (envelope.min[i] as number));
    const b = scale.bitValue * (scale.offset + (envelope.max[i] as number));
    low[i] = decreasing ? b : a;
    high[i] = decreasing ? a : b;
  }
  return { min: low, max: high };
}

/**
 * The envelope of an already-decoded chunk signal, without another read.
 *
 * For a caller who has samples in hand and wants them plotted: same reduction, same bucket rule,
 * no I/O.
 *
 * `sampleCount` bounds the reduction, not `digital.length`. `EdfChunkSignal` documents
 * `sampleCount` as the truth and every producer inside edfcore makes the two equal — `decodeDigital`
 * narrows an oversized reused buffer with `subarray` before it escapes, so no read path can hand
 * this a padded array. The bound is here because a CALLER can build an `EdfChunkSignal`, and
 * because `mergeChunks` and `trimToWindow` already take `sampleCount` as authoritative: two
 * helpers defending and one not is the worst of the three states, whichever way the contract is
 * eventually written down.
 */
export function envelopeOfSamples(chunkSignal: EdfChunkSignal, buckets: number): EdfEnvelopeSignal {
  assertPositiveInteger(buckets, 'buckets');
  const samples = chunkSignal.digital;
  const total = Math.min(chunkSignal.sampleCount, samples.length);
  const bucketCount = Math.max(1, Math.min(buckets, total));

  const min = new Int32Array(bucketCount);
  const max = new Int32Array(bucketCount);
  const counts = new Int32Array(bucketCount);

  for (let i = 0; i < total; i += 1) {
    const value = samples[i] as number;
    const bucket = Math.min(bucketCount - 1, Math.floor((i * bucketCount) / total));
    const seen = counts[bucket] as number;
    if (seen === 0) {
      min[bucket] = value;
      max[bucket] = value;
    } else {
      if (value < (min[bucket] as number)) min[bucket] = value;
      if (value > (max[bucket] as number)) max[bucket] = value;
    }
    counts[bucket] = seen + 1;
  }

  return {
    signalIndex: chunkSignal.signalIndex,
    min,
    max,
    counts,
    sampleCount: total,
    firstSampleIndex: chunkSignal.firstSampleIndex,
    startSeconds: chunkSignal.startSeconds,
    startTicks: chunkSignal.startTicks,
    outOfDigitalRangeCount: chunkSignal.outOfDigitalRangeCount,
  };
}

/** `Number()` on a large bigint silently loses digits, so the bound is applied in bigint first. */
function clampToSafeInteger(value: bigint): number {
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  return value >= limit ? Number.MAX_SAFE_INTEGER : Math.max(1, Number(value));
}

/**
 * The envelope of a window, at a chosen time resolution rather than a chosen bucket count.
 *
 * `readEnvelope` takes buckets because a plot has a pixel width. This takes seconds per bucket,
 * which is what a fixed-scale view wants — 30 s per bucket for a sleep hypnogram, whatever the
 * window length. Deriving one from the other by hand means dividing and rounding, and rounding
 * the wrong way produces a final bucket covering a sliver of time that reads as a dropout.
 *
 * The bucket count is computed PER RUN, from that run's own span, not once from the window. A
 * chunk covers one record-aligned contiguous run, and a run is not the window: an EDF+D window
 * spanning a gap produces two runs of different lengths, and even a contiguous window that does
 * not start on a record boundary produces a run wider than it asked for. Handing one bucket count
 * to every chunk therefore delivered a different resolution in each — a window of 11 s asked at
 * 1 s per bucket came back as 0.27 s per bucket in one chunk and 0.09 s in the other, which are
 * not commensurable, so a viewer cannot place the two on one axis. That is the whole promise of
 * this function, so it is computed where the run's length is known (fixed in 0.2.31).
 *
 * The bucket count was only half of it. A bucket is a fixed WIDTH IN TIME here, and until 0.3.9
 * the fold still divided each run evenly into its own count — so the width followed the run
 * exactly as before whenever the span was not a whole multiple of the request. A 100 s run at 30 s
 * per bucket got four buckets of 25 s, while a 60 s run in the same call got two of 30 s. The
 * bucket a sample lands in is now decided by WHEN it is, so the last bucket of a run is short by
 * whatever the division left over — the sliver this documentation always described — and every
 * chunk of every call reports the width that was asked for.
 */
export async function readEnvelopeAtResolution(
  recording: EdfRecording,
  selection: {
    readonly signalIndices: readonly number[];
    readonly startSeconds: number;
    readonly durationSeconds: number;
    readonly secondsPerBucket: number;
  },
  options?: ReadOptions,
): Promise<readonly EdfEnvelopeChunk[]> {
  const { secondsPerBucket } = selection;
  if (!Number.isFinite(secondsPerBucket) || secondsPerBucket <= 0) {
    throw new RangeError(
      `readEnvelopeAtResolution(): secondsPerBucket must be a positive finite number, received ` +
        `${secondsPerBucket}.`,
    );
  }
  // Validated before the window is resolved, exactly as `readEnvelope` does it and for the same
  // reason: a bad signalIndices must not read back as an empty stretch of recording.
  resolveEnvelopeSignals(recording.header, selection.signalIndices);

  // Resolved here, rather than inside `readEnvelope`, so each run's own span is known before its
  // bucket count is chosen.
  const ranges = resolveTimeWindow(
    recording.timeline,
    recording.index,
    selection.startSeconds,
    selection.durationSeconds,
  );

  // In exact ticks. `records.count * recordDurationSeconds` is a float64 product, and it lands
  // just ABOVE the true value as readily as below: 3 x 0.1 s is 0.30000000000000004, which
  // divided by a 0.1 s bucket ceils to FOUR buckets over a 0.3 s run. The extra bucket is not
  // empty — the samples are spread across the count that was asked for — so every bucket came out
  // 0.075 s wide, and a caller who asked for 0.1 s per bucket to put two runs on one axis got a
  // resolution that was neither what it requested nor the same between runs. That is the exact
  // failure this function was written to prevent, arriving by a second route (fixed in 0.3.5).
  const durationTicks = recording.header.recordDurationTicks;
  const bucketTicks = secondsToTicks(secondsPerBucket);
  const chunks: EdfEnvelopeChunk[] = [];
  for (const records of ranges) {
    // A run's span is exactly its record count times the record duration: records within one run
    // are contiguous by construction. A zero record duration is legal EDF and leaves no time axis
    // at all, so one bucket is the only honest answer for it.
    const runTicks = BigInt(records.count) * durationTicks;
    // Ceil, not round: 100 s at 30 s per bucket needs four buckets, not three. Three would
    // silently drop the last 10 s off the end of the picture.
    //
    // A `secondsPerBucket` below one tick rounds to zero and has no whole-tick answer. The limit
    // of the request is one bucket per tick, so that is what it gets; `reduceRange` then clamps to
    // one bucket per sample, which is the finest picture the data can support either way.
    const buckets =
      runTicks > 0n
        ? clampToSafeInteger(bucketTicks > 0n ? ceilDiv(runTicks, bucketTicks) : runTicks)
        : 1;
    chunks.push(
      await reduceRange(
        recording,
        records,
        {
          signalIndices: selection.signalIndices,
          startSeconds: selection.startSeconds,
          durationSeconds: selection.durationSeconds,
          buckets,
        },
        options,
        bucketTicks,
      ),
    );
  }
  return Object.freeze(chunks);
}
