/**
 * TALs plus EDF+ semantics: timekeeping, the two onset conventions, the sort, and provenance.
 *
 * The rules pinned here (EDF+ specification 2.2.1 and 2.2.4, DESIGN sections 5 and 6):
 *
 * 1. The FIRST TAL of the FIRST annotation signal of every data record is that record's
 *    timekeeping TAL and is NOT an annotation. Every other annotation signal's first TAL is an
 *    ordinary event, and stripping it would silently delete a real one.
 * 2. `recordOnsetTicks` has one entry for EVERY record in the decoded range, always, including
 *    records whose timekeeping TAL is missing.
 * 3. Onsets are exposed under both conventions as separately named fields, never as an option.
 */

import { describe, expect, it } from 'vitest';
import { EdfFormatError, EdfRangeError } from '../../../src/errors.js';
import { parseHeader } from '../../../src/header/parse.js';
import { decodeAnnotations } from '../../../src/tal/annotations.js';
import type {
  DecodeAnnotationsOptions,
  EdfAnnotation,
  EdfHeader,
  RecordRange,
} from '../../../src/types.js';
import { patchBytes } from '../../support/corrupt.js';
import { buildEdf, type EdfSpec, encodeTal } from '../../support/writer.js';

interface Fixture {
  readonly file: Uint8Array;
  readonly header: EdfHeader;
}

function build(spec: EdfSpec): Fixture {
  const file = buildEdf(spec);
  return { file, header: parseHeader(file, file.length) };
}

/** A patched copy. Every patch in this file lands inside a data record, so geometry is intact. */
function patched(fixture: Fixture, offset: number, bytes: Uint8Array): Fixture {
  const file = patchBytes(fixture.file, offset, bytes);
  return { file, header: parseHeader(file, file.length) };
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at index ${index}`);
  return item;
}

function annotationSignal(header: EdfHeader, ordinal = 0) {
  return at(header.signals, at(header.annotationSignalIndices, ordinal));
}

/** Byte offset in the FILE of one record's annotation region, which is what a hexdump needs. */
function regionOffset(header: EdfHeader, recordIndex: number, ordinal = 0): number {
  return (
    header.headerByteLength +
    recordIndex * header.recordByteLength +
    annotationSignal(header, ordinal).recordByteOffset
  );
}

function recordBytesOf(fixture: Fixture, records: RecordRange): Uint8Array {
  const { file, header } = fixture;
  const start = header.headerByteLength + records.start * header.recordByteLength;
  return file.subarray(start, start + records.count * header.recordByteLength);
}

function decode(fixture: Fixture, records: RecordRange, options?: DecodeAnnotationsOptions) {
  return decodeAnnotations(fixture.header, recordBytesOf(fixture, records), records, options);
}

function allRecords(fixture: Fixture): RecordRange {
  return { start: 0, count: fixture.header.recordCount };
}

function textsOf(annotations: readonly EdfAnnotation[]): readonly string[] {
  return annotations.map((annotation) => annotation.text);
}

function codesOf(diagnostics: readonly { code: string }[]): readonly string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

/** One data signal, one annotation signal, two one-second records. */
function simple(overrides: Partial<EdfSpec> = {}): EdfSpec {
  return {
    plus: 'C',
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
    annotationSignals: [{ samplesPerRecord: 30 }],
    ...overrides,
  };
}

describe('the first TAL of the first annotation signal is timekeeping, and only there', () => {
  const twoSignals = build({
    plus: 'C',
    recordCount: 2,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
    annotationSignals: [
      {
        samplesPerRecord: 30,
        tals: (record) => (record === 0 ? [{ onset: 0.5, texts: ['first-signal event'] }] : []),
      },
      {
        samplesPerRecord: 30,
        tals: (record) => (record === 0 ? [{ onset: 0, texts: ['second-signal first TAL'] }] : []),
      },
    ],
  });

  it('places the two annotation signals where the test expects them', () => {
    expect(twoSignals.header.annotationSignalIndices).toEqual([1, 2]);
    expect(twoSignals.header.recordCount).toBe(2);
  });

  it('excludes the timekeeping TAL of the first annotation signal from the annotations', () => {
    // EDF+ 2.2.1: the timekeeping TAL carries no text, so returning it would put a phantom
    // annotation at the start of every single record.
    const result = decode(twoSignals, allRecords(twoSignals));
    expect(textsOf(result.annotations)).not.toContain('');
    expect(
      result.annotations.filter((a) => a.signalIndex === 1 && a.onsetTicks === 0n),
    ).toHaveLength(0);
  });

  it("returns the SECOND annotation signal's first TAL, which is an ordinary event", () => {
    // EDF+ 2.2.1: additional annotation signals carry no timekeeping TAL. A reader that strips
    // "the first TAL of every annotation signal" deletes a real event from every record.
    const result = decode(twoSignals, allRecords(twoSignals));
    const fromSecond = result.annotations.filter((a) => a.signalIndex === 2);
    expect(textsOf(fromSecond)).toEqual(['second-signal first TAL']);
    expect(at(fromSecond, 0).onsetTicks).toBe(0n);
  });

  it('returns both signals, in the pinned order', () => {
    const result = decode(twoSignals, allRecords(twoSignals));
    expect(textsOf(result.annotations)).toEqual(['second-signal first TAL', 'first-signal event']);
  });

  it("never lets a second annotation signal's first TAL set a record onset", () => {
    // The decoy sits in slot 0 of signal 2 with an onset nowhere near the record's start. If
    // "slot 0 of any annotation signal" were read as timekeeping, the whole timeline would move
    // and the decoy would vanish from the annotations at the same time.
    const misleading = build({
      plus: 'C',
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
      annotationSignals: [
        { samplesPerRecord: 30 },
        { samplesPerRecord: 30, tals: () => [{ onset: 9.75, texts: ['decoy'] }] },
      ],
    });

    const result = decode(misleading, allRecords(misleading));

    expect(Array.from(result.recordOnsetTicks)).toEqual([0n, 10000000n]);
    expect(textsOf(result.annotations)).toEqual(['decoy', 'decoy']);
    expect(result.annotations.map((a) => a.onsetTicks)).toEqual([97500000n, 97500000n]);
    expect(result.diagnostics).toEqual([]);
  });

  it('reads no timekeeping at all when the caller excludes the first annotation signal', () => {
    // Silence the caller asked for, not a missing TAL: recordOnsetTicks falls back to the
    // nominal grid and nothing is reported, because no timekeeping TAL was looked at.
    const result = decode(twoSignals, allRecords(twoSignals), { signalIndices: [2] });
    expect(result.diagnostics).toEqual([]);
    expect(Array.from(result.recordOnsetTicks)).toEqual([0n, 10000000n]);
    expect(textsOf(result.annotations)).toEqual(['second-signal first TAL']);
  });

  it('deduplicates and sorts requested signal indices', () => {
    const asked = decode(twoSignals, allRecords(twoSignals), { signalIndices: [2, 1, 2] });
    const all = decode(twoSignals, allRecords(twoSignals));
    expect(textsOf(asked.annotations)).toEqual(textsOf(all.annotations));
  });

  it('refuses a data signal with a plain RangeError, not an EdfError', () => {
    // Parsing a data signal's samples as text is exactly the garbage this module exists to
    // prevent, and it can only happen through a caller's mistake, never through a file's.
    expect(() => decode(twoSignals, allRecords(twoSignals), { signalIndices: [0] })).toThrow(
      RangeError,
    );
    try {
      decode(twoSignals, allRecords(twoSignals), { signalIndices: [0] });
      expect.unreachable('expected a RangeError');
    } catch (error) {
      expect(error).toBeInstanceOf(RangeError);
      expect(error).not.toBeInstanceOf(EdfFormatError);
      expect(error).not.toBeInstanceOf(EdfRangeError);
    }
  });
});

describe('recordOnsetTicks has one entry per decoded record, always', () => {
  const threeRecords = build(
    simple({
      recordCount: 3,
      annotationSignals: [
        {
          samplesPerRecord: 30,
          tals: (record) => (record === 2 ? [{ onset: 2.5, texts: ['late'] }] : []),
        },
      ],
    }),
  );

  it('reads every record onset from its timekeeping TAL when they are all present', () => {
    const result = decode(threeRecords, allRecords(threeRecords));
    expect(result.recordOnsetTicks.length).toBe(3);
    expect(Array.from(result.recordOnsetTicks)).toEqual([0n, 10000000n, 20000000n]);
    expect(result.diagnostics).toEqual([]);
  });

  it('derives the onset of a record whose timekeeping TAL is missing, and says so', () => {
    // A hole or a sentinel would force every consumer of the timeline to handle a third case;
    // the derived value is the nominal grid position, and TIMEKEEPING_TAL_MISSING names the
    // record so the derivation is never invisible.
    const damaged = patched(
      threeRecords,
      regionOffset(threeRecords.header, 1),
      new Uint8Array(annotationSignal(threeRecords.header).recordByteLength),
    );

    const result = decode(damaged, allRecords(damaged));

    expect(result.recordOnsetTicks.length).toBe(3);
    expect(Array.from(result.recordOnsetTicks)).toEqual([0n, 10000000n, 20000000n]);
    const missing = result.diagnostics.filter((d) => d.code === 'TIMEKEEPING_TAL_MISSING');
    expect(missing).toHaveLength(1);
    expect(at(missing, 0).recordIndex).toBe(1);
    expect(at(missing, 0).severity).toBe('warning');
    expect(at(missing, 0).signalIndex).toBe(1);
  });

  it('reports a missing timekeeping TAL once PER RECORD, because each names a derived onset', () => {
    // Diagnostic volume is bounded by one test: does another occurrence carry information
    // available nowhere else? This one does. NEGATIVE_ANNOTATION_ONSET does not.
    const regionBytes = annotationSignal(threeRecords.header).recordByteLength;
    let damaged = patched(
      threeRecords,
      regionOffset(threeRecords.header, 1),
      new Uint8Array(regionBytes),
    );
    damaged = patched(damaged, regionOffset(damaged.header, 2), new Uint8Array(regionBytes));

    const result = decode(damaged, allRecords(damaged));

    expect(codesOf(result.diagnostics)).toEqual([
      'TIMEKEEPING_TAL_MISSING',
      'TIMEKEEPING_TAL_MISSING',
    ]);
    expect(result.diagnostics.map((d) => d.recordIndex)).toEqual([1, 2]);
    expect(Array.from(result.recordOnsetTicks)).toEqual([0n, 10000000n, 20000000n]);
  });

  it('derives from the observed start offset, not from zero', () => {
    const offsetFile = build(
      simple({
        recordCount: 3,
        startOffsetSeconds: 0.25,
        annotationSignals: [{ samplesPerRecord: 30 }],
      }),
    );
    const damaged = patched(
      offsetFile,
      regionOffset(offsetFile.header, 2),
      new Uint8Array(annotationSignal(offsetFile.header).recordByteLength),
    );

    const result = decode(damaged, allRecords(damaged));

    // 0.25 s + 2 records x 1 s, in ticks. Deriving from 0 would place record 2 a quarter of a
    // second early, which is a quarter second of samples attributed to the wrong time.
    expect(Array.from(result.recordOnsetTicks)).toEqual([2500000n, 12500000n, 22500000n]);
  });

  it('returns an empty result for an empty range rather than guessing a start', () => {
    const result = decode(threeRecords, { start: 0, count: 0 });
    expect(result.annotations).toEqual([]);
    expect(result.recordOnsetTicks.length).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });

  it('covers exactly the decoded sub-range', () => {
    const result = decode(threeRecords, { start: 1, count: 2 });
    expect(Array.from(result.recordOnsetTicks)).toEqual([10000000n, 20000000n]);
    expect(textsOf(result.annotations)).toEqual(['late']);
    expect(at(result.annotations, 0).recordIndex).toBe(2);
  });
});

describe("record 0's sub-second onset is the timeline start offset", () => {
  const quarterSecond = build(
    simple({
      recordCount: 3,
      startOffsetSeconds: 0.25,
      annotationSignals: [
        {
          samplesPerRecord: 40,
          tals: (record) => (record === 1 ? [{ onset: 1.5, texts: ['spindle'] }] : []),
        },
      ],
    }),
  );

  it("reads record 0's +0.25 as the start offset", () => {
    // EDF+ 2.2.1: record 0's timekeeping onset is `+0.X` with 0 <= X < 1, and X IS the
    // sub-second part of the start time. The whole-second part lives in the header starttime.
    const result = decode(quarterSecond, allRecords(quarterSecond));
    expect(at(Array.from(result.recordOnsetTicks), 0)).toBe(2500000n);
    expect(result.diagnostics).toEqual([]);
  });

  it('exposes both onset conventions, and they DIFFER when the start offset is non-zero', () => {
    // The convention lives in the identifier precisely so that no option can change what a field
    // means: `onsetSecondsFromHeaderStart` is the on-disk value (EDF+ 2.2.4), and
    // `onsetSecondsFromFirstRecord` is the EDFlib/pyEDFlib/MNE rebasing. Reporting one under the
    // other's name is a quarter-second error that looks like a rounding difference.
    const result = decode(quarterSecond, allRecords(quarterSecond));
    const spindle = at(result.annotations, 0);

    expect(spindle.onsetRaw).toBe('+1.5');
    expect(spindle.onsetTicks).toBe(15000000n);
    expect(spindle.onsetSecondsFromHeaderStart).toBe(1.5);
    expect(spindle.onsetSecondsFromFirstRecord).toBe(1.25);
    expect(spindle.onsetSecondsFromHeaderStart).not.toBe(spindle.onsetSecondsFromFirstRecord);
  });

  it('makes the two conventions equal exactly when the start offset is zero', () => {
    // Stated so that a fixture with a zero offset is never mistaken for evidence that the two
    // fields agree in general.
    const noOffset = build(
      simple({
        annotationSignals: [
          {
            samplesPerRecord: 40,
            tals: (record) => (record === 1 ? [{ onset: 1.5, texts: ['spindle'] }] : []),
          },
        ],
      }),
    );
    const spindle = at(decode(noOffset, allRecords(noOffset)).annotations, 0);
    expect(spindle.onsetSecondsFromHeaderStart).toBe(1.5);
    expect(spindle.onsetSecondsFromFirstRecord).toBe(1.5);
  });

  it('rebases correctly when the decoded range does not start at record 0', () => {
    // Record 0's onset is not in the bytes we were given, so it is derived as
    // onset(first decoded record) - recordIndex * recordDuration, which is exact for a
    // continuous file and is accepted only when it lands in [0, 1).
    const result = decode(quarterSecond, { start: 1, count: 1 });
    const spindle = at(result.annotations, 0);
    expect(Array.from(result.recordOnsetTicks)).toEqual([12500000n]);
    expect(spindle.onsetSecondsFromHeaderStart).toBe(1.5);
    expect(spindle.onsetSecondsFromFirstRecord).toBe(1.25);
    expect(result.diagnostics).toEqual([]);
  });

  it('reports a start offset outside [0, 1) and still uses the value as written', () => {
    const late = build(
      simple({
        recordCount: 2,
        recordOnsetSeconds: (record) => 1.5 + record,
        annotationSignals: [
          {
            samplesPerRecord: 40,
            tals: (record) => (record === 0 ? [{ onset: 2, texts: ['event'] }] : []),
          },
        ],
      }),
    );

    const result = decode(late, allRecords(late));

    expect(codesOf(result.diagnostics)).toContain('START_OFFSET_OUT_OF_RANGE');
    expect(Array.from(result.recordOnsetTicks)).toEqual([15000000n, 25000000n]);
    // Used as written: it is still that record's start, so rebasing subtracts all of it.
    const event = at(result.annotations, 0);
    expect(event.onsetSecondsFromHeaderStart).toBe(2);
    expect(event.onsetSecondsFromFirstRecord).toBe(0.5);
  });
});

describe('the annotation sort is a pinned total order', () => {
  // (onsetTicks, signalIndex, byteOffsetInRecord), then insertion order to make it total.
  const sameOnset = build({
    plus: 'C',
    recordCount: 1,
    recordDurationSeconds: 1,
    signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
    annotationSignals: [
      {
        samplesPerRecord: 40,
        tals: () => [
          { onset: 5, texts: ['A-first', 'A-second'] },
          { onset: 5, texts: ['A-third'] },
        ],
      },
      { samplesPerRecord: 40, tals: () => [{ onset: 5, texts: ['B-first'] }] },
    ],
  });

  it('orders two annotation signals sharing one onset by signal index', () => {
    const result = decode(sameOnset, allRecords(sameOnset));
    expect(textsOf(result.annotations)).toEqual(['A-first', 'A-second', 'A-third', 'B-first']);
    expect(result.annotations.map((a) => a.signalIndex)).toEqual([1, 1, 1, 2]);
    for (const annotation of result.annotations) {
      expect(annotation.onsetTicks).toBe(50000000n);
    }
  });

  it('orders annotations within one signal by their byte offset in the record', () => {
    const result = decode(sameOnset, allRecords(sameOnset));
    const fromFirst = result.annotations.filter((a) => a.signalIndex === 1);
    const offsets = fromFirst.map((a) => a.byteOffsetInRecord);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(new Set(offsets).size).toBe(offsets.length);
  });

  it('falls back to insertion order when onset, signal and byte offset all tie', () => {
    // Two records can hold the same event at the same offset in the same signal, so the first
    // three keys are not a total order on their own. Insertion order is record-major, and the
    // comparator spells that out rather than relying on Array.prototype.sort being stable.
    const repeated = build(
      simple({
        recordCount: 2,
        annotationSignals: [{ samplesPerRecord: 30, tals: () => [{ onset: 5, texts: ['same'] }] }],
      }),
    );

    const result = decode(repeated, allRecords(repeated));

    expect(textsOf(result.annotations)).toEqual(['same', 'same']);
    expect(result.annotations.map((a) => a.recordIndex)).toEqual([0, 1]);
    expect(result.annotations.map((a) => a.onsetTicks)).toEqual([50000000n, 50000000n]);
    expect(result.annotations.map((a) => a.byteOffsetInRecord)).toEqual([
      at(result.annotations, 0).byteOffsetInRecord,
      at(result.annotations, 0).byteOffsetInRecord,
    ]);
  });

  it('keeps two onsets distinct in ticks even where their float seconds collide', () => {
    // 1073741824 s is past 2^30, where one float64 ULP is wider than a tick, so these two onsets
    // are the SAME number in `onsetSecondsFromHeaderStart` and different numbers in `onsetTicks`.
    // That is the whole argument for exposing exact ticks in the public API (DESIGN section 2,
    // "Time comparison"): comparing, sorting or deduplicating on the float merges real events.
    const farOut = build(
      simple({
        recordCount: 1,
        annotationSignals: [
          {
            samplesPerRecord: 60,
            tals: () => [
              { onset: '+1073741824.0000001', texts: ['later'] },
              { onset: '+1073741824', texts: ['earlier'] },
            ],
          },
        ],
      }),
    );

    const result = decode(farOut, allRecords(farOut));
    const earlier = at(result.annotations, 0);
    const later = at(result.annotations, 1);

    // Sorted by the exact value, so the on-disk order is corrected.
    expect(textsOf(result.annotations)).toEqual(['earlier', 'later']);
    expect(earlier.onsetTicks).toBe(10737418240000000n);
    expect(later.onsetTicks).toBe(10737418240000001n);
    expect(earlier.onsetTicks).not.toBe(later.onsetTicks);
    expect(earlier.onsetSecondsFromHeaderStart).toBe(later.onsetSecondsFromHeaderStart);
  });

  it('returns a frozen array, so the pinned order cannot be edited in place', () => {
    expect(Object.isFrozen(decode(sameOnset, allRecords(sameOnset)).annotations)).toBe(true);
  });
});

describe('what is and is not an annotation', () => {
  it('excludes empty texts, which are structure rather than events', () => {
    // An empty run is how the grammar terminates a timestamp. Emitting one would give every
    // record a phantom annotation with no description.
    const withEmpties = build(
      simple({
        recordCount: 1,
        annotationSignals: [
          {
            samplesPerRecord: 40,
            tals: () => [
              { onset: 1, texts: ['', 'real', ''] },
              { onset: 2, texts: [''] },
            ],
          },
        ],
      }),
    );

    const result = decode(withEmpties, allRecords(withEmpties));

    expect(textsOf(result.annotations)).toEqual(['real']);
  });

  it('reports a negative onset as INFO, because it is how a pre-stimulus event is written', () => {
    // DESIGN section 6: NEGATIVE_ANNOTATION_ONSET is deliberately not a warning. Under `strict`
    // a warning here would reject every correct evoked-potential file in existence.
    const preStimulus = build(
      simple({
        recordCount: 1,
        annotationSignals: [
          {
            samplesPerRecord: 40,
            tals: () => [
              { onset: -0.5, texts: ['pre-stimulus'] },
              { onset: -1, texts: ['earlier'] },
            ],
          },
        ],
      }),
    );

    const result = decode(preStimulus, allRecords(preStimulus));

    const negative = result.diagnostics.filter((d) => d.code === 'NEGATIVE_ANNOTATION_ONSET');
    expect(negative).toHaveLength(1);
    expect(at(negative, 0).severity).toBe('info');
    expect(at(negative, 0).severity).not.toBe('warning');
    expect(result.annotations.map((a) => a.onsetTicks)).toEqual([-10000000n, -5000000n]);
    expect(at(result.annotations, 1).onsetSecondsFromHeaderStart).toBe(-0.5);
  });

  it('keeps the onset digits, the duration and the channel label as written', () => {
    const detailed = build(
      simple({
        recordCount: 1,
        annotationSignals: [
          {
            samplesPerRecord: 40,
            tals: () => [{ onset: '+0.0000001', duration: '1.5', texts: ['Spindle@@Fp1'] }],
          },
        ],
      }),
    );

    const annotation = at(decode(detailed, allRecords(detailed)).annotations, 0);

    expect(annotation.onsetRaw).toBe('+0.0000001');
    expect(annotation.onsetTicks).toBe(1n);
    expect(annotation.durationRaw).toBe('1.5');
    expect(annotation.durationTicks).toBe(15000000n);
    expect(annotation.durationSeconds).toBe(1.5);
    expect(annotation.text).toBe('Spindle');
    expect(annotation.channelLabel).toBe('Fp1');
    expect(annotation.textEncoding).toBe('utf-8');
  });

  it('leaves the duration undefined when the TAL carries none', () => {
    const noDuration = build(
      simple({
        recordCount: 1,
        annotationSignals: [{ samplesPerRecord: 40, tals: () => [{ onset: 1, texts: ['x'] }] }],
      }),
    );
    const annotation = at(decode(noDuration, allRecords(noDuration)).annotations, 0);
    expect(annotation.durationTicks).toBeUndefined();
    expect(annotation.durationSeconds).toBeUndefined();
    expect(annotation.durationRaw).toBeUndefined();
    expect(annotation.channelLabel).toBeUndefined();
  });
});

describe('provenance points at the bytes the annotation came from', () => {
  const provenance = build(
    simple({
      recordCount: 2,
      annotationSignals: [
        {
          samplesPerRecord: 30,
          tals: (record) => [{ onset: record + 0.5, texts: [`event-in-record-${record}`] }],
        },
        {
          samplesPerRecord: 30,
          tals: (record) => [{ onset: record + 0.75, texts: [`second-signal-${record}`] }],
        },
      ],
    }),
  );

  it('names the signal and the record each annotation was read from', () => {
    const result = decode(provenance, allRecords(provenance));
    expect(result.annotations.map((a) => [a.text, a.signalIndex, a.recordIndex] as const)).toEqual([
      ['event-in-record-0', 1, 0],
      ['second-signal-0', 2, 0],
      ['event-in-record-1', 1, 1],
      ['second-signal-1', 2, 1],
    ]);
  });

  it('gives a byte offset in the record that lands on the text itself', () => {
    const result = decode(provenance, allRecords(provenance));
    const { file, header } = provenance;

    for (const annotation of result.annotations) {
      const fileOffset =
        header.headerByteLength +
        annotation.recordIndex * header.recordByteLength +
        annotation.byteOffsetInRecord;
      const bytes = file.subarray(fileOffset, fileOffset + annotation.text.length);
      expect(String.fromCharCode(...bytes)).toBe(annotation.text);
    }
  });

  it('places the offset inside the region of the signal it names', () => {
    const result = decode(provenance, allRecords(provenance));
    for (const annotation of result.annotations) {
      const signal = at(provenance.header.signals, annotation.signalIndex);
      expect(annotation.byteOffsetInRecord).toBeGreaterThanOrEqual(signal.recordByteOffset);
      expect(annotation.byteOffsetInRecord).toBeLessThan(
        signal.recordByteOffset + signal.recordByteLength,
      );
    }
  });

  it('reports grammar defects at their FILE byte offset, not their offset in the buffer passed in', () => {
    // The buffer handed to decodeAnnotations is usually one window out of a large file, so an
    // offset relative to it is useless in a bug report. A hexdump has to be able to use this.
    const signal = annotationSignal(provenance.header);
    const runaway = new Uint8Array(signal.recordByteLength).fill(0x41);
    runaway.set(encodeTal({ onset: '+1', texts: ['x'], omitTerminator: true }), 0);
    const damaged = patched(provenance, regionOffset(provenance.header, 1), runaway);

    const result = decode(damaged, { start: 1, count: 1 });

    const issue = at(
      result.diagnostics.filter((d) => d.code === 'TAL_TRUNCATED_AT_REGION_END'),
      0,
    );
    expect(issue.byteOffset).toBe(regionOffset(damaged.header, 1));
    expect(issue.signalIndex).toBe(1);
    expect(issue.recordIndex).toBe(1);
    expect(issue.specReference).toBeDefined();
    expect(issue.rawBytes).toBeDefined();
    // The reported offset really does land on the '+' the runaway TAL starts with.
    expect(damaged.file.at(issue.byteOffset ?? -1)).toBe(0x2b);
  });
});

describe('a non-conformant timekeeping TAL is described, not rejected', () => {
  const shorthandBytes = Uint8Array.of(0x2b, 0x30, 0x14, 0x00, 0x00);

  it('accepts the widespread "+t 0x14 0x00" shorthand that EDFlib rejects outright', () => {
    const base = build(simple({ recordCount: 2 }));
    const damaged = patched(base, regionOffset(base.header, 0), shorthandBytes);

    const result = decode(damaged, allRecords(damaged));

    expect(codesOf(result.diagnostics)).toEqual(['TIMEKEEPING_TAL_NONCONFORMANT']);
    expect(Array.from(result.recordOnsetTicks)).toEqual([0n, 10000000n]);
    expect(result.annotations).toEqual([]);
  });

  it('reports the shorthand once per call, because it is a property of the writer', () => {
    const base = build(simple({ recordCount: 2 }));
    let damaged = patched(base, regionOffset(base.header, 0), shorthandBytes);
    damaged = patched(
      damaged,
      regionOffset(damaged.header, 1),
      Uint8Array.of(0x2b, 0x31, 0x14, 0x00, 0x00),
    );

    const result = decode(damaged, allRecords(damaged));

    expect(codesOf(result.diagnostics)).toEqual(['TIMEKEEPING_TAL_NONCONFORMANT']);
    expect(Array.from(result.recordOnsetTicks)).toEqual([0n, 10000000n]);
  });

  it('drops the text of a timekeeping TAL that carries one, and says it did', () => {
    const base = build(simple({ recordCount: 1 }));
    const damaged = patched(
      base,
      regionOffset(base.header, 0),
      encodeTal({ onset: '+0', texts: ['not an annotation'] }),
    );

    const result = decode(damaged, allRecords(damaged));

    expect(codesOf(result.diagnostics)).toEqual(['TIMEKEEPING_TAL_NONCONFORMANT']);
    expect(textsOf(result.annotations)).not.toContain('not an annotation');
    expect(result.annotations).toEqual([]);
    expect(Array.from(result.recordOnsetTicks)).toEqual([0n]);
  });

  it('flags a timekeeping TAL that carries a duration, and still uses its onset', () => {
    const base = build(simple({ recordCount: 1 }));
    const damaged = patched(
      base,
      regionOffset(base.header, 0),
      encodeTal({ onset: '+0', duration: 1 }),
    );

    const result = decode(damaged, allRecords(damaged));

    const defect = at(
      result.diagnostics.filter((d) => d.code === 'TIMEKEEPING_TAL_NONCONFORMANT'),
      0,
    );
    expect(defect.severity).toBe('warning');
    expect(defect.recordIndex).toBe(0);
    expect(Array.from(result.recordOnsetTicks)).toEqual([0n]);
  });
});

describe('the caller contract', () => {
  const fixture = build(simple({ recordCount: 2 }));

  it('throws EdfRangeError for records the file does not have', () => {
    const bytes = recordBytesOf(fixture, { start: 0, count: 2 });
    expect(() => decodeAnnotations(fixture.header, bytes, { start: 1, count: 5 })).toThrow(
      EdfRangeError,
    );
    expect(() => decodeAnnotations(fixture.header, bytes, { start: -1, count: 1 })).toThrow(
      EdfRangeError,
    );
  });

  it('throws EdfRangeError when the buffer is not exactly the requested records', () => {
    // Silently accepting a short buffer would read whatever followed it in memory as annotation
    // text, which is the same class of bug as reading past a region bound.
    const bytes = recordBytesOf(fixture, { start: 0, count: 1 });
    expect(() => decodeAnnotations(fixture.header, bytes, { start: 0, count: 2 })).toThrow(
      EdfRangeError,
    );
  });

  it('collects nothing under strict on a conforming file', () => {
    // DESIGN section 6: under strict every diagnostics array is empty by construction.
    const result = decode(fixture, allRecords(fixture), { strict: true });
    expect(result.diagnostics).toEqual([]);
    expect(Array.from(result.recordOnsetTicks)).toEqual([0n, 10000000n]);
  });

  it('throws the first would-be diagnostic under strict, carrying its code', () => {
    const damaged = patched(
      fixture,
      regionOffset(fixture.header, 1),
      new Uint8Array(annotationSignal(fixture.header).recordByteLength),
    );

    try {
      decode(damaged, allRecords(damaged), { strict: true });
      expect.unreachable('expected strict to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EdfFormatError);
      if (!(error instanceof EdfFormatError)) throw error;
      expect(error.code).toBe('TIMEKEEPING_TAL_MISSING');
      expect(error.diagnostic?.recordIndex).toBe(1);
    }
  });
});
