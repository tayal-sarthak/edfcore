/**
 * `parseHeader` — the orchestrator, and the pinned check ORDER.
 *
 * DESIGN section 6: "Check order is pinned in `src/header/parse.ts` and asserted by tests, so
 * error identity is stable across refactors." That is the point of most of this file. A file with
 * one defect proves very little about order — every test below that claims an order builds a file
 * that violates SEVERAL rules at once and asserts WHICH one comes out, both as the fatal error a
 * lenient parse throws and as the diagnostic `strict` throws first.
 *
 * The remaining tests cover the size/geometry resolution the design promises: the computed header
 * size always beats the declared one, a `-1` record count is recovered from the source length, a
 * truncated file exposes only whole records and never zero-pads a partial one into existence, and
 * `header.rawBytes` is a copy so the caller may reuse its buffer.
 */

import { describe, expect, it } from 'vitest';
import { EdfError, EdfFormatError, isEdfError } from '../../../src/errors.js';
import { parseHeader } from '../../../src/header/parse.js';
import type { EdfHeader, ParseOptions } from '../../../src/types.js';
import {
  appendBytes,
  setHeaderField,
  setSignalField,
  truncate,
  truncateBy,
} from '../../support/corrupt.js';
import { buildEdf, type EdfSpec, minimalEdf } from '../../support/writer.js';

function parse(bytes: Uint8Array, options?: ParseOptions): EdfHeader {
  return parseHeader(bytes, bytes.length, options);
}

function codesOf(header: EdfHeader): readonly string[] {
  return header.diagnostics.map((diagnostic) => diagnostic.code);
}

function formatErrorFrom(run: () => unknown): EdfFormatError {
  try {
    run();
  } catch (error) {
    if (error instanceof EdfFormatError) return error;
    throw error;
  }
  throw new Error('expected an EdfFormatError, but the call returned normally');
}

function thrownBy(bytes: Uint8Array, options?: ParseOptions): EdfFormatError {
  return formatErrorFrom(() => parse(bytes, options));
}

/**
 * A four-digit year in the `dd.mm.yy` field is accepted where it fits and is not clipped, so a
 * fixture built on this base carries no diagnostic at all unless the test puts one there.
 */
const CLEAN_DATES = { startDate: '1.1.2020' } as const;

/** One signal, ten samples, two records: header 512 bytes, record 20 bytes, file 552 bytes. */
function cleanFile(overrides: Partial<EdfSpec> = {}): Uint8Array {
  return minimalEdf({ raw: CLEAN_DATES, ...overrides });
}

const HEADER_BYTES_ONE_SIGNAL = 512;
const RECORD_BYTES_ONE_SIGNAL = 20;

describe('a conforming file', () => {
  it('parses with no diagnostics at all', () => {
    const header = parse(cleanFile());

    expect(header.variant).toBe('EDF');
    expect(header.continuity).toBe('continuous');
    expect(header.headerByteLength).toBe(HEADER_BYTES_ONE_SIGNAL);
    expect(header.declaredHeaderByteLength).toBe(HEADER_BYTES_ONE_SIGNAL);
    expect(header.recordByteLength).toBe(RECORD_BYTES_ONE_SIGNAL);
    expect(header.recordCount).toBe(2);
    expect(header.declaredRecordCount).toBe(2);
    expect(header.recordCountSource).toBe('headerField');
    expect(header.dataByteLength).toBe(2 * RECORD_BYTES_ONE_SIGNAL);
    expect(codesOf(header)).toEqual([]);
  });

  it('exposes the fixed fields verbatim, padding included', () => {
    const header = parse(cleanFile());

    expect(header.raw.version).toBe('0'.padEnd(8, ' '));
    expect(header.raw.signalCount).toBe('1'.padEnd(4, ' '));
    expect(header.raw.recordCount).toBe('2'.padEnd(8, ' '));
    expect(header.raw.recordDuration).toBe('1'.padEnd(8, ' '));
    // DESIGN section 3: the reserved field is the full 44 bytes, verbatim.
    expect(header.reserved).toHaveLength(44);
    expect(header.reserved).toBe(''.padEnd(44, ' '));
  });
});

describe('SOURCE_TOO_SMALL', () => {
  it('refuses fewer than 256 bytes even when the version block is junk', () => {
    // Step 1 runs before the version block is looked at: with no fixed header there is nothing
    // to identify, so "too small" is the honest answer and NOT_AN_EDF_FILE would be a guess.
    const bytes = truncate(setHeaderField(cleanFile(), 'version', 'NOTEDF!!'), 200);
    const error = thrownBy(bytes);

    expect(error.code).toBe('SOURCE_TOO_SMALL');
    expect(error.field).toBe('header');
    expect(error.byteOffset).toBe(0);
  });

  it.each([0, 1, 255])('refuses a %i-byte source', (byteLength) => {
    const bytes = truncate(cleanFile(), byteLength);
    expect(thrownBy(bytes).code).toBe('SOURCE_TOO_SMALL');
  });

  it('refuses a source holding the fixed header but not all 256*(ns+1) bytes', () => {
    const bytes = truncate(cleanFile(), 400);
    const error = thrownBy(bytes);

    expect(error.code).toBe('SOURCE_TOO_SMALL');
    expect(error.diagnostic?.expected).toBe(`${HEADER_BYTES_ONE_SIGNAL} bytes`);
    expect(error.diagnostic?.actual).toBe('400 bytes');
  });

  it('accepts a source holding exactly 256*(ns+1) bytes and no data records', () => {
    // Zero data records is not a defect; the count field says 0 and matches what is there.
    const bytes = truncate(cleanFile({ recordCount: 0, raw: { ...CLEAN_DATES } }), 512);
    const header = parse(bytes);

    expect(header.recordCount).toBe(0);
    expect(header.dataByteLength).toBe(0);
    expect(codesOf(header)).toEqual([]);
  });
});

describe('SIGNAL_COUNT_INVALID', () => {
  interface SignalCountCase {
    readonly raw: string;
    readonly code: string;
    readonly why: string;
  }

  const CASES: readonly SignalCountCase[] = [
    { raw: '0', code: 'SIGNAL_COUNT_INVALID', why: 'a file with no signals has no data records' },
    { raw: '-1', code: 'SIGNAL_COUNT_INVALID', why: 'a negative count sizes nothing' },
    { raw: '', code: 'SIGNAL_COUNT_INVALID', why: 'a blank field states no count' },
    { raw: 'abc', code: 'SIGNAL_COUNT_INVALID', why: 'letters are not a count' },
    { raw: '1.0', code: 'SIGNAL_COUNT_INVALID', why: 'the integer grammar rejects a point' },
    { raw: '1E3', code: 'SIGNAL_COUNT_INVALID', why: 'an exponent in a geometry field is junk' },
    { raw: '9999', code: 'SOURCE_TOO_SMALL', why: '9999 is the top of the legal range' },
    { raw: '2', code: 'SOURCE_TOO_SMALL', why: '2 is legal; the file is simply not that long' },
  ];

  // DESIGN section 5, offset 252: ns is 1..9999 and is validated BEFORE any ns-sized work.
  it.each(CASES)('reports $code for a signal count of "$raw" — $why', ({ raw, code }) => {
    const bytes = setHeaderField(cleanFile(), 'signalCount', raw);
    expect(thrownBy(bytes).code).toBe(code);
  });

  it('carries the field and offset of the count it refused', () => {
    const error = thrownBy(setHeaderField(cleanFile(), 'signalCount', '0'));

    expect(error.field).toBe('signalCount');
    expect(error.byteOffset).toBe(252);
    expect(error.diagnostic?.raw).toBe('0'.padEnd(4, ' '));
  });

  it('accepts a right-justified count, and says so', () => {
    const header = parse(setHeaderField(cleanFile(), 'signalCount', ' 1'));

    expect(header.signals).toHaveLength(1);
    expect(codesOf(header)).toEqual(['NUMERIC_FIELD_NOT_LEFT_JUSTIFIED']);
  });
});

describe('HEADER_SIZE_MISMATCH', () => {
  const threeSignals: readonly EdfSpec['signals'][number][] = [
    { label: 'Fp1', samplesPerRecord: 4 },
    { label: 'Fp2', samplesPerRecord: 4 },
    { label: 'Fpz', samplesPerRecord: 4 },
  ];

  it('warns and lets the COMPUTED size win', () => {
    const bytes = buildEdf({
      signals: threeSignals,
      recordCount: 2,
      raw: { ...CLEAN_DATES, headerByteLength: '512' },
    });
    const header = parse(bytes);

    expect(codesOf(header)).toEqual(['HEADER_SIZE_MISMATCH']);
    // DESIGN section 5, offset 184: "Compute 256*(ns+1) and use that."
    expect(header.headerByteLength).toBe(1024);
    expect(header.declaredHeaderByteLength).toBe(512);
    // The computed size is the one the data offsets are built on: had the declared 512 won,
    // 512 extra bytes would have looked like data and the record count would not have matched.
    expect(header.recordCount).toBe(2);
    expect(header.recordCountSource).toBe('headerField');
  });

  it('reports an unreadable size field the same way and claims no size the file did not state', () => {
    const bytes = buildEdf({
      signals: threeSignals,
      recordCount: 2,
      raw: { ...CLEAN_DATES, headerByteLength: 'zzz' },
    });
    const header = parse(bytes);

    expect(codesOf(header)).toEqual(['HEADER_SIZE_MISMATCH']);
    expect(header.headerByteLength).toBe(1024);
    expect(Number.isNaN(header.declaredHeaderByteLength)).toBe(true);
  });
});

describe('record count resolution', () => {
  it('recovers -1 from the source length and says where the number came from', () => {
    // DESIGN section 5, offset 236: -1 means the writer never closed the file.
    const bytes = cleanFile({ recordCount: 2, raw: { ...CLEAN_DATES, recordCount: '-1' } });
    const header = parse(bytes);

    expect(codesOf(header)).toEqual(['RECORD_COUNT_RECOVERED']);
    expect(header.declaredRecordCount).toBe(-1);
    expect(header.recordCount).toBe(2);
    expect(header.recordCountSource).toBe('sourceByteLength');
    expect(header.dataByteLength).toBe(2 * RECORD_BYTES_ONE_SIGNAL);
  });

  it('recovers an unreadable count the same way', () => {
    const bytes = cleanFile({ recordCount: 2, raw: { ...CLEAN_DATES, recordCount: 'many' } });
    const header = parse(bytes);

    expect(codesOf(header)).toEqual(['RECORD_COUNT_RECOVERED']);
    expect(Number.isNaN(header.declaredRecordCount)).toBe(true);
    expect(header.recordCount).toBe(2);
    expect(header.recordCountSource).toBe('sourceByteLength');
  });

  it('exposes only whole records when the count is larger than the file allows', () => {
    const bytes = cleanFile({ recordCount: 2, raw: { ...CLEAN_DATES, recordCount: '10' } });
    const header = parse(bytes);

    expect(codesOf(header)).toEqual(['TRUNCATED_FILE']);
    expect(header.declaredRecordCount).toBe(10);
    expect(header.recordCount).toBe(2);
    expect(header.recordCountSource).toBe('sourceByteLength');
    expect(header.dataByteLength).toBe(2 * RECORD_BYTES_ONE_SIGNAL);
  });

  it('never pads a half-written final record into existence', () => {
    // Half a record cut off the end: the file declares 2 records and holds 1 whole record plus
    // 10 bytes. The 10 bytes are reported and then ignored — zero-padding them would decode as
    // real samples.
    const bytes = truncateBy(cleanFile(), 10);
    const header = parse(bytes);

    expect(codesOf(header)).toEqual(['TRUNCATED_FILE', 'PARTIAL_FINAL_RECORD']);
    expect(header.recordCount).toBe(1);
    expect(header.dataByteLength).toBe(RECORD_BYTES_ONE_SIGNAL);

    const partial = header.diagnostics.find((d) => d.code === 'PARTIAL_FINAL_RECORD');
    expect(partial?.byteOffset).toBe(HEADER_BYTES_ONE_SIGNAL + RECORD_BYTES_ONE_SIGNAL);
    expect(partial?.byteLength).toBe(10);
    expect(partial?.actual).toBe('10 bytes');
    // No `raw`. It points into the DATA section, and `raw` is contractually the bytes AT the
    // offset it reports — it inherited the record-count field's eight, so the rendered block
    // asserted that the bytes at this data offset read `"2       "` (fixed in 0.3.73).
    expect(partial?.raw).toBeUndefined();
  });

  it('reports bytes beyond the declared records and decodes none of them', () => {
    const bytes = appendBytes(cleanFile(), new Uint8Array(RECORD_BYTES_ONE_SIGNAL).fill(0xab));
    const header = parse(bytes);

    expect(codesOf(header)).toEqual(['TRAILING_BYTES']);
    expect(header.recordCount).toBe(2);
    expect(header.recordCountSource).toBe('headerField');
    expect(header.dataByteLength).toBe(2 * RECORD_BYTES_ONE_SIGNAL);

    const trailing = header.diagnostics.find((d) => d.code === 'TRAILING_BYTES');
    expect(trailing?.byteOffset).toBe(HEADER_BYTES_ONE_SIGNAL + 2 * RECORD_BYTES_ONE_SIGNAL);
    expect(trailing?.byteLength).toBe(RECORD_BYTES_ONE_SIGNAL);
    // The same reason: these bytes are samples, not the record-count field.
    expect(trailing?.raw).toBeUndefined();
  });

  it('calls a final fragment a partial record rather than trailing bytes', () => {
    // Both codes describe bytes after the last whole record; when the declared count is already
    // the number of whole records, the fragment IS the next record, and the more specific
    // diagnosis is the one that names the record and its expected size.
    const bytes = appendBytes(cleanFile(), new Uint8Array(7));
    const header = parse(bytes);

    expect(codesOf(header)).toEqual(['PARTIAL_FINAL_RECORD']);
    expect(header.recordCount).toBe(2);
  });
});

describe('record size', () => {
  it('warns above the recommended maximum and still reads the file', () => {
    // DESIGN section 3: EDF_RECOMMENDED_MAX_RECORD_BYTES is 61440, a recommendation, not a limit.
    const bytes = buildEdf({
      signals: [{ label: 'Fp1', samplesPerRecord: 30721 }],
      recordCount: 1,
      raw: CLEAN_DATES,
    });
    const header = parse(bytes);

    expect(codesOf(header)).toEqual(['RECORD_SIZE_ABOVE_RECOMMENDED']);
    expect(header.diagnostics[0]?.severity).toBe('warning');
    expect(header.recordByteLength).toBe(61442);
    expect(header.recordCount).toBe(1);
  });

  it('does not warn exactly at the recommended maximum', () => {
    const bytes = buildEdf({
      signals: [{ label: 'Fp1', samplesPerRecord: 30720 }],
      recordCount: 1,
      raw: CLEAN_DATES,
    });
    const header = parse(bytes);

    expect(header.recordByteLength).toBe(61440);
    expect(codesOf(header)).toEqual([]);
  });

  it('refuses a file in which every signal declares 0 samples per record', () => {
    // Record N and record N+1 would begin at the same byte, so there is no geometry at all.
    const bytes = buildEdf({
      signals: [
        { label: 'A', samplesPerRecord: 0 },
        { label: 'B', samplesPerRecord: 0 },
      ],
      recordCount: 2,
      raw: CLEAN_DATES,
    });
    const error = thrownBy(bytes);

    expect(error.code).toBe('RECORD_SIZE_ZERO');
    expect(error.field).toBe('samplesPerRecord');
  });
});

describe('EDFPLUS_WITHOUT_ANNOTATION_SIGNAL', () => {
  it('refuses an EDF+ marker with no annotations channel', () => {
    // EDF+ 2.2.4: the timekeeping TAL is the only place a record start time exists, so without
    // an annotations signal every time edfcore reported would be invented.
    const bytes = buildEdf({
      plus: 'C',
      signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
      recordCount: 2,
      raw: CLEAN_DATES,
    });
    const error = thrownBy(bytes);

    expect(error.code).toBe('EDFPLUS_WITHOUT_ANNOTATION_SIGNAL');
    expect(error.field).toBe('reserved');
    expect(error.byteOffset).toBe(192);
  });

  it.each(['C', 'D'] as const)('applies to EDF+%s alike', (continuity) => {
    const bytes = buildEdf({
      plus: continuity,
      signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
      recordCount: 2,
      raw: CLEAN_DATES,
    });
    expect(thrownBy(bytes).code).toBe('EDFPLUS_WITHOUT_ANNOTATION_SIGNAL');
  });

  it('says nothing about a plain EDF file without annotations', () => {
    expect(codesOf(parse(cleanFile()))).toEqual([]);
  });
});

describe('COMMA_DECIMAL_SEPARATOR', () => {
  // DESIGN section 2: fatal, no opt-in. '0,5' is a half and '1,024' is one thousand and
  // twenty-four; substituting '.' in the second silently turns 1024 into 1.024.
  it.each(['0,5', '1,024'])('refuses a record duration of "%s" without strict', (raw) => {
    const bytes = cleanFile({ raw: { ...CLEAN_DATES, recordDuration: raw } });
    const error = thrownBy(bytes);

    expect(error.code).toBe('COMMA_DECIMAL_SEPARATOR');
    expect(error.field).toBe('recordDuration');
    expect(error.byteOffset).toBe(244);
    expect(error.diagnostic?.severity).toBe('error');
  });

  it('refuses a comma in a per-signal numeric field, naming the signal', () => {
    const bytes = buildEdf({
      signals: [
        { label: 'Fp1', samplesPerRecord: 4 },
        { label: 'Fp2', samplesPerRecord: 4, raw: { physicalMinimum: '-1,5' } },
      ],
      recordCount: 1,
      raw: CLEAN_DATES,
    });
    const error = thrownBy(bytes);

    expect(error.code).toBe('COMMA_DECIMAL_SEPARATOR');
    expect(error.signalIndex).toBe(1);
  });

  it('treats a comma between non-digits as plain junk, not as a decimal separator', () => {
    const bytes = cleanFile({ raw: { ...CLEAN_DATES, recordDuration: 'a,b' } });
    expect(thrownBy(bytes).code).toBe('NUMERIC_FIELD_INVALID');
  });
});

/**
 * The pinned order. Each fixture below breaks several rules at once; the assertion is which
 * diagnostic wins, and the comment names the two steps being ordered.
 */
describe('check order — which error a multiply-broken file reports', () => {
  interface OrderCase {
    readonly name: string;
    readonly bytes: Uint8Array;
    readonly code: string;
  }

  const CASES: readonly OrderCase[] = [
    {
      // step 1 (fixed header present) before step 2 (version block)
      name: 'under 256 bytes and not an EDF file at all -> SOURCE_TOO_SMALL',
      bytes: truncate(setHeaderField(cleanFile(), 'version', 'NOTEDF!!'), 100),
      code: 'SOURCE_TOO_SMALL',
    },
    {
      // step 2 (version block) before step 3 (ns)
      name: 'a junk version block and a junk signal count -> NOT_AN_EDF_FILE',
      bytes: setHeaderField(
        setHeaderField(cleanFile(), 'version', 'NOTEDF!!'),
        'signalCount',
        'abc',
      ),
      code: 'NOT_AN_EDF_FILE',
    },
    {
      // step 3 (ns) before step 4 (the whole header is present)
      name: 'a junk signal count on a 256-byte source -> SIGNAL_COUNT_INVALID',
      bytes: truncate(setHeaderField(cleanFile(), 'signalCount', 'abc'), 256),
      code: 'SIGNAL_COUNT_INVALID',
    },
    {
      // step 3 (ns) before step 5 (the declared header size), because offset 184 cannot be
      // trusted until ns is known
      name: 'a junk signal count and a junk header size -> SIGNAL_COUNT_INVALID',
      bytes: setHeaderField(
        setHeaderField(cleanFile(), 'signalCount', '0'),
        'headerByteLength',
        '9999',
      ),
      code: 'SIGNAL_COUNT_INVALID',
    },
    {
      // step 4 (the whole header is present) before steps 5 and 6
      name: 'a truncated header, a junk header size and a comma duration -> SOURCE_TOO_SMALL',
      bytes: truncate(
        cleanFile({ raw: { ...CLEAN_DATES, headerByteLength: 'zz', recordDuration: '0,5' } }),
        400,
      ),
      code: 'SOURCE_TOO_SMALL',
    },
    {
      // step 6 (record duration) before step 7 (the per-signal blocks)
      name: 'a comma duration and an unreadable digital minimum -> COMMA_DECIMAL_SEPARATOR',
      bytes: buildEdf({
        signals: [{ label: 'Fp1', samplesPerRecord: 4, raw: { digitalMinimum: 'abc' } }],
        recordCount: 1,
        raw: { ...CLEAN_DATES, recordDuration: '0,5' },
      }),
      code: 'COMMA_DECIMAL_SEPARATOR',
    },
    {
      // step 7 (the per-signal blocks) before step 8 (the record size)
      name: 'every signal at 0 samples and an unreadable digital minimum -> NUMERIC_FIELD_INVALID',
      bytes: buildEdf({
        signals: [
          { label: 'A', samplesPerRecord: 0, raw: { digitalMinimum: 'abc' } },
          { label: 'B', samplesPerRecord: 0 },
        ],
        recordCount: 1,
        raw: CLEAN_DATES,
      }),
      code: 'NUMERIC_FIELD_INVALID',
    },
    {
      // step 8 (the record size) before step 9 (the record count), which divides by it
      name: 'every signal at 0 samples and a -1 record count -> RECORD_SIZE_ZERO',
      bytes: buildEdf({
        signals: [
          { label: 'A', samplesPerRecord: 0 },
          { label: 'B', samplesPerRecord: 0 },
        ],
        recordCount: 1,
        raw: { ...CLEAN_DATES, recordCount: '-1' },
      }),
      code: 'RECORD_SIZE_ZERO',
    },
    {
      // step 10 is fatal, so it wins over the step 9 warning that was merely collected
      name: 'a -1 record count and an EDF+ marker with no annotations -> EDFPLUS_WITHOUT_...',
      bytes: buildEdf({
        plus: 'C',
        signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
        recordCount: 2,
        raw: { ...CLEAN_DATES, recordCount: '-1' },
      }),
      code: 'EDFPLUS_WITHOUT_ANNOTATION_SIGNAL',
    },
    {
      // step 10 before step 11 (the text fields, which nothing else depends on)
      name: 'an EDF+ marker with no annotations and an unreadable startdate -> EDFPLUS_WITHOUT_...',
      bytes: buildEdf({
        plus: 'C',
        signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
        recordCount: 2,
        raw: { startDate: 'not-date' },
      }),
      code: 'EDFPLUS_WITHOUT_ANNOTATION_SIGNAL',
    },
  ];

  it.each(CASES)('$name', ({ bytes, code }) => {
    expect(thrownBy(bytes).code).toBe(code);
  });
});

describe('strict', () => {
  it('leaves diagnostics empty on a file that has none', () => {
    const header = parse(cleanFile(), { strict: true });
    expect(header.diagnostics).toEqual([]);
  });

  interface StrictCase {
    readonly name: string;
    readonly bytes: Uint8Array;
    /** The code `strict: true` throws — the FIRST would-be diagnostic. */
    readonly strictCode: string;
    /** Codes collected without `strict`, in order, when the file parses. */
    readonly collected: readonly string[] | undefined;
    /** The code thrown without `strict`, when a later check is fatal. */
    readonly lenientCode: string | undefined;
  }

  const CASES: readonly StrictCase[] = [
    {
      // step 2 (the reserved marker) before step 5 (the declared header size)
      name: 'an unrecognised reserved marker and a wrong header size',
      bytes: setHeaderField(
        setHeaderField(cleanFile(), 'reserved', 'WEIRD'),
        'headerByteLength',
        '1024',
      ),
      strictCode: 'NONSTANDARD_RESERVED_FIELD',
      collected: ['NONSTANDARD_RESERVED_FIELD', 'HEADER_SIZE_MISMATCH'],
      lenientCode: undefined,
    },
    {
      // step 3 (ns layout) before step 5 (the declared header size)
      name: 'a right-justified signal count and a wrong header size',
      bytes: setHeaderField(
        setHeaderField(cleanFile(), 'signalCount', ' 1'),
        'headerByteLength',
        '1024',
      ),
      strictCode: 'NUMERIC_FIELD_NOT_LEFT_JUSTIFIED',
      collected: ['NUMERIC_FIELD_NOT_LEFT_JUSTIFIED', 'HEADER_SIZE_MISMATCH'],
      lenientCode: undefined,
    },
    {
      // step 5 (the declared header size) before step 11 (the dates)
      name: 'a wrong header size and a two-digit year',
      bytes: minimalEdf({ raw: { startDate: '01.01.20', headerByteLength: '1024' } }),
      strictCode: 'HEADER_SIZE_MISMATCH',
      collected: ['HEADER_SIZE_MISMATCH', 'DATE_CLIPPED_TO_1985_2084'],
      lenientCode: undefined,
    },
    {
      // step 6 (the record duration) before step 7 (the per-signal blocks)
      name: 'a zero record duration and a signal with no samples',
      bytes: buildEdf({
        signals: [
          { label: 'A', samplesPerRecord: 4 },
          { label: 'B', samplesPerRecord: 0 },
        ],
        recordCount: 1,
        recordDurationSeconds: 0,
        raw: CLEAN_DATES,
      }),
      strictCode: 'ZERO_RECORD_DURATION',
      collected: ['ZERO_RECORD_DURATION', 'ZERO_SAMPLES_PER_RECORD'],
      lenientCode: undefined,
    },
    {
      // step 7's warning is reached before step 8's fatal check
      name: 'every signal declaring 0 samples per record',
      bytes: buildEdf({
        signals: [
          { label: 'A', samplesPerRecord: 0 },
          { label: 'B', samplesPerRecord: 0 },
        ],
        recordCount: 1,
        raw: CLEAN_DATES,
      }),
      strictCode: 'ZERO_SAMPLES_PER_RECORD',
      collected: undefined,
      lenientCode: 'RECORD_SIZE_ZERO',
    },
    {
      // step 9's warning is reached before step 10's fatal check
      name: 'a -1 record count on an EDF+ file with no annotations channel',
      bytes: buildEdf({
        plus: 'C',
        signals: [{ label: 'Fp1', samplesPerRecord: 10 }],
        recordCount: 2,
        raw: { ...CLEAN_DATES, recordCount: '-1' },
      }),
      strictCode: 'RECORD_COUNT_RECOVERED',
      collected: undefined,
      lenientCode: 'EDFPLUS_WITHOUT_ANNOTATION_SIGNAL',
    },
  ];

  it.each(CASES)('throws the first would-be diagnostic: $name', ({ bytes, strictCode }) => {
    const error = thrownBy(bytes, { strict: true });

    expect(error.code).toBe(strictCode);
    expect(error.diagnostic?.code).toBe(strictCode);
  });

  it.each(CASES)(
    'collects instead when strict is off: $name',
    ({ bytes, collected, lenientCode }) => {
      if (collected !== undefined) {
        expect(codesOf(parse(bytes))).toEqual(collected);
        return;
      }
      expect(thrownBy(bytes).code).toBe(lenientCode);
    },
  );

  it('escalates a warning without changing its identity', () => {
    const bytes = minimalEdf({ raw: { headerByteLength: '999' } });
    const error = thrownBy(bytes, { strict: true });

    expect(error.code).toBe('HEADER_SIZE_MISMATCH');
    // The severity travels with the code, not with the mode: strict decides whether a
    // diagnostic is thrown, never what it says.
    expect(error.diagnostic?.severity).toBe('warning');
    expect(codesOf(parse(bytes))).toContain('HEADER_SIZE_MISMATCH');
  });

  it('leaves a conforming file openable under strict', () => {
    // Every conforming EDF carries a two-digit year, so if the spec's own 1985-2084 rule
    // were a warning, strict would reject essentially every real file and be useless.
    expect(() =>
      parse(minimalEdf({ raw: { startDate: '01.01.20' } }), { strict: true }),
    ).not.toThrow();
    expect(codesOf(parse(minimalEdf()))).toEqual(['DATE_CLIPPED_TO_1985_2084']);
  });
});

describe('header.rawBytes', () => {
  it('is a copy, so the caller may reuse the buffer it read into', () => {
    const bytes = cleanFile();
    const header = parse(bytes);
    const before = Uint8Array.from(header.rawBytes);

    bytes.fill(0);

    expect(header.rawBytes).toEqual(before);
    expect(header.rawBytes[0]).toBe(0x30);
    expect(header.raw.version).toBe('0'.padEnd(8, ' '));
  });

  it('holds exactly the header, even when the whole file was passed in', () => {
    const bytes = cleanFile();
    const header = parse(bytes);

    expect(bytes.length).toBe(HEADER_BYTES_ONE_SIGNAL + 2 * RECORD_BYTES_ONE_SIGNAL);
    expect(header.rawBytes).toHaveLength(HEADER_BYTES_ONE_SIGNAL);
    expect(header.rawBytes).toHaveLength(header.headerByteLength);
  });

  it('shares no memory with the input buffer', () => {
    const bytes = cleanFile();
    const header = parse(bytes);

    expect(header.rawBytes.buffer).not.toBe(bytes.buffer);
  });
});

describe('sourceByteLength', () => {
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %p as a caller bug, not a file defect',
    (sourceByteLength) => {
      const bytes = cleanFile();
      let thrown: unknown;
      try {
        parseHeader(bytes, sourceByteLength);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(RangeError);
      expect(thrown).not.toBeInstanceOf(EdfError);
      expect(isEdfError(thrown)).toBe(false);
    },
  );

  it('is what truncation and -1 recovery are measured against, not the header buffer length', () => {
    // The caller may hand parseHeader a header-sized buffer read from a much larger file.
    const whole = cleanFile({ recordCount: 4, raw: { ...CLEAN_DATES, recordCount: '-1' } });
    const headerOnly = truncate(whole, HEADER_BYTES_ONE_SIGNAL);
    const header = parseHeader(headerOnly, whole.length);

    expect(header.recordCount).toBe(4);
    expect(header.recordCountSource).toBe('sourceByteLength');
  });
});

describe('a defect in one signal does not move the others', () => {
  it('reports the signal index the bad field belongs to', () => {
    const bytes = setSignalField(
      buildEdf({
        signals: [
          { label: 'Fp1', samplesPerRecord: 4 },
          { label: 'Fp2', samplesPerRecord: 4 },
          { label: 'Fpz', samplesPerRecord: 4 },
        ],
        recordCount: 1,
        raw: CLEAN_DATES,
      }),
      3,
      2,
      'digitalMaximum',
      '20 48',
    );
    const error = thrownBy(bytes);

    // '20 48' is neither 2048 nor 20: embedded whitespace fails the grammar outright.
    expect(error.code).toBe('NUMERIC_FIELD_INVALID');
    expect(error.signalIndex).toBe(2);
    expect(error.field).toBe('digitalMaximum');
  });
});

describe('NON_ASCII_HEADER_FIELD quotes the byte it is complaining about', () => {
  /**
   * The evidence window was `content.subarray(0, 16)` — anchored to the start of the field, never
   * moved to the offending byte. `patientId` and `recordingId` are 80 bytes each, and in the EDF+
   * layout the subfields that realistically carry a non-ASCII byte (the patient NAME, the
   * recording EQUIPMENT) begin well past byte 16.
   *
   * So for the exact case this warning exists for, the sixteen bytes quoted after
   * "carries bytes outside printable ASCII 32..126:" were every one of them printable ASCII, while
   * the sentence around them said those bytes were the non-conformant ones (fixed in 0.3.26).
   */
  function patientDiagnostic(patientId: string) {
    const bytes = buildEdf({
      recordCount: 2,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 2 }],
      raw: { patientId },
    });
    const found = parse(bytes).diagnostics.find((d) => d.code === 'NON_ASCII_HEADER_FIELD');
    if (found === undefined) throw new Error('expected NON_ASCII_HEADER_FIELD');
    return found;
  }

  /** The hex tokens the message quotes, as numbers. */
  function quotedBytes(hex: string): readonly number[] {
    return hex
      .split(' ')
      .filter((token) => token.startsWith('0x'))
      .map((token) => Number(token));
  }

  it('shows the offending byte when it sits past the sixteenth', () => {
    // The EDF+ patient shape with an accented name: 0xe9 is at byte 29 of the field content.
    const diagnostic = patientDiagnostic('MCH-0234567 F 02-MAY-1951 José_Álvarez');
    const shown = quotedBytes(diagnostic.actual as string);

    expect(shown).toContain(0xe9);
    expect(shown.some((byte) => byte < 0x20 || byte > 0x7e)).toBe(true);
    // Elided at the front, so a reader knows the window is not the start of the field.
    expect(diagnostic.actual).toMatch(/^\.\.\. /);
    // And the message names where to look, in absolute file bytes.
    expect(diagnostic.message).toContain('the first at byte 37');
  });

  it('still starts at the field for a byte that is already near the front', () => {
    const diagnostic = patientDiagnostic('José X X X');
    expect(quotedBytes(diagnostic.actual as string)).toContain(0xe9);
    expect(diagnostic.actual).not.toMatch(/^\.\.\./);
  });

  it('leaves rawBytes as the whole field content, so nothing programmatic changed', () => {
    const diagnostic = patientDiagnostic('MCH-0234567 F 02-MAY-1951 José_Álvarez');
    expect(diagnostic.rawBytes?.length).toBe(38);
    expect(diagnostic.byteOffset).toBe(8);
    expect(diagnostic.byteLength).toBe(80);
  });
});
