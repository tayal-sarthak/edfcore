/**
 * The per-signal header, and where each signal's bytes live inside a data record.
 *
 * Layer 2. Sole owner of `recordByteOffset` arithmetic.
 *
 * The per-signal header is FIELD-MAJOR: all `ns` labels, then all `ns` transducer types, and so
 * on for ten fields, `ns * 256` bytes in total. It is NOT one 256-byte struct per signal, and
 * reading it as one is the single most common EDF bug — it happens to produce plausible output
 * for a one-signal file, which is exactly how it survives a first test.
 *
 *     address(field, i) = 256 + ns * SIGNAL_FIELD_BLOCK_OFFSETS[field] + i * WIDTHS[field]
 *
 * Inside a data record the signals are stored back to back in signal order, each contributing
 * `samplesPerRecord * bytesPerSample` bytes. Both numbers come from this file and nowhere else.
 */

import { trimEdfField } from '../bytes/latin1.js';
import { parseEdfInteger, parseEdfNumber } from '../bytes/numbers.js';
import { readAsciiField } from '../bytes/view.js';
import {
  EDF_HEADER_BLOCK_BYTES,
  HEADER_FIELDS,
  SIGNAL_FIELD_BLOCK_OFFSETS,
  SIGNAL_FIELD_WIDTHS,
} from '../constants.js';
import { type DiagnosticSink, fatalError } from '../diagnostics/collector.js';
import type { EdfRawSignalFields, EdfScale, EdfSignal } from '../types.js';
import { type NumericFieldContext, requireNumericField } from './fields.js';
import { isAnnotationLabel } from './lookup.js';
import { buildScale, normaliseUnit, type ScaleFieldOffsets } from './scale.js';
import type { EdfVariantInfo } from './variant.js';

/** The ten per-signal fields, in file order. */
export type SignalFieldName = keyof typeof SIGNAL_FIELD_WIDTHS;

/**
 * Everything about one signal that does not depend on the resolved record count.
 *
 * The record count is resolved AFTER the per-signal blocks — recovering it needs the record
 * size, which needs `samplesPerRecord` — so `sampleCount` is the one field that cannot be filled
 * in here. `buildSignals` adds it once the count is known.
 */
export type SignalDraft = Omit<EdfSignal, 'sampleCount'>;

export interface SignalHeaderInput {
  /** At least `256 * (signalCount + 1)` bytes; the caller has already refused anything less. */
  readonly headerBytes: Uint8Array;
  readonly signalCount: number;
  readonly variant: EdfVariantInfo;
  /** May be 0, in which case no signal gets a sample rate. Never divided by. */
  readonly recordDurationSeconds: number;
}

export interface ParsedSignalHeaders {
  readonly signals: readonly SignalDraft[];
  /** `bytesPerSample * SUM(samplesPerRecord)`. May be 0; the caller decides that is fatal. */
  readonly recordByteLength: number;
  readonly dataSignalIndices: readonly number[];
  readonly annotationSignalIndices: readonly number[];
}

const SIGNAL_SPEC_REFERENCE =
  'EDF specification, header record, per-signal fields (field-major, ns * 256 bytes from ' +
  'byte 256)';
const DIGITAL_RANGE_SPEC_REFERENCE = 'EDF+ additional specification 5';
const ANNOTATION_SPEC_REFERENCE = 'EDF+ specification 2.2.4 (the "EDF Annotations" signal)';

const FIELD_DESCRIPTIONS: Readonly<Record<SignalFieldName, string>> = {
  label: 'label',
  transducerType: 'transducer type',
  physicalDimension: 'physical dimension',
  physicalMinimum: 'physical minimum',
  physicalMaximum: 'physical maximum',
  digitalMinimum: 'digital minimum',
  digitalMaximum: 'digital maximum',
  prefiltering: 'prefiltering',
  samplesPerRecord: 'number of samples in each data record',
  reserved: 'reserved field',
};

/**
 * The byte offset of one per-signal field, for one signal.
 *
 * Plain arithmetic on plain numbers: a 512-signal header is 131 KB, and nothing here is ever
 * near 2^31, but the same expression is what every offset in the file is built on and `|0` has
 * no business anywhere in it.
 */
export function signalFieldOffset(
  field: SignalFieldName,
  signalCount: number,
  signalIndex: number,
): number {
  return (
    EDF_HEADER_BLOCK_BYTES +
    signalCount * SIGNAL_FIELD_BLOCK_OFFSETS[field] +
    signalIndex * SIGNAL_FIELD_WIDTHS[field]
  );
}

function readSignalField(
  input: SignalHeaderInput,
  field: SignalFieldName,
  signalIndex: number,
): string {
  return readAsciiField(
    input.headerBytes,
    signalFieldOffset(field, input.signalCount, signalIndex),
    SIGNAL_FIELD_WIDTHS[field],
  );
}

function readRawSignalFields(input: SignalHeaderInput, signalIndex: number): EdfRawSignalFields {
  return {
    label: readSignalField(input, 'label', signalIndex),
    transducerType: readSignalField(input, 'transducerType', signalIndex),
    physicalDimension: readSignalField(input, 'physicalDimension', signalIndex),
    physicalMinimum: readSignalField(input, 'physicalMinimum', signalIndex),
    physicalMaximum: readSignalField(input, 'physicalMaximum', signalIndex),
    digitalMinimum: readSignalField(input, 'digitalMinimum', signalIndex),
    digitalMaximum: readSignalField(input, 'digitalMaximum', signalIndex),
    prefiltering: readSignalField(input, 'prefiltering', signalIndex),
    samplesPerRecord: readSignalField(input, 'samplesPerRecord', signalIndex),
    reserved: readSignalField(input, 'reserved', signalIndex),
  };
}

function scaleFieldOffsets(input: SignalHeaderInput, signalIndex: number): ScaleFieldOffsets {
  const ns = input.signalCount;
  return {
    physicalDimension: signalFieldOffset('physicalDimension', ns, signalIndex),
    physicalMinimum: signalFieldOffset('physicalMinimum', ns, signalIndex),
    physicalMaximum: signalFieldOffset('physicalMaximum', ns, signalIndex),
    digitalMinimum: signalFieldOffset('digitalMinimum', ns, signalIndex),
    digitalMaximum: signalFieldOffset('digitalMaximum', ns, signalIndex),
  };
}

function numericContext(
  input: SignalHeaderInput,
  field: SignalFieldName,
  signalIndex: number,
  expected: string,
  nextStep: string,
  specReference: string,
): NumericFieldContext {
  const byteOffset = signalFieldOffset(field, input.signalCount, signalIndex);
  const byteLength = SIGNAL_FIELD_WIDTHS[field];
  return {
    field,
    description:
      `${FIELD_DESCRIPTIONS[field]} of signal ${signalIndex} (${byteLength} bytes at offset ` +
      `${byteOffset})`,
    byteOffset,
    byteLength,
    expected,
    specReference,
    nextStep,
    signalIndex,
  };
}

/**
 * `samplesPerRecord` for one signal: the field every byte offset in the data section is built
 * from, so it is fatal in every way it can fail except one.
 *
 * Zero is the exception. It is a warning: a signal contributing no samples is a writer's mistake
 * rather than an unreadable file, every other signal still has an exact offset, and refusing the
 * file would refuse the readable channels with it.
 */
function parseSamplesPerRecord(
  input: SignalHeaderInput,
  raw: string,
  signalIndex: number,
  sink: DiagnosticSink,
): number {
  const context = numericContext(
    input,
    'samplesPerRecord',
    signalIndex,
    'a whole number of samples, written in ASCII digits',
    'every byte offset inside a data record is a running sum of this field over the signals ' +
      'before it, so no sample in the file can be located while it is unreadable',
    SIGNAL_SPEC_REFERENCE,
  );
  const samplesPerRecord = requireNumericField(parseEdfInteger(raw), context, sink);

  if (samplesPerRecord < 0) {
    throw fatalError({
      code: 'NUMERIC_FIELD_INVALID',
      message:
        `${context.description} is ${JSON.stringify(raw)}, i.e. ${samplesPerRecord} samples. A ` +
        'signal cannot contribute a negative number of bytes to a data record, and the ' +
        `offsets of every later signal are a running sum of this field. ${context.specReference}. ` +
        `Next: ${context.nextStep}.`,
      field: context.field,
      byteOffset: context.byteOffset,
      byteLength: context.byteLength,
      raw,
      expected: '0 or more samples',
      actual: String(samplesPerRecord),
      signalIndex,
      specReference: context.specReference,
    });
  }

  if (samplesPerRecord === 0) {
    sink.report({
      code: 'ZERO_SAMPLES_PER_RECORD',
      message:
        `${context.description} is ${JSON.stringify(raw)}: this signal contributes no bytes to ` +
        `a data record and therefore carries no samples at all. ${context.specReference}: a ` +
        'signal is present in every data record. Next: the signal is still exposed, with ' +
        'sampleCount 0 and a zero-length block; decoding it returns an empty array, and the ' +
        'other signals are unaffected because their offsets skip it exactly.',
      field: context.field,
      byteOffset: context.byteOffset,
      byteLength: context.byteLength,
      raw,
      expected: '1 or more samples',
      actual: '0',
      signalIndex,
      specReference: SIGNAL_SPEC_REFERENCE,
    });
  }

  return samplesPerRecord;
}

/**
 * The declared digital range against what the sample width can represent: 16-bit two's
 * complement for EDF, 24-bit for BDF.
 *
 * A warning, not an error. The declaration is what scaling uses, and a range wider than the
 * format means the writer's scale is inconsistent with its own samples — but the samples still
 * decode, and edfcore reports the mismatch rather than choosing a range for it.
 */
function checkDigitalRangeFitsFormat(
  input: SignalHeaderInput,
  signalIndex: number,
  kind: EdfSignal['kind'],
  digitalMinimum: number,
  digitalMaximum: number,
  raw: EdfRawSignalFields,
  sink: DiagnosticSink,
): void {
  const low = input.variant.digitalMinimumLimit;
  const high = input.variant.digitalMaximumLimit;
  const outside = [digitalMinimum, digitalMaximum].some((value) => value < low || value > high);
  if (!outside) return;

  const byteOffset = signalFieldOffset('digitalMinimum', input.signalCount, signalIndex);
  sink.report({
    code: 'DIGITAL_RANGE_EXCEEDS_FORMAT',
    message:
      `signal ${signalIndex} declares the digital range ${digitalMinimum}..${digitalMaximum} ` +
      `(raw ${JSON.stringify(raw.digitalMinimum)} and ` +
      `${JSON.stringify(raw.digitalMaximum)} at byte offsets ${byteOffset} and ` +
      `${signalFieldOffset('digitalMaximum', input.signalCount, signalIndex)}), but a ` +
      `${input.variant.family} sample is ${input.variant.bytesPerSample * 8}-bit two's ` +
      `complement and can only hold ${low}..${high}. ${DIGITAL_RANGE_SPEC_REFERENCE}. Next: ` +
      // The warning is worth making on any channel — a range outside the sample width is the
      // BDF/EDF confusion this check exists for — but the consequence is not the same one. An
      // annotations channel gets NO scale (the branch below skips `buildScale`), its bytes are
      // TAL text, and `toPhysical` throws for it, so telling the reader to expect extrapolated
      // physical values described a conversion that cannot happen (fixed in 0.3.72).
      (kind === 'annotations'
        ? 'nothing is scaled from these fields. An annotations signal carries TAL text rather ' +
          'than a measurement, so no scale is built for it and toPhysical() refuses it. The ' +
          'range is worth correcting because it says the writer confused the two sample widths.'
        : // 0.3.72 split the annotations case out and left this one unconditional, but it runs
          // BEFORE `buildScale` and never asks whether a scale will exist. A range that is also
          // degenerate or inverted — the two commonest ways a writer stamps BDF bounds into an
          // EDF header — gets no scale at all, so promising extrapolated values described a
          // conversion that cannot happen here either (fixed in 0.3.120).
          digitalMinimum >= digitalMaximum
          ? 'no scale is built from this range, because digitalMinimum is not below ' +
            'digitalMaximum, and toPhysical() refuses the signal. The range is still worth ' +
            'correcting because it says the writer confused the two sample widths.'
          : 'the declared range is used for scaling exactly as written — edfcore never clamps — ' +
            'so expect physical values that extrapolate beyond the declared physical range.'),
    field: 'digitalMinimum',
    byteOffset,
    byteLength: SIGNAL_FIELD_WIDTHS.digitalMinimum,
    raw: raw.digitalMinimum,
    expected: `${low}..${high}`,
    actual: `${digitalMinimum}..${digitalMaximum}`,
    signalIndex,
    specReference: DIGITAL_RANGE_SPEC_REFERENCE,
  });
}

/**
 * The EDF+ requirements on an annotation signal's own header block.
 *
 * Reported and then ignored: a non-conformant annotation header says nothing about whether the
 * TALs inside the channel are readable, and they usually are. The digital range is checked
 * against the exact values the dialect prescribes, not against the representable range.
 */
function checkAnnotationSignalHeader(
  input: SignalHeaderInput,
  signalIndex: number,
  raw: EdfRawSignalFields,
  digitalMinimum: number,
  digitalMaximum: number,
  sink: DiagnosticSink,
): void {
  const expectedMinimum = input.variant.digitalMinimumLimit;
  const expectedMaximum = input.variant.digitalMaximumLimit;
  const defects: string[] = [];
  if (digitalMinimum !== expectedMinimum) {
    defects.push(
      `digital minimum ${JSON.stringify(raw.digitalMinimum)} instead of ${expectedMinimum}`,
    );
  }
  if (digitalMaximum !== expectedMaximum) {
    defects.push(
      `digital maximum ${JSON.stringify(raw.digitalMaximum)} instead of ${expectedMaximum}`,
    );
  }
  if (trimEdfField(raw.transducerType).length > 0) {
    defects.push(`a non-blank transducer type ${JSON.stringify(trimEdfField(raw.transducerType))}`);
  }
  if (trimEdfField(raw.prefiltering).length > 0) {
    defects.push(
      `a non-blank prefiltering field ${JSON.stringify(trimEdfField(raw.prefiltering))}`,
    );
  }
  if (defects.length === 0) return;

  sink.report({
    code: 'ANNOTATION_SIGNAL_HEADER_NONCONFORMANT',
    message:
      `annotation signal ${signalIndex} (label ${JSON.stringify(trimEdfField(raw.label))}) has ` +
      `${defects.join(', ')}. ${ANNOTATION_SPEC_REFERENCE}: the annotations signal must ` +
      `declare digital minimum ${expectedMinimum} and digital maximum ${expectedMaximum}, and ` +
      'leave transducer type and prefiltering blank, because the channel carries text rather ' +
      'than measurements. Next: the annotations are read anyway — the header block of an ' +
      'annotation signal only sizes its region, and that comes from samplesPerRecord.',
    field: 'label',
    byteOffset: signalFieldOffset('label', input.signalCount, signalIndex),
    byteLength: SIGNAL_FIELD_WIDTHS.label,
    raw: raw.label,
    expected: `digital range ${expectedMinimum}..${expectedMaximum}, blank transducer and prefiltering`,
    actual: defects.join(', '),
    signalIndex,
    specReference: ANNOTATION_SPEC_REFERENCE,
  });
}

/**
 * One diagnostic per duplicated label, naming every signal that carries it.
 *
 * Annotation signals are excluded, and that is not a leniency: EDF+ allows several annotation
 * channels and requires every one of them to be labelled `'EDF Annotations'`, so warning about
 * them would report a defect against a conformant file — and under `strict` it would refuse one.
 * `getSignal(header, 'EDF Annotations')` still throws on a file with two of them; the way to
 * address those channels is `header.annotationSignalIndices`.
 */
function checkDuplicateLabels(
  input: SignalHeaderInput,
  drafts: readonly SignalDraft[],
  sink: DiagnosticSink,
): void {
  const byLabel = new Map<string, number[]>();
  for (const draft of drafts) {
    if (draft.kind === 'annotations') continue;
    const indices = byLabel.get(draft.label);
    if (indices === undefined) byLabel.set(draft.label, [draft.index]);
    else indices.push(draft.index);
  }

  for (const [label, indices] of byLabel) {
    const collision = indices[1];
    if (collision === undefined) continue;
    sink.report({
      code: 'DUPLICATE_SIGNAL_LABEL',
      message:
        `signals ${indices.join(', ')} all carry the label ${JSON.stringify(label)}. A label ` +
        'identifies a channel, so a repeated one leaves no way to name these signals apart. ' +
        `${SIGNAL_SPEC_REFERENCE}. Next: getSignal(header, ${JSON.stringify(label)}) throws ` +
        'EdfAmbiguousChannelError listing these indices rather than silently returning the ' +
        'first; use findSignals() to see them all, or select by index.',
      field: 'label',
      byteOffset: signalFieldOffset('label', input.signalCount, collision),
      byteLength: SIGNAL_FIELD_WIDTHS.label,
      // The UNTRIMMED field, like every other signal diagnostic. `raw` is contractually "those
      // bytes as text, exactly as written including padding", and this reports a 16-byte field —
      // so quoting the trimmed key printed `"Fp1"` under a claim of sixteen bytes, and a reader
      // matching it against a hexdump at the offset beside it found padding the quote denied
      // (fixed in 0.3.74).
      raw: drafts.find((draft) => draft.index === collision)?.raw.label ?? label,
      expected: 'a label unique within the file',
      actual: `${indices.length} signals labelled ${JSON.stringify(label)}`,
      signalIndex: collision,
      specReference: SIGNAL_SPEC_REFERENCE,
    });
  }
}

/**
 * Parse the whole per-signal header.
 *
 * Check order within one signal is fixed and deliberate: samples per record (the offsets depend
 * on it), then the digital range, then the physical range, then the range checks, then the
 * annotation-signal conformance, then the scale. Cross-signal checks — duplicate labels, then a
 * missing EDF+ marker — run once at the end, when every label is known.
 */
export function parseSignalHeaders(
  input: SignalHeaderInput,
  sink: DiagnosticSink,
): ParsedSignalHeaders {
  const drafts: SignalDraft[] = [];
  const dataSignalIndices: number[] = [];
  const annotationSignalIndices: number[] = [];
  let recordByteOffset = 0;

  for (let index = 0; index < input.signalCount; index++) {
    const raw = readRawSignalFields(input, index);
    const label = trimEdfField(raw.label);
    const kind: EdfSignal['kind'] = isAnnotationLabel(label) ? 'annotations' : 'data';

    const samplesPerRecord = parseSamplesPerRecord(input, raw.samplesPerRecord, index, sink);
    const digitalMinimum = requireNumericField(
      parseEdfInteger(raw.digitalMinimum),
      numericContext(
        input,
        'digitalMinimum',
        index,
        'a whole number, written in ASCII digits',
        'the digital range defines the scale of this signal, and edfcore will not read a ' +
          'physical value off a range it cannot read',
        DIGITAL_RANGE_SPEC_REFERENCE,
      ),
      sink,
    );
    const digitalMaximum = requireNumericField(
      parseEdfInteger(raw.digitalMaximum),
      numericContext(
        input,
        'digitalMaximum',
        index,
        'a whole number, written in ASCII digits',
        'the digital range defines the scale of this signal, and edfcore will not read a ' +
          'physical value off a range it cannot read',
        DIGITAL_RANGE_SPEC_REFERENCE,
      ),
      sink,
    );
    const physicalMinimum = requireNumericField(
      parseEdfNumber(raw.physicalMinimum),
      numericContext(
        input,
        'physicalMinimum',
        index,
        'a number, written in ASCII digits with "." as the decimal separator',
        'the physical range defines the scale of this signal, and edfcore will not invent a ' +
          'gain for a range it cannot read',
        SIGNAL_SPEC_REFERENCE,
      ),
      sink,
    );
    const physicalMaximum = requireNumericField(
      parseEdfNumber(raw.physicalMaximum),
      numericContext(
        input,
        'physicalMaximum',
        index,
        'a number, written in ASCII digits with "." as the decimal separator',
        'the physical range defines the scale of this signal, and edfcore will not invent a ' +
          'gain for a range it cannot read',
        SIGNAL_SPEC_REFERENCE,
      ),
      sink,
    );

    checkDigitalRangeFitsFormat(input, index, kind, digitalMinimum, digitalMaximum, raw, sink);

    let scale: EdfScale | undefined;
    if (kind === 'annotations') {
      checkAnnotationSignalHeader(input, index, raw, digitalMinimum, digitalMaximum, sink);
      // No scale is built for an annotation channel, and that is not a refusal: its bytes are
      // TAL text, so there is no measurement to scale. Running the degenerate-range checks over
      // it would report a defect about a number nobody may use.
      annotationSignalIndices.push(index);
    } else {
      scale = buildScale(
        {
          signalIndex: index,
          label,
          physicalDimension: raw.physicalDimension,
          physicalMinimum,
          physicalMaximum,
          digitalMinimum,
          digitalMaximum,
          raw,
          byteOffsets: scaleFieldOffsets(input, index),
        },
        sink,
      );
      dataSignalIndices.push(index);
    }

    const recordByteLength = samplesPerRecord * input.variant.bytesPerSample;
    drafts.push({
      index,
      kind,
      label,
      transducerType: trimEdfField(raw.transducerType),
      prefiltering: trimEdfField(raw.prefiltering),
      physicalDimension: trimEdfField(raw.physicalDimension),
      unit: normaliseUnit(raw.physicalDimension),
      physicalMinimum,
      physicalMaximum,
      digitalMinimum,
      digitalMaximum,
      samplesPerRecord,
      // Undefined exactly when the record duration is 0, which is legal. Dividing by it there
      // would produce Infinity and label it a sample rate.
      sampleRateHz:
        input.recordDurationSeconds === 0
          ? undefined
          : samplesPerRecord / input.recordDurationSeconds,
      scale,
      recordByteOffset,
      recordByteLength,
      raw,
    });
    recordByteOffset += recordByteLength;
  }

  checkDuplicateLabels(input, drafts, sink);

  const firstAnnotation = annotationSignalIndices[0];
  if (firstAnnotation !== undefined && !input.variant.isPlus) {
    const first = firstAnnotation;
    const label = drafts[first]?.label ?? input.variant.annotationsLabel;
    // THIS FAMILY'S markers, not EDF's. `detectVariant` treats the version block as the only
    // reliable discriminator and reports `NONSTANDARD_RESERVED_FIELD` for a BDF file whose
    // reserved field says "EDF+C" — so advising a BDF writer to put that there produced a NEW
    // warning caused by following this one. The `plus` names below come out as EDF+C/EDF+D for an
    // EDF file and BDF+C/BDF+D for a BDF one (fixed in 0.3.24).
    const plus = `${input.variant.family}+`;
    const reserved = readAsciiField(
      input.headerBytes,
      HEADER_FIELDS.reserved.offset,
      HEADER_FIELDS.reserved.length,
    );
    sink.report({
      code: 'MISSING_EDFPLUS_MARKER',
      message:
        `signal ${first} is labelled ${JSON.stringify(label)} but the reserved field of the ` +
        'fixed header carries no EDF+/BDF+ marker, so the file claims to be plain ' +
        `${input.variant.family} while carrying an annotations channel, which only ${plus} ` +
        'defines. ' +
        `EDF+ specification 2.1.1: such a file states "${plus}C" or "${plus}D" in the ` +
        'reserved field. Next: the annotations are parsed anyway, and the channel is never ' +
        'exposed as an ' +
        'ordinary signal — it is in header.annotationSignalIndices, not in ' +
        'header.dataSignalIndices — because decoding TAL text as samples produces numbers that ' +
        'look like a signal.',
      // The location describes the RESERVED field, which is what the message names and what a
      // reader would hexdump. It used to carry the annotation signal's label offset, the label's
      // 16-byte width and the label text — so one diagnostic said "at offset 192" in its prose
      // and pointed `byteOffset` at a different part of the header entirely.
      field: 'reserved',
      byteOffset: HEADER_FIELDS.reserved.offset,
      byteLength: HEADER_FIELDS.reserved.length,
      raw: reserved,
      expected: `"${plus}C" or "${plus}D" in the reserved field at offset ${HEADER_FIELDS.reserved.offset}`,
      actual: 'no EDF+/BDF+ marker',
      signalIndex: first,
      specReference: 'EDF+ specification 2.1.1 (the EDF+ header)',
    });
  }

  return {
    signals: Object.freeze(drafts),
    recordByteLength: recordByteOffset,
    dataSignalIndices: Object.freeze(dataSignalIndices),
    annotationSignalIndices: Object.freeze(annotationSignalIndices),
  };
}

/** The drafts, completed with the sample count the resolved record count implies. */
export function buildSignals(
  drafts: readonly SignalDraft[],
  recordCount: number,
): readonly EdfSignal[] {
  return Object.freeze(
    drafts.map((draft) => ({ ...draft, sampleCount: draft.samplesPerRecord * recordCount })),
  );
}
