/**
 * "Oddities that bite implementers" on `edf-format.md`, executed.
 *
 * The section is the page's payload: seven paragraphs, each naming a thing about EDF that produces
 * a wrong answer rather than an error. The page is written to be read by someone who is about to
 * write their own parser — the comparison page says that is what people overwhelmingly do — so
 * these are the claims most likely to be acted on by a reader who never installs the package.
 *
 * They are checked here against the library because that is the only way to check them at all, and
 * because each one is a place edfcore itself could regress into the naive behaviour being warned
 * about. Every paragraph describes a bug that looks like working software: a date eighty years
 * wrong, a record count that is silently short, a rate of `Infinity`, a header byte mangled by the
 * decoder that read it.
 */

import { describe, expect, it } from 'vitest';
import { decodeHeaderLatin1 } from '../../src/bytes/latin1.js';
import { EDF_MAX_SIGNAL_COUNT } from '../../src/constants.js';
import { getSignal } from '../../src/header/lookup.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { truncateBy } from '../support/corrupt.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('edf-format.md') ?? '';
const FLAT = PAGE.replace(/\s+/g, ' ');

const openBytes = async (bytes: Uint8Array) => (await openEdf(byteSource(bytes))).header;

describe('the two-digit year', () => {
  it('resolves the example the page gives, eighty years from the naive reading', async () => {
    // "`02.08.51` is 2 August **2051**, not 1951."
    const printed = /`(\d\d\.\d\d\.\d\d)` is \d+ \w+ \*\*(\d{4})\*\*, not (\d{4})/.exec(FLAT);
    expect(printed).not.toBeNull();
    const header = await openBytes(
      buildEdf({
        recordCount: 1,
        recordDurationSeconds: 1,
        startDate: printed?.[1] ?? '',
        signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
      }),
    );
    expect(header.startTime.resolvedDate?.year).toBe(Number(printed?.[2]));
    expect(header.startTime.resolvedDate?.year).not.toBe(Number(printed?.[3]));
  });

  it('splits the century at the boundary the rule states', async () => {
    // "`85` through `99` mean 1985 through 1999, and `00` through `84` mean 2000 through 2084."
    const yearFor = async (yy: string): Promise<number | undefined> =>
      (
        await openBytes(
          buildEdf({
            recordCount: 1,
            recordDurationSeconds: 1,
            startDate: `01.01.${yy}`,
            signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
          }),
        )
      ).startTime.resolvedDate?.year;

    expect(await yearFor('85')).toBe(1985);
    expect(await yearFor('99')).toBe(1999);
    expect(await yearFor('00')).toBe(2000);
    expect(await yearFor('84')).toBe(2084);
  });
});

describe('a record count of -1', () => {
  it('is recovered by the arithmetic the page prints', async () => {
    // "The recovery is arithmetic: `floor((fileSize - headerByteLength) / recordByteLength)`."
    expect(FLAT).toContain('floor((fileSize - headerByteLength) / recordByteLength)');
    const bytes = buildEdf({
      recordCount: 9,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
      raw: { recordCount: '-1      ' },
    });
    const header = await openBytes(bytes);
    expect(header.declaredRecordCount).toBe(-1);
    expect(header.recordCount).toBe(
      Math.floor((bytes.byteLength - header.headerByteLength) / header.recordByteLength),
    );
    expect(header.recordCount).toBe(9);
    expect(header.recordCountSource).toBe('sourceByteLength');
  });

  it('catches a file claiming more records than it holds, by the same computation', async () => {
    // "The same computation catches the file that claims more records than it contains."
    expect(FLAT).toContain('catches the file that claims more records than it contains');
    const whole = buildEdf({
      recordCount: 9,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
    });
    const header = await openBytes(truncateBy(whole, 8 * 2 * 2));
    expect(header.declaredRecordCount).toBe(9);
    expect(header.recordCount).toBeLessThan(9);
    expect(header.diagnostics.map((entry) => entry.code)).toContain('TRUNCATED_FILE');
  });
});

describe('a record duration of zero', () => {
  it('is legal, and yields no rate rather than Infinity', async () => {
    // "A reader that computes `samplesPerRecord / recordDuration` unguarded reports `Infinity` Hz
    //  and then produces `NaN` for every time it converts."
    expect(FLAT).toContain('reports `Infinity` Hz');
    const header = await openBytes(
      buildEdf({
        recordCount: 2,
        recordDurationSeconds: 0,
        signals: [{ label: 'Stage', samplesPerRecord: 1 }],
      }),
    );
    const stage = getSignal(header, 'Stage');
    expect(header.recordDurationSeconds).toBe(0);
    expect(stage.sampleRateHz).toBeUndefined();
    // The unguarded expression, for contrast.
    expect(stage.samplesPerRecord / header.recordDurationSeconds).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('BDF’s first header byte', () => {
  it('is not ASCII, and survives the decoder that reads it', async () => {
    // "It's `0xFF`, followed by `\"BIOSEMI\"`. Anything that reads the header as a text string
    //  before inspecting it mangles that byte on the way in."
    expect(FLAT).toContain("BDF's first header byte is not ASCII");
    const bytes = buildEdf({
      format: 'BDF',
      recordCount: 1,
      recordDurationSeconds: 1,
      signals: [{ label: 'A1', samplesPerRecord: 4 }],
    });
    expect(bytes[0]).toBe(0xff);
    expect(decodeHeaderLatin1(bytes.subarray(1, 8))).toBe('BIOSEMI');
    // The identity map keeps it; a UTF-8 decode would replace it.
    expect(decodeHeaderLatin1(bytes.subarray(0, 1)).codePointAt(0)).toBe(0xff);
    expect(new TextDecoder().decode(bytes.subarray(0, 1)).codePointAt(0)).not.toBe(0xff);

    const header = await openBytes(bytes);
    expect(header.variant.startsWith('BDF')).toBe(true);
    expect(header.bytesPerSample).toBe(3);
  });
});

describe('the redundant header byte-count field', () => {
  it('loses to the computed size when the two disagree', async () => {
    // "`256 * (ns + 1)` is the truth; the field at offset 184 is a claim. When they disagree,
    //  believing the field puts every data-record offset in the file at the wrong place."
    expect(FLAT).toContain('the field at offset 184 is a claim');
    const header = await openBytes(
      buildEdf({
        recordCount: 4,
        recordDurationSeconds: 1,
        signals: [
          { label: 'Fp1', samplesPerRecord: 8 },
          { label: 'Fp2', samplesPerRecord: 8 },
        ],
        raw: { headerByteLength: '99999   ' },
      }),
    );
    expect(header.declaredHeaderByteLength).toBe(99_999);
    expect(header.headerByteLength).toBe(256 * (header.signals.length + 1));
    expect(header.diagnostics.map((entry) => entry.code)).toContain('HEADER_SIZE_MISMATCH');
  });
});

describe('the signal count the page bounds', () => {
  it('is the range the fixed-header table states', () => {
    // "| 252 | 4 | number of signals (ns) | 1 to 9999 — the field is four characters wide. |"
    const printed = /number of signals \(ns\) \| (\d+) to (\d+)/.exec(FLAT);
    expect(printed).not.toBeNull();
    expect(EDF_MAX_SIGNAL_COUNT).toBe(Number(printed?.[2]));
    // Four characters, which is what bounds it.
    expect(String(EDF_MAX_SIGNAL_COUNT)).toHaveLength(4);
  });
});
