/**
 * A minimal EDF/EDF+/BDF/BDF+ writer, for tests only.
 *
 * This is never exported from the package. It exists so the test suite can build exactly the
 * file it wants to talk about — including files no conforming writer would ever produce — and
 * hold the result entirely in memory, so `git clone && npm test` is green and offline.
 *
 * It is deliberately written from the format specification rather than from `src/`. Nothing
 * here imports from `src/`. A reader and a writer that share a misunderstanding would agree
 * with each other and be wrong together; keeping them independent is what makes the
 * round-trip tests worth running.
 *
 * Every header field can be overridden with a raw string, because most interesting test cases
 * are files whose fields do not parse. Damage a well-formed builder cannot express (truncation,
 * byte flips) lives in `corrupt.ts`.
 */

const SPACE = 0x20;
const NUL = 0x00;

/** TAL structural bytes. */
const TAL_DURATION_SEP = 0x15;
const TAL_FIELD_END = 0x14;
const TAL_END = 0x00;

/**
 * One data channel. `label` and `samplesPerRecord` are required because they are the two fields
 * with no defensible default — a channel needs a name to be found by, and its sample count is
 * what every byte offset in the record is computed from.
 */
export interface SignalSpec {
  readonly label: string;
  readonly transducerType?: string;
  readonly physicalDimension?: string;
  readonly physicalMinimum?: number;
  readonly physicalMaximum?: number;
  readonly digitalMinimum?: number;
  readonly digitalMaximum?: number;
  readonly prefiltering?: string;
  readonly samplesPerRecord: number;
  readonly reserved?: string;
  /**
   * Digital sample generator. Receives the record index and the sample index within that
   * record, and returns a digital (pre-scaling) integer. Defaults to a deterministic ramp.
   */
  readonly sample?: (recordIndex: number, sampleIndex: number) => number;
  /** Raw per-field overrides. These bypass all formatting and validation. */
  readonly raw?: Partial<RawSignalFieldOverrides>;
}

/**
 * Per-signal header fields as literal text, bypassing every formatter. This is how a fixture
 * expresses damage a well-formed builder cannot — a non-numeric `physicalMaximum`, a label longer
 * than its field — without the writer helpfully correcting it on the way out.
 */
export interface RawSignalFieldOverrides {
  label: string;
  transducerType: string;
  physicalDimension: string;
  physicalMinimum: string;
  physicalMaximum: string;
  digitalMinimum: string;
  digitalMaximum: string;
  prefiltering: string;
  samplesPerRecord: string;
  reserved: string;
}

/**
 * The fixed 256-byte header as literal text, the counterpart to the per-signal overrides above.
 * `headerByteLength` and `signalCount` are the interesting ones: a file whose declared header size
 * disagrees with its signal count is legal to write and is what the mismatch diagnostics are for.
 */
export interface RawHeaderFieldOverrides {
  version: string;
  patientId: string;
  recordingId: string;
  startDate: string;
  startTime: string;
  headerByteLength: string;
  reserved: string;
  recordCount: string;
  recordDuration: string;
  signalCount: string;
}

/** One time-stamped annotation to place in a record's annotation region. */
export interface TalSpec {
  /** Seconds from the file start. Written verbatim if given as a string. */
  readonly onset: number | string;
  readonly duration?: number | string;
  /** Zero texts writes the `+t\x14\x14\x00` timekeeping shape. */
  readonly texts?: readonly string[];
  /** Emit the widespread `+t\x14\x00` shorthand instead of the mandated double `\x14`. */
  readonly shorthand?: boolean;
  /** Omit the terminating NUL, producing a malformed TAL. */
  readonly omitTerminator?: boolean;
}

/**
 * An annotations channel. Its `tals` callback deliberately excludes the timekeeping TAL, which
 * the writer synthesises per record: a test that had to write its own would be asserting against
 * its own idea of where records start rather than against the format's.
 */
export interface AnnotationSignalSpec {
  /** Region size in samples; total bytes are `samplesPerRecord * bytesPerSample`. */
  readonly samplesPerRecord: number;
  /** `'BDF Annotations'` is used automatically for BDF unless overridden here. */
  readonly label?: string;
  readonly raw?: Partial<RawSignalFieldOverrides>;
  /**
   * TALs for a given record, EXCLUDING the timekeeping TAL, which the writer synthesises.
   * Return an empty array for a record with no events.
   */
  readonly tals?: (recordIndex: number) => readonly TalSpec[];
}

/**
 * One file, described. Almost every field is optional and defaults to something well formed, so a
 * test states only what it is actually about — and a fixture exercising one malformed field is
 * visibly a valid file with that one thing changed.
 */
export interface EdfSpec {
  readonly format?: 'EDF' | 'BDF';
  /** `false` is plain EDF/BDF; `'C'` and `'D'` are the EDF+/BDF+ continuity markers. */
  readonly plus?: false | 'C' | 'D';
  readonly patientId?: string;
  readonly recordingId?: string;
  /** `dd.mm.yy`. */
  readonly startDate?: string;
  /** `hh.mm.ss`. */
  readonly startTime?: string;
  readonly recordCount?: number;
  readonly recordDurationSeconds?: number;
  readonly signals: readonly SignalSpec[];
  /**
   * Annotation signals, appended after the data signals. EDF+ requires at least one; only the
   * first carries timekeeping.
   */
  readonly annotationSignals?: readonly AnnotationSignalSpec[];
  /**
   * Start time of record `r` in seconds, written into the timekeeping TAL. Defaults to
   * `startOffsetSeconds + r * recordDurationSeconds`, i.e. a contiguous recording. Override
   * this to build a genuine EDF+D with real gaps.
   */
  readonly recordOnsetSeconds?: (recordIndex: number) => number | string;
  /** Sub-second start carried by record 0's timekeeping TAL. Must be in [0, 1) to conform. */
  readonly startOffsetSeconds?: number;
  readonly raw?: Partial<RawHeaderFieldOverrides>;
  /** Written verbatim after the last data record. */
  readonly trailingBytes?: Uint8Array;
}

// ---------------------------------------------------------------------------
// Field formatting
// ---------------------------------------------------------------------------

/** EDF pads every text field on the right with spaces. Overlong values are a test-author bug. */
function padField(text: string, width: number, field: string): Uint8Array {
  const out = new Uint8Array(width).fill(SPACE);
  if (text.length > width) {
    throw new Error(`writer: ${field} is ${text.length} chars but the field is ${width}`);
  }
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 0xff) {
      throw new Error(`writer: ${field} contains U+${code.toString(16)}, which is not one byte`);
    }
    out[i] = code;
  }
  return out;
}

/**
 * Shortest exact decimal that fits the field. EDF numeric fields are 8 bytes, which is not
 * always enough for a float64 — failing loudly beats silently writing a different number.
 */
function formatNumber(value: number, width: number, field: string): string {
  if (Number.isInteger(value)) {
    const asInt = String(value);
    if (asInt.length <= width) return asInt;
  }
  for (let precision = width; precision >= 0; precision -= 1) {
    const candidate = value.toFixed(precision).replace(/\.?0+$/, '');
    if (candidate.length <= width && Number(candidate) === value) return candidate;
  }
  for (let precision = width; precision >= 0; precision -= 1) {
    const candidate = value.toFixed(precision);
    if (candidate.length <= width) return candidate;
  }
  throw new Error(`writer: ${field} value ${value} does not fit in ${width} bytes`);
}

// ---------------------------------------------------------------------------
// Deterministic sample data
// ---------------------------------------------------------------------------

/**
 * A tiny LCG (Numerical Recipes constants). Seeded, so a fixture is bit-identical on every
 * machine — a property the fixture tests assert by hashing.
 */
export function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Deterministic pseudo-EEG: a sine plus a reproducible wobble, in digital units. */
export function sineSampler(
  amplitude: number,
  cyclesPerRecord: number,
  samplesPerRecord: number,
): (recordIndex: number, sampleIndex: number) => number {
  return (recordIndex, sampleIndex) => {
    const phase = (2 * Math.PI * cyclesPerRecord * sampleIndex) / samplesPerRecord;
    return Math.round(amplitude * Math.sin(phase + recordIndex));
  };
}

// ---------------------------------------------------------------------------
// TAL encoding
// ---------------------------------------------------------------------------

function formatOnset(onset: number | string): string {
  if (typeof onset === 'string') return onset;
  const body = formatNumber(Math.abs(onset), 12, 'TAL onset');
  return `${onset < 0 ? '-' : '+'}${body}`;
}

function formatDuration(duration: number | string): string {
  if (typeof duration === 'string') return duration;
  return formatNumber(duration, 12, 'TAL duration');
}

/** One TAL: `Onset [0x15 Duration] 0x14 (Text 0x14)* 0x00`. */
export function encodeTal(tal: TalSpec): Uint8Array {
  const bytes: number[] = [];
  const push = (text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      // Text is UTF-8 on disk; every continuation byte is >= 0x80 and so can never collide
      // with a structural byte. Encode above the BMP-safe path via TextEncoder.
      if (code < 0x80) {
        bytes.push(code);
      } else {
        for (const byte of new TextEncoder().encode(text[i])) bytes.push(byte);
      }
    }
  };

  push(formatOnset(tal.onset));
  if (tal.duration !== undefined) {
    bytes.push(TAL_DURATION_SEP);
    push(formatDuration(tal.duration));
  }
  bytes.push(TAL_FIELD_END);

  const texts = tal.texts ?? [];
  if (texts.length === 0) {
    // A timekeeping TAL. The spec mandates a second 0x14 (an empty text); the shorthand
    // omitting it is widespread, and readers must accept both.
    if (!tal.shorthand) bytes.push(TAL_FIELD_END);
  } else {
    for (const text of texts) {
      push(text);
      bytes.push(TAL_FIELD_END);
    }
  }

  if (!tal.omitTerminator) bytes.push(TAL_END);
  return Uint8Array.from(bytes);
}

// ---------------------------------------------------------------------------
// The writer
// ---------------------------------------------------------------------------

interface ResolvedSignal {
  readonly raw: RawSignalFieldOverrides;
  readonly samplesPerRecord: number;
  readonly isAnnotation: boolean;
  readonly annotation: AnnotationSignalSpec | undefined;
  readonly sample: (recordIndex: number, sampleIndex: number) => number;
}

/**
 * Writes a complete file from a spec, in memory. Built from the format specification and
 * importing nothing from `src/` — a reader and a writer that share a misunderstanding agree with
 * each other and are wrong together, so keeping them independent is what makes every round-trip
 * and property test in this suite worth running.
 */
export function buildEdf(spec: EdfSpec): Uint8Array {
  const format = spec.format ?? 'EDF';
  const bytesPerSample = format === 'BDF' ? 3 : 2;
  const plus = spec.plus ?? false;
  const recordDuration = spec.recordDurationSeconds ?? 1;
  const recordCount = spec.recordCount ?? 2;
  const startOffset = spec.startOffsetSeconds ?? 0;

  const defaultDigitalMin = format === 'BDF' ? -8388608 : -32768;
  const defaultDigitalMax = format === 'BDF' ? 8388607 : 32767;

  const resolved: ResolvedSignal[] = [];

  for (const signal of spec.signals) {
    const digitalMinimum = signal.digitalMinimum ?? defaultDigitalMin;
    const digitalMaximum = signal.digitalMaximum ?? defaultDigitalMax;
    resolved.push({
      isAnnotation: false,
      annotation: undefined,
      samplesPerRecord: signal.samplesPerRecord,
      sample: signal.sample ?? ((_r, i) => i % 100),
      raw: {
        label: signal.label,
        transducerType: signal.transducerType ?? 'AgAgCl electrode',
        physicalDimension: signal.physicalDimension ?? 'uV',
        physicalMinimum: formatNumber(signal.physicalMinimum ?? -500, 8, 'physicalMinimum'),
        physicalMaximum: formatNumber(signal.physicalMaximum ?? 500, 8, 'physicalMaximum'),
        digitalMinimum: formatNumber(digitalMinimum, 8, 'digitalMinimum'),
        digitalMaximum: formatNumber(digitalMaximum, 8, 'digitalMaximum'),
        prefiltering: signal.prefiltering ?? 'HP:0.1Hz LP:75Hz',
        samplesPerRecord: String(signal.samplesPerRecord),
        reserved: signal.reserved ?? '',
        ...signal.raw,
      },
    });
  }

  for (const annotation of spec.annotationSignals ?? []) {
    const label = annotation.label ?? (format === 'BDF' ? 'BDF Annotations' : 'EDF Annotations');
    resolved.push({
      isAnnotation: true,
      annotation,
      samplesPerRecord: annotation.samplesPerRecord,
      sample: () => 0,
      raw: {
        label,
        transducerType: '',
        physicalDimension: '',
        physicalMinimum: '-1',
        physicalMaximum: '1',
        digitalMinimum: String(defaultDigitalMin),
        digitalMaximum: String(defaultDigitalMax),
        prefiltering: '',
        samplesPerRecord: String(annotation.samplesPerRecord),
        reserved: '',
        ...annotation.raw,
      },
    });
  }

  const signalCount = resolved.length;
  const headerByteLength = 256 * (signalCount + 1);

  // ---- fixed header --------------------------------------------------------
  const versionBytes = new Uint8Array(8).fill(SPACE);
  if (spec.raw?.version !== undefined) {
    versionBytes.set(padField(spec.raw.version, 8, 'version'));
  } else if (format === 'BDF') {
    // BDF's version block is 0xFF followed by "BIOSEMI" — byte 0 is NOT ASCII, and this is
    // the only reliable way to tell BDF from EDF.
    versionBytes[0] = 0xff;
    versionBytes.set(padField('BIOSEMI', 7, 'version'), 1);
  } else {
    versionBytes.set(padField('0', 8, 'version'));
  }

  const reservedText =
    spec.raw?.reserved ??
    (plus === false ? (format === 'BDF' ? '24BIT' : '') : `${format}+${plus}`);

  const fixed = new Uint8Array(256).fill(SPACE);
  fixed.set(versionBytes, 0);
  fixed.set(padField(spec.raw?.patientId ?? spec.patientId ?? 'X X X X', 80, 'patientId'), 8);
  fixed.set(
    padField(spec.raw?.recordingId ?? spec.recordingId ?? 'Startdate X X X X', 80, 'recordingId'),
    88,
  );
  fixed.set(padField(spec.raw?.startDate ?? spec.startDate ?? '01.01.20', 8, 'startDate'), 168);
  fixed.set(padField(spec.raw?.startTime ?? spec.startTime ?? '10.00.00', 8, 'startTime'), 176);
  fixed.set(
    padField(spec.raw?.headerByteLength ?? String(headerByteLength), 8, 'headerByteLength'),
    184,
  );
  fixed.set(padField(reservedText, 44, 'reserved'), 192);
  fixed.set(padField(spec.raw?.recordCount ?? String(recordCount), 8, 'recordCount'), 236);
  fixed.set(
    padField(
      spec.raw?.recordDuration ?? formatNumber(recordDuration, 8, 'recordDuration'),
      8,
      'recordDuration',
    ),
    244,
  );
  fixed.set(padField(spec.raw?.signalCount ?? String(signalCount), 4, 'signalCount'), 252);

  // ---- per-signal header: FIELD-MAJOR, not one struct per signal ------------
  const signalHeader = new Uint8Array(256 * signalCount).fill(SPACE);
  const fields: ReadonlyArray<[keyof RawSignalFieldOverrides, number]> = [
    ['label', 16],
    ['transducerType', 80],
    ['physicalDimension', 8],
    ['physicalMinimum', 8],
    ['physicalMaximum', 8],
    ['digitalMinimum', 8],
    ['digitalMaximum', 8],
    ['prefiltering', 80],
    ['samplesPerRecord', 8],
    ['reserved', 32],
  ];
  let blockOffset = 0;
  for (const [field, width] of fields) {
    for (let i = 0; i < signalCount; i += 1) {
      const signal = resolved[i];
      if (signal === undefined) throw new Error('unreachable: signal index out of range');
      signalHeader.set(
        padField(signal.raw[field], width, field),
        blockOffset * signalCount + i * width,
      );
    }
    blockOffset += width;
  }

  // ---- data records --------------------------------------------------------
  const recordByteLength =
    bytesPerSample * resolved.reduce((total, signal) => total + signal.samplesPerRecord, 0);
  const effectiveRecordCount = Math.max(0, recordCount);
  const data = new Uint8Array(recordByteLength * effectiveRecordCount);

  const onsetOf = (recordIndex: number): number | string =>
    spec.recordOnsetSeconds?.(recordIndex) ?? startOffset + recordIndex * recordDuration;

  let cursor = 0;
  for (let r = 0; r < effectiveRecordCount; r += 1) {
    let firstAnnotationSignal = true;
    for (const signal of resolved) {
      const regionBytes = signal.samplesPerRecord * bytesPerSample;

      if (signal.isAnnotation) {
        const tals: TalSpec[] = [];
        // Only the FIRST annotation signal carries timekeeping; the others must not.
        if (firstAnnotationSignal) {
          tals.push({ onset: onsetOf(r) });
          firstAnnotationSignal = false;
        }
        tals.push(...(signal.annotation?.tals?.(r) ?? []));

        let regionCursor = cursor;
        const regionEnd = cursor + regionBytes;
        for (const tal of tals) {
          const encoded = encodeTal(tal);
          if (regionCursor + encoded.length > regionEnd) {
            throw new Error(
              `writer: record ${r} annotation region holds ${regionBytes} bytes but the TALs ` +
                'need more. Raise samplesPerRecord on the annotation signal.',
            );
          }
          data.set(encoded, regionCursor);
          regionCursor += encoded.length;
        }
        // The tail is NUL padding, which the array already is.
        cursor = regionEnd;
        continue;
      }

      for (let k = 0; k < signal.samplesPerRecord; k += 1) {
        const value = signal.sample(r, k);
        writeSample(data, cursor, value, bytesPerSample);
        cursor += bytesPerSample;
      }
    }
  }

  const trailing = spec.trailingBytes ?? new Uint8Array(0);
  const out = new Uint8Array(headerByteLength + data.length + trailing.length);
  out.set(fixed, 0);
  out.set(signalHeader, 256);
  out.set(data, headerByteLength);
  if (trailing.length > 0) out.set(trailing, headerByteLength + data.length);
  return out;
}

/** Little-endian two's complement, 2 or 3 bytes. There is no big-endian variant. */
function writeSample(
  target: Uint8Array,
  offset: number,
  value: number,
  bytesPerSample: number,
): void {
  const limit = bytesPerSample === 3 ? 0x1000000 : 0x10000;
  const encoded = ((value % limit) + limit) % limit;
  target[offset] = encoded & 0xff;
  target[offset + 1] = (encoded >> 8) & 0xff;
  if (bytesPerSample === 3) target[offset + 2] = (encoded >> 16) & 0xff;
}

// ---------------------------------------------------------------------------
// Convenience builders for the shapes tests reach for constantly
// ---------------------------------------------------------------------------

/** A minimal, fully conforming plain-EDF file: one signal, two records, 10 samples each. */
export function minimalEdf(overrides: Partial<EdfSpec> = {}): Uint8Array {
  return buildEdf({
    signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
    recordCount: 2,
    recordDurationSeconds: 1,
    ...overrides,
  });
}

/** A minimal conforming EDF+C file with one annotation signal carrying timekeeping. */
export function minimalEdfPlus(overrides: Partial<EdfSpec> = {}): Uint8Array {
  return buildEdf({
    plus: 'C',
    signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
    annotationSignals: [{ samplesPerRecord: 30 }],
    recordCount: 2,
    recordDurationSeconds: 1,
    ...overrides,
  });
}

export { NUL, SPACE, TAL_DURATION_SEP, TAL_END, TAL_FIELD_END };
