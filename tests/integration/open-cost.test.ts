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
