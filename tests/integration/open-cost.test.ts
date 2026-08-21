/**
 * What `openEdf` costs, against the table on `large-files.md`.
 *
 * The page opens with four rows — a read count and a byte count for each shape of file — and the
 * sentence they support is the reason anyone reaches for this library over reading the whole file:
 * "That is the entire cost, whatever the file size."
 *
 * A read count is not something a type or a lint can hold. It is a property of the call graph, and
 * it changes by accident: a helper that fetches a field it already has, a probe that stops
 * short-circuiting on a one-record file, a header read split per signal block. That last one is
 * the failure the page names outright — "It is never one read per signal block, a pattern that
 * costs 64 requests over HTTP on a 64-signal file" — and over HTTP it is the difference between
 * one round trip and sixty-four, on a call the caller believes is free.
 *
 * `tests/io/read-pattern.test.ts` owns the read pattern of the reading calls. This is the one call
 * that happens before any of them, checked against the published table rather than against a
 * number chosen here.
 */

import { describe, expect, it } from 'vitest';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf } from '../../src/recording.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { spySource } from '../support/spy-source.js';
import { buildEdf, minimalEdfPlus } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('large-files.md') ?? '';

/** The `| file | reads at open | bytes at open |` rows. */
const ROWS = (() => {
  const at = PAGE.indexOf('| file | reads at open | bytes at open |');
  if (at === -1) throw new Error('large-files.md no longer tabulates the cost of opening a file');
  const rows: string[][] = [];
  for (const line of PAGE.slice(at).split('\n')) {
    if (!line.startsWith('|')) break;
    rows.push(
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim()),
    );
  }
  return rows.slice(2);
})();

/** The declared read count for the row whose first cell starts with `shape`. */
function readsFor(shape: string): number {
  const row = ROWS.find((cells) => (cells[0] ?? '').startsWith(shape));
  if (row === undefined) throw new Error(`no row for ${JSON.stringify(shape)}`);
  return Number(row[1]);
}

/** Open `bytes` through a spy and hand back what it was asked for. */
async function opening(bytes: Uint8Array) {
  const spy = spySource(byteSource(bytes));
  const recording = await openEdf(spy);
  return { spy, recording };
}

const DATA_SIGNALS = [
  { label: 'Fp1', samplesPerRecord: 8 },
  { label: 'Fp2', samplesPerRecord: 8 },
] as const;

describe('the table of what opening costs', () => {
  it('has the four rows the page draws', () => {
    expect(ROWS).toHaveLength(4);
    expect(ROWS.map((cells) => cells[0])).toEqual([
      'plain EDF or BDF',
      'EDF+ or BDF+',
      'EDF+ or BDF+ with one record',
      'a file with zero records',
    ]);
  });

  it('opens a plain EDF in the two reads the first row allows', async () => {
    const { spy } = await opening(
      buildEdf({ recordCount: 40, recordDurationSeconds: 1, signals: [...DATA_SIGNALS] }),
    );
    expect(spy.reads).toHaveLength(readsFor('plain EDF'));
    // "A plain EDF or BDF is probed zero times", so both reads are header reads.
    expect(spy.reads.map((read) => read.offset)).toEqual([0, 256]);
  });

  it('reads exactly the header the first row prices, and nothing else', async () => {
    const bytes = buildEdf({
      recordCount: 40,
      recordDurationSeconds: 1,
      signals: [...DATA_SIGNALS],
    });
    const { spy, recording } = await opening(bytes);
    const total = spy.reads.reduce((sum, read) => sum + read.length, 0);
    // `256 * (signalCount + 1)`
    expect(total).toBe(256 * (recording.header.signals.length + 1));
    expect(total).toBe(recording.header.headerByteLength);
  });

  it('probes two records on an EDF+, as the second row says', async () => {
    const { spy, recording } = await opening(
      minimalEdfPlus({
        recordCount: 40,
        recordDurationSeconds: 1,
        signals: [...DATA_SIGNALS],
        annotationSignals: [{ samplesPerRecord: 30 }],
      }),
    );
    expect(spy.reads).toHaveLength(readsFor('EDF+ or BDF+'));
    // "The two extra reads on EDF+ are records 0 and n−1."
    const { headerByteLength, recordByteLength, recordCount } = recording.header;
    expect(spy.reads.slice(2).map((read) => read.offset)).toEqual([
      headerByteLength,
      headerByteLength + (recordCount - 1) * recordByteLength,
    ]);
    expect(spy.reads.slice(2).map((read) => read.length)).toEqual([
      recordByteLength,
      recordByteLength,
    ]);
  });

  it('probes once when there is only one record to probe', async () => {
    const { spy } = await opening(
      minimalEdfPlus({
        recordCount: 1,
        recordDurationSeconds: 1,
        signals: [...DATA_SIGNALS],
        annotationSignals: [{ samplesPerRecord: 30 }],
      }),
    );
    expect(spy.reads).toHaveLength(readsFor('EDF+ or BDF+ with one record'));
  });

  it('probes nothing when there are no records at all', async () => {
    const { spy } = await opening(
      minimalEdfPlus({
        recordCount: 0,
        recordDurationSeconds: 1,
        signals: [...DATA_SIGNALS],
        annotationSignals: [{ samplesPerRecord: 30 }],
      }),
    );
    expect(spy.reads).toHaveLength(readsFor('a file with zero records'));
  });
});

describe('the header read the page describes in prose', () => {
  it('stays two reads on a file with many signals, not one per block', async () => {
    // "It is never one read per signal block, a pattern that costs 64 requests over HTTP on a
    //  64-signal file."
    const signals = Array.from({ length: 64 }, (_unused, index) => ({
      label: `C${index}`,
      samplesPerRecord: 2,
    }));
    const { spy } = await opening(buildEdf({ recordCount: 4, recordDurationSeconds: 1, signals }));
    expect(spy.reads).toHaveLength(2);
    expect(spy.reads[1]?.length).toBe(256 * signals.length);
  });

  it('reads the computed header size, not the one the file declares', async () => {
    // "The size read is always the computed `256 * (ns + 1)`, not the byte-length field the header
    //  declares, which files get wrong."
    const bytes = buildEdf({
      recordCount: 4,
      recordDurationSeconds: 1,
      signals: [...DATA_SIGNALS],
      raw: { headerByteLength: '99999   ' },
    });
    const { spy } = await opening(bytes);
    expect(spy.reads).toHaveLength(2);
    expect(spy.reads[0]?.length).toBe(256);
    expect(spy.reads[1]?.length).toBe(256 * DATA_SIGNALS.length);
  });
});

describe('the file the page measured', () => {
  /**
   * "Measured on a 29,925,760-byte EDF+C (8 channels at 256 Hz, 7,200 one-second records,
   *  4,156-byte records)", rebuilt from that description.
   *
   * The annotation channel is not in the parenthesis and is implied by the record size: eight
   * channels at 256 samples is 4,096 bytes, and the page says 4,156, so 60 bytes of it are the
   * 30-sample annotation region an EDF+C must carry. That the assembled file comes out at exactly
   * the byte count in the sentence is the check that the description was read correctly.
   */
  const DESCRIBED =
    /Measured on a ([\d,]+)-byte EDF\+C \((\d+) channels at (\d+) Hz, ([\d,]+) one-second records, ([\d,]+)-byte\s+records\)/.exec(
      PAGE,
    );

  const digits = (text: string | undefined): number => Number((text ?? '').replaceAll(',', ''));

  const BYTES = (() => {
    const channels = digits(DESCRIBED?.[2]);
    const hz = digits(DESCRIBED?.[3]);
    return minimalEdfPlus({
      recordCount: digits(DESCRIBED?.[4]),
      recordDurationSeconds: 1,
      signals: Array.from({ length: channels }, (_unused, index) => ({
        label: `EEG ${index}`,
        samplesPerRecord: hz,
      })),
      annotationSignals: [{ samplesPerRecord: 30 }],
    });
  })();

  /**
   * The `{ offset, length }` lines of the `open reads:` block alone.
   *
   * Scoped to that block on purpose: the page prints the same shape again further down for the
   * eight-hour window, and a page-wide match picks those up and reports six reads for a call that
   * issues four.
   */
  const BLOCK = (() => {
    const at = PAGE.indexOf('open reads:');
    if (at === -1) throw new Error('large-files.md no longer prints the measured open reads');
    const end = PAGE.indexOf('```', at);
    return PAGE.slice(at, end === -1 ? undefined : end);
  })();

  const PRINTED_READS = [...BLOCK.matchAll(/\{ offset: (\d+), length: (\d+) \}/g)].map(
    ([, offset = '', length = '']) => ({ offset: Number(offset), length: Number(length) }),
  );

  /** `total: 10,872 bytes = 0.036 % of the file` */
  const TOTAL = /total: ([\d,]+) bytes = ([\d.]+) % of the file/.exec(BLOCK);

  it('describes a file that comes out at the size it names', () => {
    expect(DESCRIBED).not.toBeNull();
    expect(BYTES.byteLength).toBe(digits(DESCRIBED?.[1]));
  });

  it('has the record size the description implies', async () => {
    const { header } = await openEdf(byteSource(BYTES));
    expect(header.recordByteLength).toBe(digits(DESCRIBED?.[5]));
  });

  it('issues exactly the four reads the page prints, in order', async () => {
    expect(PRINTED_READS).toHaveLength(4);
    const spy = spySource(byteSource(BYTES));
    await openEdf(spy);
    expect(spy.reads.map((read) => ({ offset: read.offset, length: read.length }))).toEqual(
      PRINTED_READS,
    );
  });

  it('reads the total the page totals, and the fraction it works out', async () => {
    expect(TOTAL).not.toBeNull();
    const spy = spySource(byteSource(BYTES));
    await openEdf(spy);
    const total = spy.reads.reduce((sum, read) => sum + read.length, 0);
    expect(total).toBe(digits(TOTAL?.[1]));
    // Quoted to three decimals, so that is the agreement being asked for.
    expect(((total / BYTES.byteLength) * 100).toFixed(3)).toBe(Number(TOTAL?.[2]).toFixed(3));
  });

  it('never addresses the middle of the file, whatever its size', async () => {
    // The claim the four reads exist to support: "That is the entire cost, whatever the file size."
    const spy = spySource(byteSource(BYTES));
    const recording = await openEdf(spy);
    const last = spy.reads.at(-1);
    // The only byte past the header that is touched at all is in the first record and the last.
    const middle = spy.reads.filter(
      (read) =>
        read.offset > recording.header.headerByteLength + recording.header.recordByteLength &&
        read.offset < (last?.offset ?? 0),
    );
    expect(middle).toEqual([]);
  });
});

/**
 * The same four costs again, in prose, on `api-reading.md`.
 *
 * `large-files.md` states them as a table and `api-reading.md` states them as a sentence, and both
 * are read by someone deciding whether opening a file is cheap enough to do on a click. Two
 * statements of one fact in two forms is the shape this repository keeps finding wrong: the
 * section list in 0.3, the diagnostic tables in 0.3.39, the `ByteSource` interface in 0.4.338.
 *
 * The table is already checked against the library above. This checks the prose against the table,
 * so the three agree rather than two of them agreeing and a third drifting — and it is the cheaper
 * direction, because the prose spells its numbers as words and a reader cannot diff a word against
 * a digit by eye.
 */
describe('the same costs in prose on api-reading.md', () => {
  const PROSE = (DOCS_PAGES.get('api-reading.md') ?? '').replace(/\s+/g, ' ');

  const WORDS: ReadonlyMap<string, number> = new Map([
    ['zero', 0],
    ['one', 1],
    ['two', 2],
    ['three', 3],
    ['four', 4],
  ]);

  const spelled = (word: string | undefined): number =>
    WORDS.get((word ?? '').toLowerCase()) ?? Number.NaN;

  it('is still a sentence about read counts', () => {
    expect(PROSE).toContain('`openEdf` never scans the file');
  });

  it('gives a plain file the count the table gives it', () => {
    // "On a plain EDF or BDF it costs **two reads**"
    const match = /On a plain EDF or BDF it costs \*\*(\w+) reads\*\*/.exec(PROSE);
    expect(match).not.toBeNull();
    expect(spelled(match?.[1])).toBe(readsFor('plain EDF'));
  });

  it('gives an annotated file the count the table gives it', () => {
    // "On a file that carries an annotations signal it costs **four**"
    const match = /On a file that carries an annotations signal it costs \*\*(\w+)\*\*/.exec(PROSE);
    expect(match).not.toBeNull();
    expect(spelled(match?.[1])).toBe(readsFor('EDF+ or BDF+'));
  });

  it('gives a single-record file the count the table gives it', () => {
    // "A single-record file is probed once, for three reads total"
    const match = /A single-record file is probed once, for (\w+) reads total/.exec(PROSE);
    expect(match).not.toBeNull();
    expect(spelled(match?.[1])).toBe(readsFor('EDF+ or BDF+ with one record'));
  });

  it('agrees that a file with no records is not probed', () => {
    // "a file with no data records is not probed at all" — which is the header reads and no more.
    expect(PROSE).toContain('a file with no data records is not probed at all');
    expect(readsFor('a file with zero records')).toBe(readsFor('plain EDF'));
  });

  it('describes the two probes as the records the table charges for', () => {
    // "plus one whole data record at each end of the file … the timekeeping onsets of record 0
    //  and record `recordCount - 1`."
    expect(PROSE).toContain('one whole data record at each end of the file');
    expect(PROSE).toContain('record 0 and record `recordCount - 1`');
    expect(readsFor('EDF+ or BDF+') - readsFor('plain EDF')).toBe(2);
  });
});
