/**
 * `parseHeader` — the orchestrator.
 *
 * Layer 2. Sole owner of header validation ORDER. Every check below is numbered, and the numbers
 * are the contract: under `strict` the FIRST would-be diagnostic throws, so the order decides
 * which error a broken file reports, and a test pins it. Moving a check is a behavioural change
 * even when every individual check is unaltered.
 *
 * The order is not arbitrary. Each step establishes something the next one needs:
 *
 *   1. at least 256 bytes            8. the record size, hence the file geometry
 *   2. the variant, hence sample width    9. the record count, which needs 8 and the source size
 *   3. ns, before any ns-sized work      10. the EDF+ annotations requirement
 *   4. the whole header is present       11. the text fields, which nothing else depends on
 *   5. the declared header size (loses)
 *   6. the record duration
 *   7. the per-signal blocks
 *
 * `sourceByteLength` is required and positional because two of those steps genuinely need the
 * size of the file the header came from: recovering `recordCount = -1`, and telling a truncated
 * file from a complete one.
 */

import { trimEdfField } from '../bytes/latin1.js';
import { copyBytes } from '../bytes/view.js';
import {
  EDF_HEADER_BLOCK_BYTES,
  EDF_RECOMMENDED_MAX_RECORD_BYTES,
  HEADER_FIELDS,
  SIGNAL_FIELD_WIDTHS,
} from '../constants.js';
import { DiagnosticSink, fatalError } from '../diagnostics/collector.js';
import { parseUnsignedTicks, secondsToTicks } from '../tal/ticks.js';
import type { EdfHeader, ParseOptions } from '../types.js';
import { resolveStartTime } from './dates.js';
import {
  checkDeclaredHeaderByteLength,
  describeFixedField,
  fixedFieldSpecReference,
  parseDeclaredRecordCount,
  parseRecordDuration,
  parseSignalCount,
  readRawHeaderFields,
  reportNonAsciiHeaderFields,
} from './fields.js';
import { parsePatientId, parseRecordingId } from './identification.js';
import { buildSignals, parseSignalHeaders, signalFieldOffset } from './signals.js';
import { detectVariant } from './variant.js';

interface RecordCountResolution {
  readonly recordCount: number;
  readonly recordCountSource: EdfHeader['recordCountSource'];
}

interface RecordCountInput {
  readonly raw: string;
  /** Verbatim, or `NaN` when the field could not be read. */
  readonly declared: number;
  readonly headerByteLength: number;
  /** Always positive here: a zero-byte record is fatal before this runs. */
  readonly recordByteLength: number;
  readonly sourceByteLength: number;
}

/**
 * How many data records the file actually contains.
 *
 * Four outcomes, and every one of them is reported: the count was unknown and was recovered from
 * the source length; the file is shorter than the count claims; the file ends part-way through a
 * record; the file carries bytes beyond the records it declares. Nothing is ever padded into
 * existence — a record that is not entirely present is not a record.
 */
function resolveRecordCount(input: RecordCountInput, sink: DiagnosticSink): RecordCountResolution {
  const { raw, declared, headerByteLength, recordByteLength, sourceByteLength } = input;
  const availableDataBytes = Math.max(0, sourceByteLength - headerByteLength);
  const wholeRecords = Math.floor(availableDataBytes / recordByteLength);
  const partialBytes = availableDataBytes - wholeRecords * recordByteLength;

  const description = describeFixedField('recordCount');
  const specReference = fixedFieldSpecReference('recordCount');
  const field = 'recordCount';
  const byteOffset = HEADER_FIELDS.recordCount.offset;
  const byteLength = HEADER_FIELDS.recordCount.length;

  const reportPartialFinalRecord = (): void => {
    if (partialBytes === 0) return;
    sink.report({
      code: 'PARTIAL_FINAL_RECORD',
      message:
        `the source ends ${partialBytes} bytes into data record ${wholeRecords}, which is ` +
        `${recordByteLength} bytes long, so that record is incomplete. ${specReference}: every ` +
        `data record in a file has the same size. Next: header.recordCount is ${wholeRecords} ` +
        'and only whole records are exposed — edfcore never zero-pads a record into existence, ' +
        'because the padding would decode as real samples.',
      field: 'dataRecords',
      byteOffset: headerByteLength + wholeRecords * recordByteLength,
      byteLength: partialBytes,
      raw,
      expected: `${recordByteLength} bytes`,
      actual: `${partialBytes} bytes`,
      specReference,
    });
  };

  // -1 is the sanctioned "the writer never closed the file" value; an unreadable field and any
  // other negative count mean the same thing, and the same recovery is the truthful answer.
  if (Number.isNaN(declared) || declared < 0) {
    const declaredText = Number.isNaN(declared)
      ? ', which is not a whole number of data records'
      : `, i.e. ${declared}`;
    sink.report({
      code: 'RECORD_COUNT_RECOVERED',
      message:
        `${description} is ${JSON.stringify(raw)}${declaredText}, so the count was recovered ` +
        `from the source length: floor((${sourceByteLength} - ${headerByteLength}) / ` +
        `${recordByteLength}) = ${wholeRecords} whole data records. ${specReference}: -1 means ` +
        'the writer never closed the file. Next: header.recordCount is ' +
        `${wholeRecords} and header.recordCountSource is "sourceByteLength"; if that looks ` +
        "wrong, check that parseHeader's sourceByteLength argument is the true file size.",
      field,
      byteOffset,
      byteLength,
      raw,
      expected: 'a whole number of data records',
      actual: String(declared),
      specReference,
    });
    reportPartialFinalRecord();
    return { recordCount: wholeRecords, recordCountSource: 'sourceByteLength' };
  }

  if (declared > wholeRecords) {
    sink.report({
      code: 'TRUNCATED_FILE',
      message:
        `${description} is ${JSON.stringify(raw)}, i.e. ${declared} data records of ` +
        `${recordByteLength} bytes, which needs ` +
        `${headerByteLength + declared * recordByteLength} bytes; the source is ` +
        `${sourceByteLength} bytes and holds ${wholeRecords} whole records. ${specReference}. ` +
        `Next: header.recordCount is ${wholeRecords} and header.recordCountSource is ` +
        '"sourceByteLength"; the missing records are not readable, and edfcore will not ' +
        'fabricate them.',
      field,
      byteOffset,
      byteLength,
      raw,
      expected: `at most ${wholeRecords} data records`,
      actual: String(declared),
      specReference,
    });
    reportPartialFinalRecord();
    return { recordCount: wholeRecords, recordCountSource: 'sourceByteLength' };
  }

  const extraBytes = availableDataBytes - declared * recordByteLength;
  if (extraBytes > 0) {
    if (declared === wholeRecords) {
      reportPartialFinalRecord();
    } else {
      sink.report({
        code: 'TRAILING_BYTES',
        message:
          `the source carries ${extraBytes} bytes beyond the ${declared} data records the ` +
          `header declares, which end at byte ${headerByteLength + declared * recordByteLength} ` +
          `of ${sourceByteLength}. ${specReference}. Next: those bytes are never decoded; ` +
          'header.recordCount stays at the declared count and header.dataByteLength counts ' +
          'only the declared records.',
        field: 'dataRecords',
        byteOffset: headerByteLength + declared * recordByteLength,
        byteLength: extraBytes,
        raw,
        expected: `${declared * recordByteLength} data bytes`,
        actual: `${availableDataBytes} data bytes`,
        specReference,
      });
    }
  }

  return { recordCount: declared, recordCountSource: 'headerField' };
}

/**
 * The record duration in exact 100 ns ticks.
 *
 * Taken from the DIGITS on disk rather than from the parsed float, so `'0.1'` is 1000000 ticks
 * and not whatever `0.1 * 1e7` rounds to. `tal/ticks.ts` owns that conversion; it is listed a
 * layer above this one but depends on nothing except the tick constant, and reimplementing exact
 * decimal-to-tick parsing here to respect the table would be the worse trade.
 *
 * The float path is the fallback for the spellings the tick grammar does not admit — `'+1'`,
 * `'1E3'` — which `parseRecordDuration` has already accepted and proved finite and non-negative.
 */
function recordDurationTicksOf(raw: string, seconds: number): bigint {
  const exact = parseUnsignedTicks(trimEdfField(raw));
  return exact.ok ? exact.ticks : secondsToTicks(seconds);
}

/**
 * Parse an EDF/BDF header.
 *
 * `headerBytes` must hold at least `256 * (ns + 1)` bytes; anything beyond that is ignored, so a
 * caller that over-read is free to pass its whole buffer. `sourceByteLength` is the size of the
 * file those bytes came from — pass `bytes.byteLength` for an in-memory file.
 */
export function parseHeader(
  headerBytes: Uint8Array,
  sourceByteLength: number,
  options?: ParseOptions,
): EdfHeader {
  // A caller bug, not a file defect, so it is a plain RangeError: EdfFormatError would claim the
  // bytes are wrong when what is wrong is the number describing them.
  if (!Number.isSafeInteger(sourceByteLength) || sourceByteLength < 0) {
    throw new RangeError(
      `parseHeader(): sourceByteLength must be a non-negative safe integer, received ` +
        `${sourceByteLength}. Next: pass the byte length of the whole file — bytes.byteLength ` +
        'for an in-memory file, or source.byteLength for a ByteSource.',
    );
  }

  const sink = new DiagnosticSink(options);

  // ---- 1. The fixed header must be present at all. --------------------------------------
  if (headerBytes.length < EDF_HEADER_BLOCK_BYTES) {
    throw fatalError({
      code: 'SOURCE_TOO_SMALL',
      message:
        `the header is ${headerBytes.length} bytes, but every EDF and BDF file begins with a ` +
        `${EDF_HEADER_BLOCK_BYTES}-byte fixed header. EDF specification, header record bytes ` +
        '0-255. Next: check that the whole file reached edfcore — an empty file, a truncated ' +
        'download and a directory read all land here.',
      field: 'header',
      byteOffset: 0,
      byteLength: headerBytes.length,
      expected: `at least ${EDF_HEADER_BLOCK_BYTES} bytes`,
      actual: `${headerBytes.length} bytes`,
      specReference: 'EDF specification, header record bytes 0-255',
    });
  }

  const raw = readRawHeaderFields(headerBytes);

  // ---- 2. Version block and reserved marker: the family, the sample width, the dialect. ----
  const variant = detectVariant(headerBytes, sink);

  // ---- 3. ns, before any ns-sized allocation and before trusting the field at offset 184. --
  const signalCount = parseSignalCount(raw.signalCount, sink);

  // ---- 4. The whole header must be present, now that its size is known. -------------------
  const headerByteLength = EDF_HEADER_BLOCK_BYTES * (signalCount + 1);
  if (headerBytes.length < headerByteLength) {
    throw fatalError({
      code: 'SOURCE_TOO_SMALL',
      message:
        `the header of a file declaring ${signalCount} signals is ${EDF_HEADER_BLOCK_BYTES} * ` +
        `(${signalCount} + 1) = ${headerByteLength} bytes, but only ${headerBytes.length} ` +
        'bytes are available. EDF specification, header record. Next: read ' +
        `${headerByteLength} bytes from offset 0 and parse those; if the file itself is that ` +
        'short, the signal count at offset 252 is not the one the file was written with.',
      field: 'header',
      byteOffset: 0,
      byteLength: headerBytes.length,
      expected: `${headerByteLength} bytes`,
      actual: `${headerBytes.length} bytes`,
      specReference: 'EDF specification, header record bytes 184-191 (number of bytes in header)',
    });
  }

  // ---- 5. The declared header size. The computed one always wins. -------------------------
  const declaredHeaderByteLength = checkDeclaredHeaderByteLength(
    raw.headerByteLength,
    headerByteLength,
    sink,
  );

  // ---- 6. The record duration. May be fractional, and may legitimately be 0. --------------
  const recordDurationSeconds = parseRecordDuration(raw.recordDuration, sink);
  const recordDurationTicks = recordDurationTicksOf(raw.recordDuration, recordDurationSeconds);

  // ---- 7. The field-major per-signal blocks. ----------------------------------------------
  const parsed = parseSignalHeaders(
    { headerBytes, signalCount, variant, recordDurationSeconds },
    sink,
  );
  const recordByteLength = parsed.recordByteLength;

  // ---- 8. The record size, which every data offset in the file steps by. ------------------
  if (recordByteLength === 0) {
    const samplesBlockOffset = signalFieldOffset('samplesPerRecord', signalCount, 0);
    throw fatalError({
      code: 'RECORD_SIZE_ZERO',
      message:
        `every one of the ${signalCount} signals declares 0 samples per data record, so a data ` +
        'record is 0 bytes long and the file has no record size to step by — record N and ' +
        'record N+1 would begin at the same byte. EDF specification, data records. Next: the ' +
        `per-signal sample counts live at offset ${samplesBlockOffset}, ` +
        `${SIGNAL_FIELD_WIDTHS.samplesPerRecord} bytes per signal; header.raw keeps them as ` +
        'written.',
      field: 'samplesPerRecord',
      byteOffset: samplesBlockOffset,
      byteLength: signalCount * SIGNAL_FIELD_WIDTHS.samplesPerRecord,
      expected: 'at least one signal with a non-zero number of samples per record',
      actual: '0 bytes per data record',
      specReference: 'EDF specification, data records',
    });
  }
  if (recordByteLength > EDF_RECOMMENDED_MAX_RECORD_BYTES) {
    sink.report({
      code: 'RECORD_SIZE_ABOVE_RECOMMENDED',
      message:
        `a data record is ${recordByteLength} bytes (${variant.bytesPerSample} bytes per ` +
        `sample x ${recordByteLength / variant.bytesPerSample} samples), above the ` +
        `${EDF_RECOMMENDED_MAX_RECORD_BYTES}-byte record size the EDF specification ` +
        'recommends. EDF specification, data records (recommended maximum record size). Next: ' +
        'nothing — the file is read normally, but reads are record-aligned, so this is also ' +
        'the smallest amount of data any read can return.',
      field: 'recordByteLength',
      expected: `at most ${EDF_RECOMMENDED_MAX_RECORD_BYTES} bytes`,
      actual: `${recordByteLength} bytes`,
      specReference: 'EDF specification, data records',
    });
  }

  // ---- 9. The record count, recovered or verified against the real file size. -------------
  const declaredRecordCount = parseDeclaredRecordCount(raw.recordCount, sink);
  const { recordCount, recordCountSource } = resolveRecordCount(
    {
      raw: raw.recordCount,
      declared: declaredRecordCount,
      headerByteLength,
      recordByteLength,
      sourceByteLength,
    },
    sink,
  );

  // ---- 10. EDF+ without an annotations signal has no per-record timing to report. ---------
  if (variant.isPlus && parsed.annotationSignalIndices.length === 0) {
    throw fatalError({
      code: 'EDFPLUS_WITHOUT_ANNOTATION_SIGNAL',
      message:
        `the reserved field at offset ${HEADER_FIELDS.reserved.offset} declares ` +
        `${JSON.stringify(variant.reservedMarker ?? '')} but no signal is labelled ` +
        `${JSON.stringify(variant.annotationsLabel)}. EDF+ specification 2.2.4: every data ` +
        'record of an EDF+ file carries a timekeeping TAL in an annotations signal, and that ' +
        'is the only place a record start time exists. Without it every time edfcore reported ' +
        'would be invented. Next: read the samples as plain ' +
        `${variant.family} by clearing the EDF+ marker in the reserved field, or find the ` +
        'writer that dropped the annotations channel.',
      field: 'reserved',
      byteOffset: HEADER_FIELDS.reserved.offset,
      byteLength: HEADER_FIELDS.reserved.length,
      raw: raw.reserved,
      expected: `a signal labelled ${JSON.stringify(variant.annotationsLabel)}`,
      actual: `${signalCount} signals, none of them annotations`,
      specReference: 'EDF+ specification 2.2.4 (the "EDF Annotations" signal)',
    });
  }

  // ---- 11. The text fields. Nothing above depends on them. --------------------------------
  reportNonAsciiHeaderFields(headerBytes, sink);
  const patient = parsePatientId(raw.patientId, { edfPlus: variant.isPlus }, sink);
  const recording = parseRecordingId(raw.recordingId, { edfPlus: variant.isPlus }, sink);
  const startTime = resolveStartTime(
    {
      rawStartDate: raw.startDate,
      rawStartTime: raw.startTime,
      recordingIdDate: recording.startDate,
    },
    sink,
  );

  return {
    variant: variant.variant,
    continuity: variant.continuity,
    bytesPerSample: variant.bytesPerSample,
    headerByteLength,
    declaredHeaderByteLength,
    recordByteLength,
    dataByteLength: recordCount * recordByteLength,
    recordDurationSeconds,
    recordDurationTicks,
    recordCount,
    declaredRecordCount,
    recordCountSource,
    startTime,
    patient,
    recording,
    signals: buildSignals(parsed.signals, recordCount),
    dataSignalIndices: parsed.dataSignalIndices,
    annotationSignalIndices: parsed.annotationSignalIndices,
    reserved: raw.reserved,
    raw,
    // A copy, not a view: the caller owns the buffer it read into and is free to reuse it, and
    // a header that quietly changed under a hexdump would be worse than no hexdump.
    rawBytes: copyBytes(headerBytes, 0, headerByteLength),
    diagnostics: sink.diagnostics,
  };
}
