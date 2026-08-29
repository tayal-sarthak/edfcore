/**
 * The running example on `api-types.md`, built and run.
 *
 * That page documents the type surface by showing one file's values: a six-record EDF+D with a gap,
 * 2,328 bytes, whose fields appear in nine separate snippets across the page. Between them they
 * state a byte offset, a byte length, a tick count, a seconds-since-midnight, a sample count and
 * the shape `locate` returns on both sides of a gap.
 *
 * `type-tables.test.ts` checks the TABLES on that page — that every field a table lists exists on
 * the type, with the type it claims. The snippets between the tables are the other half, and they
 * are where the numbers live. A reader who wants to know what `chunk.byteOffset` means reads
 * `1548`, not the row that says `number`.
 *
 * Nine snippets, one file. That is what makes it worth building once and asserting against: the
 * page's internal consistency is itself a claim — `1548` is `768 + 3 * 260`, and every one of
 * those three numbers is printed somewhere else on the same page. A fixture that reproduces the
 * geometry checks the arithmetic between the snippets as well as each snippet against the library.
 *
 * Every value is read out of the page, so neither side can drift.
 */

import { describe, expect, it } from 'vitest';
import { formatStartTimeNaive } from '../../src/header/dates.js';
import { getSignal } from '../../src/header/lookup.js';
import { inspectEdf } from '../../src/inspect.js';
import { byteSource } from '../../src/io/bytes.js';
import { buildRecordIndex } from '../../src/record-index.js';
import { openEdf, readRecords } from '../../src/recording.js';
import type { EdfRecordIndex, EdfRecording } from '../../src/types.js';
import { DOCS_PAGES } from '../support/docs-pages.js';
import { buildEdf } from '../support/writer.js';

const PAGE = DOCS_PAGES.get('api-types.md') ?? '';

/** `header.recordCount;  // 6 — resolved` -> 6. */
const shows = (expression: string): string =>
  new RegExp(`${expression.replace(/[.()[\]*+?^$|\\]/g, '\\$&')};\\s*//\\s*([^\\n]+)`)
    .exec(PAGE)?.[1]
    ?.trim() ?? '';

const number = (expression: string): number => Number(/^-?[\d.]+/.exec(shows(expression))?.[0]);

/**
 * The page's file: an EDF+D of six one-second records with a three-record gap, one 100-sample
 * data signal and a 30-sample annotation region — 260 bytes a record, 768 of header, 2,328 in all.
 */
const FILE = buildEdf({
  plus: 'D',
  recordCount: 6,
  recordDurationSeconds: 1,
  startTime: '22.30.00',
  startDate: '02.03.02',
  recordingId: 'Startdate 02-MAR-2002 X X X',
  // The declared range the page's own values imply. `signal.scale` prints a bitValue of
  // 0.1221001221001221 and `signal.raw.digitalMinimum` prints '-2048   ', which is 500 uV over
  // 4,095 digital steps and nothing else; the conventions paragraph at the top of the page uses
  // the same -2048 as its example of a raw field. Until 0.5.6 this fixture took the writer's
  // defaults, so those two lines of the block described a different file from the other five.
  signals: [
    {
      label: 'EEG Fpz-Cz',
      samplesPerRecord: 100,
      physicalMinimum: -250,
      physicalMaximum: 250,
      digitalMinimum: -2048,
      digitalMaximum: 2047,
    },
  ],
  annotationSignals: [
    {
      samplesPerRecord: 30,
      tals: (record: number) =>
        record === 1 ? [{ onset: 1.5, duration: 0.25, texts: ['Lights off'] }] : [],
    },
  ],
  recordOnsetSeconds: (record: number) => (record < 3 ? record : record + 10),
});

async function opened(): Promise<EdfRecording> {
  return openEdf(byteSource(FILE));
}

async function scanned(): Promise<{ recording: EdfRecording; index: EdfRecordIndex }> {
  const recording = await opened();
  return { recording, index: await buildRecordIndex(recording) };
}

describe('the page was read', () => {
  it('found the values it prints, so a passing run is not a vacuous one', () => {
    expect(shows('header.recordCount')).not.toBe('');
    expect(shows('inspection.byteLength')).not.toBe('');
    expect(shows('chunk.byteOffset')).not.toBe('');
    expect(number('header.recordCount')).toBe(6);
  });
});

describe('the header', () => {
  it('has the geometry every other number on the page is arithmetic on', async () => {
    const { header } = await opened();

    expect(header.variant).toBe('EDF+D');
    expect(header.continuity).toBe('discontinuous');
    expect(header.recordCount).toBe(number('header.recordCount'));
    expect(header.headerByteLength).toBe(number('header.headerByteLength'));
    expect(header.declaredHeaderByteLength).toBe(number('header.declaredHeaderByteLength'));
    expect(header.declaredRecordCount).toBe(number('header.declaredRecordCount'));
    expect(header.recordCountSource).toBe('headerField');
  });

  it('describes its data signal the way the page does', async () => {
    const { header } = await opened();
    const signal = getSignal(header, 'EEG Fpz-Cz');

    expect(signal.index).toBe(number('signal.index'));
    expect(signal.kind).toBe('data');
    expect(signal.samplesPerRecord).toBe(number('signal.samplesPerRecord'));
    expect(signal.sampleRateHz).toBe(number('signal.sampleRateHz'));
    // "samplesPerRecord * header.recordCount", asserted as the product as well as the value.
    expect(signal.sampleCount).toBe(number('signal.sampleCount'));
    expect(signal.sampleCount).toBe(signal.samplesPerRecord * header.recordCount);
  });

  it('derives the gain the page prints, from the range the page prints', async () => {
    const { header } = await opened();
    const signal = getSignal(header, 'EEG Fpz-Cz');

    // The pinned expression, re-derived here from the declared fields rather than compared with
    // a recorded float: `bitValue` is what a reader checks their own port against, and copying
    // the page's digits into the test would make the two agree without either being right.
    const bitValue =
      (signal.physicalMaximum - signal.physicalMinimum) /
      (signal.digitalMaximum - signal.digitalMinimum);
    const offset = signal.physicalMaximum / bitValue - signal.digitalMaximum;
    expect(signal.scale).toEqual({ bitValue, offset });

    const printed = shows('signal.scale');
    expect(printed).toBe(`{ bitValue: ${bitValue}, offset: ${offset} }`);
  });

  it('keeps the raw digital minimum the page prints, padding included', async () => {
    const { header } = await opened();
    const signal = getSignal(header, 'EEG Fpz-Cz');

    // Quoted on the page twice: here, and in the conventions paragraph that introduces the
    // "exposed twice" rule with this exact field as its example.
    expect(`'${signal.raw.digitalMinimum}'`).toBe(shows('signal.raw.digitalMinimum'));
    expect(signal.digitalMinimum).toBe(-2048);
    // NOT whitespace-collapsed: the padding inside the quotes is the whole point of the
    // sentence, and collapsing it turns `'-2048   '` into `'-2048 '` before the comparison.
    expect(PAGE.replace(/\n/g, ' ')).toContain(
      "`signal.digitalMinimum` is `-2048`; `signal.raw.digitalMinimum` is `'-2048   '`",
    );
  });

  it('carries the start time as fields, never as a Date', async () => {
    const { header } = await opened();
    const { startTime } = header;

    expect(startTime.clock).toEqual({ hour: 22, minute: 30, second: 0 });
    expect(startTime.secondsSinceMidnight).toBe(number('startTime.secondsSinceMidnight'));
    expect(startTime.dateSource).toBe('recordingIdField');
    expect(startTime.resolvedDate).toEqual({ year: 2002, month: 3, day: 2 });
    expect(`'${formatStartTimeNaive(startTime)}'`).toBe(
      /formatStartTimeNaive\(startTime\);\s*\/\/\s*('[^']+')/.exec(PAGE)?.[1],
    );
  });
});

describe('the scanned index', () => {
  it('answers on both sides of the gap the way the page shows', async () => {
    const { index } = await scanned();

    expect(index.coverage).toBe('complete');
    expect(index.segments).toHaveLength(2);
    expect(index.gaps).toHaveLength(1);

    const ticks = /await index\.onsetTicks\(3\);\s*\/\/\s*(\d+)n/.exec(PAGE)?.[1];
    expect(await index.onsetTicks(3)).toBe(BigInt(ticks as string));
    // "undefined — that second is inside the gap".
    expect(await index.locate(12.5)).toBeUndefined();
    expect(await index.locate(13)).toMatchObject({
      recordIndex: 3,
      recordStartSeconds: 13,
      offsetInRecordSeconds: 0,
    });
  });
});

describe('a chunk read by record', () => {
  it('reports the offset and length the page prints', async () => {
    const { recording, index } = await scanned();
    const chunk = await readRecords(
      { ...recording, index },
      { records: { start: 3, count: 1 }, signalIndices: [0] },
    );

    expect(chunk.records).toEqual({ start: 3, count: 1 });
    expect(chunk.startSeconds).toBe(number('chunk.startSeconds'));
    expect(chunk.durationSeconds).toBe(number('chunk.durationSeconds'));
    expect(chunk.byteOffset).toBe(number('chunk.byteOffset'));
    expect(chunk.byteLength).toBe(number('chunk.byteLength'));
    // The page's own arithmetic, between three snippets: 768 + 3 * 260.
    expect(chunk.byteOffset).toBe(
      number('header.headerByteLength') + 3 * recording.header.recordByteLength,
    );
  });
});

describe('triage over the same file', () => {
  it('costs the header and says the size, as the page prints', async () => {
    const inspection = await inspectEdf(byteSource(FILE));

    expect(inspection.ok).toBe(true);
    expect(inspection.variant).toBe('EDF+D');
    expect(inspection.byteLength).toBe(number('inspection.byteLength'));
    expect(inspection.bytesRead).toBe(number('inspection.bytesRead'));
    // And the size really is the file's, which is what makes the two numbers comparable.
    expect(inspection.byteLength).toBe(FILE.byteLength);
    expect(inspection.bytesRead).toBe(number('header.headerByteLength'));
  });
});
