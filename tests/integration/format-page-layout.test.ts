/**
 * The two byte-layout tables on `edf-format.md`, read out of the page and checked.
 *
 * That page is the one to send a colleague who asks what EDF is, and it is almost entirely
 * addresses: ten rows giving the offset and width of every fixed header field, and ten more
 * giving the address of every per-signal field. Nothing in the suite had ever looked at it —
 * it and `physical-values.md` were the only two pages no test named at all.
 *
 * The numbers are right. What was missing is that nothing held them there. `HEADER_FIELDS` in
 * `constants.ts` is the same table in the same order, and the page is a hand-typed copy of it:
 * an offset corrected in one is a page teaching a byte address that no longer exists, in a
 * document whose whole purpose is being independent of the library.
 *
 * So the rows are PARSED from the page rather than restated here. A test that restates them is a
 * third copy, and a third copy drifts the same way the second one would.
 */

import { describe, expect, it } from 'vitest';
import {
  EDF_HEADER_BLOCK_BYTES,
  HEADER_FIELDS,
  SIGNAL_FIELD_BLOCK_OFFSETS,
  SIGNAL_FIELD_WIDTHS,
} from '../../src/constants.js';
import { getSignal } from '../../src/header/lookup.js';
import { signalFieldOffset } from '../../src/header/signals.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readWindow } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('edf-format.md') ?? '';

/**
 * The cells of every pipe-table row under `heading`, up to the blank line that ends the table.
 * The separator row (`|---|---|`) and the header row are dropped.
 */
function tableUnder(heading: string): readonly (readonly string[])[] {
  const start = PAGE.indexOf(heading);
  if (start === -1) throw new Error(`no section ${JSON.stringify(heading)} on edf-format.md`);
  const rows: (readonly string[])[] = [];
  let seenTable = false;
  for (const line of PAGE.slice(start + heading.length).split('\n')) {
    if (!line.trimStart().startsWith('|')) {
      if (seenTable) break;
      continue;
    }
    seenTable = true;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    rows.push(cells.map((cell) => cell.trim()));
  }
  return rows.slice(2);
}

describe('the fixed header table', () => {
  const rows = tableUnder('## The fixed header (256 bytes at offset 0)');

  it('lists every fixed field, in the order the bytes run', () => {
    expect(rows).toHaveLength(Object.keys(HEADER_FIELDS).length);
    const published = rows.map((cells) => Number(cells[0]));
    expect(published).toEqual(Object.values(HEADER_FIELDS).map((field) => field.offset));
  });

  it('gives each field the width the parser reads', () => {
    const widths = rows.map((cells) => Number(cells[1]));
    expect(widths).toEqual(Object.values(HEADER_FIELDS).map((field) => field.length));
  });

  it('leaves no gap and no overlap across the 256 bytes', () => {
    // The heading says "256 bytes at offset 0", so the rows have to tile exactly that.
    let next = 0;
    for (const cells of rows) {
      expect(Number(cells[0])).toBe(next);
      next += Number(cells[1]);
    }
    expect(next).toBe(256);
  });
});

describe('the per-signal address table', () => {
  const rows = tableUnder('## The per-signal header is field-major');

  /** `` `256 + ns*96 + i*8` `` as the three numbers in it. */
  function address(cell: string): { base: number; perSignalCount: number; perIndex: number } {
    const match = /^`(\d+) \+ ns\*(\d+) \+ i\*(\d+)`$/.exec(cell);
    if (match === null) throw new Error(`unreadable address cell ${JSON.stringify(cell)}`);
    return {
      base: Number(match[1]),
      perSignalCount: Number(match[2]),
      perIndex: Number(match[3]),
    };
  }

  it('lists every per-signal field, in the order the bytes run', () => {
    expect(rows).toHaveLength(Object.keys(SIGNAL_FIELD_WIDTHS).length);
    const published = rows.map((cells) => address(cells[2] ?? '').perSignalCount);
    expect(published).toEqual(Object.values(SIGNAL_FIELD_BLOCK_OFFSETS));
  });

  it('gives each field the width the parser reads, in both columns', () => {
    const widths = Object.values(SIGNAL_FIELD_WIDTHS);
    expect(rows.map((cells) => Number(cells[1]))).toEqual(widths);
    // The same width again inside the address, where it multiplies the signal index.
    expect(rows.map((cells) => address(cells[2] ?? '').perIndex)).toEqual(widths);
  });

  it('starts every address at the end of the first 256-byte block', () => {
    for (const cells of rows) expect(address(cells[2] ?? '').base).toBe(EDF_HEADER_BLOCK_BYTES);
  });

  it('makes each ns multiplier the sum of the widths before it, as the page says', () => {
    // "The multiplier on `ns` in each row is the sum of the widths of every field before it."
    let before = 0;
    for (const cells of rows) {
      expect(address(cells[2] ?? '').perSignalCount).toBe(before);
      before += Number(cells[1]);
    }
    // "The widths sum to 256, which is why the per-signal section is `ns * 256` bytes."
    expect(before).toBe(EDF_HEADER_BLOCK_BYTES);
  });

  it('resolves to the address the parser actually reads', () => {
    // ns = 1 is the case the page warns about: there the field-major and struct-per-signal
    // layouts are identical, so it is the one signal count that cannot tell them apart.
    for (const signalCount of [1, 2, 30]) {
      for (let index = 0; index < signalCount; index += 1) {
        const names = Object.keys(SIGNAL_FIELD_WIDTHS) as (keyof typeof SIGNAL_FIELD_WIDTHS)[];
        names.forEach((field, row) => {
          const { base, perSignalCount, perIndex } = address(rows[row]?.[2] ?? '');
          expect(base + signalCount * perSignalCount + index * perIndex).toBe(
            signalFieldOffset(field, signalCount, index),
          );
        });
      }
    }
  });
});

/**
 * The page's own `byteOfSample`, transcribed. It is printed as something to read once rather
 * than to use — "edfcore does that arithmetic for you" — so what matters is that the address it
 * produces is the address edfcore reads from, not that a caller ever runs it.
 */
function byteOfSample(
  header: { headerByteLength: number; recordByteLength: number; bytesPerSample: number },
  signal: { samplesPerRecord: number; recordByteOffset: number },
  sampleIndex: number,
): number {
  const record = Math.floor(sampleIndex / signal.samplesPerRecord);
  const withinRecord = sampleIndex % signal.samplesPerRecord;
  return (
    header.headerByteLength +
    record * header.recordByteLength +
    signal.recordByteOffset +
    withinRecord * header.bytesPerSample
  );
}

describe('the address the page works out by hand', () => {
  /** The file the snippet opens: `'Resp', 16 samples per record` as signal 1. */
  const BYTES = buildEdf({
    recordCount: 30,
    recordDurationSeconds: 1,
    signals: [
      { label: 'EEG Fpz-Cz', samplesPerRecord: 256 },
      // Every sample distinct across the whole channel, so a value identifies its own address.
      {
        label: 'Resp',
        samplesPerRecord: 16,
        sample: (record, within) => record * 16 + within - 240,
      },
    ],
  });

  /** `byteOfSample(recording.header, signal, 20);  // 1832 — record 1, sample 4 of that signal` */
  const printed =
    /byteOfSample\(recording\.header, signal, (\d+)\);\s*\/\/ (\d+) — record (\d+), sample (\d+)/.exec(
      PAGE,
    );

  it('prints a worked example the page can be read for', () => {
    expect(printed).not.toBeNull();
  });

  it('computes the byte the page prints', async () => {
    const [, index = '', address = '', record = '', within = ''] = printed ?? [];
    const { header } = await openEdf(byteSource(BYTES));
    const resp = getSignal(header, 'Resp');
    expect(resp.samplesPerRecord).toBe(16);
    expect(byteOfSample(header, resp, Number(index))).toBe(Number(address));
    // The two halves of the division, which the comment states as the reason for the number.
    expect(Math.floor(Number(index) / resp.samplesPerRecord)).toBe(Number(record));
    expect(Number(index) % resp.samplesPerRecord).toBe(Number(within));
  });

  it('is the byte edfcore reads that sample from', async () => {
    const [, index = '', address = ''] = printed ?? [];
    const recording = await openEdf(byteSource(BYTES));
    const resp = getSignal(recording.header, 'Resp');
    const sampleIndex = Number(index);

    // Read the one record holding it and pick the sample out on the signal's own grid.
    const [chunk] = await readWindow(recording, {
      startSeconds: sampleIndex / resp.samplesPerRecord,
      durationSeconds: 1,
      signalIndices: [resp.index],
    });
    const within = sampleIndex % resp.samplesPerRecord;
    const value = chunk?.signals[0]?.digital[within];

    // Decode the two bytes at the printed address straight out of the file, little-endian two's
    // complement, the way the page's own `decodeEdfSample` does.
    const b0 = BYTES[Number(address)] ?? 0;
    const b1 = BYTES[Number(address) + 1] ?? 0;
    const raw = b0 | (b1 << 8);
    expect(value).toBe(raw & 0x8000 ? raw - 0x10000 : raw);
  });
});

describe('the record arithmetic the page states as four lines', () => {
  /**
   * The block itself, so the check fails if the page stops making these four claims:
   *
   *   bytesPerSample      = 2 for EDF, 3 for BDF
   *   recordByteLength    = bytesPerSample * SUM(samplesPerRecord[j] for all j)
   *   recordByteOffset[i] = bytesPerSample * SUM(samplesPerRecord[j] for j < i)
   *   fileOffset(r)       = headerByteLength + r * recordByteLength
   */
  it('is still the block the page prints', () => {
    const flat = PAGE.replace(/\s+/g, ' ');
    expect(flat).toContain('bytesPerSample = 2 for EDF, 3 for BDF');
    expect(flat).toContain(
      'recordByteLength = bytesPerSample * SUM(samplesPerRecord[j] for all j)',
    );
    expect(flat).toContain(
      'recordByteOffset[i] = bytesPerSample * SUM(samplesPerRecord[j] for j < i)',
    );
    expect(flat).toContain('fileOffset(r) = headerByteLength + r * recordByteLength');
  });

  // "Different signals may declare different counts, so one file can hold EEG at 256 samples per
  //  record alongside a temperature probe at 1." Both families, and a channel at 1.
  const SHAPES = [
    { format: 'EDF', counts: [256, 16, 1] },
    { format: 'BDF', counts: [256, 16, 1] },
    { format: 'EDF', counts: [1] },
    { format: 'BDF', counts: [64, 64, 64, 3, 7] },
  ] as const;

  for (const { format, counts } of SHAPES) {
    it(`holds for ${format} with ${counts.length} signal(s) at ${counts.join('/')}`, async () => {
      const bytes = buildEdf({
        format,
        recordCount: 4,
        recordDurationSeconds: 1,
        signals: counts.map((samplesPerRecord, index) => ({
          label: `S${index}`,
          samplesPerRecord,
        })),
      });
      const { header } = await openEdf(byteSource(bytes));

      expect(header.bytesPerSample).toBe(format === 'EDF' ? 2 : 3);

      const total = counts.reduce((sum, count) => sum + count, 0);
      expect(header.recordByteLength).toBe(header.bytesPerSample * total);

      let before = 0;
      counts.forEach((count, index) => {
        expect(getSignal(header, `S${index}`).recordByteOffset).toBe(
          header.bytesPerSample * before,
        );
        before += count;
      });

      // `fileOffset(r) = headerByteLength + r * recordByteLength`, ending exactly at the file end.
      for (let record = 0; record < header.recordCount; record += 1) {
        const offset = header.headerByteLength + record * header.recordByteLength;
        expect(offset).toBeLessThan(bytes.byteLength);
      }
      expect(header.headerByteLength + header.recordCount * header.recordByteLength).toBe(
        bytes.byteLength,
      );

      // "There is no sample-rate field in EDF … A rate is the quotient of the two."
      counts.forEach((count, index) => {
        expect(getSignal(header, `S${index}`).samplesPerRecord).toBe(count);
        expect(getSignal(header, `S${index}`).sampleRateHz).toBe(count / 1);
      });
    });
  }
});
