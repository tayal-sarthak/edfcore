/**
 * What is actually in each of the six columns `edfcore signals` prints.
 *
 * `cli.md` tabulates them by name and position, and ends the sixth row with the instruction the
 * whole command exists for: "the authoritative count; index by this, never by the rate". A script
 * reading this output is `cut -f6`. Nothing checked the contents — `cli.test.ts` asserts that
 * there are six columns and one line per signal, which is satisfied by six columns of anything.
 *
 * That is the exact shape of the defect the page records against itself: until 0.2.42 the page
 * claimed a column list the command did not emit — it described samples per record where the
 * command emitted `kind`, and the authoritative field was in no column at all. A count of six
 * would not have caught that either.
 *
 * Three of the rows carry a qualifier, and each is a separate way to be wrong:
 *
 *  - `sampleRateHz` is **empty** for a legal zero record duration. It is derived — `samples /
 *    seconds` — so on an annotations-only recording there is no rate to print, and printing
 *    `undefined`, `0` or `NaN` would each be a number a script would divide by.
 *  - `label` and `physicalDimension` are trimmed, but not by the same thing, and the difference
 *    shows on hostile text. The parser strips EDF padding (spaces and NULs) from both; the
 *    command additionally calls `String.trim` on the dimension, which reaches a tab, and passes
 *    the label through `printable`, which turns a tab into `.`. Either way the row keeps six
 *    columns, which is the property that matters in a format whose purpose is `cut`.
 *
 * The column ORDER is read out of the page rather than written here, so the two cannot drift.
 *
 * What this does NOT check: exit codes, the other five commands, or the flags. Those are
 * `cli.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { type CliIo, parseArgs, runCli } from '../../src/cli-run.js';
import { parseHeader } from '../../src/header/parse.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('cli.md') ?? '';

/** The column table, read out of the page: `| 1 | \`index\` | |`. */
const COLUMNS: readonly string[] = (() => {
  const at = PAGE.indexOf('| # | Column | Note |');
  if (at === -1) throw new Error('cli.md no longer tabulates the signals columns');
  const names: string[] = [];
  for (const line of PAGE.slice(at).split('\n').slice(2)) {
    if (!line.startsWith('|')) break;
    const cells = line.slice(1, -1).split('|');
    const position = Number((cells[0] ?? '').trim());
    if (!Number.isInteger(position)) break;
    names.push((cells[1] ?? '').trim().replaceAll('`', ''));
  }
  return names;
})();

async function signalsOf(bytes: Uint8Array): Promise<string[][]> {
  let out = '';
  const io: CliIo = {
    readFile: async () => bytes,
    out: (text) => {
      out += text;
    },
    err: () => {},
  };
  const code = await runCli(parseArgs(['signals', 'a.edf']), io);
  expect(code).toBe(0);
  return out
    .trim()
    .split('\n')
    .map((line) => line.split('\t'));
}

describe('the column list', () => {
  it('is the six the page tabulates, in the page’s order', () => {
    expect(COLUMNS).toEqual([
      'index',
      'label',
      'kind',
      'sampleRateHz',
      'physicalDimension',
      'samplesPerRecord',
    ]);
  });
});

describe('every column carries the field the page names', () => {
  // Two data signals with different sample counts and different units, plus the annotations
  // channel — which the page says is included. Equal counts would let two columns be swapped
  // without either row changing.
  const bytes = buildEdf({
    format: 'EDF',
    plus: 'C',
    recordCount: 2,
    recordDurationSeconds: 2,
    signals: [
      { label: 'Fp1', samplesPerRecord: 8, physicalDimension: 'uV' },
      { label: 'Resp', samplesPerRecord: 3, physicalDimension: 'mV' },
    ],
    annotationSignals: [{ samplesPerRecord: 16 }],
  });
  const header = parseHeader(bytes, bytes.byteLength);

  it('reads back the header, field by field, for every signal', async () => {
    const rows = await signalsOf(bytes);
    expect(rows).toHaveLength(header.signals.length);

    for (const [position, signal] of header.signals.entries()) {
      const row = rows[position];
      expect(row, `no row for signal ${position}`).toBeDefined();
      if (row === undefined) continue;
      expect(row[COLUMNS.indexOf('index')]).toBe(String(signal.index));
      expect(row[COLUMNS.indexOf('label')]).toBe(signal.label);
      expect(row[COLUMNS.indexOf('kind')]).toBe(signal.kind);
      expect(row[COLUMNS.indexOf('sampleRateHz')]).toBe(String(signal.sampleRateHz));
      expect(row[COLUMNS.indexOf('physicalDimension')]).toBe(signal.physicalDimension);
      expect(row[COLUMNS.indexOf('samplesPerRecord')]).toBe(String(signal.samplesPerRecord));
    }
  });

  it('separates the two data signals, so no two columns could be swapped unnoticed', async () => {
    const rows = await signalsOf(bytes);
    // 8 samples over 2 s is 4 Hz; 3 over 2 s is 1.5. Distinct from each other, from the sample
    // counts, and from the indices.
    expect(rows[0]).toEqual(['0', 'Fp1', 'data', '4', 'uV', '8']);
    expect(rows[1]).toEqual(['1', 'Resp', 'data', '1.5', 'mV', '3']);
    expect(rows[2]?.[2]).toBe('annotations');
  });
});

describe('the rate column on a legal zero record duration', () => {
  // EDF+ uses a zero record duration for a recording whose records carry annotations and nothing
  // else. There is no rate to print, and printing `undefined`, `0` or `NaN` would each be a
  // number a script divides by.
  const bytes = buildEdf({
    format: 'EDF',
    recordCount: 2,
    recordDurationSeconds: 0,
    signals: [
      { label: 'Fp1', samplesPerRecord: 8 },
      { label: 'Resp', samplesPerRecord: 3 },
    ],
  });

  it('is empty, and the authoritative count beside it is not', async () => {
    const rows = await signalsOf(bytes);
    const rate = COLUMNS.indexOf('sampleRateHz');
    const count = COLUMNS.indexOf('samplesPerRecord');
    for (const row of rows) {
      expect(row).toHaveLength(COLUMNS.length);
      expect(row[rate]).toBe('');
    }
    expect(rows.map((row) => row[count])).toEqual(['8', '3']);
  });
});

describe('a hostile label or dimension keeps the row six columns wide', () => {
  // A label is arbitrary bytes, and in a tab-separated listing a tab in one shifts every field
  // after it for that row alone — so column 6 hands a script a physical dimension where it
  // expected a sample count, with no error, and only on the file that has the problem (0.3.2).
  const bytes = buildEdf({
    format: 'EDF',
    recordCount: 1,
    recordDurationSeconds: 1,
    signals: [
      { label: 'Fp1\tFp2', samplesPerRecord: 8, physicalDimension: 'uV' },
      { label: 'Resp', samplesPerRecord: 3, raw: { physicalDimension: '\tmV     ' } },
    ],
  });

  it('replaces the tab in a label rather than letting it become a separator', async () => {
    const rows = await signalsOf(bytes);
    for (const row of rows) expect(row).toHaveLength(COLUMNS.length);
    expect(rows[0]?.[COLUMNS.indexOf('label')]).toBe('Fp1.Fp2');
    expect(rows[0]?.[COLUMNS.indexOf('samplesPerRecord')]).toBe('8');
  });

  it('trims a tab off a dimension, which the padding rule does not reach', async () => {
    const rows = await signalsOf(bytes);
    expect(rows[1]?.[COLUMNS.indexOf('physicalDimension')]).toBe('mV');
    expect(rows[1]?.[COLUMNS.indexOf('samplesPerRecord')]).toBe('3');
  });
});
