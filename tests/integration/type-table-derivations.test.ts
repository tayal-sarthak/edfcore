/**
 * The third column of the `EdfHeader` and `EdfSignal` tables, executed.
 *
 * `type-tables.test.ts` checks that both tables list every member of their interface, in
 * declaration order. That settles the first column. The third is where the tables do their real
 * work — most rows do not describe a field, they DERIVE it: `dataByteLength` is
 * `recordCount * recordByteLength`, `sampleCount` is `samplesPerRecord * header.recordCount`,
 * `sampleRateHz` is `undefined` "exactly when that duration is `0`", `recordByteOffset` is an
 * offset "within one data record" rather than within the file. None of that had been run.
 *
 * A wrong rule here is worse than a missing one. These are the sentences a reader uses instead of
 * measuring: someone who believes `recordByteOffset` is a file offset writes a seek that lands in
 * the header, and someone who divides by `sampleRateHz` because the table did not say it can be
 * `undefined` gets `Infinity` on a legal annotations-only recording.
 *
 * Each rule below is asserted twice: that the page still states it, quoting the row's own words,
 * and that the library obeys it. Quoting is what makes the pair meaningful — a rule reworded on
 * the page fails here rather than drifting away from a test that only knows the behaviour.
 *
 * The fixture is a three-signal BDF+D file. Three signals with three different sample counts, so
 * a running-sum offset cannot be confused with a fixed stride; BDF so `bytesPerSample` is 3 and
 * every byte rule multiplies by something other than 1 or 2; `+D` so `continuity` is the one
 * value the table calls out.
 *
 * What this does NOT check: the second column. `documented-signatures.test.ts` and the type tests
 * under `tests/types/` are about the types themselves.
 */

import { describe, expect, it } from 'vitest';
import { parseHeader } from '../../src/header/parse.js';
import type { EdfHeader, EdfSignal } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('api-types.md') ?? '';

/** The page as one line: a table row is one line, but the prose around it wraps. */
const PROSE = PAGE.replace(/\s+/g, ' ');

/**
 * The `meaning` cell of one row, so a rule can be quoted rather than paraphrased.
 *
 * Scoped to a `### heading`, because `recordByteLength` is a row in BOTH tables and means
 * different things in each. Cells are split on an UNESCAPED pipe: a type cell writes a union as
 * `number \| undefined`, and splitting on every pipe puts the rest of that row in the wrong cell.
 */
function meaningOf(heading: string, field: string): string {
  const lines = PAGE.split('\n');
  const from = lines.findIndex((line) => line.trim() === `### ${heading}`);
  if (from === -1) throw new Error(`api-types.md has no ${heading} section`);
  const to = lines.findIndex((line, at) => at > from && line.startsWith('### '));
  const row = lines
    .slice(from, to === -1 ? lines.length : to)
    .find((line) => line.startsWith(`| \`${field}\` |`));
  if (row === undefined) throw new Error(`${heading} has no row for ${field}`);
  const cells = row.split(/(?<!\\)\|/);
  return (cells[3] ?? '').trim();
}

function says(heading: string, field: string, fragment: string): void {
  expect(meaningOf(heading, field), `the ${heading}.${field} row no longer says this`).toContain(
    fragment,
  );
}

const headerSays = (field: string, fragment: string): void => says('EdfHeader', field, fragment);
const signalSays = (field: string, fragment: string): void => says('EdfSignal', field, fragment);

const BYTES = buildEdf({
  format: 'BDF',
  plus: 'D',
  recordCount: 5,
  recordDurationSeconds: 2,
  recordOnsetSeconds: (recordIndex) => (recordIndex < 3 ? recordIndex * 2 : recordIndex * 2 + 9),
  signals: [
    { label: 'Fp1  ', samplesPerRecord: 8, physicalDimension: 'µV' },
    { label: 'Resp', samplesPerRecord: 3, physicalDimension: 'mV' },
  ],
  annotationSignals: [{ samplesPerRecord: 24 }],
});
const HEADER: EdfHeader = parseHeader(BYTES, BYTES.byteLength);

function signalAt(index: number): EdfSignal {
  const signal = HEADER.signals[index];
  if (signal === undefined) throw new Error(`fixture has no signal ${index}`);
  return signal;
}

describe('the EdfHeader table derives what it says it derives', () => {
  it('makes continuity discontinuous only for the +D dialects', () => {
    headerSays('continuity', "`'discontinuous'` only for `EDF+D` and `BDF+D`");
    const variants: ReadonlyArray<[false | 'C' | 'D', string]> = [
      [false, 'continuous'],
      ['C', 'continuous'],
      ['D', 'discontinuous'],
    ];
    for (const format of ['EDF', 'BDF'] as const) {
      for (const [plus, continuity] of variants) {
        const bytes = buildEdf({
          format,
          plus,
          recordCount: 2,
          recordDurationSeconds: 1,
          signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
          ...(plus === false ? {} : { annotationSignals: [{ samplesPerRecord: 16 }] }),
        });
        expect(parseHeader(bytes, bytes.byteLength).continuity, `${format}+${plus}`).toBe(
          continuity,
        );
      }
    }
  });

  it('decides bytesPerSample by the version block alone', () => {
    headerSays('bytesPerSample', 'decided by the version block alone');
    expect(HEADER.bytesPerSample).toBe(3);
    // A BDF version block under an EDF+ reserved marker is still three bytes a sample. Reading
    // it as two corrupts every value in the file, so the reserved field does not get a vote.
    const bytes = buildEdf({
      format: 'BDF',
      plus: 'C',
      recordCount: 1,
      recordDurationSeconds: 1,
      signals: [{ label: 'Fp1', samplesPerRecord: 4 }],
      annotationSignals: [{ samplesPerRecord: 16 }],
      raw: { reserved: 'EDF+C' },
    });
    expect(parseHeader(bytes, bytes.byteLength).bytesPerSample).toBe(3);
  });

  it('computes the header size and keeps the declared one beside it', () => {
    headerSays('headerByteLength', 'never the declared value');
    headerSays('declaredHeaderByteLength', 'byte offset 184');
    expect(HEADER.headerByteLength).toBe(256 * (HEADER.signals.length + 1));
    expect(HEADER.declaredHeaderByteLength).toBe(HEADER.headerByteLength);
  });

  it('sums the record length over all signals, annotations channel included', () => {
    headerSays('recordByteLength', 'summed over all signals');
    const summed = HEADER.signals.reduce(
      (total, signal) => total + signal.samplesPerRecord * HEADER.bytesPerSample,
      0,
    );
    expect(HEADER.recordByteLength).toBe(summed);
    expect(summed).toBe((8 + 3 + 24) * 3);
  });

  it('multiplies the record length by the record count for dataByteLength', () => {
    headerSays('dataByteLength', '`recordCount * recordByteLength`');
    expect(HEADER.dataByteLength).toBe(HEADER.recordCount * HEADER.recordByteLength);
    expect(BYTES.byteLength).toBe(HEADER.headerByteLength + HEADER.dataByteLength);
  });

  it('keeps every signal in file order and partitions them by kind', () => {
    headerSays('signals', 'in file order, annotation channels included');
    headerSays('dataSignalIndices', "whose `kind` is `'data'`");
    headerSays('annotationSignalIndices', "indices whose `kind` is `'annotations'`");
    expect(HEADER.signals.map((signal) => signal.index)).toEqual([0, 1, 2]);
    expect(HEADER.dataSignalIndices).toEqual([0, 1]);
    expect(HEADER.annotationSignalIndices).toEqual([2]);
    // A partition, not two filters that happen to agree: every index once, none twice.
    expect([...HEADER.dataSignalIndices, ...HEADER.annotationSignalIndices].sort()).toEqual([
      0, 1, 2,
    ]);
  });

  it('keeps the reserved field whole, padding included', () => {
    headerSays('reserved', 'the full 44 reserved bytes, verbatim, padding included');
    expect(HEADER.reserved).toHaveLength(44);
    expect(HEADER.reserved.startsWith('BDF+D')).toBe(true);
    expect(HEADER.reserved.endsWith(' ')).toBe(true);
  });

  it('keeps the whole header in rawBytes', () => {
    headerSays('rawBytes', 'the whole header');
    expect(HEADER.rawBytes).toHaveLength(HEADER.headerByteLength);
    expect(Array.from(HEADER.rawBytes)).toEqual(
      Array.from(BYTES.subarray(0, HEADER.headerByteLength)),
    );
  });

  it('resolves the record count and keeps the declared one verbatim', () => {
    headerSays('recordCount', 'resolved and non-negative');
    headerSays('declaredRecordCount', '`-1` means the writer never closed the file');
    expect(HEADER.recordCount).toBe(5);
    expect(HEADER.declaredRecordCount).toBe(5);
    expect(HEADER.recordCountSource).toBe('headerField');

    const unclosed = buildEdf({
      format: 'BDF',
      recordCount: 5,
      recordDurationSeconds: 2,
      signals: [{ label: 'Fp1', samplesPerRecord: 8 }],
      raw: { recordCount: '-1' },
    });
    const header = parseHeader(unclosed, unclosed.byteLength);
    expect(header.declaredRecordCount).toBe(-1);
    expect(header.recordCount).toBe(5);
    expect(header.recordCount).toBeGreaterThanOrEqual(0);
    expect(header.recordCountSource).toBe('sourceByteLength');
  });
});

describe('the EdfSignal table derives what it says it derives', () => {
  it('numbers each signal by its position in header.signals', () => {
    signalSays('index', 'position in `header.signals`');
    for (const [position, signal] of HEADER.signals.entries()) {
      expect(signal.index).toBe(position);
    }
  });

  it('trims label and dimension, and keeps the padding on raw', () => {
    signalSays('label', 'trimmed; `raw.label` keeps the padding');
    signalSays('physicalDimension', 'the unit, trimmed; `raw.physicalDimension` keeps the padding');
    expect(signalAt(0).label).toBe('Fp1');
    expect(signalAt(0).raw.label).toBe('Fp1'.padEnd(16, ' '));
    expect(signalAt(1).physicalDimension).toBe('mV');
    expect(signalAt(1).raw.physicalDimension).toBe('mV'.padEnd(8, ' '));
  });

  it('collapses every spelling of micro in unit and in nothing else', () => {
    signalSays('unit', 'every spelling of micro collapsed to `u`');
    // U+00B5 MICRO SIGN went into the fixture; the trimmed dimension keeps it and `unit` does not.
    expect(signalAt(0).physicalDimension).toBe('µV');
    expect(signalAt(0).unit).toBe('uV');
    expect(signalAt(1).unit).toBe('mV');
  });

  it('counts samples per record times records, and sizes the block by the sample width', () => {
    signalSays('samplesPerRecord', 'authoritative');
    signalSays('sampleCount', '`samplesPerRecord * header.recordCount`');
    signalSays('recordByteLength', '`samplesPerRecord * header.bytesPerSample`');
    for (const signal of HEADER.signals) {
      expect(signal.sampleCount).toBe(signal.samplesPerRecord * HEADER.recordCount);
      expect(signal.recordByteLength).toBe(signal.samplesPerRecord * HEADER.bytesPerSample);
    }
    expect(signalAt(0).sampleCount).toBe(40);
    expect(signalAt(0).recordByteLength).toBe(24);
  });

  it('offsets each block within one data record, not within the file', () => {
    signalSays('recordByteOffset', 'within one data record');
    let running = 0;
    for (const signal of HEADER.signals) {
      expect(signal.recordByteOffset).toBe(running);
      running += signal.recordByteLength;
    }
    expect(running).toBe(HEADER.recordByteLength);
    // The first offset is 0, which a file offset never is — the header is in front of it.
    expect(signalAt(0).recordByteOffset).toBe(0);
  });

  it('derives the rate, and leaves it undefined exactly when the duration is zero', () => {
    signalSays('sampleRateHz', '`undefined` exactly when that duration is `0`');
    for (const signal of HEADER.signals) {
      expect(signal.sampleRateHz).toBe(signal.samplesPerRecord / HEADER.recordDurationSeconds);
    }
    expect(signalAt(0).sampleRateHz).toBe(4);
    expect(signalAt(1).sampleRateHz).toBe(1.5);

    const zero = buildEdf({
      format: 'BDF',
      recordCount: 2,
      recordDurationSeconds: 0,
      signals: [
        { label: 'Fp1', samplesPerRecord: 8 },
        { label: 'Resp', samplesPerRecord: 3 },
      ],
    });
    const header = parseHeader(zero, zero.byteLength);
    // "Exactly when": every signal, not merely the one that was looked at.
    expect(header.signals.map((signal) => signal.sampleRateHz)).toEqual([undefined, undefined]);
    // And the authoritative count is untouched by the missing rate.
    expect(header.signals.map((signal) => signal.samplesPerRecord)).toEqual([8, 3]);
  });

  it('says a physical maximum may be below the minimum, and reads one back', () => {
    signalSays('physicalMaximum', '**may be below the minimum**');
    expect(PROSE).toContain('edfcore never swaps the two');
    const inverted = buildEdf({
      format: 'BDF',
      recordCount: 1,
      recordDurationSeconds: 1,
      signals: [{ label: 'Inv', samplesPerRecord: 4, physicalMinimum: 500, physicalMaximum: -500 }],
    });
    const signal = parseHeader(inverted, inverted.byteLength).signals[0];
    expect(signal?.physicalMinimum).toBe(500);
    expect(signal?.physicalMaximum).toBe(-500);
    expect(signal?.scale?.bitValue).toBeLessThan(0);
  });
});
