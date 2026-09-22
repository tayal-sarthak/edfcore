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
 * meanings for the undocumented ones would be guessing, and a wrong trigger code is worse than
 * none.
 */

import { BDF_DIGITAL_MIN } from './constants.js';
import { decodeDigitalCounted } from './decode/digital.js';
import { EdfAmbiguousChannelError } from './errors.js';
import { readRecordBytes } from './io/read.js';
import { assertReadOptions } from './io/source.js';
import { scanChunkRecords } from './record-index.js';
import { assertRecording, assertSelection, gapBefore } from './recording.js';
import { ceilDiv, secondsToTicks, ticksToSeconds } from './tal/ticks.js';
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

/**
 * `undefined`, `an object`, `NaN`, `1.5` — named as itself, since `&` would have taken them all.
 *
 * The article is written out here rather than left off, and `object` is the one `typeof` answer
 * that does not take "a". This was the last of the package's five describers still saying `a
 * object`; 0.6.230 fixed the one behind every read and gave the reason `io/source.ts` states — "an
 * article needs to know that `Uint8Array` is said 'yoo-int', which no rule about vowels gets right,
 * and getting it wrong is the kind of thing a reader notices instead of the message".
 *
 * It is reachable from the mistake this guard exists for. `decodeStatusWord(chunk.signals[0])` —
 * the signal rather than one sample of its `digital` — is an object, and so is the typed array one
 * field along.
 *
 * `null` and `undefined` are answered above the article, so of the six that can still arrive
 * exactly one begins with a vowel.
 */
function describeSample(sample: unknown): string {
  if (sample === null) return 'null';
  if (sample === undefined) return 'undefined';
  if (typeof sample === 'object') return 'an object';
  if (typeof sample !== 'number') return `a ${typeof sample}`;
  return String(sample);
}

/*
 * The Status word, as BioSemi assigns it ("Trigger signals", biosemi.com; the same table is in
 * BIOSIG/FieldTrip's `read_biosemi_bdf`):
 *
 *   0..15  the sixteen parallel trigger inputs
 *   16     high when a new epoch is started
 *   17     speed bit 0
 *   18     speed bit 1
 *   19     speed bit 2
 *   20     high when CMS is within range
 *   21     speed bit 3
 *   22     high when the battery is low
 *   23     high when the amplifier is an ActiveTwo MK2
 *
 * The flags are NOT the two bits immediately above the trigger field. 17 and 18 are speed bits,
 * so until 0.3.54 `cmsInRange` reported speed bit 0 and `batteryLow` reported speed bit 1, and
 * the two bits that carry those flags were never read: an amplifier with CMS genuinely in range
 * reported `cmsInRange: false`, and a rig running at a speed mode with bit 0 set reported
 * `cmsInRange: true` with the CMS bit clear. `trigger` and `newEpoch` were always right.
 *
 * The speed field and the MK2 flag stay unnamed and reachable through `raw`, which is the rule
 * the module docblock states.
 */
const TRIGGER_MASK = 0xffff;
const EPOCH_BIT = 1 << 16;
const CMS_IN_RANGE_BIT = 1 << 20;
const BATTERY_LOW_BIT = 1 << 22;
/** The widest a 24-bit word goes when written unsigned; `BDF_DIGITAL_MIN` is the other end. */
const UNSIGNED_24_BIT_MAX = 0xffffff;

/**
 * The `Status` channel of a BDF file, or `undefined` when there is none.
 *
 * Returns `undefined` rather than throwing for a plain EDF or a BDF without the channel: a file
 * having no Status channel is an ordinary fact about the file, not an error.
 */
export function getStatusSignal(header: EdfHeader): EdfSignal | undefined {
  /*
   * `undefined` is this function's answer, which is what makes a wrong argument dangerous here
   * rather than merely unhelpful. The first line reads `header.bytesPerSample`, so
   * `getStatusSignal(recording)` — the object a reader has in hand, from the `openEdf` two lines
   * above the call — found `undefined`, took the not-a-BDF branch, and reported that a BDF+ file
   * with a Status channel has none. Every trigger in the recording then reads as absent, on the one
   * path in this package where a missing event is indistinguishable from no events.
   *
   * `contiguityOf` (0.6.91) and `formatStartTimeNaive` (0.6.110) are the same shape: a function
   * whose own answer includes the one a wrong argument produces (fixed in 0.6.120).
   */
  if (!Array.isArray((header as { signals?: unknown } | null | undefined)?.signals)) {
    /*
     * A FORGOTTEN AWAIT, and the one wrong argument this guard's own advice does not reach.
     *
     * 0.6.120 wrote this check because "undefined is what this function returns for a file with no
     * Status channel, so a wrong argument must not be able to produce it", and what that costs is
     * in the comment above: "Every trigger in the recording then reads as absent, on the one path
     * in this package where a missing event is indistinguishable from no events." A pending
     * Promise is exactly such a wrong argument.
     *
     * The next step is `recording.header`, which a reader holding `readHeader(source)` does not
     * have. 0.6.217, 0.6.229, 0.6.232, 0.6.235, 0.6.236 and 0.6.237 name the keyword everywhere
     * else a header is taken — 0.6.237's entry said that was all of them, and this was the one it
     * missed.
     */
    if (typeof (header as { then?: unknown } | null | undefined)?.then === 'function') {
      throw new RangeError(
        'getStatusSignal(): that is a pending Promise, not a header. Next: await ' +
          'readHeader(source) — it resolves to the header this takes.',
      );
    }
    throw new RangeError(
      'getStatusSignal(): that is not a header — it has no signals, and undefined is what this ' +
        'function returns for a file with no Status channel, so a wrong argument must not be able ' +
        'to produce it. Next: pass recording.header.',
    );
  }
  /*
   * A CHUNK, which carries the array the check above is looking for.
   *
   * `chunk.signals` is the other signals array in this package, so the guard 0.6.120 wrote to stop
   * a wrong argument producing `undefined` was defeated by the one object most likely to be in a
   * caller's hand beside the header — and produced `undefined` through it, because a chunk has no
   * `bytesPerSample` and the very next line reads that field to decide whether the file is a BDF.
   *
   * Which is the field to test. The guard above names `signals`; this call never reads `signals`
   * until three lines later and reads `bytesPerSample` first, so checking what it actually reads is
   * what makes the refusal cover every shape rather than one.
   */
  if (typeof (header as { bytesPerSample?: unknown }).bytesPerSample !== 'number') {
    throw new RangeError(
      'getStatusSignal(): that is a chunk, not a header — a chunk carries a signals array too, ' +
        'but no bytesPerSample, which is the field this call reads to decide whether the file is ' +
        'a BDF at all. So it answered undefined: no Status channel, for a file that has one. ' +
        'Next: pass recording.header.',
    );
  }
  if (header.bytesPerSample !== 3) return undefined;
  const matches: EdfSignal[] = [];
  for (const index of header.dataSignalIndices) {
    const signal = header.signals[index];
    if (signal !== undefined && signal.label.trim().toLowerCase() === STATUS_LABEL) {
      matches.push(signal);
    }
  }
  /*
   * More than one, refused rather than resolved to the first.
   *
   * `getSignal` states the reason for its own duplicate-label refusal and it is the whole of this
   * one: "there is no answer edfcore could return that would not be a guess", because "returning
   * the first is how the wrong channel ends up in a paper". This loop returned the first and said
   * nothing, so `readTriggers` decoded a whole recording's triggers off a channel nobody chose —
   * on the one path in the package where a missing event is indistinguishable from no events.
   *
   * A BDF carrying two channels labelled `Status` is malformed, which is precisely the file this
   * package exists to be careful with (fixed in 0.6.138).
   */
  if (matches.length > 1) {
    throw new EdfAmbiguousChannelError(
      `this file has ${matches.length} signals labelled ${JSON.stringify(matches[0]?.label ?? '')} ` +
        `(indices ${matches.map((signal) => signal.index).join(', ')}), so getStatusSignal ` +
        'cannot choose one — returning the first would date every trigger in the recording to a ' +
        'channel nobody picked. Next: select the one you mean with getSignal(header, index) and ' +
        'decode it with decodeDigital() and decodeStatusWord().',
      {
        label: matches[0]?.label.trim() ?? '',
        matchingIndices: matches.map((signal) => signal.index),
      },
    );
  }
  return matches[0];
}

/**
 * Decodes one 24-bit Status sample.
 *
 * `decodeDigital` sign-extends BDF samples, as it must for a measurement, so bit 23 of a Status
 * word arrives as a negative number. The bit field is unsigned, so it is masked back before
 * anything is read out of it.
 */
export function decodeStatusWord(sample: number): EdfStatusWord {
  /*
   * Guarded, because `&` coerces rather than refuses. `undefined`, `null`, `NaN` and a string all
   * become 0 under it, and 0 is a perfectly well-formed Status word — no trigger asserted, CMS in
   * range, battery fine. A caller indexing the wrong array got that back with no way to tell it
   * from a real sample, which is the outcome this library exists to prevent: a wrong value that
   * looks like a value. `1.5` truncated to trigger code 1, and anything wider than 24 bits was
   * masked away rather than questioned (fixed in 0.6.80).
   *
   * The bound admits BOTH spellings of a 24-bit word, because both arrive here legitimately.
   * `decodeDigital` sign-extends, so a real sample with bit 23 set is negative and the mask below
   * is what puts it back; a caller writing a bit pattern by hand spells the same word unsigned, up
   * to 0xffffff. What is refused is everything outside the union: a wider integer, a fraction, and
   * the values `&` silently turned into zero.
   */
  if (!Number.isSafeInteger(sample) || sample < BDF_DIGITAL_MIN || sample > UNSIGNED_24_BIT_MAX) {
    throw new RangeError(
      `decodeStatusWord(): ${describeSample(sample)} is not a 24-bit Status word, which is a ` +
        `whole number in ${BDF_DIGITAL_MIN}..${UNSIGNED_24_BIT_MAX} — sign-extended as ` +
        'decodeDigital() returns it, or unsigned as a bit pattern is written. Next: pass one ' +
        'element of the Int32Array decodeDigital() returned for the Status channel, or call ' +
        'readTriggers() and let edfcore find that channel and decode it.',
    );
  }
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
 *
 * A GAP IS A LEFT EDGE TOO. The running trigger state does not survive one, and the first
 * in-window sample of every contiguous run produces an event. `precededByGap` goes on the event
 * whose tick IS the run's resume instant, and on no other — so a window that begins part-way into
 * the first record after a gap yields events and none of them carries it. That is 0.3.67's rule,
 * narrower than the one this said until 0.3.92: the gap precedes the RUN, not whichever sample the
 * window happened to admit first, which could be a whole record later. Until
 * 0.3.13 the state carried across, on the reasoning that a code held over a gap should not be
 * reported twice — but it is not the same observation twice. The records between two segments do
 * not exist, so what the trigger did in between is unknown, and staying silent asserted that it
 * did nothing. A file with one code held before and after a five-minute hole returned a SINGLE
 * event, and a consumer differencing consecutive events read one 308-second epoch out of eight
 * seconds of recording.
 *
 * A contiguous file has exactly one run, so nothing about it changes.
 */
export async function readTriggers(
  recording: EdfRecording,
  selection: TriggerSelection,
  options?: ReadOptions,
): Promise<readonly EdfTriggerEvent[]> {
  assertRecording(recording, 'readTriggers');
  assertSelection(
    selection,
    'readTriggers',
    '{ startSeconds, durationSeconds }',
    'there is no records form of a trigger scan: readRecords() would hand back the Status ' +
      'channel as samples, which you would still have to find and decode.',
  );
  /*
   * The OPTIONS, here rather than on the first read, for the reason `streamRecords` states in full
   * at 0.6.169: the guard that catches them is inside the read, so whether it fires at all depends
   * on the window rather than on the call. A window past the end, one inside an EDF+D gap, or one
   * of zero duration resolves to no records, the loop below never runs, and
   * `readTriggers(recording, selection, controller.signal)` resolved with the cancellation dropped.
   *
   * This is the worst of the family for it. `[]` is one of this function's real answers — "no
   * trigger changed in this window" — so the empty result reads as a fact about the recording, on
   * the one path in the package where a missing event is indistinguishable from no events. The
   * identical call over a window with records in it was refused all along.
   */
  assertReadOptions(options);
  const { source, header, timeline } = recording;

  const status = getStatusSignal(header);
  if (status === undefined) {
    throw new RangeError(
      'readTriggers(): this file has no BioSemi Status channel — it is either not a BDF file, ' +
        'or no signal is labelled "Status". Next: check header.signals, or read EDF+ ' +
        'annotations with readAnnotations().',
    );
  }

  /*
   * A Status channel the file declares with NO SAMPLES, which this counted as no triggers.
   *
   * `samplesPerRecord` of zero makes the inner loop below run zero times, so the scan completed and
   * returned `[]` — and `[]` is one of this function's real answers. An experimenter reads it as "no
   * stimulus in this window", on the one path in the package where a missing event is
   * indistinguishable from no events; the refusal `getStatusSignal` grew in 0.6.120 and 0.6.179 was
   * for exactly that, one call earlier.
   *
   * It is a defect the parser already names — `ZERO_SAMPLES_PER_RECORD` — and one the sample-grid
   * family already refuses in these words, in `sample-grid.ts` and `sample-locate.ts`. This is the
   * third place a signal with no grid is read from, and the only one that answered.
   */
  if (status.samplesPerRecord <= 0) {
    throw new RangeError(
      `readTriggers(): the Status channel (signal ${status.index}) declares ` +
        `${status.samplesPerRecord} samples per record, so this file stores no trigger samples at ` +
        'all — and an empty result here reads as a recording with no stimulus in it. Next: check ' +
        'header.diagnostics for ZERO_SAMPLES_PER_RECORD; the channel is declared but carries ' +
        'nothing.',
    );
  }

  const ranges = resolveTimeWindow(
    timeline,
    recording.index,
    selection.startSeconds,
    selection.durationSeconds,
  );

  const windowStartTicks = secondsToTicks(selection.startSeconds, 'startSeconds');
  const windowEndTicks =
    windowStartTicks + secondsToTicks(selection.durationSeconds, 'durationSeconds');
  const durationTicks = header.recordDurationTicks;
  const samplesPerRecord = status.samplesPerRecord;

  const events: EdfTriggerEvent[] = [];

  for (const records of ranges) {
    // A range from `resolveTimeWindow` never spans a gap, so one segment covers all of it.
    const segment = segmentContaining(recording.index.segments, records.start);
    // PER RUN, not per window. The last code SEEN within this run, updated for out-of-window
    // samples too — that is what stops a code asserted before the window from being re-reported
    // as a fresh onset inside it. It is deliberately NOT carried in from the previous run: the
    // records between two segments do not exist, so the previous run's last code says nothing
    // about what the hardware was doing when this one began.
    let previous: number | undefined;
    // Whether this run has reported yet. Its first in-window sample is always an event, carrying
    // the code in force at that edge — which a transitions-only rule would lose.
    let reported = false;
    // What precedes this run, so a resume is distinguishable from a latch. `undefined` on a
    // probed index, exactly as it is on `EdfChunk`.
    const precededByGap = gapBefore(recording.index, records.start);
    /*
     * The instant this run's data actually resumes, so the gap goes on the event that sits there
     * and on no other.
     *
     * `resolveTimeWindow` is RECORD-aligned and the window is not, so a window starting part-way
     * through the first record after a gap still yields that record — and the gap was hung on
     * whichever sample was the first to fall INSIDE the window. On a 7 s gap ending at 10 s, a
     * window of [10.9, 11.4) reported its first event, at 11 s, as "preceded by a gap ending at
     * 10 s": four samples of real data sit between the two, so the flag asserted a hole where the
     * recording had already resumed (fixed in 0.3.67).
     *
     * Whether the flag appeared at all depended on where the window started relative to a record
     * boundary rather than on where the data resumed.
     */
    const resumeTicks = segment?.startTicks;
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

          // CEILING, the same rule `gridSampleStartTicks` and `sampleStartTicksOf` use, and for
          // the reason the first of those states in its own comment: a sample boundary need not
          // fall on a whole tick, and truncating returns a tick that lies inside the PREVIOUS
          // sample. 10^7 / 512 is 19531.25, so three boundaries in four are affected on an
          // ordinary 512 Hz BioSemi file.
          //
          // Truncating made an event's own reported time round-trip to the wrong sample —
          // `sampleAt(event.seconds)` returned 100 for an event readTriggers called sample 101 —
          // and a window aligned to the stimulus with `sampleStartSecondsOf` reported the onset a
          // sample late, which at 512 Hz is 2 ms on the one number an ERP pipeline reads. A
          // one-sample-wide trigger at the window's left edge disappeared entirely, contradicting
          // this function's own rule that the first in-window sample always produces an event
          // (fixed in 0.3.32).
          //
          // A zero record duration puts every sample of the record at its start instant.
          const ticks =
            durationTicks > 0n && samplesPerRecord > 0
              ? recordStartTicks + ceilDiv(BigInt(s) * durationTicks, BigInt(samplesPerRecord))
              : recordStartTicks;

          if (ticks < windowStartTicks || ticks >= windowEndTicks) continue;
          if (reported && !changed) continue;
          const firstOfRun = !reported;
          reported = true;

          events.push({
            sampleIndex: recordIndex * samplesPerRecord + s,
            seconds: ticksToSeconds(ticks),
            ticks,
            trigger: word.trigger,
            status: word,
            // The gap precedes the RUN, so it belongs to the event AT the run's first sample and
            // to no other — not merely to the first event the window happens to admit.
            precededByGap:
              firstOfRun && (resumeTicks === undefined || ticks === resumeTicks)
                ? precededByGap
                : undefined,
          });
        }
      }

      scanned += slice.count;
    }
  }

  return Object.freeze(events);
}
