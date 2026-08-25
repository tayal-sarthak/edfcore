/**
 * The values `api-primitives.md` prints beside each primitive.
 *
 * That page is the reference for the layer under `openEdf` — the calls a consumer reaches for when
 * the convenience API is not the shape they want — and each entry ends with a line showing what
 * comes back. Six of those lines say something a reader would otherwise have to take on trust, and
 * none was executed.
 *
 * Two of them are contracts rather than examples. `again.buffer === scratch.buffer` is the whole
 * reason `decodeDigital` takes an `out` argument: zero allocations after the first, in a loop over
 * a long recording. And `decodeHeaderLatin1(bytes.subarray(0, 8))` printing `'0       '` with its
 * padding intact is the "no trimming, no interpretation" promise the paragraph above it spends
 * five sentences on — a function that trimmed would satisfy every other test of it.
 *
 * `[ 0, 1 ]` from `findSignals` is the duplicate-label case, annotated on the page as something
 * CHB-MIT really does. It is the reason `getSignal` has an ambiguity error at all.
 */

import { describe, expect, it } from 'vitest';
import { decodeHeaderLatin1 } from '../../src/bytes/latin1.js';
import { TICKS_PER_SECOND } from '../../src/constants.js';
import { decodeDigital } from '../../src/decode/digital.js';
import { formatStartTimeNaive } from '../../src/header/dates.js';
import { findSignals, isAnnotationLabel } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('api-primitives.md') ?? '';

/** The text after `// ` on the line the expression appears on. */
const shows = (expression: string): string =>
  new RegExp(`${expression.replace(/[.()[\]*+?^$|\\]/g, '\\$&')};\\s*//\\s*([^\\n]+)`)
    .exec(PAGE)?.[1]
    ?.trim() ?? '';

describe('decodeDigital with an out array', () => {
  it('writes into the array it was given, as the page shows', async () => {
    const bytes = minimalEdfPlus({ recordCount: 2, recordDurationSeconds: 1 });
    const source = byteSource(bytes);
    const recording = await openEdf(source);
    const records = { start: 0, count: 2 } as const;
    const recordBytes = await readRecordBytes(source, recording.header, records);

    const scratch = new Int32Array(64);
    const again = decodeDigital(recording.header, recordBytes, records, 0, scratch);

    expect(again.buffer === scratch.buffer).toBe(true);
    expect(shows('console.log(again.buffer === scratch.buffer)')).toBe('true');
    // "zero allocations after the first" — a second call reuses it again.
    const third = decodeDigital(recording.header, recordBytes, records, 0, scratch);
    expect(third.buffer === scratch.buffer).toBe(true);
  });
});

describe('findSignals on a file with the same label twice', () => {
  it('returns both, in signal order, as the page prints', async () => {
    // CHB-MIT ships `T8-P8` twice, which is why the page uses it.
    const bytes = buildEdf({
      recordCount: 1,
      recordDurationSeconds: 1,
      signals: [
        { label: 'T8-P8', samplesPerRecord: 4 },
        { label: 'T8-P8', samplesPerRecord: 4 },
      ],
    });
    const { header } = await openEdf(byteSource(bytes));

    const printed = /console\.log\(matches\.map\(\(s\) => s\.index\)\);\s*\/\/ \[ ([\d, ]+) \]/
      .exec(PAGE)?.[1]
      ?.split(',')
      .map((entry) => Number(entry.trim()));
    expect(printed).toEqual([0, 1]);
    expect(findSignals(header, 'T8-P8').map((signal) => signal.index)).toEqual(printed);
  });

  it('trims the argument as well as the label, which the sentence above claims', async () => {
    const bytes = buildEdf({
      recordCount: 1,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
    });
    const { header } = await openEdf(byteSource(bytes));
    expect(findSignals(header, '  Fp1  ').map((signal) => signal.index)).toEqual([0]);
    // "case-sensitive … edfcore has no montage vocabulary".
    expect(findSignals(header, 'FP1')).toEqual([]);
  });
});

describe('isAnnotationLabel', () => {
  it('answers what the page prints for both of its examples', () => {
    expect(String(isAnnotationLabel('EDF Annotations '))).toBe(
      shows("isAnnotationLabel('EDF Annotations ')"),
    );
    expect(String(isAnnotationLabel('Fp1'))).toBe(shows("isAnnotationLabel('Fp1')"));
  });
});

describe('decodeHeaderLatin1', () => {
  it('keeps the padding, which is the promise the paragraph makes', async () => {
    // "No trimming, no interpretation." A function that trimmed would satisfy every test that
    // compares a decoded field with its trimmed value, which is most of them.
    const bytes = minimalEdfPlus({ recordCount: 1, recordDurationSeconds: 1 });
    const printed = shows('decodeHeaderLatin1(bytes.subarray(0, 8))');

    expect(`'${decodeHeaderLatin1(bytes.subarray(0, 8))}'`).toBe(printed);
    expect(printed).toContain(' '.repeat(7));
  });
});

describe('formatStartTimeNaive', () => {
  it('formats the start time the page prints, milliseconds included', async () => {
    const bytes = minimalEdfPlus({
      recordCount: 1,
      recordDurationSeconds: 1,
      startDate: '02.08.51',
      startTime: '09.00.00',
      recordingId: 'Startdate 02-AUG-1951 X X X',
    });
    const { header } = await openEdf(byteSource(bytes));

    const printed = /formatStartTimeNaive\(header\.startTime\);\s*\/\/ '([^']+)'/.exec(PAGE)?.[1];
    expect(formatStartTimeNaive(header.startTime)).toBe(printed);
    // "The milliseconds are always `.000`. The header stores whole seconds."
    expect(printed?.endsWith('.000')).toBe(true);
  });
});

describe('TICKS_PER_SECOND', () => {
  it('halves to the bigint the page prints', () => {
    const printed = /TICKS_PER_SECOND \/ 2n;\s*\/\/ (\d+)n/.exec(PAGE)?.[1];
    expect(TICKS_PER_SECOND / 2n).toBe(BigInt(printed as string));
  });
});
