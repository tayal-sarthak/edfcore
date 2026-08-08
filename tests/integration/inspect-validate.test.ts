/**
 * The two paths that exist to describe a file rather than to read it.
 *
 * `inspectEdf` is triage: DESIGN section 3 says it reads at most 128 KiB and NEVER throws on
 * malformed content, so a caller can walk a directory of unknown files without wrapping each
 * call. The boundary that keeps that promise honest is that it never promised to hide I/O — a
 * dead socket still rejects, and the tests below assert both halves of that distinction.
 *
 * `edfcore/validate` is conformance only (DESIGN decision 13): nothing it reports changes how a
 * byte is interpreted. `validateHeader` is pure and does no I/O at all; `validateRecording`
 * states what it cost — `recordsScanned` and `bytesRead` are what actually happened, so a report
 * claiming a file is clean also says how much of it was looked at.
 */

import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../src/header/parse.js';
import {
  buildRecordIndex,
  byteSource,
  EdfFormatError,
  type EdfInspection,
  inspectEdf,
  openEdf,
  readWindow,
} from '../../src/index.js';
import { validateHeader, validateRecording } from '../../src/validate.js';
import { patchBytes, setSignalField, truncate } from '../support/corrupt.js';
import { failingSource, spySource } from '../support/spy-source.js';
import { buildEdf, minimalEdf, minimalEdfPlus, type SignalSpec } from '../support/writer.js';

/** 128 KiB — `256 * 512`, the whole header of a 511-signal file. */
const MAX_INSPECT_BYTES = 128 * 1024;

function defined<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}

function codesOf(inspection: EdfInspection): readonly string[] {
  return inspection.diagnostics.map((diagnostic) => diagnostic.code);
}

// ---------------------------------------------------------------------------
// inspectEdf never throws about CONTENT
// ---------------------------------------------------------------------------

describe('inspectEdf on files that cannot be parsed', () => {
  const VALID = minimalEdf();

  interface Case {
    readonly name: string;
    readonly bytes: Uint8Array;
    readonly code: string;
    /** What triage can still say about the family, from the version block alone. */
    readonly variant: string | undefined;
  }

  const cases: readonly Case[] = [
    {
      name: 'junk bytes that are not an EDF file at all',
      bytes: new Uint8Array(300).fill(0x41),
      code: 'NOT_AN_EDF_FILE',
      variant: undefined,
    },
    {
      name: 'an empty source',
      bytes: new Uint8Array(0),
      code: 'SOURCE_TOO_SMALL',
      variant: undefined,
    },
    {
      name: 'a 300-byte file, past the fixed header but short of the per-signal blocks',
      bytes: truncate(VALID, 300),
      code: 'SOURCE_TOO_SMALL',
      variant: 'EDF',
    },
    {
      name: 'a file truncated to exactly its fixed header',
      bytes: truncate(VALID, 256),
      code: 'SOURCE_TOO_SMALL',
      variant: 'EDF',
    },
    {
      name: 'a per-signal header field that fails its numeric grammar',
      bytes: setSignalField(VALID, 1, 0, 'samplesPerRecord', 'ten'),
      code: 'NUMERIC_FIELD_INVALID',
      variant: 'EDF',
    },
  ];

  it.each(cases)(
    'returns ok:false with a diagnostic for $name',
    async ({ bytes, code, variant }) => {
      const inspection = await inspectEdf(byteSource(bytes));

      expect(inspection.ok).toBe(false);
      expect(codesOf(inspection)).toContain(code);
      expect(inspection.header).toBeUndefined();
      // The version block and the reserved field survive long after everything else has stopped
      // making sense, so triage still names the family where it can.
      expect(inspection.variant).toBe(variant);
      expect(inspection.byteLength).toBe(bytes.length);
      expect(inspection.bytesRead).toBeLessThanOrEqual(bytes.length);
    },
  );

  it('reports an error-severity header defect as ok:false while still returning the header', async () => {
    // digitalMinimum === digitalMaximum: the header parses, but physical units are undefined for
    // that signal, and DEGENERATE_DIGITAL_RANGE is error severity (DESIGN section 6,
    // deferred-fatal). `ok` is false and every piece of evidence is still on the result.
    const bytes = buildEdf({
      signals: [{ label: 'EMG Chin', samplesPerRecord: 4, digitalMinimum: 0, digitalMaximum: 0 }],
    });
    const inspection = await inspectEdf(byteSource(bytes));

    expect(inspection.ok).toBe(false);
    expect(codesOf(inspection)).toContain('DEGENERATE_DIGITAL_RANGE');
    expect(inspection.variant).toBe('EDF');
    expect(defined(inspection.header, 'the parsed header').signals[0]?.scale).toBeUndefined();
  });

  it('does not throw on a valid header whose data records are garbage', async () => {
    // inspectEdf is HEADER-ONLY triage (DESIGN section 3), so `ok` speaks for the header. The
    // promise being pinned here is that a corrupt body never turns triage into an exception —
    // the corruption is found by readRecords/validateRecording, which read those bytes.
    const bytes = patchBytes(minimalEdf(), 512, new Uint8Array(40).fill(0xff));
    const inspection = await inspectEdf(byteSource(bytes));

    expect(inspection.variant).toBe('EDF');
    expect(defined(inspection.header, 'the parsed header').recordCount).toBe(2);
    expect(inspection.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(inspection.ok).toBe(true);
  });

  it('rejects when the SOURCE fails, because it never promised to hide I/O', async () => {
    // The reads happen outside the catch on purpose: a dead socket or a file that vanished is
    // not a statement about the file's grammar, and turning it into `ok: false` would be a claim
    // edfcore cannot support.
    await expect(inspectEdf(failingSource(4096))).rejects.toThrow(/simulated I\/O failure/);
  });
});

// ---------------------------------------------------------------------------
// The 128 KiB ceiling
// ---------------------------------------------------------------------------

describe('inspectEdf reports what the parse had already found, not only the fatal', () => {
  /**
   * A header parse accumulates diagnostics as it goes and reaches its fatal checks last. When one
   * of those threw, the sink and everything in it went with it and `inspectEdf` returned exactly
   * one entry — while its own documented `diagnostics` field says "everything found, including the
   * fatal one when parsing failed".
   *
   * It matters most here, in the one call whose job is triaging unknown files: the fatal is often
   * the LEAST informative of the set. Below, "this EDF+ file has no annotations signal" is what
   * stops the parse, and the three real defects it had already found say nothing about annotations.
   */
  function damaged(withAnnotations: boolean): Uint8Array {
    return buildEdf({
      plus: 'C',
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [
        { label: 'Fp1', samplesPerRecord: 2, physicalMinimum: 5, physicalMaximum: 5 },
        { label: 'Fp2', samplesPerRecord: 2, digitalMinimum: 7, digitalMaximum: 7 },
        { label: 'Fp1', samplesPerRecord: 2 },
      ],
      ...(withAnnotations ? { annotationSignals: [{ samplesPerRecord: 20 }] } : {}),
    });
  }

  it('keeps the defects found before the fatal, with the fatal last', async () => {
    const inspection = await inspectEdf(byteSource(damaged(false)));

    expect(inspection.ok).toBe(false);
    expect(inspection.diagnostics.map((d) => d.code)).toEqual([
      'DEGENERATE_PHYSICAL_RANGE',
      'DEGENERATE_DIGITAL_RANGE',
      'DUPLICATE_SIGNAL_LABEL',
      // Last: the reason parsing stopped, reached in the order the parse reached it.
      'EDFPLUS_WITHOUT_ANNOTATION_SIGNAL',
    ]);
  });

  it('finds the same three defects the parse reports when the file is parseable', async () => {
    // Ground truth: the identical file with an annotations channel added parses, and its header
    // carries the same three. Without this the list above is just a list.
    const bytes = damaged(true);
    const header = parseHeader(bytes, bytes.byteLength);
    expect(header.diagnostics.map((d) => d.code)).toEqual([
      'DEGENERATE_PHYSICAL_RANGE',
      'DEGENERATE_DIGITAL_RANGE',
      'DUPLICATE_SIGNAL_LABEL',
      'DATE_CLIPPED_TO_1985_2084',
    ]);
  });

  it('carries them on the thrown error too, so a strict caller sees them', async () => {
    // The evidence lives on `EdfFormatError.collected`, so a caller who catches rather than
    // inspects gets it as well.
    const error = await openEdf(byteSource(damaged(false)))
      .then(() => undefined)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EdfFormatError);
    expect((error as EdfFormatError).code).toBe('EDFPLUS_WITHOUT_ANNOTATION_SIGNAL');
    expect((error as EdfFormatError).collected.map((d) => d.code)).toEqual([
      'DEGENERATE_PHYSICAL_RANGE',
      'DEGENERATE_DIGITAL_RANGE',
      'DUPLICATE_SIGNAL_LABEL',
    ]);
  });

  it('is empty on a fatal raised before anything was collected', async () => {
    // SOURCE_TOO_SMALL is checked first of all, so there is genuinely nothing to carry.
    const error = await openEdf(byteSource(new Uint8Array(10)))
      .then(() => undefined)
      .catch((thrown: unknown) => thrown);

    expect((error as EdfFormatError).code).toBe('SOURCE_TOO_SMALL');
    expect((error as EdfFormatError).collected).toEqual([]);
  });
});

describe('the bytes inspectEdf is allowed to read', () => {
  it('reads only the header of a large file, never the data', async () => {
    const bytes = buildEdf({
      signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 1000 }],
      recordCount: 200,
      recordDurationSeconds: 1,
    });
    expect(bytes.length).toBeGreaterThan(MAX_INSPECT_BYTES * 2);

    const source = spySource(byteSource(bytes));
    const inspection = await inspectEdf(source);

    expect(inspection.ok).toBe(true);
    expect(inspection.bytesRead).toBe(512);
    expect(source.bytesRead).toBe(512);
    expect(source.bytesRead).toBeLessThanOrEqual(MAX_INSPECT_BYTES);
    // Two reads: 256 bytes to learn the signal count, then the remaining 256 * ns.
    expect(source.reads.map((read) => [read.offset, read.length])).toEqual([
      [0, 256],
      [256, 256],
    ]);
    // Nothing past the header was touched.
    expect(source.maxOffsetTouched).toBe(511);
  });

  it('stops at 128 KiB on a header larger than the ceiling and says why', async () => {
    // 512 signals: the header is 256 * 513 = 131328 bytes, which is above the ceiling.
    const signals: SignalSpec[] = Array.from({ length: 512 }, (_, index) => ({
      label: `EEG S${index}`,
      samplesPerRecord: 1,
    }));
    const bytes = buildEdf({ signals, recordCount: 1, recordDurationSeconds: 1 });

    const source = spySource(byteSource(bytes));
    const inspection = await inspectEdf(source);

    expect(source.bytesRead).toBe(MAX_INSPECT_BYTES);
    expect(inspection.bytesRead).toBe(MAX_INSPECT_BYTES);
    expect(codesOf(inspection)).toContain('HEADER_EXCEEDS_INSPECTION_BUDGET');
    expect(inspection.ok).toBe(false);
    // Bounded by design, and it says which call is not: readHeader/openEdf read the whole
    // header however large it is.
    expect(inspection.diagnostics.map((d) => d.message).join(' ')).toMatch(/readHeader|openEdf/);
    expect(inspection.variant).toBe('EDF');
  });
});

// ---------------------------------------------------------------------------
// validateHeader: pure, and no I/O
// ---------------------------------------------------------------------------

describe('validateHeader', () => {
  it('does no I/O and returns the same diagnostics for the same header', async () => {
    const bytes = minimalEdf({
      signals: [
        { label: 'Fp1', transducerType: '', prefiltering: 'bandpass', samplesPerRecord: 4 },
      ],
    });
    const source = spySource(byteSource(bytes));
    const recording = await openEdf(source);
    source.reset();

    const first = validateHeader(recording.header);
    const second = validateHeader(recording.header);

    // Pure: no reads at all, and the second call agrees with the first.
    expect(source.reads).toEqual([]);
    expect(second.map((d) => d.code)).toEqual(first.map((d) => d.code));
    // Nothing it reports is on the read path, so the header's own diagnostics are untouched.
    expect(recording.header.diagnostics).not.toBe(first);
  });

  it('reports the EDF+ recommendations the header ignores, and nothing else', async () => {
    const bytes = minimalEdf({
      signals: [
        { label: 'Fp1', transducerType: '', prefiltering: 'bandpass', samplesPerRecord: 4 },
      ],
    });
    const recording = await openEdf(byteSource(bytes));

    const codes = validateHeader(recording.header).map((diagnostic) => diagnostic.code);
    // EDF+ additional specification 9: "<type> <sensor>", a named transducer, and HP:/LP:/N:/G:
    // prefiltering terms. All three are recommendations, so none of them can ever be fatal.
    expect(codes).toContain('LABEL_CONVENTION_NONCONFORMANT');
    expect(codes).toContain('TRANSDUCER_TYPE_BLANK');
    expect(codes).toContain('PREFILTERING_NONCONFORMANT');
    expect(validateHeader(recording.header).every((d) => d.severity !== 'error')).toBe(true);
  });

  it('returns nothing for a header that follows the recommendations', async () => {
    const bytes = minimalEdf({
      signals: [
        {
          label: 'EEG Fpz-Cz',
          transducerType: 'AgAgCl electrode',
          prefiltering: 'HP:0.1Hz LP:75Hz N:50Hz',
          samplesPerRecord: 4,
        },
      ],
    });
    const recording = await openEdf(byteSource(bytes));

    expect(validateHeader(recording.header)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateRecording: what it cost, stated rather than hidden
// ---------------------------------------------------------------------------

describe('validateRecording', () => {
  it('reads nothing when the onsets are arithmetic and samples were not asked for', async () => {
    // Plain EDF: there is no timekeeping TAL, so record r starts at r * recordDuration BY
    // DEFINITION. Reading the data would answer a question the bytes do not contain.
    const source = spySource(byteSource(minimalEdf({ recordCount: 3 })));
    const recording = await openEdf(source);
    source.reset();

    const report = await validateRecording(recording);

    expect(report.recordsScanned).toBe(0);
    expect(report.bytesRead).toBe(0);
    expect(report.signalStats).toEqual([]);
    expect(source.reads).toEqual([]);
  });

  it('reports honest recordsScanned and bytesRead when it does traverse', async () => {
    const source = spySource(byteSource(minimalEdfPlus({ recordCount: 3 })));
    const recording = await openEdf(source);
    const recordByteLength = recording.header.recordByteLength;
    source.reset();

    const report = await validateRecording(recording);

    // One annotation signal means the onsets are ON DISK, so they have to be read.
    expect(recordByteLength).toBe(2 * (10 + 30));
    expect(report.recordsScanned).toBe(3);
    expect(report.bytesRead).toBe(3 * recordByteLength);
    expect(source.bytesRead).toBe(report.bytesRead);
  });

  it('reuses a supplied complete index instead of traversing again', async () => {
    const source = spySource(byteSource(minimalEdfPlus({ recordCount: 4 })));
    const opened = await openEdf(source);
    const index = await buildRecordIndex(opened);
    const recording = { ...opened, index };
    source.reset();

    const report = await validateRecording(recording, { index });

    // One traversal, not two: the onsets are already known, and nothing else needs the bytes.
    expect(report.recordsScanned).toBe(0);
    expect(report.bytesRead).toBe(0);
    expect(source.reads).toEqual([]);
  });

  it('does not accept a probed index as a substitute for reading the onsets', async () => {
    const opened = await openEdf(byteSource(minimalEdfPlus({ recordCount: 4 })));

    const report = await validateRecording(opened, { index: opened.index });

    // `coverage: 'probed'` covers two records, so it cannot stand in for every record.
    expect(opened.index.coverage).toBe('probed');
    expect(report.recordsScanned).toBe(4);
    expect(report.bytesRead).toBe(4 * opened.header.recordByteLength);
  });

  it('fills ObservedSignalStats from the samples when scanSamples is on', async () => {
    // Four samples per record, two of which the declared digital range does not contain.
    const SAMPLES: readonly number[] = [-100, 0, 100, 200];
    const bytes = buildEdf({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [
        {
          label: 'EEG Fpz-Cz',
          digitalMinimum: -100,
          digitalMaximum: 100,
          physicalMinimum: -50,
          physicalMaximum: 50,
          samplesPerRecord: SAMPLES.length,
          sample: (_recordIndex, sampleIndex) => SAMPLES[sampleIndex] ?? 0,
        },
      ],
    });
    const recording = await openEdf(byteSource(bytes));

    const report = await validateRecording(recording, { scanSamples: true });

    expect(report.recordsScanned).toBe(2);
    expect(report.bytesRead).toBe(2 * recording.header.recordByteLength);
    expect(report.signalStats).toEqual([
      {
        signalIndex: 0,
        observedDigitalMin: -100,
        observedDigitalMax: 200,
        // edfcore never clamps on read: the count says the DECLARED range is wrong, not that
        // the samples are (DESIGN "Clamping").
        outOfDigitalRangeCount: 2,
        sampleCount: 8,
      },
    ]);
    expect(report.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('calls onProgress with the records finished and the total', async () => {
    const recording = await openEdf(byteSource(minimalEdfPlus({ recordCount: 5 })));
    const progress: Array<readonly [number, number]> = [];

    const report = await validateRecording(recording, {
      scanSamples: true,
      onProgress: (done, total) => {
        progress.push([done, total]);
      },
    });

    expect(progress.length).toBeGreaterThan(0);
    // The bar always finishes, and `total` is the record count throughout.
    expect(progress.at(-1)).toEqual([5, 5]);
    expect(progress.every(([, total]) => total === 5)).toBe(true);
    expect(progress.map(([done]) => done)).toEqual(
      [...progress.map(([done]) => done)].sort((a, b) => a - b),
    );
    expect(report.recordsScanned).toBe(5);
  });

  it('reports a discontinuity in a file that claims to be continuous', async () => {
    // EDF+C with a real gap: the marker says continuous, the timekeeping TALs disagree, and the
    // onsets are used exactly as written.
    const bytes = buildEdf({
      plus: 'C',
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [{ label: 'EEG Fpz-Cz', samplesPerRecord: 4 }],
      annotationSignals: [{ samplesPerRecord: 30 }],
      recordOnsetSeconds: (recordIndex) => (recordIndex < 2 ? recordIndex : recordIndex + 60),
    });
    const recording = await openEdf(byteSource(bytes));

    const report = await validateRecording(recording);

    expect(report.diagnostics.map((d) => d.code)).toContain('DISCONTINUITY_IN_CONTINUOUS_FILE');
    expect(report.recordsScanned).toBe(4);
  });
});

describe('an overlap is not called a gap', () => {
  /**
   * 0.3.3 stated the rule while fixing `edfcore gaps`: a gap is time no record covers; an overlap
   * is one instant two records both claim. Two other sites never got the same partition.
   *
   * The file below has records at 0, 1, 2 and 2.5 s. Record 3 starts half a second before record
   * 2 ends, and NO instant of the recording is uncovered.
   */
  function overlapping(): Uint8Array {
    return buildEdf({
      plus: 'C',
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 2 }],
      annotationSignals: [{ samplesPerRecord: 20 }],
      recordOnsetSeconds: (r: number) => [0, 1, 2, 2.5][r] as number,
    });
  }

  it('does not tell a validation report that a file missing no data has a gap', async () => {
    const recording = await openEdf(byteSource(overlapping()));
    const report = await validateRecording(recording, {});
    const structural = report.diagnostics.find(
      (d) =>
        d.code === 'DISCONTINUITY_IN_CONTINUOUS_FILE' && d.message.includes('separate segments'),
    );

    expect(structural?.message).toContain('1 overlap(s) between them');
    expect(structural?.message).not.toContain('gap(s) between them');
    // The neighbouring diagnostic has always got this right; now they agree.
    expect(report.diagnostics.some((d) => d.code === 'RECORD_ONSET_SPACING_VIOLATION')).toBe(true);
  });

  it('does not tell readWindow the file "covers only" more seconds than it spans', async () => {
    // The refusal fires on `spanTicks !== coveredTicks`, which is two-sided, and the message
    // hardcoded the gap reading — producing "span 3.5 s but cover only 4 s", where 4 is not
    // "only" anything next to 3.5, and asserting a hole that does not exist.
    const recording = await openEdf(byteSource(overlapping()));
    expect(recording.timeline.coveredTicks).toBeGreaterThan(recording.timeline.spanTicks);

    const error = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 4,
    })
      .then(() => undefined)
      .catch((thrown: unknown) => thrown as Error);

    expect(error?.message).toContain('starts before the previous one ends');
    expect(error?.message).not.toContain('at least one gap');
    expect(error?.message).not.toContain('cover only');
    // Still a refusal, and still with the same next step: a probed index cannot map this window.
    expect(error?.message).toContain('buildRecordIndex');
  });

  it('still calls a real hole a gap', async () => {
    const bytes = buildEdf({
      plus: 'C',
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 2 }],
      annotationSignals: [{ samplesPerRecord: 20 }],
      recordOnsetSeconds: (r: number) => (r < 2 ? r : r + 10),
    });
    const recording = await openEdf(byteSource(bytes));
    const error = await readWindow(recording, {
      signalIndices: [0],
      startSeconds: 0,
      durationSeconds: 4,
    })
      .then(() => undefined)
      .catch((thrown: unknown) => thrown as Error);

    expect(error?.message).toContain('at least one gap');
    const report = await validateRecording(recording, {});
    expect(
      report.diagnostics.find((d) => d.message.includes('separate segments'))?.message,
    ).toContain('1 gap(s) between them');
  });
});

describe('a sweep reports the same thing whatever chunk size it ran in', () => {
  /**
   * `traverse` states this invariant two lines above the call it broke: "The origin is the
   * recording's, so the sweep's verdict does not depend on its chunk size."
   *
   * It decoded each chunk with `originTicks` but not `startOffsetTicks`, and only the latter was
   * consulted when resolving record 0's sub-second offset. So every chunk re-derived that offset
   * from whichever record it happened to begin on. On an EDF+C file with a real gap — the single
   * most likely thing a conformance sweep is pointed at — each chunk starting after the gap
   * derived a value outside [0, 1) and reported START_OFFSET_OUT_OF_RANGE against a chunk
   * boundary the caller never chose. `maxMaterializeBytes` alone moved the count from 1 to 31.
   */
  function continuousMarkerWithRealGap(): Uint8Array {
    return buildEdf({
      plus: 'C',
      recordCount: 60,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
      annotationSignals: [{ samplesPerRecord: 40 }],
      recordOnsetSeconds: (r: number) => (r < 30 ? r : r + 100),
    });
  }

  function countByCode(diagnostics: readonly { code: string }[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const d of diagnostics) counts[d.code] = (counts[d.code] ?? 0) + 1;
    return counts;
  }

  it('gives the same diagnostics at every budget from the default down to one record', async () => {
    const recording = await openEdf(byteSource(continuousMarkerWithRealGap()));
    // 100-byte records, so these are ~42000, 20, 10, 5, 2 and 1 records per chunk.
    const budgets = [undefined, 2000, 1000, 500, 200, 100];

    const reports = [];
    for (const maxMaterializeBytes of budgets) {
      const report = await validateRecording(
        recording,
        maxMaterializeBytes === undefined ? {} : { maxMaterializeBytes },
      );
      reports.push(countByCode(report.diagnostics));
    }

    // Every run identical to the first, and no START_OFFSET_OUT_OF_RANGE at all: record 0 of this
    // file starts at 0 s, so there is nothing out of range to report.
    for (const counts of reports) expect(counts).toEqual(reports[0]);
    expect(reports[0]?.START_OFFSET_OUT_OF_RANGE).toBeUndefined();
    // The real defect in this file is still found, and its count does not move either.
    expect(reports[0]?.DISCONTINUITY_IN_CONTINUOUS_FILE).toBe(2);
  });

  it('still reports a record 0 offset that really is out of range', async () => {
    // The check that must not have been silenced. Record 0 starts +5 s after the header start
    // time, which is not a sub-second offset. It is reported once — from the open-time timeline
    // probe, which the sweep folds in — and not once per chunk.
    const bytes = buildEdf({
      plus: 'C',
      recordCount: 8,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
      annotationSignals: [{ samplesPerRecord: 40 }],
      recordOnsetSeconds: (r: number) => 5 + r,
    });
    const recording = await openEdf(byteSource(bytes));
    expect(recording.timeline.startOffsetTicks).toBe(50_000_000n);

    for (const maxMaterializeBytes of [undefined, 100]) {
      const report = await validateRecording(
        recording,
        maxMaterializeBytes === undefined ? {} : { maxMaterializeBytes },
      );
      expect(countByCode(report.diagnostics).START_OFFSET_OUT_OF_RANGE).toBe(1);
    }
  });
});
