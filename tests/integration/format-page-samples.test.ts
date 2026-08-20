/**
 * The sample encoding on `edf-format.md`, decoded twice and compared.
 *
 * The page prints two small decoders, one per family, as a statement of what a stored sample is:
 * little-endian two's complement, 16 bits in EDF and 24 sign-extended from bit 23 in BDF. They are
 * written to be read, not called — a reader who wants samples calls edfcore — so the claim they
 * make is that edfcore's decoder agrees with them.
 *
 * That is worth holding from this side. `decode/digital.ts` de-interleaves whole records with a
 * plan and a typed-array fast path; the page's version reads three bytes with no state at all.
 * They are the same function written for opposite purposes, and the page's is the one derived
 * straight from the specification. If the two ever disagree, the fast one is wrong.
 *
 * The page's own worked bytes are parsed out of it, so `decodeBdfSample(0xff, 0xff, 0x7f)` has to
 * keep printing a number that is actually what those bytes hold.
 */

import { describe, expect, it } from 'vitest';
import { decodeDigital } from '../../src/decode/digital.js';
import { byteSource } from '../../src/io/bytes.js';
import { readRecordBytes } from '../../src/io/read.js';
import { openEdf } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('edf-format.md') ?? '';

/** The page's `decodeEdfSample`, transcribed. */
function decodeEdfSample(b0: number, b1: number): number {
  const value = b0 | (b1 << 8);
  return value & 0x8000 ? value - 0x10000 : value;
}

/** The page's `decodeBdfSample`, transcribed. */
function decodeBdfSample(b0: number, b1: number, b2: number): number {
  const value = b0 | (b1 << 8) | (b2 << 16);
  return value & 0x800000 ? value - 0x1000000 : value;
}

/** Every digital value of `signal 0` in a file whose samples are `values`, as edfcore reads it. */
async function throughEdfcore(
  format: 'EDF' | 'BDF',
  values: readonly number[],
): Promise<Int32Array> {
  const bytes = buildEdf({
    format,
    recordCount: 1,
    recordDurationSeconds: 1,
    signals: [
      {
        label: 'S',
        samplesPerRecord: values.length,
        digitalMinimum: format === 'EDF' ? -32768 : -8388608,
        digitalMaximum: format === 'EDF' ? 32767 : 8388607,
        sample: (_record, index) => values[index] ?? 0,
      },
    ],
  });
  const recording = await openEdf(byteSource(bytes));
  const records = { start: 0, count: 1 };
  const recordBytes = await readRecordBytes(recording.source, recording.header, records);
  return decodeDigital(recording.header, recordBytes, records, 0);
}

describe('the two decoders the page prints', () => {
  it('produce the results the page prints beside them', () => {
    // `decodeEdfSample(0xff, 0xff);         // -1`
    const edf = [
      ...PAGE.matchAll(/decodeEdfSample\((0x[0-9a-f]{2}), (0x[0-9a-f]{2})\);\s*\/\/ (-?\d+)/g),
    ];
    expect(edf.length).toBeGreaterThan(0);
    for (const [, b0 = '', b1 = '', printed = ''] of edf) {
      expect(decodeEdfSample(Number(b0), Number(b1))).toBe(Number(printed));
    }

    const bdf = [
      ...PAGE.matchAll(
        /decodeBdfSample\((0x[0-9a-f]{2}), (0x[0-9a-f]{2}), (0x[0-9a-f]{2})\);\s*\/\/ (-?\d+)/g,
      ),
    ];
    expect(bdf.length).toBeGreaterThan(0);
    for (const [, b0 = '', b1 = '', b2 = '', printed = ''] of bdf) {
      expect(decodeBdfSample(Number(b0), Number(b1), Number(b2))).toBe(Number(printed));
    }
  });

  it('span the ranges the comments claim', () => {
    // "EDF: 16 bits, so -32768 .. 32767"
    expect(decodeEdfSample(0x00, 0x80)).toBe(-32768);
    expect(decodeEdfSample(0xff, 0x7f)).toBe(32767);
    // "BDF: 24 bits, sign-extended from bit 23, so -8388608 .. 8388607"
    expect(decodeBdfSample(0x00, 0x00, 0x80)).toBe(-8388608);
    expect(decodeBdfSample(0xff, 0xff, 0x7f)).toBe(8388607);
  });

  it('agree with edfcore across the whole EDF range', async () => {
    // Every one of the 65,536 encodings, decoded both ways.
    const values: number[] = [];
    for (let raw = 0; raw < 0x10000; raw += 1) values.push(decodeEdfSample(raw & 0xff, raw >> 8));
    expect(await throughEdfcore('EDF', values)).toEqual(Int32Array.from(values));
  });

  it('agree with edfcore at the BDF extremes and around zero', async () => {
    // 2^24 samples in one record is not a file; the boundaries are where sign extension is decided.
    const values = [-8388608, -8388607, -65536, -256, -1, 0, 1, 255, 65535, 8388606, 8388607];
    expect(await throughEdfcore('BDF', values)).toEqual(Int32Array.from(values));
  });
});

describe('the byte patterns named in prose', () => {
  it('holds that -1 is ff ff in EDF and ff ff ff in BDF', () => {
    // "`-1` is `ff ff` in EDF and `ff ff ff` in BDF; `8388607` is `ff ff 7f`."
    expect(PAGE).toContain('`-1` is `ff ff` in EDF and `ff ff ff` in BDF; `8388607` is `ff ff 7f`');
    expect(decodeEdfSample(0xff, 0xff)).toBe(-1);
    expect(decodeBdfSample(0xff, 0xff, 0xff)).toBe(-1);
    expect(decodeBdfSample(0xff, 0xff, 0x7f)).toBe(8388607);
  });

  it('holds that the same three bytes mean different things to the two families', async () => {
    // "A reader that gets `bytesPerSample` wrong doesn't fail. It produces a signal, just not the
    // one in the file." `ff ff 7f` is -1 followed by half a sample in EDF, and 8388607 in BDF.
    expect(decodeEdfSample(0xff, 0xff)).not.toBe(decodeBdfSample(0xff, 0xff, 0x7f));
  });
});
