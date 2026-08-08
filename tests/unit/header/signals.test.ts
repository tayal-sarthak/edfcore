/**
 * The field-major per-signal header.
 *
 * The layout is the single most common EDF bug: the per-signal block is NOT one 256-byte struct
 * per signal, it is all `ns` labels, then all `ns` transducer types, and so on (DESIGN section 5,
 * "Per-signal header — field-major"). A struct-per-signal reader produces plausible output for a
 * one-signal file, so every layout test here uses THREE signals with three different sample
 * counts, three different labels and three different physical dimensions: under the wrong layout
 * each of those lands in a different field's block and the values cannot line up by accident.
 *
 * The rest of the file pins what the design promises about a parsed signal: `recordByteOffset` is
 * the running sum of the earlier signals' bytes, `sampleRateHz` is derived and is `undefined`
 * exactly when the record duration is 0, an annotations channel is never exposed as data, and the
 * three per-signal warnings fire with the right code.
 */

import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../../src/header/parse.js';
import { type SignalFieldName, signalFieldOffset } from '../../../src/header/signals.js';
import type { EdfDiagnostic, EdfHeader, EdfSignal } from '../../../src/types.js';
import { setSignalField } from '../../support/corrupt.js';
import { buildEdf, type EdfSpec, minimalEdfPlus, type SignalSpec } from '../../support/writer.js';

function parse(bytes: Uint8Array): EdfHeader {
  return parseHeader(bytes, bytes.length);
}

function signalAt(header: EdfHeader, index: number): EdfSignal {
  const signal = header.signals[index];
  if (signal === undefined) throw new Error(`fixture has no signal ${index}`);
  return signal;
}

function codesOf(header: EdfHeader): readonly string[] {
  return header.diagnostics.map((diagnostic) => diagnostic.code);
}

function diagnosticWith(header: EdfHeader, code: string): EdfDiagnostic {
  const found = header.diagnostics.find((diagnostic) => diagnostic.code === code);
  if (found === undefined) {
    throw new Error(`expected a ${code} diagnostic, got [${codesOf(header).join(', ')}]`);
  }
  return found;
}

/**
 * A four-digit year in the `dd.mm.yy` field is accepted where it fits and is NOT clipped, so a
 * fixture built on this base carries no date diagnostic and its `diagnostics` array is exactly
 * the per-signal one the test is about.
 */
const CLEAN_DATES = { startDate: '1.1.2020' } as const;

/** Three signals, three sample counts, three of everything: the layout cannot line up by luck. */
const THREE_SIGNALS: readonly SignalSpec[] = [
  {
    label: 'Fp1',
    transducerType: 'AgAgCl cup electrode',
    physicalDimension: 'uV',
    prefiltering: 'HP:0.5Hz LP:70Hz',
    samplesPerRecord: 256,
  },
  {
    label: 'ECG',
    transducerType: 'chest strap',
    physicalDimension: 'mV',
    prefiltering: 'HP:1Hz',
    samplesPerRecord: 512,
  },
  {
    label: 'Marker',
    transducerType: 'TTL input',
    physicalDimension: 'V',
    prefiltering: 'none',
    samplesPerRecord: 1,
  },
];

function threeSignalFile(overrides: Partial<EdfSpec> = {}): Uint8Array {
  return buildEdf({
    signals: THREE_SIGNALS,
    recordCount: 1,
    recordDurationSeconds: 2,
    raw: CLEAN_DATES,
    ...overrides,
  });
}

describe('per-signal header addressing', () => {
  /**
   * DESIGN section 5: `address(field, i) = 256 + ns * blockOffset + i * width`, with the block
   * offsets being the cumulative widths of the fields before it. The widths sum to 256, which is
   * exactly why a struct-per-signal reader is off by an amount nothing else notices.
   */
  const DESIGN_ADDRESSES = [
    { field: 'label', blockOffset: 0, width: 16 },
    { field: 'transducerType', blockOffset: 16, width: 80 },
    { field: 'physicalDimension', blockOffset: 96, width: 8 },
    { field: 'physicalMinimum', blockOffset: 104, width: 8 },
    { field: 'physicalMaximum', blockOffset: 112, width: 8 },
    { field: 'digitalMinimum', blockOffset: 120, width: 8 },
    { field: 'digitalMaximum', blockOffset: 128, width: 8 },
    { field: 'prefiltering', blockOffset: 136, width: 80 },
    { field: 'samplesPerRecord', blockOffset: 216, width: 8 },
    { field: 'reserved', blockOffset: 224, width: 32 },
  ] as const satisfies readonly {
    field: SignalFieldName;
    blockOffset: number;
    width: number;
  }[];

  it.each(DESIGN_ADDRESSES)(
    'places $field at 256 + ns*$blockOffset + i*$width for every signal',
    ({ field, blockOffset, width }) => {
      for (const signalCount of [1, 3, 512]) {
        for (const index of [0, 1, signalCount - 1]) {
          if (index >= signalCount) continue;
          expect(signalFieldOffset(field, signalCount, index)).toBe(
            256 + signalCount * blockOffset + index * width,
          );
        }
      }
    },
  );

  it('addresses signal 1 field-major, not as the second of ns 256-byte structs', () => {
    // The struct-per-signal misreading would put signal 1's label at 256 + 1*256 = 512, which in
    // a 3-signal file is 208 bytes into the transducer block. Field-major puts it at 272.
    expect(signalFieldOffset('label', 3, 1)).toBe(272);
    expect(signalFieldOffset('label', 3, 1)).not.toBe(512);
    expect(signalFieldOffset('samplesPerRecord', 3, 2)).toBe(256 + 3 * 216 + 2 * 8);
  });
});

describe('field-major per-signal parsing', () => {
  it('reads every field of every signal from its own block', () => {
    const header = parse(threeSignalFile());

    expect(header.signals).toHaveLength(3);
    expect(header.signals.map((signal) => signal.label)).toEqual(['Fp1', 'ECG', 'Marker']);
    expect(header.signals.map((signal) => signal.physicalDimension)).toEqual(['uV', 'mV', 'V']);
    expect(header.signals.map((signal) => signal.samplesPerRecord)).toEqual([256, 512, 1]);
    expect(header.signals.map((signal) => signal.transducerType)).toEqual([
      'AgAgCl cup electrode',
      'chest strap',
      'TTL input',
    ]);
    expect(header.signals.map((signal) => signal.prefiltering)).toEqual([
      'HP:0.5Hz LP:70Hz',
      'HP:1Hz',
      'none',
    ]);
    expect(header.signals.map((signal) => signal.index)).toEqual([0, 1, 2]);
  });

  it('keeps each signal field raw and untrimmed at its declared width', () => {
    const header = parse(threeSignalFile());
    const ecg = signalAt(header, 1);

    expect(ecg.raw.label).toBe('ECG'.padEnd(16, ' '));
    expect(ecg.raw.physicalDimension).toBe('mV'.padEnd(8, ' '));
    expect(ecg.raw.samplesPerRecord).toBe('512'.padEnd(8, ' '));
    expect(ecg.raw.transducerType).toBe('chest strap'.padEnd(80, ' '));
    expect(ecg.raw.reserved).toBe(''.padEnd(32, ' '));
  });

  it('picks up a byte patched at the field-major address of one signal only', () => {
    // corrupt.ts computes the address from the format specification independently of src/, so a
    // parser that agreed with itself but not with the layout would fail here.
    const patched = setSignalField(threeSignalFile(), 3, 1, 'label', 'T8-P8');
    const header = parse(patched);

    expect(header.signals.map((signal) => signal.label)).toEqual(['Fp1', 'T8-P8', 'Marker']);
    expect(header.signals.map((signal) => signal.samplesPerRecord)).toEqual([256, 512, 1]);
  });

  it('keeps sample counts attached to their own signal when a later field is patched', () => {
    const patched = setSignalField(threeSignalFile(), 3, 2, 'samplesPerRecord', '64');
    const header = parse(patched);

    expect(header.signals.map((signal) => signal.samplesPerRecord)).toEqual([256, 512, 64]);
    expect(header.signals.map((signal) => signal.label)).toEqual(['Fp1', 'ECG', 'Marker']);
  });
});

describe('record geometry', () => {
  it('starts signal i at bytesPerSample * SUM(samplesPerRecord[j < i])', () => {
    const header = parse(threeSignalFile());

    // DESIGN section 5: recordByteOffset[i] = bytesPerSample * SUM(spr[j] for j < i).
    expect(header.bytesPerSample).toBe(2);
    expect(header.signals.map((signal) => signal.recordByteOffset)).toEqual([0, 512, 1536]);
    expect(header.signals.map((signal) => signal.recordByteLength)).toEqual([512, 1024, 2]);
    expect(header.recordByteLength).toBe(1538);

    let runningSum = 0;
    for (const signal of header.signals) {
      expect(signal.recordByteOffset).toBe(runningSum);
      runningSum += signal.samplesPerRecord * header.bytesPerSample;
    }
    expect(header.recordByteLength).toBe(runningSum);
  });

  it('scales every offset by 3 bytes per sample on BDF', () => {
    const header = parse(threeSignalFile({ format: 'BDF' }));

    expect(header.variant).toBe('BDF');
    expect(header.bytesPerSample).toBe(3);
    expect(header.signals.map((signal) => signal.recordByteOffset)).toEqual([0, 768, 2304]);
    expect(header.signals.map((signal) => signal.recordByteLength)).toEqual([768, 1536, 3]);
    expect(header.recordByteLength).toBe(2307);
  });

  it('multiplies samplesPerRecord by the resolved record count for sampleCount', () => {
    const header = parse(threeSignalFile({ recordCount: 7 }));

    expect(header.recordCount).toBe(7);
    expect(header.signals.map((signal) => signal.sampleCount)).toEqual([256 * 7, 512 * 7, 7]);
  });
});

describe('sampleRateHz', () => {
  it('is samplesPerRecord / recordDurationSeconds', () => {
    const header = parse(threeSignalFile({ recordDurationSeconds: 2 }));

    expect(header.recordDurationSeconds).toBe(2);
    expect(header.signals.map((signal) => signal.sampleRateHz)).toEqual([128, 256, 0.5]);
  });

  it('follows a fractional record duration', () => {
    const header = parse(threeSignalFile({ recordDurationSeconds: 0.5 }));

    expect(header.signals.map((signal) => signal.sampleRateHz)).toEqual([512, 1024, 2]);
  });

  it('is undefined for every signal when the record duration is 0', () => {
    // A record duration of 0 is legal — EDF+ uses it for annotations-only recordings (DESIGN
    // section 5, offset 244) — so the rate is undefined rather than Infinity, and the file
    // still parses.
    const header = parse(threeSignalFile({ recordDurationSeconds: 0 }));

    expect(header.recordDurationSeconds).toBe(0);
    expect(codesOf(header)).toContain('ZERO_RECORD_DURATION');
    expect(header.signals.map((signal) => signal.sampleRateHz)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    for (const signal of header.signals) {
      expect(signal.samplesPerRecord).toBeGreaterThan(0);
    }
  });
});

describe('annotation signals', () => {
  const edfPlusWithAnnotations = buildEdf({
    plus: 'C',
    signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
    annotationSignals: [{ samplesPerRecord: 30 }],
    recordCount: 2,
    raw: CLEAN_DATES,
  });

  it('classifies an "EDF Annotations" channel as annotations and keeps it out of the data set', () => {
    const header = parse(edfPlusWithAnnotations);

    expect(header.variant).toBe('EDF+C');
    expect(signalAt(header, 1).kind).toBe('annotations');
    expect(signalAt(header, 1).label).toBe('EDF Annotations');
    expect(header.annotationSignalIndices).toEqual([1]);
    expect(header.dataSignalIndices).toEqual([0]);
    expect(header.dataSignalIndices).not.toContain(1);
  });

  it('never builds a scale for an annotations channel, and reports no scaling defect', () => {
    // Its bytes are TAL text, so there is no measurement to scale; running the degenerate-range
    // checks over it would report a defect about a number nobody may use.
    const header = parse(edfPlusWithAnnotations);

    expect(signalAt(header, 1).scale).toBeUndefined();
    expect(signalAt(header, 0).scale).toBeDefined();
    expect(codesOf(header)).toEqual([]);
  });

  it('still classifies the channel as annotations when the EDF+ marker is missing', () => {
    // MISSING_EDFPLUS_MARKER: the annotations are parsed anyway and the channel is never exposed
    // as an ordinary signal, because decoding TAL text as samples produces numbers that look
    // like a signal.
    const bytes = buildEdf({
      plus: false,
      signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
      annotationSignals: [{ samplesPerRecord: 30 }],
      recordCount: 2,
      raw: CLEAN_DATES,
    });
    const header = parse(bytes);

    expect(header.variant).toBe('EDF');
    expect(codesOf(header)).toEqual(['MISSING_EDFPLUS_MARKER']);
    expect(diagnosticWith(header, 'MISSING_EDFPLUS_MARKER').signalIndex).toBe(1);
    expect(signalAt(header, 1).kind).toBe('annotations');
    expect(header.annotationSignalIndices).toEqual([1]);
    expect(header.dataSignalIndices).toEqual([0]);
  });

  it('advises a BDF writer to write BDF+C, not EDF+C', () => {
    /*
     * The advice has to be followable. `detectVariant` treats the version block as the only
     * reliable discriminator and reports `NONSTANDARD_RESERVED_FIELD` for a BDF file whose
     * reserved field says "EDF+C" — so telling a BDF writer to put that there produced a NEW
     * warning caused by following this one. The diagnostic said `"EDF+C" or "EDF+D"` for both
     * families (fixed in 0.3.24).
     */
    const bytes = buildEdf({
      format: 'BDF',
      plus: false,
      recordCount: 2,
      signals: [
        {
          label: 'Fp1',
          samplesPerRecord: 10,
          physicalMinimum: -262144,
          physicalMaximum: 262144,
          digitalMinimum: -8388608,
          digitalMaximum: 8388607,
        },
      ],
      annotationSignals: [{ samplesPerRecord: 30, label: 'BDF Annotations' }],
      raw: CLEAN_DATES,
    });
    const diagnostic = diagnosticWith(parse(bytes), 'MISSING_EDFPLUS_MARKER');

    expect(diagnostic.expected).toContain('"BDF+C" or "BDF+D"');
    expect(diagnostic.expected).not.toContain('EDF+C');
    expect(diagnostic.message).toContain('"BDF+C" or "BDF+D"');
    expect(diagnostic.message).toContain('only BDF+ defines');
  });

  it('points its byte range at the reserved field it names, not at the label', () => {
    // `field` said `reserved` while `byteOffset` was the annotation signal's LABEL offset,
    // `byteLength` was the label's 16-byte width and `raw` was the label text — so one diagnostic
    // said "at offset 192" in its prose and sent a hexdump somewhere else entirely.
    const bytes = buildEdf({
      plus: false,
      signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
      annotationSignals: [{ samplesPerRecord: 30 }],
      recordCount: 2,
      raw: CLEAN_DATES,
    });
    const diagnostic = diagnosticWith(parse(bytes), 'MISSING_EDFPLUS_MARKER');

    expect(diagnostic.field).toBe('reserved');
    expect(diagnostic.byteOffset).toBe(192);
    expect(diagnostic.byteLength).toBe(44);
    // The prose already stated 192; the structured location now agrees with it.
    expect(diagnostic.expected).toContain('at offset 192');
    // And `raw` is the reserved field's own 44 bytes, not the signal label.
    expect(diagnostic.raw).toHaveLength(44);
    expect(diagnostic.raw).not.toContain('Annotations');
  });

  it('recognises a "BDF Annotations" channel in a BDF+ file', () => {
    const bytes = buildEdf({
      format: 'BDF',
      plus: 'C',
      signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
      annotationSignals: [{ samplesPerRecord: 30 }],
      recordCount: 2,
      raw: CLEAN_DATES,
    });
    const header = parse(bytes);

    expect(header.variant).toBe('BDF+C');
    expect(signalAt(header, 1).label).toBe('BDF Annotations');
    expect(signalAt(header, 1).kind).toBe('annotations');
    expect(header.annotationSignalIndices).toEqual([1]);
    expect(header.dataSignalIndices).toEqual([0]);
  });

  it('does not report two annotation channels as duplicate labels', () => {
    // EDF+ allows several annotation channels and requires every one to be labelled
    // 'EDF Annotations', so DUPLICATE_SIGNAL_LABEL there would refuse a conformant file.
    const bytes = buildEdf({
      plus: 'C',
      signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
      annotationSignals: [{ samplesPerRecord: 30 }, { samplesPerRecord: 30 }],
      recordCount: 2,
      raw: CLEAN_DATES,
    });
    const header = parse(bytes);

    expect(codesOf(header)).not.toContain('DUPLICATE_SIGNAL_LABEL');
    expect(header.annotationSignalIndices).toEqual([1, 2]);
    expect(header.dataSignalIndices).toEqual([0]);
  });
});

describe('DUPLICATE_SIGNAL_LABEL', () => {
  it('reports one diagnostic naming every signal that carries the repeated label', () => {
    // CHB-MIT ships 'T8-P8' twice, which is what makes this worth a guardrail rather than a
    // convention.
    const bytes = buildEdf({
      signals: [
        { label: 'T8-P8', samplesPerRecord: 8 },
        { label: 'C3-P3', samplesPerRecord: 8 },
        { label: 'T8-P8', samplesPerRecord: 8 },
      ],
      recordCount: 1,
      raw: CLEAN_DATES,
    });
    const header = parse(bytes);

    expect(codesOf(header)).toEqual(['DUPLICATE_SIGNAL_LABEL']);
    const diagnostic = diagnosticWith(header, 'DUPLICATE_SIGNAL_LABEL');
    expect(diagnostic.severity).toBe('warning');
    expect(diagnostic.field).toBe('label');
    expect(diagnostic.signalIndex).toBe(2);
    expect(diagnostic.byteOffset).toBe(signalFieldOffset('label', 3, 2));
    expect(diagnostic.raw).toBe('T8-P8');
  });

  it('collides labels that differ only in padding, because matching is on the trimmed label', () => {
    const bytes = buildEdf({
      signals: [
        { label: 'T8-P8', samplesPerRecord: 8 },
        { label: 'x', samplesPerRecord: 8, raw: { label: ' T8-P8' } },
      ],
      recordCount: 1,
      raw: CLEAN_DATES,
    });
    const header = parse(bytes);

    expect(codesOf(header)).toEqual(['DUPLICATE_SIGNAL_LABEL']);
    expect(header.signals.map((signal) => signal.label)).toEqual(['T8-P8', 'T8-P8']);
    expect(signalAt(header, 1).raw.label).toBe(' T8-P8'.padEnd(16, ' '));
  });

  it('says nothing about labels that differ', () => {
    const header = parse(threeSignalFile());
    expect(codesOf(header)).toEqual([]);
  });
});

describe('ZERO_SAMPLES_PER_RECORD', () => {
  const bytes = buildEdf({
    signals: [
      { label: 'A', samplesPerRecord: 4 },
      { label: 'B', samplesPerRecord: 0 },
      { label: 'C', samplesPerRecord: 6 },
    ],
    recordCount: 2,
    raw: CLEAN_DATES,
  });

  it('warns, keeps the signal, and gives it no bytes at all', () => {
    const header = parse(bytes);

    expect(codesOf(header)).toEqual(['ZERO_SAMPLES_PER_RECORD']);
    const diagnostic = diagnosticWith(header, 'ZERO_SAMPLES_PER_RECORD');
    expect(diagnostic.severity).toBe('warning');
    expect(diagnostic.signalIndex).toBe(1);
    expect(diagnostic.byteOffset).toBe(signalFieldOffset('samplesPerRecord', 3, 1));

    expect(signalAt(header, 1).samplesPerRecord).toBe(0);
    expect(signalAt(header, 1).recordByteLength).toBe(0);
    expect(signalAt(header, 1).sampleCount).toBe(0);
  });

  it('leaves the later signals addressable, because their offsets skip it exactly', () => {
    const header = parse(bytes);

    expect(header.signals.map((signal) => signal.recordByteOffset)).toEqual([0, 8, 8]);
    expect(header.recordByteLength).toBe(20);
  });
});

describe('DIGITAL_RANGE_EXCEEDS_FORMAT', () => {
  interface RangeCase {
    readonly name: string;
    readonly format: 'EDF' | 'BDF';
    readonly digitalMinimum: number;
    readonly digitalMaximum: number;
    readonly reported: boolean;
  }

  const CASES: readonly RangeCase[] = [
    {
      name: 'a 16-bit EDF signal declaring a minimum below -32768',
      format: 'EDF',
      digitalMinimum: -40000,
      digitalMaximum: 32767,
      reported: true,
    },
    {
      name: 'a 16-bit EDF signal declaring a maximum above 32767',
      format: 'EDF',
      digitalMinimum: -32768,
      digitalMaximum: 40000,
      reported: true,
    },
    {
      name: 'an EDF signal exactly at the 16-bit bounds',
      format: 'EDF',
      digitalMinimum: -32768,
      digitalMaximum: 32767,
      reported: false,
    },
    {
      name: 'a BDF signal carrying a 16-bit range, which fits in 24 bits',
      format: 'BDF',
      digitalMinimum: -32768,
      digitalMaximum: 32767,
      reported: false,
    },
    {
      name: 'a BDF signal exactly at the 24-bit bounds',
      format: 'BDF',
      digitalMinimum: -8388608,
      digitalMaximum: 8388607,
      reported: false,
    },
    {
      name: 'a BDF signal declaring a maximum above 8388607',
      format: 'BDF',
      digitalMinimum: -8388608,
      digitalMaximum: 8388608,
      reported: true,
    },
  ];

  it.each(CASES)('$name', ({ format, digitalMinimum, digitalMaximum, reported }) => {
    const bytes = buildEdf({
      format,
      signals: [{ label: 'Fp1', samplesPerRecord: 4, digitalMinimum, digitalMaximum }],
      recordCount: 1,
      raw: CLEAN_DATES,
    });
    const header = parse(bytes);

    expect(codesOf(header).includes('DIGITAL_RANGE_EXCEEDS_FORMAT')).toBe(reported);
  });

  it('scales with the declared range exactly as written, because edfcore never clamps', () => {
    const bytes = buildEdf({
      signals: [
        {
          label: 'Fp1',
          samplesPerRecord: 4,
          physicalMinimum: -500,
          physicalMaximum: 500,
          digitalMinimum: -40000,
          digitalMaximum: 32767,
        },
      ],
      recordCount: 1,
      raw: CLEAN_DATES,
    });
    const header = parse(bytes);
    const signal = signalAt(header, 0);

    expect(codesOf(header)).toEqual(['DIGITAL_RANGE_EXCEEDS_FORMAT']);
    expect(signal.digitalMinimum).toBe(-40000);
    expect(signal.digitalMaximum).toBe(32767);
    // DESIGN section 5: bitValue = (physMax - physMin) / (digMax - digMin), untouched by the
    // fact that the declared range is wider than 16 bits.
    expect(signal.scale?.bitValue).toBe(1000 / 72767);

    const diagnostic = diagnosticWith(header, 'DIGITAL_RANGE_EXCEEDS_FORMAT');
    expect(diagnostic.signalIndex).toBe(0);
    expect(diagnostic.byteOffset).toBe(signalFieldOffset('digitalMinimum', 1, 0));
    expect(diagnostic.expected).toBe('-32768..32767');

    // A data signal IS scaled from these fields, so the extrapolation warning is the right one.
    expect(diagnostic.message).toContain('used for scaling exactly as written');
  });

  it('does not promise scaling behaviour on an annotations channel, which has none', () => {
    /*
     * The check runs for every signal, which is right — a BDF range in an EDF+ file is exactly the
     * sample-width confusion it exists to catch, wherever it appears. The consequence clause was
     * not right for every signal: an annotations channel gets no scale, its bytes are TAL text,
     * and `toPhysical` refuses it, so "expect physical values that extrapolate" described a
     * conversion that cannot happen for it (fixed in 0.3.72).
     */
    const bytes = minimalEdfPlus({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 2 }],
      annotationSignals: [
        { samplesPerRecord: 30, raw: { digitalMinimum: '-8388608', digitalMaximum: '8388607 ' } },
      ],
    });
    const header = parse(bytes);
    const diagnostic = diagnosticWith(header, 'DIGITAL_RANGE_EXCEEDS_FORMAT');
    const signal = signalAt(header, diagnostic.signalIndex ?? -1);

    // The premise: this channel really has no scale to talk about.
    expect(signal.kind).toBe('annotations');
    expect(signal.scale).toBeUndefined();

    expect(diagnostic.message).toContain('nothing is scaled from these fields');
    expect(diagnostic.message).not.toContain('expect physical values');
    // Still reported, and still says why it matters.
    expect(diagnostic.message).toContain('confused the two sample widths');
  });
});

describe('unit normalisation', () => {
  it('keeps the physical dimension as written and normalises micro only for comparison', () => {
    // A raw 0xB5 byte decodes to U+00B5 through ISO-8859-1, and both it and U+03BC collapse to
    // 'u' on `unit`; `physicalDimension` still says what the file said.
    const bytes = buildEdf({
      signals: [
        { label: 'Fp1', samplesPerRecord: 4, physicalDimension: 'µV' },
        { label: 'Fp2', samplesPerRecord: 4, physicalDimension: 'uV' },
      ],
      recordCount: 1,
      raw: CLEAN_DATES,
    });
    const header = parse(bytes);

    expect(signalAt(header, 0).physicalDimension).toBe('µV');
    expect(signalAt(header, 0).unit).toBe('uV');
    expect(signalAt(header, 1).physicalDimension).toBe('uV');
    expect(signalAt(header, 1).unit).toBe('uV');
  });
});
