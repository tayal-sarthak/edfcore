/**
 * `src/header/variant.ts` — the version block and the reserved-field marker.
 *
 * These two fields decide the sample width, the EDF+ dialect and the continuity, and therefore
 * every byte offset and every time value the rest of the library computes. DESIGN.md section 5
 * pins both rules: the 8-byte version block is the ONLY EDF-vs-BDF discriminator, and the
 * reserved field is matched on its five-byte PREFIX.
 */

import { describe, expect, it } from 'vitest';

import { DiagnosticSink } from '../../../src/diagnostics/collector.js';
import { EdfFormatError } from '../../../src/errors.js';
import { parseHeader } from '../../../src/header/parse.js';
import {
  detectVariant,
  type EdfVariantInfo,
  isBdfVersionBlock,
  isEdfVersionBlock,
  reservedMarkerOf,
} from '../../../src/header/variant.js';
import { patchBytes, setHeaderField } from '../../support/corrupt.js';
import { buildEdf, minimalEdf, minimalEdfPlus } from '../../support/writer.js';

interface Detected {
  readonly info: EdfVariantInfo;
  readonly codes: readonly string[];
}

function detect(bytes: Uint8Array): Detected {
  const sink = new DiagnosticSink();
  const info = detectVariant(bytes, sink);
  return { info, codes: sink.diagnostics.map((diagnostic) => diagnostic.code) };
}

function ascii(text: string): number[] {
  return [...text].map((character) => character.charCodeAt(0));
}

/** Replace the eight version bytes, which the writer cannot express as text (BDF's byte 0). */
function withVersionBytes(bytes: Uint8Array, version: readonly number[]): Uint8Array {
  expect(version).toHaveLength(8);
  return patchBytes(bytes, 0, Uint8Array.from(version));
}

function expectFormatError(run: () => unknown): EdfFormatError {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(EdfFormatError);
  return thrown as EdfFormatError;
}

/** One data signal, four samples a record — small enough that the geometry is checkable by eye. */
const SAMPLES_PER_RECORD = 4;

function edfFile(): Uint8Array {
  return minimalEdf({ signals: [{ label: 'Fp1', samplesPerRecord: SAMPLES_PER_RECORD }] });
}

function bdfFile(): Uint8Array {
  return buildEdf({
    format: 'BDF',
    signals: [{ label: 'Fp1', samplesPerRecord: SAMPLES_PER_RECORD }],
    recordCount: 2,
  });
}

describe('the eight-byte version block decides the family, and nothing else does', () => {
  it("reads '0' followed by seven spaces as EDF, two bytes per sample", () => {
    // DESIGN.md section 5, offset 0: EDF's version block is exactly "0       ".
    const bytes = edfFile();
    expect([...bytes.subarray(0, 8)]).toEqual([0x30, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20]);

    const { info, codes } = detect(bytes);
    expect(info.family).toBe('EDF');
    expect(info.variant).toBe('EDF');
    expect(info.bytesPerSample).toBe(2);
    expect(info.isPlus).toBe(false);
    expect(codes).toEqual([]);
  });

  it("reads 0xFF followed by 'BIOSEMI' as BDF, three bytes per sample", () => {
    // DESIGN.md section 5, offset 0: BDF's byte 0 is 0xFF — not ASCII — then bytes 1-7 "BIOSEMI".
    const bytes = bdfFile();
    expect([...bytes.subarray(0, 8)]).toEqual([0xff, ...ascii('BIOSEMI')]);

    const { info, codes } = detect(bytes);
    expect(info.family).toBe('BDF');
    expect(info.variant).toBe('BDF');
    expect(info.bytesPerSample).toBe(3);
    expect(codes).toEqual([]);

    const header = parseHeader(bytes, bytes.byteLength);
    expect(header.bytesPerSample).toBe(3);
    expect(header.variant).toBe('BDF');
    // recordByteLength = bytesPerSample * SUM(samplesPerRecord) — DESIGN.md section 5.
    expect(header.recordByteLength).toBe(3 * SAMPLES_PER_RECORD);
  });

  it('keeps the EDF sample width even when the reserved field claims BDF', () => {
    // The reserved marker never widens a sample: EDF+ deliberately keeps "0       " so legacy
    // readers still open the file, so nothing in the reserved field identifies the family.
    const bytes = setHeaderField(edfFile(), 'reserved', 'BDF+C');
    const { info, codes } = detect(bytes);
    expect(info.family).toBe('EDF');
    expect(info.bytesPerSample).toBe(2);
    expect(codes).toEqual(['NONSTANDARD_RESERVED_FIELD']);
  });

  it('keeps the BDF sample width even when the reserved field claims EDF+', () => {
    const bytes = setHeaderField(bdfFile(), 'reserved', 'EDF+D');
    const { info, codes } = detect(bytes);
    expect(info.family).toBe('BDF');
    expect(info.bytesPerSample).toBe(3);
    // The marker loses the family argument but still wins the continuity one: ignoring the "D"
    // would silently turn a discontinuous recording into one whose every timestamp is wrong.
    expect(info.continuity).toBe('discontinuous');
    expect(info.variant).toBe('BDF+D');
    expect(codes).toEqual(['NONSTANDARD_RESERVED_FIELD']);
  });

  it('tolerates NUL padding after the EDF "0", because the value is the same', () => {
    // A documented tolerance (src/header/variant.ts): NOT_AN_EDF_FILE is the only alternative,
    // and it would refuse a file whose every other byte is fine.
    const bytes = withVersionBytes(edfFile(), [0x30, 0, 0, 0, 0, 0, 0, 0]);
    expect(detect(bytes).info.family).toBe('EDF');
  });

  it('accepts no padding tolerance in the BDF block: the seven letters are exact', () => {
    expect(isBdfVersionBlock(Uint8Array.from([0xff, ...ascii('BIOSEMI')]))).toBe(true);
    expect(isBdfVersionBlock(Uint8Array.from([0xff, ...ascii('BIOSEM ')]))).toBe(false);
    expect(isBdfVersionBlock(Uint8Array.from([0xff, ...ascii('biosemi')]))).toBe(false);
    expect(isBdfVersionBlock(Uint8Array.from([0xfe, ...ascii('BIOSEMI')]))).toBe(false);
  });

  it("recognises only '0' in the first byte of an EDF block", () => {
    expect(isEdfVersionBlock(Uint8Array.from(ascii('0       ')))).toBe(true);
    expect(isEdfVersionBlock(Uint8Array.from(ascii('1       ')))).toBe(false);
    expect(isEdfVersionBlock(Uint8Array.from(ascii('        ')))).toBe(false);
    // A byte after the '0' that is neither space nor NUL is content, not padding.
    expect(isEdfVersionBlock(Uint8Array.from(ascii('0 0     ')))).toBe(false);
  });
});

describe('a version block that is neither EDF nor BDF is fatal', () => {
  const REJECTED: ReadonlyArray<{ readonly name: string; readonly version: readonly number[] }> = [
    { name: 'a writer that spelled the format out', version: ascii('EDF     ') },
    { name: 'a version digit other than 0', version: ascii('1       ') },
    { name: 'a blank version field', version: ascii('        ') },
    { name: 'a non-padding byte inside the EDF block', version: ascii('0 0     ') },
    { name: 'BIOSEMI misspelt', version: [0xff, ...ascii('BIOSEM ')] },
    { name: '0xFF without BIOSEMI', version: [0xff, ...ascii('       ')] },
    // A gzip container is the case the message's "next step" names explicitly.
    { name: 'gzip magic', version: [0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00] },
    { name: 'a NUL-filled block', version: [0, 0, 0, 0, 0, 0, 0, 0] },
  ];

  for (const { name, version } of REJECTED) {
    it(`refuses ${name} with NOT_AN_EDF_FILE rather than guessing a family`, () => {
      const bytes = withVersionBytes(edfFile(), version);
      const error = expectFormatError(() => detect(bytes));
      expect(error.code).toBe('NOT_AN_EDF_FILE');
      expect(error.edfErrorKind).toBe('format');
      expect(error.field).toBe('version');
      expect(error.byteOffset).toBe(0);
      expect(error.diagnostic?.severity).toBe('error');
      expect(error.diagnostic?.byteLength).toBe(8);
      // The bytes as written travel with the diagnostic — DESIGN.md section 6.
      expect([...(error.diagnostic?.rawBytes ?? [])]).toEqual([...version]);
    });
  }

  it('throws through parseHeader even when strict is not set', () => {
    // NOT_AN_EDF_FILE is in DESIGN.md section 6's "always fatal" list: it fires regardless of
    // `strict`, because there is no truthful way to proceed.
    const bytes = withVersionBytes(edfFile(), ascii('EDF     '));

    const collected = expectFormatError(() => parseHeader(bytes, bytes.byteLength));
    expect(collected.code).toBe('NOT_AN_EDF_FILE');

    const strict = expectFormatError(() => parseHeader(bytes, bytes.byteLength, { strict: true }));
    expect(strict.code).toBe('NOT_AN_EDF_FILE');
  });

  it('reports the version field before anything else in the header can be wrong', () => {
    // Check order, DESIGN.md section 6: step 2 is the version block, ahead of the signal count.
    // A file that is broken in both ways must still report NOT_AN_EDF_FILE.
    const broken = setHeaderField(
      withVersionBytes(edfFile(), ascii('EDF     ')),
      'signalCount',
      'ab',
    );
    expect(expectFormatError(() => parseHeader(broken, broken.byteLength)).code).toBe(
      'NOT_AN_EDF_FILE',
    );
  });
});

describe('the reserved field is matched on its five-byte prefix', () => {
  interface ReservedCase {
    readonly behaviour: string;
    readonly format: 'EDF' | 'BDF';
    readonly reserved: string;
    readonly variant: EdfVariantInfo['variant'];
    readonly marker: EdfVariantInfo['reservedMarker'];
    readonly continuity: EdfVariantInfo['continuity'];
    readonly isPlus: boolean;
    readonly codes: readonly string[];
  }

  const CASES: readonly ReservedCase[] = [
    {
      behaviour: "'EDF+C' marks a continuous EDF+ file",
      format: 'EDF',
      reserved: 'EDF+C',
      variant: 'EDF+C',
      marker: 'EDF+C',
      continuity: 'continuous',
      isPlus: true,
      codes: [],
    },
    {
      behaviour: "'EDF+D' marks a discontinuous EDF+ file",
      format: 'EDF',
      reserved: 'EDF+D',
      variant: 'EDF+D',
      marker: 'EDF+D',
      continuity: 'discontinuous',
      isPlus: true,
      codes: [],
    },
    {
      // DESIGN.md section 5: match the 5-byte prefix. Trailing text is not a defect.
      behaviour: "'EDF+D v2.1' matches on its prefix and its trailing text is ignored",
      format: 'EDF',
      reserved: 'EDF+D v2.1',
      variant: 'EDF+D',
      marker: 'EDF+D',
      continuity: 'discontinuous',
      isPlus: true,
      codes: [],
    },
    {
      behaviour: "'BDF+C' marks a continuous BDF+ file",
      format: 'BDF',
      reserved: 'BDF+C',
      variant: 'BDF+C',
      marker: 'BDF+C',
      continuity: 'continuous',
      isPlus: true,
      codes: [],
    },
    {
      behaviour: "'BDF+D' marks a discontinuous BDF+ file",
      format: 'BDF',
      reserved: 'BDF+D',
      variant: 'BDF+D',
      marker: 'BDF+D',
      continuity: 'discontinuous',
      isPlus: true,
      codes: [],
    },
    {
      // DESIGN.md section 5: "24BIT" = plain BioSemi BDF, NOT a BDF+ dialect.
      behaviour: "'24BIT' is plain BioSemi BDF, not a plus dialect",
      format: 'BDF',
      reserved: '24BIT',
      variant: 'BDF',
      marker: '24BIT',
      continuity: 'continuous',
      isPlus: false,
      codes: [],
    },
    {
      behaviour: 'a blank reserved field is plain EDF and is not a defect',
      format: 'EDF',
      reserved: '',
      variant: 'EDF',
      marker: undefined,
      continuity: 'continuous',
      isPlus: false,
      codes: [],
    },
    {
      behaviour: 'a blank reserved field is plain BDF and is not a defect',
      format: 'BDF',
      reserved: '',
      variant: 'BDF',
      marker: undefined,
      continuity: 'continuous',
      isPlus: false,
      codes: [],
    },
    {
      behaviour: 'an unrecognised marker leaves the file plain and is reported',
      format: 'EDF',
      reserved: 'EDF+X',
      variant: 'EDF',
      marker: undefined,
      continuity: 'continuous',
      isPlus: false,
      codes: ['NONSTANDARD_RESERVED_FIELD'],
    },
    {
      // The prefix is the first five BYTES: a leading space means the field does not start
      // with the marker, which is exactly what EDF+ 2.1.1 requires it to do.
      behaviour: 'a leading space defeats the prefix, because the prefix is never trimmed',
      format: 'EDF',
      reserved: ' EDF+C',
      variant: 'EDF',
      marker: undefined,
      continuity: 'continuous',
      isPlus: false,
      codes: ['NONSTANDARD_RESERVED_FIELD'],
    },
    {
      behaviour: 'the marker is case-sensitive',
      format: 'EDF',
      reserved: 'edf+c',
      variant: 'EDF',
      marker: undefined,
      continuity: 'continuous',
      isPlus: false,
      codes: ['NONSTANDARD_RESERVED_FIELD'],
    },
    {
      behaviour: "a 'BDF+D' marker on an EDF file keeps EDF, keeps the discontinuity, and warns",
      format: 'EDF',
      reserved: 'BDF+D',
      variant: 'EDF+D',
      marker: 'BDF+D',
      continuity: 'discontinuous',
      isPlus: true,
      codes: ['NONSTANDARD_RESERVED_FIELD'],
    },
    {
      behaviour: "a '24BIT' marker on an EDF file does not make it 24-bit",
      format: 'EDF',
      reserved: '24BIT',
      variant: 'EDF',
      marker: '24BIT',
      continuity: 'continuous',
      isPlus: false,
      codes: ['NONSTANDARD_RESERVED_FIELD'],
    },
    {
      behaviour: "an 'EDF+C' marker on a BDF file stays BDF+C",
      format: 'BDF',
      reserved: 'EDF+C',
      variant: 'BDF+C',
      marker: 'EDF+C',
      continuity: 'continuous',
      isPlus: true,
      codes: ['NONSTANDARD_RESERVED_FIELD'],
    },
  ];

  for (const testCase of CASES) {
    it(testCase.behaviour, () => {
      const base = testCase.format === 'BDF' ? bdfFile() : edfFile();
      const { info, codes } = detect(setHeaderField(base, 'reserved', testCase.reserved));
      expect(info.variant).toBe(testCase.variant);
      expect(info.reservedMarker).toBe(testCase.marker);
      expect(info.continuity).toBe(testCase.continuity);
      expect(info.isPlus).toBe(testCase.isPlus);
      expect(codes).toEqual(testCase.codes);
    });
  }

  it('matches the prefix without trimming or case folding', () => {
    expect(reservedMarkerOf('EDF+C')).toBe('EDF+C');
    expect(reservedMarkerOf('EDF+D v2.1')).toBe('EDF+D');
    expect(reservedMarkerOf(`24BIT${' '.repeat(39)}`)).toBe('24BIT');
    expect(reservedMarkerOf('BDF+CONTINUOUS')).toBe('BDF+C');
    expect(reservedMarkerOf(' EDF+C')).toBeUndefined();
    expect(reservedMarkerOf('EDF+')).toBeUndefined();
    expect(reservedMarkerOf('')).toBeUndefined();
  });
});

describe('what the family fixes downstream', () => {
  it('names the annotation label and the representable digital range per family', () => {
    // DESIGN.md section 5: annotation label is matched trimmed and case-sensitive; the digital
    // limits are what the sample width can hold (16-bit for EDF, 24-bit for BDF).
    const edf = detect(edfFile()).info;
    expect(edf.annotationsLabel).toBe('EDF Annotations');
    expect(edf.digitalMinimumLimit).toBe(-32768);
    expect(edf.digitalMaximumLimit).toBe(32767);

    const bdf = detect(bdfFile()).info;
    expect(bdf.annotationsLabel).toBe('BDF Annotations');
    expect(bdf.digitalMinimumLimit).toBe(-8388608);
    expect(bdf.digitalMaximumLimit).toBe(8388607);
  });
});

describe('parseHeader carries the variant through to the file geometry', () => {
  it("reads a reserved field of 'EDF+D v2.1' as a discontinuous EDF+ file", () => {
    const bytes = minimalEdfPlus({ raw: { reserved: 'EDF+D v2.1' } });
    const header = parseHeader(bytes, bytes.byteLength);
    expect(header.variant).toBe('EDF+D');
    expect(header.continuity).toBe('discontinuous');
    expect(header.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'NONSTANDARD_RESERVED_FIELD',
    );
    // The whole 44 bytes stay verbatim on the header — DESIGN.md section 3.
    expect(header.reserved).toHaveLength(44);
    expect(header.reserved.startsWith('EDF+D v2.1')).toBe(true);
  });

  it('reads a BDF+C file with a BDF annotations channel', () => {
    const bytes = buildEdf({
      format: 'BDF',
      plus: 'C',
      signals: [{ label: 'Fp1', samplesPerRecord: SAMPLES_PER_RECORD }],
      annotationSignals: [{ samplesPerRecord: 30 }],
      recordCount: 2,
    });
    const header = parseHeader(bytes, bytes.byteLength);
    expect(header.variant).toBe('BDF+C');
    expect(header.bytesPerSample).toBe(3);
    expect(header.annotationSignalIndices).toEqual([1]);
    expect(header.signals[1]?.label).toBe('BDF Annotations');
    expect(header.signals[1]?.kind).toBe('annotations');
    // Three bytes a sample across the data signal and the 30-sample annotation region.
    expect(header.recordByteLength).toBe(3 * (SAMPLES_PER_RECORD + 30));
  });

  it('reads plain BioSemi BDF marked 24BIT as a non-plus file', () => {
    const bytes = bdfFile();
    expect(parseHeader(bytes, bytes.byteLength).variant).toBe('BDF');
    // The writer emits "24BIT" for a plain BDF file, which is the BioSemi convention.
    expect(parseHeader(bytes, bytes.byteLength).reserved.startsWith('24BIT')).toBe(true);
  });
});
