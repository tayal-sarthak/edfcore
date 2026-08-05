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
import { ticksToSeconds } from './tal/ticks.js';
import { resolveTimeWindow } from './time/window.js';
import type {
  EdfHeader,
  EdfRecording,
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
 * Every change of the trigger word in a window, as timed events.
 *
 * A parallel trigger is held for as long as the stimulus computer asserts it, so the same code
 * repeats over many samples. What an experimenter wants is the TRANSITION, which is why this
 * reports changes rather than samples: one event per change, carrying the code it changed to.
 *
 * Code 0 is "no trigger asserted", so a return to 0 is reported as an event with `trigger: 0`
 * and is easy to filter out. It is reported rather than dropped because the release time is what
 * gives a trigger its duration.
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

  const events: EdfTriggerEvent[] = [];
  // Carried across runs so a trigger held over a gap is not reported twice. `undefined` means
  // nothing has been seen yet, which is what makes the very first sample an event.
  let previous: number | undefined;

  for (const records of ranges) {
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

      const sampleCount = status.samplesPerRecord * slice.count;
      const firstSampleIndex = slice.start * status.samplesPerRecord;

      for (let i = 0; i < sampleCount; i += 1) {
        const word = decodeStatusWord(decoded.digital[i] as number);
        if (previous !== undefined && word.trigger === previous) continue;
        previous = word.trigger;

        const sampleIndex = firstSampleIndex + i;
        const ticks =
          header.recordDurationTicks > 0n && status.samplesPerRecord > 0
            ? (BigInt(sampleIndex) * header.recordDurationTicks) / BigInt(status.samplesPerRecord)
            : 0n;
        events.push({
          sampleIndex,
          seconds: ticksToSeconds(ticks),
          ticks,
          trigger: word.trigger,
          status: word,
        });
      }

      scanned += slice.count;
    }
  }

  return Object.freeze(events);
}
