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
import { EdfScalingError } from './errors.js';
import { readRecordBytes } from './io/read.js';
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
}

function assertPositiveInteger(value: number, name: string): void {
  if (Number.isSafeInteger(value) && value > 0) return;
  throw new RangeError(
    `readEnvelope(): ${name} must be a positive whole number, received ${value}. ` +
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
      throw new RangeError(
        `readEnvelope(): signalIndex ${signalIndex} is outside the ${header.signals.length} ` +
          'signals this file declares. Next: pass an index from header.dataSignalIndices.',
      );
    }
    if (signal.kind === 'annotations') {
      throw new RangeError(
        `readEnvelope(): signal ${signalIndex} (${JSON.stringify(signal.label)}) is this file's ` +
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
): Promise<EdfEnvelopeChunk> {
  const { source, header, timeline } = recording;
  const signals = resolveEnvelopeSignals(header, selection.signalIndices);
  const diagnostics: EdfDiagnostic[] = [];

  // More buckets than the densest signal has samples in this run would leave holes that mean
  // nothing, so the request is clamped rather than honoured literally.
  const densestSamples = signals.reduce(
    (most, signal) => Math.max(most, signal.samplesPerRecord * records.count),
    0,
  );
  const bucketCount = Math.max(1, Math.min(selection.buckets, densestSamples));

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
    for (const diagnostic of annotations.diagnostics) diagnostics.push(diagnostic);
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
    outOfDigitalRangeCount: accumulator.outOfRange,
  }));

  return Object.freeze({
    records,
    startSeconds,
    durationSeconds,
    bucketCount,
    secondsPerBucket: bucketCount > 0 ? durationSeconds / bucketCount : 0,
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

  for (let i = 0; i < sampleCount; i += 1) {
    const value = samples[i] as number;
    // Integer arithmetic on the run grid: floor(position * buckets / totalSamples).
    const bucket = Math.min(bucketCount - 1, Math.floor((position * bucketCount) / totalSamples));
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

  for (let i = 0; i < length; i += 1) {
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
      ),
    );
  }
  return Object.freeze(chunks);
}
