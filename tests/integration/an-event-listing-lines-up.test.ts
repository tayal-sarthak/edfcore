/**
 * Every row of an event listing puts its text in the same place.
 *
 * `formatAnnotations` padded the duration to twelve characters and did not pad the onset at all,
 * which works for exactly as long as every time is twelve characters. Two documented cases are not.
 *
 * A NEGATIVE onset spends one character on the sign. The note at the top of that file argues at
 * length that a negative onset is legal — EDF+ measures from the header start time and a recording
 * may begin after its first annotation — and 0.3.45 exists to print one correctly. It is also how a
 * pre-stimulus baseline is spelled, so it sorts before everything: the misaligned row was usually
 * the first one.
 *
 * A recording past 100 HOURS does it too. The hours are deliberately not wrapped at 24 — the same
 * docblock says "a 30-hour recording is a real thing and `30:12:00.000` is more useful than
 * `06:12:00.000` on day two" — and long-term epilepsy monitoring runs for a week, which is
 * `168:00:00.000`. A duration that long overflows the padded column outright.
 *
 * Same defect as the sample rate (0.6.23) and the signal index (0.6.24): a value wider than the
 * width it was given. Same fix: the width comes from the rows being printed. And the same property
 * checks it, because the property is what survives the next column.
 */

import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../../src/constants.js';
import { formatAnnotations } from '../../src/format-annotations.js';
import { byteSource } from '../../src/io/bytes.js';
import { openEdf, readAnnotations } from '../../src/recording.js';
import type { EdfAnnotation } from '../../src/types.js';
import { AWKWARD } from '../support/awkward-files.js';

function event(onsetSeconds: number, text: string, durationSeconds?: number): EdfAnnotation {
  const ticks = BigInt(Math.round(onsetSeconds * Number(TICKS_PER_SECOND)));
  return {
    onsetSecondsFromHeaderStart: onsetSeconds,
    onsetSecondsFromFirstRecord: onsetSeconds,
    onsetTicks: ticks,
    onsetTicksFromFirstRecord: ticks,
    onsetRaw: `${onsetSeconds}`,
    durationSeconds,
    durationTicks:
      durationSeconds === undefined
        ? undefined
        : BigInt(Math.round(durationSeconds * Number(TICKS_PER_SECOND))),
    durationRaw: durationSeconds === undefined ? undefined : `${durationSeconds}`,
    text,
    channelLabel: undefined,
    signalIndex: 1,
    recordIndex: 0,
    byteOffsetInRecord: 0,
    textEncoding: 'utf-8',
  } as EdfAnnotation;
}

/** Where each row's text begins, given the texts that went in. */
function textColumns(listing: string, texts: readonly string[]): readonly number[] {
  const rows = listing.split('\n');
  expect(rows).toHaveLength(texts.length);
  return rows.map((row, index) => row.indexOf(texts[index] as string));
}

const HOUR = 3600;

describe('the cases that used to move a row', () => {
  it('a pre-stimulus baseline, which sorts first', () => {
    const texts = ['baseline', 'stimulus', 'response'];
    const listing = formatAnnotations([
      event(-1.5, 'baseline'),
      event(0, 'stimulus', 30),
      event(1.25, 'response'),
    ]);
    expect(listing).toContain('-00:00:01.500');
    expect(new Set(textColumns(listing, texts)).size).toBe(1);
  });

  it('a week of long-term monitoring, where the hours are three digits', () => {
    const texts = ['start', 'day five', 'end'];
    const listing = formatAnnotations([
      event(1, 'start', 2),
      event(100 * HOUR + 61, 'day five', 3),
      event(200 * HOUR, 'end'),
    ]);
    expect(listing).toContain('100:01:01.000');
    expect(new Set(textColumns(listing, texts)).size).toBe(1);
  });

  it('a duration longer than the column it was given', () => {
    const texts = ['whole study', 'blip'];
    const listing = formatAnnotations([event(0, 'whole study', 100 * HOUR), event(5, 'blip', 1)]);
    expect(listing).toContain('100:00:00.000');
    expect(new Set(textColumns(listing, texts)).size).toBe(1);
  });

  it('all three at once, which is one listing with two wide columns', () => {
    const texts = ['before', 'long', 'after'];
    const listing = formatAnnotations([
      event(-0.25, 'before'),
      event(150 * HOUR, 'long', 120 * HOUR),
      event(151 * HOUR, 'after'),
    ]);
    expect(new Set(textColumns(listing, texts)).size).toBe(1);
  });
});

describe('an ordinary listing', () => {
  it('is byte for byte what it was, which is what the floor of twelve is for', () => {
    // Twelve is `hh:mm:ss.mmm`, and the widths only grow past it. A listing whose times all fit
    // must not move, or every snapshot of this output in the world would.
    const listing = formatAnnotations([
      event(0, 'Sleep stage W', 30),
      event(30, 'Sleep stage 1', 30),
    ]);
    expect(listing).toBe(
      '00:00:00.000  00:00:30.000  Sleep stage W\n00:00:30.000  00:00:30.000  Sleep stage 1',
    );
  });

  it('is unchanged when every event is instantaneous, so the duration column holds its place', () => {
    const listing = formatAnnotations([event(0, 'a'), event(1, 'b')]);
    expect(listing).toBe('00:00:00.000                a\n00:00:01.000                b');
  });
});

describe('over the matrix', () => {
  it('is the seventeen shapes it was written against', () => {
    expect(AWKWARD).toHaveLength(17);
  });

  it.each(AWKWARD)('$name lines its events up', async ({ bytes }) => {
    const recording = await openEdf(byteSource(bytes));
    const { annotations } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });
    const listing = formatAnnotations(annotations);
    if (listing === '') return;

    // Read off the rendered rows rather than from the texts, because a real file's events may
    // repeat a label: every row must begin with a time, two spaces, a time-or-blank, two spaces.
    for (const row of listing.split('\n')) {
      expect({
        row,
        shaped: /^-?\d+:\d\d:\d\d\.\d\d\d {2}(-?\d+:\d\d:\d\d\.\d\d\d| +) {2}\S/.test(row),
      }).toEqual({
        row,
        shaped: true,
      });
    }
  });

  it('has a shape with events to line up, so the sweep is not vacuous', async () => {
    const annotated = AWKWARD.find((file) => file.name === 'EDF+C with annotations');
    if (annotated === undefined) throw new Error('the matrix lost its annotated file');
    const recording = await openEdf(byteSource(annotated.bytes));
    const { annotations } = await readAnnotations(recording, {
      start: 0,
      count: recording.header.recordCount,
    });
    expect(annotations.length).toBeGreaterThan(0);
    expect(formatAnnotations(annotations)).not.toBe('');
  });
});
