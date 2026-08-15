/**
 * Which dialect the file claims to be.
 *
 * Layer 2. Sole owner of the version-block and reserved-field grammars — the two fields that
 * decide sample width, EDF+ dialect and continuity, and therefore every byte offset and every
 * time value computed downstream.
 *
 * Two rules deserve stating because they look wrong:
 *
 * - The 8-byte version block is the ONLY reliable EDF-vs-BDF discriminator. EDF+ deliberately
 *   keeps `'0       '` so legacy readers still open the file, so nothing in the reserved field
 *   can be trusted to identify the family.
 * - BDF's version block is not ASCII: byte 0 is 0xFF, then `'BIOSEMI'`.
 */

import { trimEdfField } from '../bytes/latin1.js';
import { readAsciiField, sliceBytes } from '../bytes/view.js';
import {
  BDF_ANNOTATIONS_LABEL,
  BDF_DIGITAL_MAX,
  BDF_DIGITAL_MIN,
  EDF_ANNOTATIONS_LABEL,
  EDF_DIGITAL_MAX,
  EDF_DIGITAL_MIN,
  HEADER_FIELDS,
} from '../constants.js';
import { type DiagnosticSink, fatalError } from '../diagnostics/collector.js';
import type { EdfVariant } from '../types.js';

/** ASCII `'0'`: the whole of EDF's version block, before padding. */
const EDF_VERSION_BYTE = 0x30;
/** Not ASCII. This single byte is what separates a BDF file from an EDF one. */
const BDF_VERSION_BYTE = 0xff;
const BDF_VERSION_TEXT = 'BIOSEMI';

const CHAR_NUL = 0x00;
const CHAR_SPACE = 0x20;

const EDF_BYTES_PER_SAMPLE = 2 as const;
const BDF_BYTES_PER_SAMPLE = 3 as const;

/**
 * The half of a variant that decides byte layout: EDF stores 16-bit samples, BDF 24-bit. It is
 * detected from the version byte rather than the reserved marker, because a file can be BDF
 * without ever claiming `BDF+`, and every offset in the record depends on getting this right.
 */
export type EdfFamily = 'EDF' | 'BDF';

/** The recognised reserved-field prefixes. Matched on the first five bytes, never trimmed. */
export type EdfReservedMarker = 'EDF+C' | 'EDF+D' | 'BDF+C' | 'BDF+D' | '24BIT';

const RESERVED_MARKERS: readonly EdfReservedMarker[] = [
  'EDF+C',
  'EDF+D',
  'BDF+C',
  'BDF+D',
  '24BIT',
];

export interface EdfVariantInfo {
  readonly variant: EdfVariant;
  /** From the version block alone. Sample width follows from this and nothing else. */
  readonly family: EdfFamily;
  readonly bytesPerSample: 2 | 3;
  readonly continuity: 'continuous' | 'discontinuous';
  /** True for EDF+C/EDF+D/BDF+C/BDF+D: the file claims the EDF+ dialect, so the subfield
   *  grammars in `identification.ts` apply and an annotation signal is mandatory. */
  readonly isPlus: boolean;
  /** The five-byte prefix that actually matched, or `undefined` when the field is blank or
   *  unrecognised. */
  readonly reservedMarker: EdfReservedMarker | undefined;
  /** Trimmed, case-sensitive annotation label for this family. */
  readonly annotationsLabel: string;
  /** What the sample width can represent. Drives `DIGITAL_RANGE_EXCEEDS_FORMAT`. */
  readonly digitalMinimumLimit: number;
  readonly digitalMaximumLimit: number;
}

/**
 * EDF's version block: ASCII `'0'` then seven spaces.
 *
 * NUL is accepted as padding alongside space. The spec says space, but a writer that pads with
 * NUL has produced the same value, and `NOT_AN_EDF_FILE` — the only alternative here — would
 * refuse a file whose every other byte is fine.
 */
export function isEdfVersionBlock(versionBytes: Uint8Array): boolean {
  if (versionBytes[0] !== EDF_VERSION_BYTE) return false;
  for (let i = 1; i < versionBytes.length; i++) {
    const byte = versionBytes[i];
    if (byte !== CHAR_SPACE && byte !== CHAR_NUL) return false;
  }
  return true;
}

/** BDF's version block: byte 0 = 0xFF, bytes 1..7 = `'BIOSEMI'`. Exact, no padding tolerance. */
export function isBdfVersionBlock(versionBytes: Uint8Array): boolean {
  if (versionBytes[0] !== BDF_VERSION_BYTE) return false;
  for (let i = 0; i < BDF_VERSION_TEXT.length; i++) {
    if (versionBytes[i + 1] !== BDF_VERSION_TEXT.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * The dialect marker carried by the reserved field, matched on its five-byte PREFIX.
 *
 * The prefix rule is what makes `'EDF+D v2.1'` an EDF+D file rather than an unrecognised one.
 */
export function reservedMarkerOf(reserved: string): EdfReservedMarker | undefined {
  for (const marker of RESERVED_MARKERS) {
    if (reserved.startsWith(marker)) return marker;
  }
  return undefined;
}

function markerFamily(marker: EdfReservedMarker): EdfFamily {
  return marker === 'EDF+C' || marker === 'EDF+D' ? 'EDF' : 'BDF';
}

function hexBytes(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (const byte of bytes) parts.push(byte.toString(16).padStart(2, '0'));
  return parts.join(' ');
}

function variantOf(
  family: EdfFamily,
  isPlus: boolean,
  continuity: 'continuous' | 'discontinuous',
): EdfVariant {
  if (!isPlus) return family;
  if (family === 'BDF') return continuity === 'discontinuous' ? 'BDF+D' : 'BDF+C';
  return continuity === 'discontinuous' ? 'EDF+D' : 'EDF+C';
}

/**
 * Read the version block and the reserved field, and decide the variant.
 *
 * `headerBytes` must cover at least the 256-byte fixed header; the caller has already refused
 * anything shorter with `SOURCE_TOO_SMALL`.
 *
 * When the reserved marker names a different family than the version block does — `'BDF+C'` on
 * a file whose version block is EDF — the version block wins for the family, but the marker is
 * still honoured for continuity and EDF+ dialect, and the disagreement is reported. Dropping
 * the `D` would silently turn a discontinuous recording into one whose every timestamp is
 * wrong; keeping the wrong sample width would make every sample wrong instead.
 */
export function detectVariant(headerBytes: Uint8Array, sink: DiagnosticSink): EdfVariantInfo {
  const versionBytes = sliceBytes(
    headerBytes,
    HEADER_FIELDS.version.offset,
    HEADER_FIELDS.version.length,
  );
  const isBdf = isBdfVersionBlock(versionBytes);
  const isEdf = !isBdf && isEdfVersionBlock(versionBytes);

  if (!isBdf && !isEdf) {
    const raw = readAsciiField(
      headerBytes,
      HEADER_FIELDS.version.offset,
      HEADER_FIELDS.version.length,
    );
    throw fatalError({
      code: 'NOT_AN_EDF_FILE',
      message:
        `version field (8 bytes at offset ${HEADER_FIELDS.version.offset}) is ` +
        `${JSON.stringify(raw)}, bytes ${hexBytes(versionBytes)}: this is neither EDF's ` +
        `"0" followed by seven spaces nor BDF's 0xFF followed by "BIOSEMI". ` +
        'EDF specification, header record bytes 0-7 (version of this data format). ' +
        'Next: confirm the bytes are an uncompressed EDF or BDF recording — a gzip, zip or ' +
        'vendor container has to be unpacked before edfcore sees it.',
      field: 'version',
      byteOffset: HEADER_FIELDS.version.offset,
      byteLength: HEADER_FIELDS.version.length,
      rawBytes: versionBytes,
      raw,
      expected: '"0       " (EDF) or 0xFF "BIOSEMI" (BDF)',
      actual: hexBytes(versionBytes),
      specReference: 'EDF specification, header record bytes 0-7',
    });
  }

  const family: EdfFamily = isBdf ? 'BDF' : 'EDF';
  const reservedRaw = readAsciiField(
    headerBytes,
    HEADER_FIELDS.reserved.offset,
    HEADER_FIELDS.reserved.length,
  );
  const marker = reservedMarkerOf(reservedRaw);
  const reservedText = trimEdfField(reservedRaw);

  if (marker === undefined && reservedText.length > 0) {
    sink.report({
      code: 'NONSTANDARD_RESERVED_FIELD',
      message:
        `reserved field (44 bytes at offset ${HEADER_FIELDS.reserved.offset}) is ` +
        `${JSON.stringify(reservedText)}, which is neither blank nor one of the recognised ` +
        'five-byte markers "EDF+C", "EDF+D", "BDF+C", "BDF+D" or "24BIT". EDF+ specification ' +
        '2.1.1: the reserved field must start with "EDF+C" when the recording is ' +
        'uninterrupted and "EDF+D" when it is not. Next: the file is read as plain ' +
        `${family}; header.reserved keeps all 44 bytes verbatim.`,
      field: 'reserved',
      byteOffset: HEADER_FIELDS.reserved.offset,
      byteLength: HEADER_FIELDS.reserved.length,
      raw: reservedRaw,
      expected: '"" or one of "EDF+C", "EDF+D", "BDF+C", "BDF+D", "24BIT"',
      actual: reservedText,
      specReference: 'EDF+ specification 2.1.1 (the EDF+ header)',
    });
  } else if (marker !== undefined && markerFamily(marker) !== family) {
    sink.report({
      code: 'NONSTANDARD_RESERVED_FIELD',
      message:
        `reserved field (44 bytes at offset ${HEADER_FIELDS.reserved.offset}) declares ` +
        `${JSON.stringify(marker)} but the version block says this file is ${family}, and ` +
        'the version block is the only reliable discriminator (EDF+ keeps "0       " so ' +
        `legacy readers still open the file). Next: the file is read as ${family} with ` +
        `${family === 'BDF' ? 3 : 2} bytes per sample; the marker's continuity is still ` +
        'honoured, because ignoring a "D" would make every reported time wrong.',
      field: 'reserved',
      byteOffset: HEADER_FIELDS.reserved.offset,
      byteLength: HEADER_FIELDS.reserved.length,
      raw: reservedRaw,
      expected: family === 'BDF' ? '"BDF+C", "BDF+D" or "24BIT"' : '"EDF+C" or "EDF+D"',
      actual: marker,
      specReference: 'EDF specification, header record bytes 0-7',
    });
  }

  const isPlus = marker !== undefined && marker !== '24BIT';
  const continuity = marker === 'EDF+D' || marker === 'BDF+D' ? 'discontinuous' : 'continuous';

  return {
    variant: variantOf(family, isPlus, continuity),
    family,
    bytesPerSample: family === 'BDF' ? BDF_BYTES_PER_SAMPLE : EDF_BYTES_PER_SAMPLE,
    continuity,
    isPlus,
    reservedMarker: marker,
    annotationsLabel: family === 'BDF' ? BDF_ANNOTATIONS_LABEL : EDF_ANNOTATIONS_LABEL,
    digitalMinimumLimit: family === 'BDF' ? BDF_DIGITAL_MIN : EDF_DIGITAL_MIN,
    digitalMaximumLimit: family === 'BDF' ? BDF_DIGITAL_MAX : EDF_DIGITAL_MAX,
  };
}
