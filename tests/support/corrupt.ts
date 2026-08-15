/**
 * Damage a well-formed file in ways a builder cannot express.
 *
 * `writer.ts` can produce any file whose *fields* are wrong. This module produces files whose
 * *bytes* are wrong: truncated, flipped, padded with garbage. Every function returns a new
 * array and never mutates its input, so a single fixture can seed many cases.
 */

const SPACE = 0x20;

/** Field offsets and widths in the fixed 256-byte header. */
export const HEADER_FIELD = {
  version: [0, 8],
  patientId: [8, 80],
  recordingId: [88, 80],
  startDate: [168, 8],
  startTime: [176, 8],
  headerByteLength: [184, 8],
  reserved: [192, 44],
  recordCount: [236, 8],
  recordDuration: [244, 8],
  signalCount: [252, 4],
} as const satisfies Record<string, readonly [number, number]>;

/** Cumulative width preceding each per-signal field, and the field's own width. */
export const SIGNAL_FIELD = {
  label: [0, 16],
  transducerType: [16, 80],
  physicalDimension: [96, 8],
  physicalMinimum: [104, 8],
  physicalMaximum: [112, 8],
  digitalMinimum: [120, 8],
  digitalMaximum: [128, 8],
  prefiltering: [136, 80],
  samplesPerRecord: [216, 8],
  reserved: [224, 32],
} as const satisfies Record<string, readonly [number, number]>;

/**
 * The fields a test can damage by name, derived from the offset tables above rather than listed
 * again. The offsets are written here from the specification and not imported from `src/`, so a
 * test that corrupts `digitalMaximum` overwrites the bytes the FORMAT puts there — not the bytes
 * edfcore believes it does, which would make the test agree with any offset bug it has.
 */
export type HeaderFieldName = keyof typeof HEADER_FIELD;
export type SignalFieldName = keyof typeof SIGNAL_FIELD;

function clone(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes);
}

/** Overwrite a fixed-header field with raw text, right-padded with spaces. */
export function setHeaderField(
  bytes: Uint8Array,
  field: HeaderFieldName,
  text: string,
): Uint8Array {
  const [offset, width] = HEADER_FIELD[field];
  return setRawText(bytes, offset, width, text, field);
}

/**
 * Overwrite a per-signal field. The per-signal header is field-major, so the address is
 * `256 + signalCount * blockOffset + signalIndex * width` — not one struct per signal.
 */
export function setSignalField(
  bytes: Uint8Array,
  signalCount: number,
  signalIndex: number,
  field: SignalFieldName,
  text: string,
): Uint8Array {
  const [blockOffset, width] = SIGNAL_FIELD[field];
  const offset = 256 + signalCount * blockOffset + signalIndex * width;
  return setRawText(bytes, offset, width, text, `${field}[${signalIndex}]`);
}

function setRawText(
  bytes: Uint8Array,
  offset: number,
  width: number,
  text: string,
  label: string,
): Uint8Array {
  if (text.length > width) {
    throw new Error(`corrupt: ${label} is ${text.length} chars but the field is ${width}`);
  }
  const out = clone(bytes);
  out.fill(SPACE, offset, offset + width);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 0xff) throw new Error(`corrupt: ${label} contains a non-byte character`);
    out[offset + i] = code;
  }
  return out;
}

/** Keep only the first `byteLength` bytes. */
export function truncate(bytes: Uint8Array, byteLength: number): Uint8Array {
  return clone(bytes.subarray(0, byteLength));
}

/** Drop `count` bytes from the end — the shape of an interrupted transfer. */
export function truncateBy(bytes: Uint8Array, count: number): Uint8Array {
  return truncate(bytes, Math.max(0, bytes.length - count));
}

/** Append arbitrary bytes after the last data record. */
export function appendBytes(bytes: Uint8Array, extra: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length + extra.length);
  out.set(bytes, 0);
  out.set(extra, bytes.length);
  return out;
}

/** Write raw bytes at an absolute offset. */
export function patchBytes(bytes: Uint8Array, offset: number, patch: Uint8Array): Uint8Array {
  const out = clone(bytes);
  out.set(patch, offset);
  return out;
}

/** Flip one bit, for the fuzz corpus. */
export function flipBit(bytes: Uint8Array, offset: number, bit: number): Uint8Array {
  const out = clone(bytes);
  const current = out[offset];
  if (current === undefined) throw new Error(`corrupt: offset ${offset} is past the end`);
  out[offset] = current ^ (1 << bit);
  return out;
}
