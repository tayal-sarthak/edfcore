/**
 * `decodeAnnotations`: TALs plus EDF+ semantics.
 *
 * Layer 3. Sole owner of timekeeping extraction and of the annotation sort. The byte grammar
 * lives in `grammar.ts`; everything here is about which TAL means what.
 *
 * Three rules the rest of the library depends on:
 *
 * 1. The FIRST TAL of the FIRST annotation signal of the file is that record's timekeeping TAL.
 *    "First" is a position, not "the first one that parsed", and "first annotation signal" is
 *    `header.annotationSignalIndices[0]` — not the first signal this call was asked for. An
 *    additional annotation signal carries NO timekeeping TAL, and stripping its first TAL would
 *    silently delete a real event.
 * 2. `recordOnsetTicks` has one entry for EVERY record in the decoded range, always. A record
 *    whose timekeeping TAL is missing gets the derived onset `start + recordIndex * duration`
 *    rather than a hole or a sentinel, and `TIMEKEEPING_TAL_MISSING` carries the record index so
 *    the derivation is never invisible. Every timeline in edfcore is built from this array.
 * 3. Onsets are exposed under both conventions as separately named fields, never as an option:
 *    `onsetSecondsFromHeaderStart` is the verbatim on-disk value and
 *    `onsetSecondsFromFirstRecord` is rebased to record 0's true start. `onsetTicks` is exact
 *    and is the only one worth comparing.
 *
 * Diagnostic volume is bounded on purpose, by one test: does another occurrence of this code
 * carry information available nowhere else? `TIMEKEEPING_TAL_MISSING` does — it names a record
 * whose onset was derived — so it is reported per record. `NEGATIVE_ANNOTATION_ONSET` and
 * `TIMEKEEPING_TAL_NONCONFORMANT` do not: the onsets are in the result and the shorthand is a
 * property of the writer, so they are reported once per call. The grammar's own defects are
 * deduplicated per region and carry an occurrence count.
 *
 * Record-onset spacing and monotonicity are deliberately NOT checked here. This module produces
 * `recordOnsetTicks`; `time/timeline.ts` owns enforcing what a valid timeline is, and splitting
 * that would give one rule two owners.
 */

import { sliceBytes } from '../bytes/view.js';
import { TICKS_PER_SECOND } from '../constants.js';
import { DiagnosticSink } from '../diagnostics/collector.js';
import { EdfRangeError } from '../errors.js';
import type {
  DecodeAnnotationsOptions,
  EdfAnnotation,
  EdfAnnotationsResult,
  EdfHeader,
  EdfSignal,
  RecordRange,
} from '../types.js';
import {
  type ParsedTal,
  parseTalRegion,
  previewBytes,
  splitChannelLabel,
  TAL_PREVIEW_MAX_BYTES,
  type TalIssue,
  type TalIssueCode,
  type TalTextEncoding,
} from './grammar.js';
import { saturateToInt64, ticksToSeconds } from './ticks.js';

const ANNOTATIONS_SPEC = "EDF+ specification 2.2 (the 'EDF Annotations' signal)";
const TIMEKEEPING_SPEC = 'EDF+ specification 2.2.1 (time keeping of data records)';
const ONSET_SPEC = 'EDF+ specification 2.2.4 (onsets are relative to the startdate/starttime)';

const ISSUE_RULES: Readonly<Record<TalIssueCode, string>> = {
  TAL_MALFORMED:
    'a TAL is Onset [ 0x15 Duration ] 0x14 *( Text 0x14 ) 0x00, the onset carries a mandatory ' +
    'sign and the duration never does',
  TAL_TRUNCATED_AT_REGION_END:
    'a TAL is contained in its own annotation region; the bytes past the region are the next ' +
    "signal's samples",
  TAL_REGION_NOT_NUL_TERMINATED: 'the bytes after the last TAL of a region are all 0x00',
  ANNOTATION_TEXT_NOT_UTF8: 'annotation text is UTF-8',
};

const ISSUE_NEXT_STEPS: Readonly<Record<TalIssueCode, string>> = {
  TAL_MALFORMED:
    'the rest of the region and the rest of the file were kept; hexdump the file at the byte ' +
    'offset above to see what the writer emitted',
  TAL_TRUNCATED_AT_REGION_END:
    "check the writer's samplesPerRecord for this annotation signal — a region too small for " +
    'the TALs written into it is the usual cause',
  TAL_REGION_NOT_NUL_TERMINATED:
    'hexdump the file at the byte offset above; trailing bytes from an earlier, longer record ' +
    'mean the writer reused a buffer without clearing it',
  ANNOTATION_TEXT_NOT_UTF8:
    'the affected annotations report textEncoding "latin-1-fallback", so you can re-decode the ' +
    'bytes yourself if the writer used another code page',
};

const ISSUE_SPEC_REFERENCES: Readonly<Record<TalIssueCode, string>> = {
  TAL_MALFORMED: ANNOTATIONS_SPEC,
  TAL_TRUNCATED_AT_REGION_END: ANNOTATIONS_SPEC,
  TAL_REGION_NOT_NUL_TERMINATED: ANNOTATIONS_SPEC,
  ANNOTATION_TEXT_NOT_UTF8: ANNOTATIONS_SPEC,
};

/** Enough of a region to show what went wrong, without copying a 60 KB region per diagnostic. */
const RAW_EVIDENCE_MAX_BYTES = TAL_PREVIEW_MAX_BYTES;

/** Everything one region contributes to a diagnostic, so the reporters stay readable. */
interface RegionContext {
  readonly signal: EdfSignal;
  readonly recordIndex: number;
  /** The buffer the caller passed in. */
  readonly bytes: Uint8Array;
  /** Region start within that buffer. */
  readonly offset: number;
  /** Region start within the FILE — what a hexdump needs. */
  readonly fileOffset: number;
}

/**
 * An annotation before rebasing. The rebase quantity is record 0's start, which is only known
 * once every record in the range has been read, so the public objects are built at the end.
 */
interface PendingAnnotation {
  readonly onsetTicks: bigint;
  readonly onsetRaw: string;
  readonly durationTicks: bigint | undefined;
  readonly durationRaw: string | undefined;
  readonly text: string;
  readonly channelLabel: string | undefined;
  readonly signalIndex: number;
  readonly recordIndex: number;
  readonly byteOffsetInRecord: number;
  readonly textEncoding: TalTextEncoding;
  /** Insertion order: record-major, then signal index ascending, then on-disk order. */
  readonly order: number;
}

interface ObservedOnset {
  readonly recordIndex: number;
  readonly ticks: bigint;
  readonly raw: string;
}

function describeRange(range: RecordRange): string {
  return `{ start: ${range.start}, count: ${range.count} }`;
}

function assertRecordRange(header: EdfHeader, recordBytes: Uint8Array, records: RecordRange): void {
  const available: RecordRange = { start: 0, count: header.recordCount };
  const validIndices =
    Number.isSafeInteger(records.start) &&
    records.start >= 0 &&
    Number.isSafeInteger(records.count) &&
    records.count >= 0;
  if (!validIndices || records.start + records.count > header.recordCount) {
    throw new EdfRangeError(
      `decodeAnnotations(): records ${describeRange(records)} is not inside the ` +
        `${header.recordCount} records this file has. ` +
        `Next: clamp the range to [0, ${header.recordCount}).`,
      { requested: records, available },
    );
  }

  const expected = records.count * header.recordByteLength;
  if (recordBytes.length !== expected) {
    const whole =
      header.recordByteLength > 0 ? Math.floor(recordBytes.length / header.recordByteLength) : 0;
    throw new EdfRangeError(
      `decodeAnnotations(): recordBytes is ${recordBytes.length} bytes, but records ` +
        `${describeRange(records)} of this file is exactly ${expected} bytes ` +
        `(${records.count} x ${header.recordByteLength}). ` +
        'Next: pass the buffer readRecordBytes() returned for this exact range, unsliced.',
      { requested: records, available: { start: records.start, count: whole } },
    );
  }
}

/**
 * The annotation signals to read, ascending and deduplicated.
 *
 * A non-annotation index is refused with a plain `RangeError`, not an `EdfError`: parsing a data
 * signal's samples as text is exactly the garbage this module exists to prevent, and it can only
 * happen through a caller's mistake, never through a file's.
 */
function resolveSignals(
  header: EdfHeader,
  requested: readonly number[] | undefined,
): readonly EdfSignal[] {
  const indices = requested ?? header.annotationSignalIndices;
  const seen = new Set<number>();
  const signals: EdfSignal[] = [];
  for (const index of indices) {
    if (seen.has(index)) continue;
    seen.add(index);
    const signal = header.signals[index];
    if (signal === undefined || signal.kind !== 'annotations') {
      throw new RangeError(
        `decodeAnnotations(): signal ${index} is not an annotation signal. This file's ` +
          `annotation signals are [${header.annotationSignalIndices.join(', ')}]. ` +
          'Next: pass one of those, or omit signalIndices to read them all.',
      );
    }
    signals.push(signal);
  }
  return signals.sort((a, b) => a.index - b.index);
}

function reportIssue(sink: DiagnosticSink, context: RegionContext, issue: TalIssue): void {
  const repeats =
    issue.occurrences > 1
      ? ` (${issue.occurrences} occurrences in this region; the first is described)`
      : '';
  const evidenceLength = Math.min(issue.byteLength, RAW_EVIDENCE_MAX_BYTES);
  sink.report({
    code: issue.code,
    message:
      `annotation region of signal ${context.signal.index} ("${context.signal.label}") in ` +
      `record ${context.recordIndex}: ${issue.detail}${repeats}. ` +
      `Bytes at that offset: "${issue.raw}". Rule: ${ISSUE_RULES[issue.code]}. ` +
      `Next: ${ISSUE_NEXT_STEPS[issue.code]}.`,
    field: 'annotation region',
    byteOffset: context.fileOffset + issue.byteOffsetInRegion,
    byteLength: issue.byteLength,
    rawBytes: sliceBytes(context.bytes, context.offset + issue.byteOffsetInRegion, evidenceLength),
    raw: issue.raw,
    signalIndex: context.signal.index,
    recordIndex: context.recordIndex,
    specReference: ISSUE_SPEC_REFERENCES[issue.code],
  });
}

function reportTimekeepingMissing(sink: DiagnosticSink, context: RegionContext): void {
  const shown = Math.min(context.signal.recordByteLength, RAW_EVIDENCE_MAX_BYTES);
  sink.report({
    code: 'TIMEKEEPING_TAL_MISSING',
    message:
      `record ${context.recordIndex} has no timekeeping TAL: the first TAL slot of annotation ` +
      `signal ${context.signal.index} ("${context.signal.label}") is empty or did not parse. ` +
      `Region starts with: "${previewBytes(context.bytes, context.offset, shown)}". ` +
      'Rule: the first TAL of the first annotation signal of every data record gives that ' +
      "record's start relative to the file start, and carries no text. " +
      `Next: this record's onset was derived as start + ${context.recordIndex} x ` +
      'recordDuration and is in recordOnsetTicks; treat times inside it as nominal, and run ' +
      'validateRecording() to see how many records are affected.',
    field: 'timekeeping TAL',
    byteOffset: context.fileOffset,
    byteLength: context.signal.recordByteLength,
    rawBytes: sliceBytes(context.bytes, context.offset, shown),
    signalIndex: context.signal.index,
    recordIndex: context.recordIndex,
    specReference: TIMEKEEPING_SPEC,
  });
}

/**
 * What is non-conformant about a timekeeping TAL, or `undefined` when it is exactly
 * `+onset 0x14 0x14 0x00`.
 *
 * Zero texts is the widespread `+t 0x14 0x00` shorthand. EDFlib rejects that file outright; we
 * treat "zero texts" and "one empty text" as the same thing and keep going, because the onset is
 * unambiguous either way and refusing the file would refuse a large part of the real corpus.
 */
function timekeepingDefect(tal: ParsedTal): string | undefined {
  if (tal.durationRaw !== undefined) {
    return `carries the duration "${tal.durationRaw}", which a timekeeping TAL never has`;
  }
  if (tal.texts.length === 0) {
    return (
      'omits the mandatory empty text and is written "+onset 0x14 0x00" — the widespread ' +
      'shorthand, which EDFlib rejects outright'
    );
  }
  const texts = tal.texts.map((run) => run.text).filter((text) => text.length > 0);
  if (texts.length > 0) {
    return (
      `carries the text ${texts.map((text) => `"${text}"`).join(', ')}, which is dropped: the ` +
      'timekeeping TAL is not an annotation'
    );
  }
  if (tal.texts.length > 1) {
    return `carries ${tal.texts.length} empty texts, where the grammar allows exactly one`;
  }
  return undefined;
}

function reportTimekeepingDefect(
  sink: DiagnosticSink,
  context: RegionContext,
  tal: ParsedTal,
  defect: string,
): void {
  sink.report({
    code: 'TIMEKEEPING_TAL_NONCONFORMANT',
    message:
      `the timekeeping TAL of record ${context.recordIndex} (annotation signal ` +
      `${context.signal.index}, onset "${tal.onsetRaw}") ${defect}. ` +
      'Rule: a timekeeping TAL is written "+onset 0x14 0x14 0x00" — one signed onset, no ' +
      'duration, one empty text. ' +
      "Next: the onset was used as this record's start and the file was kept; this is " +
      'reported once per decodeAnnotations() call, so later records are not re-reported.',
    field: 'timekeeping TAL',
    byteOffset: context.fileOffset + tal.byteOffsetInRegion,
    byteLength: tal.byteLength,
    raw: tal.onsetRaw,
    signalIndex: context.signal.index,
    recordIndex: context.recordIndex,
    specReference: TIMEKEEPING_SPEC,
  });
}

function reportNegativeOnset(sink: DiagnosticSink, context: RegionContext, tal: ParsedTal): void {
  sink.report({
    code: 'NEGATIVE_ANNOTATION_ONSET',
    message:
      `annotation onset "${tal.onsetRaw}" in record ${context.recordIndex} (signal ` +
      `${context.signal.index}) is negative: ${ticksToSeconds(tal.onsetTicks)} s before ` +
      'the file start. ' +
      'Rule: EDF+ allows a negative onset and it is how a pre-stimulus event is written, so ' +
      'this is information, not a warning. ' +
      'Next: nothing to fix — compare event times with onsetTicks, which is exact and signed. ' +
      'Reported once per decodeAnnotations() call.',
    field: 'annotation onset',
    byteOffset: context.fileOffset + tal.byteOffsetInRegion,
    byteLength: tal.byteLength,
    raw: tal.onsetRaw,
    signalIndex: context.signal.index,
    recordIndex: context.recordIndex,
    specReference: ONSET_SPEC,
  });
}

/**
 * The pinned total order: onset, then signal, then byte offset in the record, then insertion
 * order. The last key is what makes it total — two annotations in different records can share
 * all three of the others — and it is spelled out rather than left to `Array.prototype.sort`
 * being stable, because a test pins this order.
 */
function compareAnnotations(a: PendingAnnotation, b: PendingAnnotation): number {
  if (a.onsetTicks !== b.onsetTicks) return a.onsetTicks < b.onsetTicks ? -1 : 1;
  if (a.signalIndex !== b.signalIndex) return a.signalIndex - b.signalIndex;
  if (a.byteOffsetInRecord !== b.byteOffsetInRecord) {
    return a.byteOffsetInRecord - b.byteOffsetInRecord;
  }
  return a.order - b.order;
}

export function decodeAnnotations(
  header: EdfHeader,
  recordBytes: Uint8Array,
  records: RecordRange,
  options?: DecodeAnnotationsOptions,
): EdfAnnotationsResult {
  assertRecordRange(header, recordBytes, records);

  const sink = new DiagnosticSink(options);
  const signals = resolveSignals(header, options?.signalIndices);
  // Timekeeping belongs to the file's first annotation signal, not to the first one this call
  // was asked for: an additional annotation signal's first TAL is an ordinary annotation. A call
  // that leaves that signal out reads no timekeeping at all, and every recordOnsetTicks entry is
  // then the nominal grid — silence the caller asked for, not a missing TAL.
  const timekeepingSignalIndex = header.annotationSignalIndices[0];
  const durationTicks = header.recordDurationTicks;

  const observedOnsets = new Array<bigint | undefined>(records.count).fill(undefined);
  const pending: PendingAnnotation[] = [];
  let firstObserved: ObservedOnset | undefined;
  let negativeOnsetReported = false;
  let timekeepingDefectReported = false;

  for (let position = 0; position < records.count; position += 1) {
    const recordIndex = records.start + position;
    const recordOffset = position * header.recordByteLength;

    for (const signal of signals) {
      const context: RegionContext = {
        signal,
        recordIndex,
        bytes: recordBytes,
        offset: recordOffset + signal.recordByteOffset,
        fileOffset:
          header.headerByteLength + recordIndex * header.recordByteLength + signal.recordByteOffset,
      };
      const parse = parseTalRegion(recordBytes, context.offset, signal.recordByteLength);
      for (const issue of parse.issues) reportIssue(sink, context, issue);

      const first = parse.tals[0];
      const timekeeping =
        signal.index === timekeepingSignalIndex && first !== undefined && first.ordinal === 0
          ? first
          : undefined;

      if (signal.index === timekeepingSignalIndex) {
        if (timekeeping === undefined) {
          reportTimekeepingMissing(sink, context);
        } else {
          observedOnsets[position] = timekeeping.onsetTicks;
          firstObserved ??= {
            recordIndex,
            ticks: timekeeping.onsetTicks,
            raw: timekeeping.onsetRaw,
          };
          const defect = timekeepingDefect(timekeeping);
          if (defect !== undefined && !timekeepingDefectReported) {
            timekeepingDefectReported = true;
            reportTimekeepingDefect(sink, context, timekeeping, defect);
          }
        }
      }

      for (const tal of parse.tals) {
        if (tal === timekeeping) continue;
        for (const run of tal.texts) {
          // An empty run is structure, not an event: it is how the grammar terminates a
          // timestamp, and every record would otherwise carry a phantom annotation.
          if (run.text.length === 0) continue;
          const parts = splitChannelLabel(run.text);
          const annotation: PendingAnnotation = {
            onsetTicks: tal.onsetTicks,
            onsetRaw: tal.onsetRaw,
            durationTicks: tal.durationTicks,
            durationRaw: tal.durationRaw,
            text: parts.text,
            channelLabel: parts.channelLabel,
            signalIndex: signal.index,
            recordIndex,
            byteOffsetInRecord: signal.recordByteOffset + run.byteOffsetInRegion,
            textEncoding: run.encoding,
            order: pending.length,
          };
          pending.push(annotation);
          if (annotation.onsetTicks < 0n && !negativeOnsetReported) {
            negativeOnsetReported = true;
            reportNegativeOnset(sink, context, tal);
          }
        }
      }
    }
  }

  // Record 0's onset, observed when it was decoded and derived from the first record that was
  // otherwise. For a continuous file the derivation is exact; see the rebasing note below.
  //
  // With no observed onset anywhere in this range there is nothing local to derive from, and the
  // origin has to come from the caller. Falling back to zero instead made the result depend on
  // the range: the same record got one onset when read alone and another when read alongside a
  // neighbour that did carry a timekeeping TAL, which in turn made chunk boundaries, segment
  // boundaries and even a fatal TIMELINE_NOT_MONOTONIC a function of the scan chunk size.
  const baseTicks =
    firstObserved === undefined
      ? (options?.originTicks ?? 0n)
      : firstObserved.ticks - BigInt(firstObserved.recordIndex) * durationTicks;

  const recordOnsetTicks = new BigInt64Array(records.count);
  for (let position = 0; position < records.count; position += 1) {
    const observed = observedOnsets[position];
    recordOnsetTicks[position] =
      observed ?? saturateToInt64(baseTicks + BigInt(records.start + position) * durationTicks);
  }

  const startOffsetTicks = resolveStartOffsetTicks(
    sink,
    header,
    records,
    recordOnsetTicks,
    baseTicks,
    firstObserved,
  );

  pending.sort(compareAnnotations);
  const annotations: EdfAnnotation[] = pending.map((item) => ({
    onsetSecondsFromHeaderStart: ticksToSeconds(item.onsetTicks),
    onsetSecondsFromFirstRecord: ticksToSeconds(item.onsetTicks - startOffsetTicks),
    onsetTicks: item.onsetTicks,
    // The exact form of the line above. Saturating rather than wrapping, for the same reason
    // record onsets do: an onset already at the edge of the int64 range must not come back as a
    // large positive number after a subtraction.
    onsetTicksFromFirstRecord: saturateToInt64(item.onsetTicks - startOffsetTicks),
    onsetRaw: item.onsetRaw,
    durationSeconds:
      item.durationTicks === undefined ? undefined : ticksToSeconds(item.durationTicks),
    durationTicks: item.durationTicks,
    durationRaw: item.durationRaw,
    text: item.text,
    channelLabel: item.channelLabel,
    signalIndex: item.signalIndex,
    recordIndex: item.recordIndex,
    byteOffsetInRecord: item.byteOffsetInRecord,
    textEncoding: item.textEncoding,
  }));

  return {
    annotations: Object.freeze(annotations),
    recordOnsetTicks,
    diagnostics: sink.diagnostics,
  };
}

/**
 * Record 0's true start, which is what `onsetSecondsFromFirstRecord` is rebased by.
 *
 * When the range starts at record 0 the value is read from the file and used as written, even if
 * it is outside the [0, 1) second the spec allows — it is still that record's start.
 *
 * When the range starts later, record 0's onset is not in the bytes we were given, so it is
 * derived as `onset(first decoded record) - recordIndex * recordDuration`. That is exact for a
 * continuous file and wrong by the elapsed gaps for an EDF+D one, so the derived value is used
 * only when it lands inside [0, 1) — where a gap cannot hide, unless it is itself shorter than a
 * second. Otherwise rebasing is switched off and the two onset conventions become equal.
 *
 * A derivation that lands outside [0, 1) is only *reported* for a file that claims to be
 * continuous, where `onset(r) = start + r * duration` must hold and a violation is the file's
 * fault. On an EDF+D file it is the expected outcome of not decoding from record 0, and a
 * diagnostic there would make `strict` reject every conformant discontinuous recording — the
 * record-index probes read exactly one late record.
 */
function resolveStartOffsetTicks(
  sink: DiagnosticSink,
  header: EdfHeader,
  records: RecordRange,
  recordOnsetTicks: BigInt64Array,
  baseTicks: bigint,
  firstObserved: ObservedOnset | undefined,
): bigint {
  if (records.count === 0) return 0n;

  const origin =
    firstObserved === undefined
      ? 'no timekeeping TAL was found in the decoded range'
      : firstObserved.recordIndex === 0
        ? `raw timekeeping onset "${firstObserved.raw}"`
        : `derived from record ${firstObserved.recordIndex}, timekeeping onset ` +
          `"${firstObserved.raw}"`;

  if (records.start === 0) {
    const onset = recordOnsetTicks[0] ?? 0n;
    if (onset < 0n || onset >= TICKS_PER_SECOND) {
      sink.report({
        code: 'START_OFFSET_OUT_OF_RANGE',
        message:
          `record 0 starts ${ticksToSeconds(onset)} s after the header start time, but a ` +
          'sub-second start offset must be in [0, 1). ' +
          `Origin: ${origin}. ` +
          "Rule: the onset of the first record's timekeeping TAL is the recording's sub-second " +
          'start offset, and the whole-second part of the start time lives in the header. ' +
          'Next: the value was used as written; compare it with the header starttime field, ' +
          'because a writer that encodes the start time twice produces exactly this.',
        field: 'timekeeping TAL',
        raw: firstObserved?.raw ?? '',
        recordIndex: 0,
        specReference: TIMEKEEPING_SPEC,
      });
    }
    return onset;
  }

  if (baseTicks >= 0n && baseTicks < TICKS_PER_SECOND) return baseTicks;

  if (header.continuity === 'continuous') {
    sink.report({
      code: 'START_OFFSET_OUT_OF_RANGE',
      message:
        `the decoded range starts at record ${records.start}, so record 0's start offset had ` +
        `to be derived (${origin}); the derived value ${ticksToSeconds(baseTicks)} s is outside ` +
        '[0, 1), which a continuous file cannot produce — its record onsets are start + ' +
        'recordIndex * recordDuration by definition. ' +
        "Rule: the onset of record 0's timekeeping TAL is the recording's sub-second start " +
        'offset, and it is the only correct rebasing origin. ' +
        'Next: onsetSecondsFromFirstRecord equals onsetSecondsFromHeaderStart for this call; ' +
        'the file is either discontinuous while claiming EDF+C, or its record onsets drift — ' +
        'buildRecordIndex() will say which.',
      field: 'timekeeping TAL',
      raw: firstObserved?.raw ?? '',
      recordIndex: records.start,
      specReference: TIMEKEEPING_SPEC,
    });
  }
  return 0n;
}
