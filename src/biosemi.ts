/**
 * The BioSemi Status channel.
 *
 * Layer 7. BioSemi's ActiveTwo writes BDF files whose last channel is labelled `Status`, and its
 * 24-bit samples are not a measurement — they are a bit field the amplifier latched at each
 * sample. The low 16 bits are the parallel trigger input, which is how nearly every ERP
 * experiment records stimulus onsets.
 *
 * Reading that is file access, not analysis. The codes were written by the hardware at
 * acquisition time, exactly like an EDF+ annotation, and this module only reports what is in the
 * bytes. Nothing here inspects a biosignal, so event detection remains a non-goal.
 *
 * Only the bits BioSemi documents are named. `raw` carries all 24 so a caller with a rig-specific
 * convention can decode the rest without waiting for this module to learn about it — inventing
 * meanings for the bits above 18 would be guessing, and a wrong trigger code is worse than none.
 */

import { decodeDigitalCounted } from './decode/digital.js';
import { readRecordBytes } from './io/read.js';
import { scanChunkRecords } from './record-index.js';
import { secondsToTicks, ticksToSeconds } from './tal/ticks.js';
import { resolveTimeWindow } from './time/window.js';
import type {
  EdfHeader,
  EdfRecording,
  EdfSegment,
  EdfSignal,
  EdfStatusWord,
  EdfTriggerEvent,
  ReadOptions,
  RecordRange,
  TriggerSelection,
} from './types.js';

/** BioSemi's own label for the channel. Matched case-insensitively after trimming. */
const STATUS_LABEL = 'status';

/** The parallel input occupies the low 16 bits; the flags sit immediately above it. */
const TRIGGER_MASK = 0xffff;
const EPOCH_BIT = 1 << 16;
const CMS_IN_RANGE_BIT = 1 << 17;
const BATTERY_LOW_BIT = 1 << 18;

/**
 * The `Status` channel of a BDF file, or `undefined` when there is none.
 *
 * Returns `undefined` rather than throwing for a plain EDF or a BDF without the channel: a file
 * having no Status channel is an ordinary fact about the file, not an error.
 */
export function getStatusSignal(header: EdfHeader): EdfSignal | undefined {
  if (header.bytesPerSample !== 3) return undefined;
  for (const index of header.dataSignalIndices) {
    const signal = header.signals[index];
    if (signal !== undefined && signal.label.trim().toLowerCase() === STATUS_LABEL) return signal;
  }
  return undefined;
}

/**
 * Decodes one 24-bit Status sample.
 *
 * `decodeDigital` sign-extends BDF samples, as it must for a measurement, so bit 23 of a Status
 * word arrives as a negative number. The bit field is unsigned, so it is masked back before
 * anything is read out of it.
 */
export function decodeStatusWord(sample: number): EdfStatusWord {
  const raw = sample & 0xffffff;
  return {
    raw,
    trigger: raw & TRIGGER_MASK,
    newEpoch: (raw & EPOCH_BIT) !== 0,
    cmsInRange: (raw & CMS_IN_RANGE_BIT) !== 0,
    batteryLow: (raw & BATTERY_LOW_BIT) !== 0,
  };
}

/**
 * The segment a record belongs to, or `undefined` when the index has not been scanned.
 *
 * `undefined` is not a failure: a probed index has no segments, and `resolveTimeWindow` has
 * already refused one on any file whose span exceeds its coverage — so a caller who gets here
 * without segments has a contiguous file, where the nominal grid IS the true one.
 */
function segmentContaining(
  segments: readonly EdfSegment[] | undefined,
  recordIndex: number,
): EdfSegment | undefined {
  if (segments === undefined) return undefined;
  for (const segment of segments) {
    const first = segment.records.start;
    if (recordIndex >= first && recordIndex < first + segment.records.count) return segment;
  }
  return undefined;
}

/**
 * Every change of the trigger word in a window, as timed events.
 *
 * A parallel trigger is held for as long as the stimulus computer asserts it, so the same code
 * repeats over many samples. What an experimenter wants is the TRANSITION, which is why this
 * reports changes rather than samples: one event per change, carrying the code it changed to.
 *
 * Code 0 is "no trigger asserted", so a return to 0 is reported as an event with `trigger: 0`
 * and is easy to filter out. It is reported rather than dropped because the release time is what
 * gives a trigger its duration.
 *
 * TIMES ARE ELAPSED RECORDING TIME, on the one axis the package uses: `t = 0` is the start of
 * record 0, the same axis `selection.startSeconds`, `chunk.startSeconds` and `segment.startSeconds`
 * live on. A sample's time is its own record's TRUE onset plus its offset within that record —
 * never the record index times the record duration. The two agree on a contiguous file and diverge
 * by the whole gap on an EDF+D one, where the nominal form reported a stimulus at 2 s that the
 * hardware latched at 10 s (fixed in 0.2.18).
 *
 * THE WINDOW IS HONOURED. The scan is record-aligned, because records are the unit of I/O, but a
 * sample outside `[startSeconds, startSeconds + durationSeconds)` is never reported — it only
 * updates the running trigger state. Reporting the whole record would place events outside the
 * window a caller asked for, and, worse, would let the first sample of a record report a
 * "transition" to a code that was already held long before it.
 *
 * At the left edge this reports the code IN FORCE, not only transitions strictly inside: the first
 * in-window sample always produces an event. That is the same rule a whole-file read already
 * follows — `t = 0` yields an event for whatever the first sample holds, transition or not — so an
 * aligned and an unaligned window behave alike. Filter on `trigger` if you only want assertions.
 */
export async function readTriggers(
  recording: EdfRecording,
  selection: TriggerSelection,
  options?: ReadOptions,
): Promise<readonly EdfTriggerEvent[]> {
  const { source, header, timeline } = recording;

  const status = getStatusSignal(header);
  if (status === undefined) {
    throw new RangeError(
      'readTriggers(): this file has no BioSemi Status channel — it is either not a BDF file, ' +
        'or no signal is labelled "Status". Next: check header.signals, or read EDF+ ' +
        'annotations with readAnnotations().',
    );
  }

  const ranges = resolveTimeWindow(
    timeline,
    recording.index,
    selection.startSeconds,
    selection.durationSeconds,
  );

  const windowStartTicks = secondsToTicks(selection.startSeconds);
  const windowEndTicks = windowStartTicks + secondsToTicks(selection.durationSeconds);
  const durationTicks = header.recordDurationTicks;
  const samplesPerRecord = status.samplesPerRecord;

  const events: EdfTriggerEvent[] = [];
  // The last code SEEN, in the window or before it. Carried across runs so a trigger held over a
  // gap is not reported twice, and updated for out-of-window samples too — that is what stops a
  // code asserted before the window from being re-reported as a fresh onset inside it.
  let previous: number | undefined;
  // Whether anything has been reported yet. The first in-window sample is always an event: it
  // carries the code in force at the window's left edge, which a transitions-only rule would lose.
  let reported = false;

  for (const records of ranges) {
    // A range from `resolveTimeWindow` never spans a gap, so one segment covers all of it.
    const segment = segmentContaining(recording.index.segments, records.start);
    const chunkRecords = scanChunkRecords(header, options?.maxMaterializeBytes);
    let scanned = 0;
    let scratch: Int32Array | undefined;

    while (scanned < records.count) {
      const slice: RecordRange = {
        start: records.start + scanned,
        count: Math.min(chunkRecords, records.count - scanned),
      };
      const bytes = await readRecordBytes(source, header, slice, options);
      const decoded = decodeDigitalCounted(header, bytes, slice, status.index, scratch, options);
      scratch = decoded.digital;

      for (let r = 0; r < slice.count; r += 1) {
        const recordIndex = slice.start + r;
        // The record's own start on the recording's axis. From the segment when one has been
        // scanned; from the nominal grid otherwise, which is exact for a contiguous file — and
        // `resolveTimeWindow` has already refused a probed index on a file that is not.
        const recordStartTicks =
          segment === undefined
            ? BigInt(recordIndex) * durationTicks
            : segment.startTicks + BigInt(recordIndex - segment.records.start) * durationTicks;

        for (let s = 0; s < samplesPerRecord; s += 1) {
          const word = decodeStatusWord(decoded.digital[r * samplesPerRecord + s] as number);
          const changed = previous === undefined || word.trigger !== previous;
          previous = word.trigger;

          // A zero record duration puts every sample of the record at its start instant.
          const ticks =
            durationTicks > 0n && samplesPerRecord > 0
              ? recordStartTicks + (BigInt(s) * durationTicks) / BigInt(samplesPerRecord)
              : recordStartTicks;

          if (ticks < windowStartTicks || ticks >= windowEndTicks) continue;
          if (reported && !changed) continue;
          reported = true;

          events.push({
            sampleIndex: recordIndex * samplesPerRecord + s,
            seconds: ticksToSeconds(ticks),
            ticks,
            trigger: word.trigger,
            status: word,
          });
        }
      }

      scanned += slice.count;
    }
  }

  return Object.freeze(events);
}
